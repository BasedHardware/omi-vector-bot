const { hashContent, normalizeText, candidateDigest, normalizedValidation } = require('./knowledgeReview');
const clone = value => value == null ? null : structuredClone(value);
const words = query => String(query || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)?.slice(0, 8) || [];

function eligible(state, now, scope) {
  const row = state?.versions?.[(state.publishedVersion || 0) - 1];
  return row?.status === 'published' && row.recheckAt > now && row.approvedBy && row.approvedAt &&
    scope && candidateDigest(scope, row) === row.digest && normalizedValidation(row.validation, row, now) ? row : null;
}

function createMemoryStore() {
  const rows = new Map(), tails = new Map(), erasures = new Map();
  const key = scope => `${scope.guildId}:${scope.factId}`;
  return {
    async mutate(scope, change, { create = false } = {}) {
      const entry = key(scope);
      const previous = tails.get(entry) || Promise.resolve();
      let unlock;
      const hold = new Promise(resolve => { unlock = resolve; });
      const tail = previous.then(() => hold); tails.set(entry, tail);
      await previous;
      try {
        const current = clone(rows.get(entry)?.state);
        if (!current && !create) return { ok: false, reason: 'stale' };
        const result = await change(current);
        if (result.state) {
          const at = result.state.updatedAt;
          for (const version of result.state.versions) version.provenance = version.provenance.filter(item =>
            item.expiresAt > at && !(erasures.get(`${scope.guildId}:${item.caseId}`) > at));
          rows.set(entry, { guildId: scope.guildId, factId: scope.factId, state: clone(result.state) });
        }
        return clone(result.result);
      } finally { unlock(); if (tails.get(entry) === tail) tails.delete(entry); }
    },
    async read(scope) { return clone(rows.get(key(scope))?.state); },
    async search(guildId, query, now, limit) {
      const wanted = words(query);
      if (!wanted.length) return [];
      return [...rows.values()].filter(row => row.guildId === guildId)
        .sort((a, b) => b.state.updatedAt - a.state.updatedAt)
        .map(row => ({ factId: row.factId, ...clone(eligible(row.state, now, row)) }))
        .filter(row => row.content && wanted.some(word => row.content.toLowerCase().includes(word))).slice(0, limit);
    },
    async managedHashes(guildId, hashes, notes = []) {
      const wanted = new Set(hashes);
      const managed = [...rows.values()].filter(row => row.guildId === guildId).flatMap(row => row.state.versions.filter(version => version.managed === true));
      const blocked = managed.map(version => version.contentHash).filter(hash => wanted.has(hash));
      for (const note of notes) if (managed.some(version => normalizeText(note).includes(normalizeText(version.content)))) blocked.push(hashContent(note));
      return [...new Set(blocked)];
    },
    async eraseProvenance(guildId, now, caseIds) {
      for (const caseId of caseIds) erasures.set(`${guildId}:${caseId}`, now + 30 * 86_400_000);
    },
    async cleanProvenance(guildId, now, caseIds = []) {
      const removed = new Set(caseIds);
      const pending = [...rows.values()].filter(row => row.guildId === guildId && row.state.versions.some(version =>
        version.provenance.some(item => item.expiresAt <= now || removed.has(item.caseId))))
        .sort((a, b) => a.factId.localeCompare(b.factId));
      for (const row of pending.slice(0, 100)) {
        await this.mutate(row, state => {
          for (const version of state.versions) version.provenance = version.provenance.filter(item => item.expiresAt > now && !removed.has(item.caseId));
          return { state, result: true };
        });
      }
      for (const [key, until] of erasures) if (until <= now) erasures.delete(key);
      return { processed: Math.min(100, pending.length), remaining: pending.length > 100 };
    },
    async pruneExpiredProvenance(now, { shouldStop = () => false } = {}) {
      const pending = [...rows.values()].filter(row => row.state.versions.some(version =>
        version.provenance.some(item => item.expiresAt <= now)))
        .sort((a, b) => a.guildId.localeCompare(b.guildId) || a.factId.localeCompare(b.factId));
      let examined = 0, barriersDeleted = 0;
      for (const row of pending.slice(0, 100)) {
        if (shouldStop()) break;
        await this.mutate(row, state => {
          for (const version of state.versions) version.provenance = version.provenance.filter(item => item.expiresAt > now);
          return { state, result: true };
        });
        examined++;
      }
      if (!shouldStop()) for (const [key, until] of erasures) {
        if (barriersDeleted >= 1000) break;
        if (until <= now) { erasures.delete(key); barriersDeleted++; }
      }
      return { examined, barriersDeleted, remaining: pending.length > examined || barriersDeleted === 1000 };
    },
  };
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_reviewed_knowledge (
    guild_id TEXT NOT NULL, fact_id TEXT NOT NULL, state JSONB NOT NULL,
    PRIMARY KEY(guild_id,fact_id), CHECK(jsonb_typeof(state)='object')
  )`);
  await client.query(`CREATE TABLE IF NOT EXISTS support_knowledge_erasures (
    guild_id TEXT NOT NULL, case_id TEXT NOT NULL, expires_at BIGINT NOT NULL,
    PRIMARY KEY(guild_id,case_id)
  ); CREATE INDEX IF NOT EXISTS support_knowledge_erasures_expiry ON support_knowledge_erasures(expires_at)`);
}

function createPostgresStore(pool) {
  return {
    async mutate(scope, change, { create = false, statementTimeoutMs = 0 } = {}) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (statementTimeoutMs) await client.query("SELECT set_config('statement_timeout',$1,true)", [String(statementTimeoutMs)]);
        await client.query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))', [`knowledge-erasure:${scope.guildId}`]);
        if (create) await client.query(`INSERT INTO support_reviewed_knowledge(guild_id,fact_id,state) VALUES($1,$2,'{}') ON CONFLICT DO NOTHING`, [scope.guildId, scope.factId]);
        const { rows } = await client.query('SELECT state FROM support_reviewed_knowledge WHERE guild_id=$1 AND fact_id=$2 FOR UPDATE', [scope.guildId, scope.factId]);
        if (!rows.length) { await client.query('COMMIT'); return { ok: false, reason: 'stale' }; }
        const current = rows[0].state.latestVersion ? rows[0].state : null;
        const result = await change(clone(current));
        if (result.state) {
          const at = result.state.updatedAt;
          const caseIds = [...new Set(result.state.versions.flatMap(row => row.provenance.map(item => item.caseId)))];
          const deleted = await client.query('SELECT case_id FROM support_knowledge_erasures WHERE guild_id=$1 AND expires_at>$2 AND case_id=ANY($3::text[])', [scope.guildId, at, caseIds]);
          const erased = new Set(deleted.rows.map(row => row.case_id));
          for (const version of result.state.versions) version.provenance = version.provenance.filter(item => item.expiresAt > at && !erased.has(item.caseId));
          await client.query('UPDATE support_reviewed_knowledge SET state=$3::jsonb WHERE guild_id=$1 AND fact_id=$2', [scope.guildId, scope.factId, JSON.stringify(result.state)]);
        }
        else if (!current) await client.query('DELETE FROM support_reviewed_knowledge WHERE guild_id=$1 AND fact_id=$2', [scope.guildId, scope.factId]);
        await client.query('COMMIT'); return result.result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the failure. */ }
        throw error;
      } finally { client.release(); }
    },
    async read(scope) {
      const { rows } = await pool.query('SELECT state FROM support_reviewed_knowledge WHERE guild_id=$1 AND fact_id=$2', [scope.guildId, scope.factId]);
      return rows[0]?.state || null;
    },
    async search(guildId, query, now, limit) {
      const wanted = words(query);
      if (!wanted.length) return [];
      const { rows } = await pool.query(`SELECT fact_id, state FROM support_reviewed_knowledge,
        LATERAL (SELECT state->'versions'->((state->>'publishedVersion')::integer-1) AS version) AS current
        WHERE guild_id=$1 AND current.version->>'status'='published'
          AND (current.version->>'recheckAt')::bigint>$2
          AND EXISTS(SELECT 1 FROM unnest($3::text[]) AS term WHERE strpos(lower(current.version->>'content'),term)>0)
        ORDER BY (state->>'updatedAt')::bigint DESC LIMIT $4`, [guildId, now, wanted, limit]);
      return rows.map(row => ({ factId: row.fact_id, ...eligible(row.state, now, { guildId, factId: row.fact_id }) })).filter(row => row.content);
    },
    async managedHashes(guildId, hashes, notes = []) {
      if (!hashes.length) return [];
      const { rows } = await pool.query(`SELECT DISTINCT candidate.hash FROM support_reviewed_knowledge,
        LATERAL unnest($2::text[],$3::text[]) AS candidate(hash,content),
        LATERAL jsonb_array_elements(coalesce(state->'versions','[]'::jsonb)) AS version
        WHERE guild_id=$1 AND (version->>'managed')::boolean IS TRUE AND
          (version->>'contentHash'=candidate.hash OR
           (length(version->>'contentMatch')>0 AND strpos(candidate.content,version->>'contentMatch')>0))`,
      [guildId, hashes, notes.length ? notes.map(normalizeText) : hashes.map(() => '')]);
      return rows.map(row => row.hash);
    },
    async eraseProvenance(guildId, now, caseIds) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`knowledge-erasure:${guildId}`]);
        for (const caseId of caseIds) await client.query(`INSERT INTO support_knowledge_erasures(guild_id,case_id,expires_at) VALUES($1,$2,$3)
          ON CONFLICT(guild_id,case_id) DO UPDATE SET expires_at=GREATEST(support_knowledge_erasures.expires_at,EXCLUDED.expires_at)`, [guildId, caseId, now + 30 * 86_400_000]);
        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the failure. */ }
        throw error;
      } finally { client.release(); }
    },
    async cleanProvenance(guildId, now, caseIds = []) {
      const { rows } = await pool.query(`SELECT fact_id FROM support_reviewed_knowledge WHERE guild_id=$1 AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(coalesce(state->'versions','[]'::jsonb)) AS version,
        LATERAL jsonb_array_elements(coalesce(version->'provenance','[]'::jsonb)) AS item
        WHERE (item->>'expiresAt')::bigint<=$2 OR item->>'caseId'=ANY($3::text[]))
        ORDER BY fact_id LIMIT 101`, [guildId, now, caseIds]);
      const removed = new Set(caseIds);
      for (const row of rows.slice(0, 100)) await this.mutate({ guildId, factId: row.fact_id }, state => {
        for (const version of state.versions) version.provenance = version.provenance.filter(item => item.expiresAt > now && !removed.has(item.caseId));
        return { state, result: true };
      });
      await pool.query('DELETE FROM support_knowledge_erasures WHERE ctid IN (SELECT ctid FROM support_knowledge_erasures WHERE expires_at<=$1 LIMIT 1000)', [now]);
      return { processed: Math.min(100, rows.length), remaining: rows.length > 100 };
    },
    async pruneExpiredProvenance(now, { shouldStop = () => false } = {}) {
      // Each statement, including lock waits in mutations, is bounded. No
      // connection-wide timeout is changed for customer-facing operations.
      async function shortQuery(sql, args) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query("SELECT set_config('statement_timeout','5000',true)");
          const result = await client.query(sql, args);
          await client.query('COMMIT'); return result;
        } catch (error) {
          try { await client.query('ROLLBACK'); } catch { /* Preserve private failure. */ }
          throw error;
        } finally { client.release(); }
      }
      if (shouldStop()) return { examined: 0, barriersDeleted: 0, remaining: false };
      const { rows } = await shortQuery(`SELECT guild_id,fact_id FROM support_reviewed_knowledge WHERE EXISTS(
        SELECT 1 FROM jsonb_array_elements(coalesce(state->'versions','[]'::jsonb)) AS version,
        LATERAL jsonb_array_elements(coalesce(version->'provenance','[]'::jsonb)) AS item
        WHERE (item->>'expiresAt')::bigint<=$1)
        ORDER BY guild_id,fact_id LIMIT 101`, [now]);
      let examined = 0, barriersDeleted = 0;
      for (const row of rows.slice(0, 100)) {
        if (shouldStop()) break;
        await this.mutate({ guildId: row.guild_id, factId: row.fact_id }, state => {
          for (const version of state.versions) version.provenance = version.provenance.filter(item => item.expiresAt > now);
          return { state, result: true };
        }, { statementTimeoutMs: 5000 });
        examined++;
      }
      if (!shouldStop()) {
        const deleted = await shortQuery(`DELETE FROM support_knowledge_erasures WHERE expires_at<=$1 AND ctid IN
          (SELECT ctid FROM support_knowledge_erasures WHERE expires_at<=$1 LIMIT 1000) RETURNING 1`, [now]);
        barriersDeleted = deleted.rows.length;
      }
      return { examined, barriersDeleted, remaining: rows.length > examined || barriersDeleted === 1000 };
    },
  };
}

module.exports = { createMemoryStore, createPostgresStore, initSchema, eligible, hashContent };
