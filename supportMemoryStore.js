const { MAX_MESSAGES } = require('./supportMemory');

async function initSchema(client) {
  // One query is an atomic PostgreSQL schema upgrade. Never touch identity/order encryption.
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_memory_scopes (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      forum_id TEXT, expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id,thread_id)
    );
    CREATE TABLE IF NOT EXISTS support_memory_messages (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL, message_id TEXT NOT NULL,
      forum_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('customer','staff','bot')),
      at BIGINT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id,thread_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS support_memory_deletions (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, message_id TEXT NOT NULL,
      forum_id TEXT, customer_id TEXT,
      expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id,thread_id,message_id)
    );
    CREATE TABLE IF NOT EXISTS support_quality_signals (
      guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      forum_id TEXT, event_id TEXT NOT NULL, kind TEXT NOT NULL, area TEXT NOT NULL,
      at BIGINT NOT NULL DEFAULT 0, expires_at BIGINT NOT NULL, PRIMARY KEY (guild_id,thread_id,event_id)
    );
    CREATE TABLE IF NOT EXISTS support_memory_opt_outs (
      guild_id TEXT NOT NULL, forum_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      PRIMARY KEY (guild_id,forum_id,customer_id)
    );
    ALTER TABLE support_memory_scopes ADD COLUMN IF NOT EXISTS forum_id TEXT;
    ALTER TABLE support_memory_messages ADD COLUMN IF NOT EXISTS forum_id TEXT;
    ALTER TABLE support_quality_signals ADD COLUMN IF NOT EXISTS forum_id TEXT;
    ALTER TABLE support_quality_signals ADD COLUMN IF NOT EXISTS at BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE support_memory_deletions ADD COLUMN IF NOT EXISTS forum_id TEXT;
    ALTER TABLE support_memory_deletions ADD COLUMN IF NOT EXISTS customer_id TEXT;
    UPDATE support_memory_deletions d SET customer_id=s.customer_id,forum_id=s.forum_id
      FROM support_memory_scopes s WHERE d.guild_id=s.guild_id AND d.thread_id=s.thread_id
        AND d.customer_id IS NULL;

    -- Unknown legacy forum scope cannot be guessed. Remove its retained message copies.
    DELETE FROM support_memory_messages WHERE forum_id IS NULL;
    ALTER TABLE support_memory_messages DROP COLUMN IF EXISTS ciphertext;
    ALTER TABLE support_memory_messages DROP COLUMN IF EXISTS iv;
    ALTER TABLE support_memory_messages DROP COLUMN IF EXISTS tag;
    ALTER TABLE support_memory_messages DROP COLUMN IF EXISTS version;
    ALTER TABLE support_memory_messages ALTER COLUMN forum_id SET NOT NULL;

    -- Legacy opt-outs must never silently become opt-ins. An unknown old forum
    -- uses a conservative guild/customer suppression, not invented provenance.
    INSERT INTO support_memory_opt_outs(guild_id,forum_id,customer_id)
      SELECT s.guild_id,COALESCE(s.forum_id,'*'),s.customer_id
      FROM support_memory_scopes s JOIN support_memory_deletions d
        ON s.guild_id=d.guild_id AND s.thread_id=d.thread_id
      WHERE d.message_id='*' AND d.expires_at=9007199254740991
      ON CONFLICT DO NOTHING;

    CREATE INDEX IF NOT EXISTS support_memory_messages_expiry ON support_memory_messages(expires_at);
    CREATE INDEX IF NOT EXISTS support_quality_signals_expiry ON support_quality_signals(expires_at);
    CREATE INDEX IF NOT EXISTS support_memory_deletions_expiry ON support_memory_deletions(expires_at);
    CREATE INDEX IF NOT EXISTS support_memory_scopes_expiry ON support_memory_scopes(expires_at);
    CREATE INDEX IF NOT EXISTS support_memory_owner_forum ON support_memory_scopes(guild_id,forum_id,customer_id,expires_at);
  `);
}
function createPostgresStore(pool) {
  const args = row => [row.guildId, row.forumId, row.threadId, row.customerId];
  const map = row => ({ guildId: row.guild_id, forumId: row.forum_id, threadId: row.thread_id, customerId: row.customer_id,
    messageId: row.message_id, role: row.role, at: Number(row.at), expiresAt: Number(row.expires_at) });
  async function locked(scope, action) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The forum/owner barrier precedes the thread barrier in EVERY write.
      // Forgetting all posts and a queued first capture therefore serialize.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['support-memory-owner:' + scope.guildId + ':' + scope.forumId + ':' + scope.customerId]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['support-memory-thread:' + scope.guildId + ':' + scope.threadId]);
      const result = await action(client);
      await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* Keep original failure private. */ }
      throw error;
    } finally { client.release(); }
  }
  async function blocked(client, row, now) {
    const result = await client.query(`SELECT 1 FROM support_memory_opt_outs
      WHERE guild_id=$1 AND forum_id IN ($2,'*') AND customer_id=$3 LIMIT 1`, [row.guildId,row.forumId,row.customerId]);
    if (result.rows.length) return true;
    const deleted = await client.query(`SELECT 1 FROM support_memory_deletions
      WHERE guild_id=$1 AND thread_id=$2 AND message_id IN ('*',$3) AND expires_at>$4 LIMIT 1`,
    [row.guildId,row.threadId,row.messageId || '',now]);
    return Boolean(deleted.rows.length);
  }
  async function register(client, row, now) {
    if (await blocked(client,row,now)) return false;
    await client.query(`INSERT INTO support_memory_scopes(guild_id,forum_id,thread_id,customer_id,expires_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(guild_id,thread_id) DO UPDATE SET
      expires_at=GREATEST(support_memory_scopes.expires_at,EXCLUDED.expires_at),
      forum_id=COALESCE(support_memory_scopes.forum_id,EXCLUDED.forum_id)
      WHERE support_memory_scopes.customer_id=EXCLUDED.customer_id
      AND (support_memory_scopes.forum_id IS NULL OR support_memory_scopes.forum_id=EXCLUDED.forum_id)`, [...args(row),row.expiresAt]);
    const owner = await client.query('SELECT customer_id,forum_id FROM support_memory_scopes WHERE guild_id=$1 AND thread_id=$2', [row.guildId,row.threadId]);
    if (owner.rows[0]?.customer_id !== row.customerId || owner.rows[0]?.forum_id !== row.forumId) return false;
    // Legacy metadata-only outcomes remain quarantined until live channel scope
    // is observed; this never guesses a forum or reconstructs message text.
    await client.query(`UPDATE support_quality_signals SET forum_id=$2
      WHERE guild_id=$1 AND thread_id=$3 AND customer_id=$4 AND forum_id IS NULL`, args(row));
    return true;
  }
  return {
    async put(row, now) {
      return locked(row, async client => {
        if (!await register(client,row,now)) return false;
        await client.query(`INSERT INTO support_memory_messages
          (guild_id,forum_id,thread_id,customer_id,message_id,role,at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(guild_id,thread_id,message_id) DO NOTHING`,
        [...args(row),row.messageId,row.role,row.at,row.expiresAt]);
        await client.query(`DELETE FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 AND message_id IN
          (SELECT message_id FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 ORDER BY at DESC,message_id DESC OFFSET $3)`,
        [row.guildId,row.threadId,MAX_MESSAGES]);
        return true;
      });
    },
    async list(scope, now) {
      const { rows } = await pool.query(`SELECT guild_id,forum_id,thread_id,customer_id,message_id,role,at,expires_at
        FROM support_memory_messages m WHERE guild_id=$1 AND forum_id=$2 AND thread_id=$3 AND customer_id=$4 AND expires_at>$5
        AND NOT EXISTS(SELECT 1 FROM support_memory_opt_outs o WHERE o.guild_id=m.guild_id AND o.forum_id IN (m.forum_id,'*') AND o.customer_id=m.customer_id)
        AND NOT EXISTS(SELECT 1 FROM support_memory_deletions d WHERE d.guild_id=m.guild_id AND d.thread_id=m.thread_id
          AND d.message_id IN ('*',m.message_id) AND d.expires_at>$5)
        ORDER BY at DESC,message_id DESC LIMIT 50`, [...args(scope),now]);
      return rows.reverse().map(map);
    },
    async otherThreads(scope, now) {
      const { rows } = await pool.query(`WITH activity AS (
          SELECT guild_id,forum_id,thread_id,customer_id,at FROM support_memory_messages WHERE expires_at>$5
          UNION ALL
          SELECT guild_id,forum_id,thread_id,customer_id,at FROM support_quality_signals WHERE expires_at>$5
        ), candidates AS (
          SELECT guild_id,forum_id,thread_id,customer_id,MAX(at) AS at FROM activity
          WHERE guild_id=$1 AND forum_id=$2 AND thread_id<>$3 AND customer_id=$4 AND at>0
          GROUP BY guild_id,forum_id,thread_id,customer_id
        )
        SELECT c.*,COALESCE((SELECT kind FROM support_quality_signals q
          WHERE q.guild_id=c.guild_id AND q.forum_id=c.forum_id AND q.thread_id=c.thread_id AND q.customer_id=c.customer_id
            AND q.expires_at>$5 AND q.kind IN ('needs_help','reopened','answer_sent','handoff_delivered','resolved')
            ORDER BY q.at DESC,q.event_id DESC LIMIT 1),'unknown') AS outcome
        FROM candidates c
        WHERE NOT EXISTS(SELECT 1 FROM support_memory_opt_outs o WHERE o.guild_id=c.guild_id AND o.forum_id IN (c.forum_id,'*') AND o.customer_id=c.customer_id)
        AND NOT EXISTS(SELECT 1 FROM support_memory_deletions d WHERE d.guild_id=c.guild_id AND d.thread_id=c.thread_id AND d.message_id='*' AND d.expires_at>$5)
        ORDER BY c.at DESC,c.thread_id DESC LIMIT 2`, [...args(scope),now]);
      return rows.map(row => ({ guildId: row.guild_id, forumId: row.forum_id, threadId: row.thread_id,
        customerId: row.customer_id, at: Number(row.at), outcome: row.outcome }));
    },
    async contextReferences(scope, now) {
      const { rows } = await pool.query(`WITH ranked AS (
        SELECT guild_id,forum_id,thread_id,customer_id,message_id,role,at,expires_at,
          ROW_NUMBER() OVER(PARTITION BY role ORDER BY at DESC,message_id DESC) AS position
        FROM support_memory_messages m WHERE guild_id=$1 AND forum_id=$2 AND thread_id=$3 AND customer_id=$4
          AND expires_at>$5 AND role IN ('customer','bot')
          AND NOT EXISTS(SELECT 1 FROM support_memory_opt_outs o WHERE o.guild_id=m.guild_id AND o.forum_id IN (m.forum_id,'*') AND o.customer_id=m.customer_id)
          AND NOT EXISTS(SELECT 1 FROM support_memory_deletions d WHERE d.guild_id=m.guild_id AND d.thread_id=m.thread_id AND d.message_id IN ('*',m.message_id) AND d.expires_at>$5)
        ) SELECT guild_id,forum_id,thread_id,customer_id,message_id,role,at,expires_at FROM ranked
        WHERE position<=CASE WHEN role='customer' THEN 3 ELSE 1 END ORDER BY at,message_id`, [...args(scope),now]);
      return rows.map(map);
    },
    async isSuppressed(scope, now) { return blocked(pool,scope,now); },
    async forget(scope, messageId, until, { onlyKnown = false } = {}) {
      return locked(scope, async client => {
        const { rows } = await client.query('SELECT customer_id,forum_id FROM support_memory_scopes WHERE guild_id=$1 AND thread_id=$2', [scope.guildId,scope.threadId]);
        if (onlyKnown && !rows.length) return false;
        if (rows.length && (rows[0].customer_id !== scope.customerId || (rows[0].forum_id && rows[0].forum_id !== scope.forumId))) throw Error('Support memory owner mismatch');
        await client.query(`INSERT INTO support_memory_deletions(guild_id,thread_id,message_id,expires_at,forum_id,customer_id) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT(guild_id,thread_id,message_id) DO UPDATE SET expires_at=GREATEST(support_memory_deletions.expires_at,EXCLUDED.expires_at)`,
        [scope.guildId,scope.threadId,messageId || '*',until,scope.forumId,scope.customerId]);
        await client.query('DELETE FROM support_memory_messages WHERE guild_id=$1 AND thread_id=$2 AND ($3::text IS NULL OR message_id=$3)', [scope.guildId,scope.threadId,messageId]);
        await client.query('DELETE FROM support_quality_signals WHERE guild_id=$1 AND thread_id=$2', [scope.guildId,scope.threadId]);
        return true;
      });
    },
    async forgetCustomer(scope) {
      return locked(scope, async client => {
        await client.query('INSERT INTO support_memory_opt_outs(guild_id,forum_id,customer_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [scope.guildId,scope.forumId,scope.customerId]);
        for (const table of ['support_memory_messages','support_quality_signals','support_memory_deletions','support_memory_scopes']) {
          await client.query('DELETE FROM ' + table + ' WHERE guild_id=$1 AND customer_id=$3 AND (forum_id=$2 OR forum_id IS NULL)', [scope.guildId,scope.forumId,scope.customerId]);
        }
        return true;
      });
    },
    async signal(row, now) {
      return locked(row, async client => {
        if (!await register(client,row,now)) return false;
        await client.query(`INSERT INTO support_quality_signals(guild_id,forum_id,thread_id,customer_id,event_id,kind,area,at,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`, [...args(row),row.eventId,row.kind,row.area,row.at,row.expiresAt]);
        return true;
      });
    },
    async report(now) {
      return (await pool.query(`SELECT kind,area,COUNT(*)::int AS count FROM support_quality_signals
        WHERE expires_at>$1 GROUP BY kind,area ORDER BY kind,area`, [now])).rows;
    },
    async prune(now) {
      for (const table of ['support_memory_messages','support_quality_signals','support_memory_deletions','support_memory_scopes']) {
        await pool.query('DELETE FROM ' + table + ' WHERE ctid IN (SELECT ctid FROM ' + table + ' WHERE expires_at<=$1 LIMIT 1000)', [now]);
      }
    },
  };
}
module.exports = { initSchema, createPostgresStore };
