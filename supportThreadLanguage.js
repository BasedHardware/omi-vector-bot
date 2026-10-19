// Closing-card preferences only. No conversation text or process-local fallback.
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function validScope(scope) {
  return scope && ['guildId', 'threadId', 'ownerId'].every(key => validId(scope[key]));
}

function scopeForThread(channel) {
  if (!channel?.isThread?.()) return null;
  const scope = { guildId: channel.guildId || channel.guild?.id,
    threadId: channel.id, ownerId: channel.ownerId };
  return validScope(scope) ? scope : null;
}

function languageCode(value) {
  return typeof value === 'string' && /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?$/.test(value) ? value : null;
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_thread_languages (
    guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL,
    language_code TEXT NOT NULL CHECK (language_code ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (guild_id, thread_id, owner_id)
  );
  CREATE INDEX IF NOT EXISTS support_thread_languages_expiry ON support_thread_languages (expires_at);`);
}

function createStore(pool, { now = () => Date.now() } = {}) {
  if (!pool?.query) throw new Error('Language preference database is required');
  return {
    async save(scope, language) {
      const code = languageCode(language);
      if (!validScope(scope) || !code) return false;
      await pool.query(`INSERT INTO support_thread_languages (guild_id, thread_id, owner_id, language_code, expires_at)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (guild_id, thread_id, owner_id)
        DO UPDATE SET language_code=EXCLUDED.language_code, expires_at=EXCLUDED.expires_at`,
      [scope.guildId, scope.threadId, scope.ownerId, code, new Date(now() + RETENTION_MS)]);
      return true;
    },
    async get(scope) {
      if (!validScope(scope)) return null;
      const result = await pool.query(`SELECT language_code FROM support_thread_languages
        WHERE guild_id=$1 AND thread_id=$2 AND owner_id=$3 AND expires_at>$4`,
      [scope.guildId, scope.threadId, scope.ownerId, new Date(now())]);
      return languageCode(result.rows[0]?.language_code);
    },
    async forgetThread(channel) {
      const guildId = channel?.guildId || channel?.guild?.id;
      if (!validId(guildId) || !validId(channel?.id)) return;
      await pool.query('DELETE FROM support_thread_languages WHERE guild_id=$1 AND thread_id=$2', [guildId, channel.id]);
    },
    async prune() {
      await pool.query(`DELETE FROM support_thread_languages WHERE (guild_id, thread_id, owner_id) IN
        (SELECT guild_id, thread_id, owner_id FROM support_thread_languages WHERE expires_at<=$1
         ORDER BY expires_at LIMIT 1000)`, [new Date(now())]);
    },
  };
}

function getStore() {
  return process.env.DATABASE_URL ? createStore(require('./db').pool) : null;
}

module.exports = { RETENTION_MS, scopeForThread, languageCode, initSchema, createStore, getStore };
