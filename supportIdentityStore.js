const { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } = require('node:crypto');

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_BINDING_TTL_MS = 30 * 24 * HOUR_MS;

function configuredKey() {
  const key = Buffer.from(String(process.env.DATA_ENCRYPTION_KEY || '').trim(), 'base64');
  return key.length === 32 ? key : null;
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function digestCode(code, salt) {
  return createHash('sha256').update(salt).update(String(code)).digest();
}

async function initSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_verified_emails (
      discord_user_id TEXT PRIMARY KEY,
      email_ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      verified_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_otp_challenges (
      discord_user_id TEXT PRIMARY KEY,
      email_ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      code_salt TEXT NOT NULL,
      code_digest TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_verification_sends (
      limiter_key TEXT PRIMARY KEY,
      reservations JSONB NOT NULL DEFAULT '[]'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS support_verified_emails_expiry ON support_verified_emails (expires_at);
    CREATE INDEX IF NOT EXISTS support_otp_challenges_expiry ON support_otp_challenges (expires_at);
    CREATE INDEX IF NOT EXISTS support_verification_sends_expiry ON support_verification_sends (expires_at);
  `);
}

function memoryBackend() {
  return { bindings: new Map(), challenges: new Map(), sends: new Map() };
}

class SupportIdentityStore {
  constructor({ pool = null, key = configuredKey, now = () => Date.now(), bindingTtlMs = DEFAULT_BINDING_TTL_MS, memory = memoryBackend() } = {}) {
    this.pool = pool;
    this.keyProvider = typeof key === 'function' ? key : () => key;
    this.now = now;
    this.bindingTtlMs = bindingTtlMs;
    this.memory = memory;
  }

  key() {
    const key = this.keyProvider();
    if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Support identity encryption is unavailable');
    return key;
  }

  encrypt(email, userId) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('A valid verified email is required');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    cipher.setAAD(Buffer.from(`omi-support-email:${userId}`, 'utf8'));
    return {
      email_ciphertext: Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]).toString('base64'),
      iv: iv.toString('base64'),
      auth_tag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(row) {
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(`omi-support-email:${row.discord_user_id}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.email_ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  limiterKey(userId, email) {
    const normalized = normalizeEmail(email);
    if (!normalized) throw new Error('A valid verification email is required');
    return createHmac('sha256', this.key()).update('omi-support-otp-send\0').update(String(userId)).update('\0').update(normalized).digest('hex');
  }

  async transaction(userId, operation) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // A shared lock serializes verification, relinking, and unlinking for this owner.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`omi-support-identity:${userId}`]);
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure. */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async getBinding(userId) {
    const now = this.now();
    let row;
    if (this.pool) {
      const result = await this.pool.query('SELECT * FROM support_verified_emails WHERE discord_user_id = $1 AND expires_at > $2', [String(userId), new Date(now)]);
      row = result.rows[0];
    } else {
      row = this.memory.bindings.get(String(userId));
      if (row && new Date(row.expires_at).getTime() <= now) {
        this.memory.bindings.delete(String(userId));
        row = null;
      }
    }
    if (!row) return null;
    return { email: this.decrypt(row), verifiedAt: new Date(row.verified_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString() };
  }

  bindingRow(userId, email) {
    const now = this.now();
    return { discord_user_id: String(userId), ...this.encrypt(email, userId), verified_at: new Date(now), expires_at: new Date(now + this.bindingTtlMs) };
  }

  async writeBinding(client, row) {
    await client.query(`INSERT INTO support_verified_emails (discord_user_id, email_ciphertext, iv, auth_tag, verified_at, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (discord_user_id) DO UPDATE SET
      email_ciphertext = EXCLUDED.email_ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag,
      verified_at = EXCLUDED.verified_at, expires_at = EXCLUDED.expires_at`,
    [row.discord_user_id, row.email_ciphertext, row.iv, row.auth_tag, row.verified_at, row.expires_at]);
  }

  async setBinding(userId, email) {
    const row = this.bindingRow(userId, email);
    if (this.pool) await this.transaction(userId, (client) => this.writeBinding(client, row));
    else this.memory.bindings.set(String(userId), row);
    return true;
  }

  async revoke(userId) {
    if (this.pool) {
      return this.transaction(userId, async (client) => {
        const removed = await client.query('DELETE FROM support_verified_emails WHERE discord_user_id = $1 RETURNING discord_user_id', [String(userId)]);
        await client.query('DELETE FROM support_otp_challenges WHERE discord_user_id = $1', [String(userId)]);
        return removed.rowCount > 0;
      });
    }
    const removed = this.memory.bindings.delete(String(userId));
    this.memory.challenges.delete(String(userId));
    return removed;
  }

  async reserveAttempt(userId, email, maxSendsPerHour = 3) {
    const key = this.limiterKey(userId, email);
    const now = this.now();
    const id = randomUUID();
    if (this.pool) {
      // The conditional upsert locks the limiter row and admits at most the limit
      // even when separate processes reserve at the same instant.
      const { rows } = await this.pool.query(`INSERT INTO support_verification_sends (limiter_key, reservations, expires_at)
        VALUES ($1, jsonb_build_array(jsonb_build_object('id', $2::text, 'at', $3::bigint)), $4)
        ON CONFLICT (limiter_key) DO UPDATE SET
        reservations = (SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) FROM jsonb_array_elements(support_verification_sends.reservations) item WHERE (item->>'at')::bigint > $5) || EXCLUDED.reservations,
        expires_at = EXCLUDED.expires_at
        WHERE (SELECT count(*) FROM jsonb_array_elements(support_verification_sends.reservations) item WHERE (item->>'at')::bigint > $5) < $6
        RETURNING limiter_key`, [key, id, now, new Date(now + HOUR_MS), now - HOUR_MS, maxSendsPerHour]);
      return rows.length ? id : false;
    }
    const current = (this.memory.sends.get(key) || []).filter((item) => item.at > now - HOUR_MS);
    if (current.length >= maxSendsPerHour) return false;
    current.push({ id, at: now });
    this.memory.sends.set(key, current);
    return id;
  }

  async releaseAttempt(userId, email, id) {
    const key = this.limiterKey(userId, email);
    if (this.pool) {
      await this.pool.query(`UPDATE support_verification_sends SET reservations =
        (SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) FROM jsonb_array_elements(reservations) item WHERE item->>'id' <> $2)
        WHERE limiter_key = $1`, [key, String(id)]);
    } else {
      this.memory.sends.set(key, (this.memory.sends.get(key) || []).filter((item) => item.id !== id));
    }
  }

  async createChallenge(userId, email, { ttlMinutes = 10, maxAttempts = 5 } = {}) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16);
    const row = {
      discord_user_id: String(userId), ...this.encrypt(email, userId), code_salt: salt.toString('base64'),
      code_digest: digestCode(code, salt).toString('base64'), expires_at: new Date(this.now() + ttlMinutes * 60 * 1000), attempts: 0, max_attempts: maxAttempts,
    };
    if (this.pool) {
      await this.transaction(userId, (client) => client.query(`INSERT INTO support_otp_challenges
        (discord_user_id, email_ciphertext, iv, auth_tag, code_salt, code_digest, expires_at, attempts, max_attempts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8) ON CONFLICT (discord_user_id) DO UPDATE SET
        email_ciphertext = EXCLUDED.email_ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag,
        code_salt = EXCLUDED.code_salt, code_digest = EXCLUDED.code_digest, expires_at = EXCLUDED.expires_at,
        attempts = 0, max_attempts = EXCLUDED.max_attempts`,
      [row.discord_user_id, row.email_ciphertext, row.iv, row.auth_tag, row.code_salt, row.code_digest, row.expires_at, row.max_attempts]));
    } else this.memory.challenges.set(String(userId), row);
    return code;
  }

  challengeResult(row, code) {
    if (!row) return { ok: false, reason: 'No verification is pending. Run /order again.' };
    if (this.now() >= new Date(row.expires_at).getTime()) return { ok: false, consume: true, reason: 'That code expired. Run /order again.' };
    if (row.attempts >= row.max_attempts) return { ok: false, consume: true, reason: 'Too many attempts. Run /order again.' };
    const candidate = digestCode(String(code || '').trim(), Buffer.from(row.code_salt, 'base64'));
    const expected = Buffer.from(row.code_digest, 'base64');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return { ok: false, reason: 'Incorrect code.' };
    return { ok: true, email: this.decrypt(row) };
  }

  async verifyChallenge(userId, code) {
    if (this.pool) {
      return this.transaction(userId, async (client) => {
        const { rows } = await client.query('SELECT * FROM support_otp_challenges WHERE discord_user_id = $1 FOR UPDATE', [String(userId)]);
        const result = this.challengeResult(rows[0], code);
        if (result.ok) await this.writeBinding(client, this.bindingRow(userId, result.email));
        if (result.ok || result.consume) await client.query('DELETE FROM support_otp_challenges WHERE discord_user_id = $1', [String(userId)]);
        else if (rows[0]) await client.query('UPDATE support_otp_challenges SET attempts = attempts + 1 WHERE discord_user_id = $1', [String(userId)]);
        const { consume, ...publicResult } = result;
        return publicResult;
      });
    }
    // No await between reading and consuming a challenge: memory mode is also single-use.
    const row = this.memory.challenges.get(String(userId));
    const result = this.challengeResult(row, code);
    if (result.ok) this.memory.bindings.set(String(userId), this.bindingRow(userId, result.email));
    if (result.ok || result.consume) this.memory.challenges.delete(String(userId));
    else if (row) row.attempts += 1;
    const { consume, ...publicResult } = result;
    return publicResult;
  }

  async pruneExpired(client = this.pool) {
    if (client) {
      for (const table of ['support_verified_emails', 'support_otp_challenges', 'support_verification_sends']) {
        await client.query(`DELETE FROM ${table} WHERE expires_at <= $1`, [new Date(this.now())]);
      }
      return;
    }
    for (const map of [this.memory.bindings, this.memory.challenges]) {
      for (const [id, row] of map) if (new Date(row.expires_at).getTime() <= this.now()) map.delete(id);
    }
    for (const [key, entries] of this.memory.sends) {
      const active = entries.filter((item) => item.at > this.now() - HOUR_MS);
      if (active.length) this.memory.sends.set(key, active);
      else this.memory.sends.delete(key);
    }
  }

  resetMemory() {
    this.memory.bindings.clear();
    this.memory.challenges.clear();
    this.memory.sends.clear();
  }
}

const developmentStore = new SupportIdentityStore();
let productionStore;

function getStore() {
  if (!process.env.DATABASE_URL) return developmentStore;
  if (!productionStore) productionStore = new SupportIdentityStore({ pool: require('./db').pool });
  return productionStore;
}

module.exports = { SupportIdentityStore, configuredKey, getStore, initSchema, memoryBackend, DEFAULT_BINDING_TTL_MS };
