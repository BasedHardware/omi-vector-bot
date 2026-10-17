const { MAX_MESSAGES } = require('./supportMemory');

async function initSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_memory_scopes (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS support_memory_messages (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL, message_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'staff', 'bot')),
      at BIGINT NOT NULL, version BIGINT NOT NULL, expires_at BIGINT NOT NULL,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL,
      PRIMARY KEY (guild_id, thread_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS support_memory_deletions (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
      expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id, thread_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS support_quality_signals (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      event_id TEXT NOT NULL, kind TEXT NOT NULL, area TEXT NOT NULL, expires_at BIGINT NOT NULL,
      PRIMARY KEY (guild_id, thread_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS support_memory_messages_expiry ON support_memory_messages(expires_at);
    CREATE INDEX IF NOT EXISTS support_quality_signals_expiry ON support_quality_signals(expires_at);
    CREATE INDEX IF NOT EXISTS support_memory_deletions_expiry ON support_memory_deletions(expires_at);
    CREATE INDEX IF NOT EXISTS support_memory_scopes_expiry ON support_memory_scopes(expires_at);
  `);
}

function createPostgresStore(pool) {
  async function locked(scope, action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`support-memory:${scope.guildId}:${scope.threadId}`]);
      const result = await action(client);
      await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the failure. */ }
      throw error;
    } finally { client.release(); }
  }
  const scopeArgs = row => [row.guildId, row.threadId, row.customerId];
  async function register(client, row, now) {
    await client.query(`INSERT INTO support_memory_scopes(guild_id, thread_id, customer_id, expires_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT(guild_id,thread_id) DO UPDATE SET expires_at=GREATEST(support_memory_scopes.expires_at,EXCLUDED.expires_at)
      WHERE support_memory_scopes.customer_id=EXCLUDED.customer_id`, [...scopeArgs(row), row.expiresAt]);
    const owner = await client.query('SELECT customer_id FROM support_memory_scopes WHERE guild_id=$1 AND thread_id=$2', scopeArgs(row).slice(0, 2));
    if (owner.rows[0]?.customer_id !== row.customerId) return false;
    const deleted = await client.query(`SELECT 1 FROM support_memory_deletions WHERE guild_id=$1 AND thread_id=$2
      AND message_id IN ('*',$3) AND expires_at>$4 LIMIT 1`, [row.guildId, row.threadId, row.messageId || '', now]);
    return !deleted.rows.length;
  }
  return {
    async put(row, now) {
      return locked(row, async client => {
        if (!await register(client, row, now)) return false;
        await client.query(`INSERT INTO support_memory_messages(guild_id,thread_id,customer_id,message_id,role,at,version,expires_at,ciphertext,iv,tag)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(guild_id,thread_id,message_id) DO UPDATE SET
          role=EXCLUDED.role, version=EXCLUDED.version, ciphertext=EXCLUDED.ciphertext, iv=EXCLUDED.iv, tag=EXCLUDED.tag
          WHERE support_memory_messages.customer_id=EXCLUDED.customer_id AND support_memory_messages.version<=EXCLUDED.version`,
        [...scopeArgs(row), row.messageId, row.role, row.at, row.version, row.expiresAt, row.ciphertext, row.iv, row.tag]);
        await client.query(`DELETE FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 AND message_id IN
          (SELECT message_id FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 ORDER BY at DESC,message_id DESC OFFSET $3)`, [row.guildId, row.threadId, MAX_MESSAGES]);
        return true;
      });
    },
    async list(scope, now) {
      const { rows } = await pool.query(`SELECT * FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 AND customer_id=$3
        AND expires_at>$4 ORDER BY at DESC,message_id DESC LIMIT 50`, [...scopeArgs(scope), now]);
      return rows.reverse().map(row => ({ guildId: row.guild_id, threadId: row.thread_id, customerId: row.customer_id,
        messageId: row.message_id, role: row.role, at: Number(row.at), version: Number(row.version), expiresAt: Number(row.expires_at),
        ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }));
    },
    async forget(scope, messageId, until, { onlyKnown = false } = {}) {
      return locked(scope, async client => {
        const { rows } = await client.query('SELECT customer_id FROM support_memory_scopes WHERE guild_id=$1 AND thread_id=$2', scopeArgs(scope).slice(0, 2));
        if (onlyKnown && !rows.length) return false;
        if (rows.length && rows[0].customer_id !== scope.customerId) throw Error('Support memory owner mismatch');
        await client.query(`INSERT INTO support_memory_deletions(guild_id,thread_id,message_id,expires_at) VALUES ($1,$2,$3,$4)
          ON CONFLICT(guild_id,thread_id,message_id) DO UPDATE SET expires_at=GREATEST(support_memory_deletions.expires_at,EXCLUDED.expires_at)`,
        [scope.guildId, scope.threadId, messageId || '*', until]);
        await client.query('DELETE FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 AND ($3::text IS NULL OR message_id=$3)', [scope.guildId, scope.threadId, messageId]);
        await client.query('DELETE FROM support_quality_signals WHERE guild_id=$1 AND thread_id=$2', scopeArgs(scope).slice(0, 2));
      });
    },
    async signal(row, now) {
      return locked(row, async client => {
        if (!await register(client, row, now)) return false;
        await client.query(`INSERT INTO support_quality_signals(guild_id,thread_id,customer_id,event_id,kind,area,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [...scopeArgs(row), row.eventId, row.kind, row.area, row.expiresAt]);
        return true;
      });
    },
    async report(now) {
      const { rows } = await pool.query(`SELECT kind,area,COUNT(*)::int AS count FROM support_quality_signals
        WHERE expires_at>$1 GROUP BY kind,area ORDER BY kind,area`, [now]);
      return rows;
    },
    async prune(now) {
      // Bounded batches avoid a long startup/timer transaction on a busy forum.
      for (const table of ['support_memory_messages', 'support_quality_signals', 'support_memory_deletions', 'support_memory_scopes']) {
        await pool.query(`DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} WHERE expires_at<=$1 LIMIT 1000)`, [now]);
      }
    },
  };
}

module.exports = { initSchema, createPostgresStore };
