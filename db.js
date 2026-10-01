const fs = require('fs');
const { Pool } = require('pg');
const { chunkDocument, cleanDocument, queryTerms, sourceAuthority } = require('./retrieval');

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

      CREATE TABLE IF NOT EXISTS doc_chunks (
        url TEXT NOT NULL REFERENCES doc_pages(url) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        section TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'other',
        authority INTEGER NOT NULL DEFAULT 2,
        body TEXT NOT NULL DEFAULT '',
        search_vector TSVECTOR GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(section, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(body, '')), 'B')
        ) STORED,
        PRIMARY KEY (url, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS doc_chunks_search_idx ON doc_chunks USING GIN (search_vector);
      CREATE INDEX IF NOT EXISTS doc_chunks_source_idx ON doc_chunks (source, authority DESC);

      CREATE TABLE IF NOT EXISTS source_sync (
        source_key TEXT PRIMARY KEY,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        item_count INTEGER NOT NULL DEFAULT 0
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

      CREATE TABLE IF NOT EXISTS ratings (
        thread_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        helped BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const chunks = await client.query(`SELECT count(*)::int AS n FROM doc_chunks`);
    const pages = await client.query(`SELECT count(*)::int AS n FROM doc_pages`);
    if ((chunks.rows[0]?.n || 0) === 0 && (pages.rows[0]?.n || 0) > 0) {
      const existing = await client.query(`SELECT url, title, body FROM doc_pages`);
      for (const page of existing.rows) {
        await replaceDocChunks(client, page);
      }
      console.log(`[DB] indexed ${existing.rows.length} existing page(s)`);
    }
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
  return queryTerms(text, 12);
}

async function replaceDocChunks(client, page) {
  const chunks = chunkDocument(page);
  await client.query(`DELETE FROM doc_chunks WHERE url = $1`, [page.url]);
  for (const chunk of chunks) {
    await client.query(
      `INSERT INTO doc_chunks
       (url, chunk_index, title, section, source, authority, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        chunk.url,
        chunk.chunkIndex,
        chunk.title,
        chunk.section,
        chunk.source,
        sourceAuthority(chunk.source),
        chunk.body,
      ]
    );
  }
  return chunks.length;
}

async function saveDocPage({ url, title, body }) {
  if (!url) return;
  const page = {
    url: String(url),
    title: String(title || ''),
    body: cleanDocument(body),
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO doc_pages (url, title, body, fetched_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (url) DO UPDATE SET title = $2, body = $3, fetched_at = NOW()`,
      [page.url, page.title, page.body]
    );
    await replaceDocChunks(client, page);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function searchDocPages(question, limit = 8, sources = []) {
  const words = queryWords(question);
  if (!words.length) return [];
  const search = words.join(' OR ');
  const wantedSources = Array.isArray(sources) ? sources.map(String).filter(Boolean) : [];
  const { rows } = await pool.query(
    `WITH query AS (SELECT websearch_to_tsquery('english', $1) AS value)
     SELECT title, url, section, source, authority, body, chunk_index,
            ts_rank_cd(search_vector, query.value, 32) AS rank
     FROM doc_chunks, query
     WHERE search_vector @@ query.value
       AND (cardinality($3::text[]) = 0 OR source = ANY($3::text[]))
     ORDER BY (ts_rank_cd(search_vector, query.value, 32) * (1 + authority * 0.06)) DESC,
              authority DESC,
              chunk_index ASC
     LIMIT $2`,
    [search, limit, wantedSources]
  );
  return rows;
}

async function markSourceSynced(sourceKey, itemCount) {
  if (!sourceKey) return;
  await pool.query(
    `INSERT INTO source_sync (source_key, synced_at, item_count)
     VALUES ($1, NOW(), $2)
     ON CONFLICT (source_key)
     DO UPDATE SET synced_at = NOW(), item_count = $2`,
    [String(sourceKey), Number(itemCount) || 0]
  );
}

async function sourceNeedsSync(sourceKey, maxAgeMs = 24 * 60 * 60 * 1000) {
  const { rows } = await pool.query(
    `SELECT synced_at FROM source_sync WHERE source_key = $1`,
    [String(sourceKey)]
  );
  const at = rows[0]?.synced_at ? new Date(rows[0].synced_at).getTime() : 0;
  return !at || Date.now() - at >= maxAgeMs;
}

async function saveRating(threadId, userId, helped) {
  if (!threadId || !userId) return;
  await pool.query(
    `INSERT INTO ratings (thread_id, user_id, helped)
     VALUES ($1, $2, $3)
     ON CONFLICT (thread_id) DO UPDATE SET user_id = $2, helped = $3, created_at = NOW()`,
    [String(threadId), String(userId), Boolean(helped)]
  );
}

async function ratingCounts() {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE helped)::int AS yes,
       count(*) FILTER (WHERE NOT helped)::int AS no
     FROM ratings`
  );
  return { yes: rows[0]?.yes || 0, no: rows[0]?.no || 0 };
}

async function countPagesLike(prefix) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM doc_pages WHERE url LIKE $1`, [`${prefix}%`]);
  return rows[0].n;
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
  markSourceSynced,
  sourceNeedsSync,
  countPagesLike,
  saveRating,
  ratingCounts,
  saveRelease,
  searchReleases,
  saveIssueThread,
  listIssueThreads,
  sslFor,
  shutdown,
};
