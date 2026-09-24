const { createHash, randomBytes, randomInt, timingSafeEqual } = require('node:crypto');

function digestCode(code, salt) {
  return createHash('sha256').update(salt).update(String(code)).digest();
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

class VerificationService {
  constructor({ ttlMinutes = 10, maxAttempts = 5, maxSendsPerHour = 3 } = {}) {
    this.ttlMinutes = ttlMinutes;
    this.maxAttempts = maxAttempts;
    this.maxSendsPerHour = maxSendsPerHour;
    this.pending = new Map();
    this.sends = new Map();
  }

  reserveAttempt(discordUserId, email) {
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const key = `${discordUserId}:${email}`;
    const record = this.sends.get(key) || { timestamps: [] };
    record.timestamps = record.timestamps.filter((t) => t > hourAgo);
    if (record.timestamps.length >= this.maxSendsPerHour) {
      this.sends.set(key, record);
      return false;
    }
    record.timestamps.push(now);
    this.sends.set(key, record);
    return now;
  }

  releaseAttempt(discordUserId, email, reservedAt) {
    const timestamps = this.sends.get(`${discordUserId}:${email}`)?.timestamps || [];
    const index = timestamps.lastIndexOf(reservedAt);
    if (index !== -1) timestamps.splice(index, 1);
  }

  create(discordUserId, email) {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const salt = randomBytes(16);
    this.pending.set(String(discordUserId), {
      email,
      salt,
      digest: digestCode(code, salt),
      expiresAt: Date.now() + this.ttlMinutes * 60 * 1000,
      attempts: 0,
    });
    return code;
  }

  verify(discordUserId, code) {
    const item = this.pending.get(String(discordUserId));
    if (!item) return { ok: false, reason: 'No verification is pending. Run /order again.' };
    if (Date.now() > item.expiresAt) {
      this.pending.delete(String(discordUserId));
      return { ok: false, reason: 'That code expired. Run /order again.' };
    }
    item.attempts += 1;
    if (item.attempts > this.maxAttempts) {
      this.pending.delete(String(discordUserId));
      return { ok: false, reason: 'Too many attempts. Run /order again.' };
    }
    const candidate = digestCode(String(code || '').trim(), item.salt);
    if (candidate.length !== item.digest.length || !timingSafeEqual(candidate, item.digest)) {
      return { ok: false, reason: 'Incorrect code.' };
    }
    this.pending.delete(String(discordUserId));
    return { ok: true, email: item.email };
  }

  reset() {
    this.pending.clear();
    this.sends.clear();
  }
}

module.exports = { VerificationService, normalizeEmail, digestCode };
