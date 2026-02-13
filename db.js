const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
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
  shutdown,
};
