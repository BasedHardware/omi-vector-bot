const fs = require('fs');
const { Pool } = require('pg');

function sslFor(connectionString) {
  const value = String(connectionString || '');
  if (!value || /localhost|127\.0\.0\.1|\.railway\.internal/i.test(value)) return false;
  if (process.env.PGSSLROOTCERT) {
    return { rejectUnauthorized: true, ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8') };
  }
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslFor(process.env.DATABASE_URL),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        last_message_id TEXT
      );

      CREATE TABLE IF NOT EXISTS escalations (
        id SERIAL PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS knowledge_base (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS doc_pages (
        url TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS releases (
        tag TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS issue_threads (
        issue_number INTEGER NOT NULL,
        thread_id TEXT NOT NULL,
        PRIMARY KEY (issue_number, thread_id)
      );
    `);
    console.log('[DB] Schema initialized');
  } finally {
    client.release();
  }
}

async function upsertThread(threadId, lastMessageId) {
  await pool.query(
    `INSERT INTO threads (thread_id, last_message_id)
     VALUES ($1, $2)
     ON CONFLICT (thread_id)
     DO UPDATE SET last_message_id = $2`,
    [threadId, lastMessageId]
  );
}

async function createEscalation(threadId) {
  const { rows } = await pool.query(
    `INSERT INTO escalations (thread_id, status) VALUES ($1, 'pending') RETURNING id`,
    [threadId]
  );
  return rows[0].id;
}

async function getPendingEscalation(threadId) {
  const { rows } = await pool.query(
    `SELECT id, thread_id FROM escalations
     WHERE thread_id = $1 AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`,
    [threadId]
  );
  return rows[0] || null;
}

async function resolveEscalation(id) {
  await pool.query(
    `UPDATE escalations SET status = 'resolved' WHERE id = $1`,
    [id]
  );
}

async function getAllPendingEscalations() {
  const { rows } = await pool.query(
    `SELECT id, thread_id FROM escalations WHERE status = 'pending' ORDER BY created_at ASC`
  );
  return rows;
}

async function addKnowledge(content) {
  await pool.query(
    `INSERT INTO knowledge_base (content) VALUES ($1)`,
    [content]
  );
}

async function searchKnowledge(query, limit = 3) {
  // Simple keyword search — returns most recent relevant snippets
  // For production, consider pg_trgm or a vector DB for semantic search
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);

  if (words.length === 0) {
    const { rows } = await pool.query(
      `SELECT content FROM knowledge_base ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows.map((r) => r.content);
  }

  const conditions = words.map((_, i) => `LOWER(content) LIKE $${i + 1}`);
  const params = words.map((w) => `%${w}%`);
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT content FROM knowledge_base
     WHERE ${conditions.join(' OR ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((r) => r.content);
}

function queryWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 5);
}

async function saveDocPage({ url, title, body }) {
  if (!url) return;
  await pool.query(
    `INSERT INTO doc_pages (url, title, body, fetched_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (url) DO UPDATE SET title = $2, body = $3, fetched_at = NOW()`,
    [url, String(title || ''), String(body || '').slice(0, 4000)]
  );
}

async function searchDocPages(question, limit = 2) {
  const words = queryWords(question);
  if (!words.length) return [];
  const clauses = words.map((_, i) => `(title || ' ' || body) ILIKE $${i + 1}`);
  const params = words.map((word) => `%${word}%`);
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT title, url, body FROM doc_pages
     WHERE ${clauses.join(' OR ')}
     ORDER BY fetched_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function saveRelease({ tag, name, body, publishedAt }) {
  if (!tag) return;
  await pool.query(
    `INSERT INTO releases (tag, name, body, published_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tag) DO UPDATE SET name = $2, body = $3, published_at = $4`,
    [tag, String(name || ''), String(body || '').slice(0, 800), publishedAt || null]
  );
}

async function searchReleases(question, limit = 1) {
  const words = queryWords(question);
  if (!words.length) return [];
  const clauses = words.map((_, i) => `(name || ' ' || body) ILIKE $${i + 1}`);
  const params = words.map((word) => `%${word}%`);
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT tag, name, body FROM releases
     WHERE ${clauses.join(' OR ')}
     ORDER BY published_at DESC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

async function saveIssueThread(issueNumber, threadId) {
  const number = Number(issueNumber);
  const thread = String(threadId || '');
  if (!number || !thread) return;
  await pool.query(
    `INSERT INTO issue_threads (issue_number, thread_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [number, thread]
  );
}

async function listIssueThreads() {
  const { rows } = await pool.query(
    `SELECT issue_number, thread_id FROM issue_threads ORDER BY issue_number`
  );
  return rows;
}

async function shutdown() {
  await pool.end();
  console.log('[DB] Pool closed');
}

module.exports = {
  pool,
  initSchema,
  upsertThread,
  createEscalation,
  getPendingEscalation,
  resolveEscalation,
  getAllPendingEscalations,
  addKnowledge,
  searchKnowledge,
  saveDocPage,
  searchDocPages,
  saveRelease,
  searchReleases,
  saveIssueThread,
  listIssueThreads,
  sslFor,
  shutdown,
};
