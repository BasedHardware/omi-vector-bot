const { randomUUID, createHash } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const LEASE_MS = 120_000;
const REPEAT_MS = 10 * 60_000;
const context = new AsyncLocalStorage();

function questionFingerprint(text) {
  return createHash('sha256').update(String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
}

function isLeaseLost(err) { return err?.message === 'support lease lost'; }

async function initSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_message_claims (
      message_id TEXT PRIMARY KEY, case_key TEXT NOT NULL, owner TEXT NOT NULL,
      fingerprint TEXT, state TEXT NOT NULL DEFAULT 'processing',
      lease_until TIMESTAMPTZ NOT NULL, finished_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS support_message_repeat_idx
      ON support_message_claims (case_key, fingerprint, finished_at) WHERE state = 'answered';
    CREATE INDEX IF NOT EXISTS support_message_expiry_idx ON support_message_claims (finished_at);
    CREATE TABLE IF NOT EXISTS support_case_leases (
      case_key TEXT PRIMARY KEY, owner TEXT NOT NULL, lease_until TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS support_worker_slots (
      slot INTEGER PRIMARY KEY, owner TEXT, lease_until TIMESTAMPTZ
    );
    INSERT INTO support_worker_slots (slot) VALUES (1), (2), (3) ON CONFLICT DO NOTHING;
  `);
}

class PostgresRuntimeStore {
  constructor(pool) { this.pool = pool; }
  async claim(job) {
    const { rows } = await this.pool.query(`
      INSERT INTO support_message_claims (message_id, case_key, owner, fingerprint, lease_until)
      VALUES ($1,$2,$3,$4,NOW() + $5 * INTERVAL '1 millisecond')
      ON CONFLICT (message_id) DO UPDATE SET owner=$3, lease_until=EXCLUDED.lease_until
        , state='processing', fingerprint=EXCLUDED.fingerprint
      WHERE support_message_claims.state='queued'
      RETURNING message_id`, [job.messageId, job.caseKey, job.owner, job.fingerprint, LEASE_MS]);
    return rows.length > 0;
  }
  async enqueue(input) {
    await this.pool.query(`INSERT INTO support_message_claims (message_id,case_key,owner,fingerprint,state,lease_until)
      VALUES ($1,$2,'queued',$3,'queued',NOW()) ON CONFLICT (message_id) DO NOTHING`, [input.messageId, input.caseKey, input.fingerprint]);
  }
  async defer(job) {
    await this.pool.query(`UPDATE support_message_claims SET state='queued',owner='queued',lease_until=NOW()
      WHERE message_id=$1 AND owner=$2 AND state='processing'`, [job.messageId, job.owner]);
    await this.release(job);
  }
  async queued(limit) {
    const { rows } = await this.pool.query(`SELECT message_id,case_key,fingerprint FROM support_message_claims
      WHERE state='queued' ORDER BY message_id LIMIT $1`, [limit]);
    return rows.map((row) => ({ messageId: row.message_id, caseKey: row.case_key, fingerprint: row.fingerprint }));
  }
  async discard(input) {
    await this.pool.query("UPDATE support_message_claims SET state='ignored',finished_at=NOW() WHERE message_id=$1 AND state='queued'", [input.messageId]);
  }
  async repeated(job) {
    if (!job.fingerprint) return false;
    const { rows } = await this.pool.query(`SELECT 1 FROM support_message_claims
      WHERE case_key=$1 AND fingerprint=$2 AND state='answered'
        AND finished_at > NOW() - $3 * INTERVAL '1 millisecond' LIMIT 1`, [job.caseKey, job.fingerprint, REPEAT_MS]);
    return rows.length > 0;
  }
  async acquire(job) {
    const lease = await this.pool.query(`INSERT INTO support_case_leases (case_key,owner,lease_until)
      VALUES ($1,$2,NOW() + $3 * INTERVAL '1 millisecond')
      ON CONFLICT (case_key) DO UPDATE SET owner=$2, lease_until=EXCLUDED.lease_until
      WHERE support_case_leases.lease_until < NOW() OR support_case_leases.owner=$2
      RETURNING case_key`, [job.caseKey, job.owner, LEASE_MS]);
    if (!lease.rows.length) return false;
    const slot = await this.pool.query(`UPDATE support_worker_slots SET owner=$1,
      lease_until=NOW() + $2 * INTERVAL '1 millisecond'
      WHERE slot=(SELECT slot FROM support_worker_slots
        WHERE owner IS NULL OR lease_until < NOW() ORDER BY slot FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING slot`, [job.owner, LEASE_MS]);
    if (!slot.rows.length) {
      await this.pool.query('DELETE FROM support_case_leases WHERE case_key=$1 AND owner=$2', [job.caseKey, job.owner]);
      return false;
    }
    job.slot = slot.rows[0].slot;
    return true;
  }
  async owned(job) {
    const { rows } = await this.pool.query(`SELECT 1 FROM support_message_claims m
      WHERE m.message_id=$1 AND m.owner=$2 AND m.state='processing' AND m.lease_until > NOW()
        AND ($3::integer IS NULL OR EXISTS (SELECT 1 FROM support_worker_slots w
          JOIN support_case_leases c ON c.owner=w.owner
          WHERE w.slot=$3 AND w.owner=$2 AND w.lease_until > NOW()
            AND c.case_key=$4 AND c.lease_until > NOW()))`, [job.messageId, job.owner, job.slot ?? null, job.caseKey]);
    return rows.length > 0;
  }
  async renew(job) {
    const { rows } = await this.pool.query(`UPDATE support_message_claims SET lease_until=NOW() + $3 * INTERVAL '1 millisecond'
      WHERE message_id=$1 AND owner=$2 AND state='processing' AND lease_until > NOW() RETURNING message_id`, [job.messageId, job.owner, LEASE_MS]);
    if (!rows.length) return false;
    if (job.slot == null) return true;
    const caseLease = await this.pool.query(`UPDATE support_case_leases SET lease_until=NOW() + $3 * INTERVAL '1 millisecond'
      WHERE case_key=$1 AND owner=$2 AND lease_until > NOW() RETURNING case_key`, [job.caseKey, job.owner, LEASE_MS]);
    const slot = await this.pool.query(`UPDATE support_worker_slots SET lease_until=NOW() + $3 * INTERVAL '1 millisecond'
      WHERE slot=$1 AND owner=$2 AND lease_until > NOW() RETURNING slot`, [job.slot, job.owner, LEASE_MS]);
    return Boolean(caseLease.rows.length && slot.rows.length);
  }
  async finish(job, state) {
    await this.pool.query(`UPDATE support_message_claims SET state=$3, finished_at=NOW()
      WHERE message_id=$1 AND owner=$2 AND state='processing'`, [job.messageId, job.owner, state]);
    await this.release(job);
    // Retain answer fingerprints for ten minutes, message idempotency for a day.
    await this.pool.query("DELETE FROM support_message_claims WHERE finished_at < NOW() - INTERVAL '1 day'");
  }
  async release(job) {
    await this.pool.query('DELETE FROM support_case_leases WHERE case_key=$1 AND owner=$2', [job.caseKey, job.owner]);
    await this.pool.query('UPDATE support_worker_slots SET owner=NULL,lease_until=NULL WHERE owner=$1', [job.owner]);
  }
}

class MemoryRuntimeStore {
  constructor({ now = () => Date.now(), slots = 3 } = {}) {
    this.now = now; this.maxSlots = slots; this.messages = new Map(); this.cases = new Map(); this.slots = new Map();
  }
  async claim(job) {
    const previous = this.messages.get(job.messageId);
    // An expired started request can have an unknown external delivery outcome.
    // Only explicitly queued work is safe to resume automatically.
    if (previous && previous.state !== 'queued') return false;
    this.messages.set(job.messageId, { ...job, until: this.now() + LEASE_MS, state: 'processing' });
    return true;
  }
  async enqueue(input) {
    if (!this.messages.has(input.messageId)) this.messages.set(input.messageId, { ...input, state: 'queued', owner: 'queued', until: this.now() });
  }
  async defer(job) {
    const value = this.messages.get(job.messageId);
    if (value?.owner === job.owner && value.state === 'processing') Object.assign(value, { state: 'queued', owner: 'queued', until: this.now() });
    await this.release(job);
  }
  async queued(limit) { return [...this.messages.values()].filter((row) => row.state === 'queued').slice(0, limit).map(({ messageId, caseKey, fingerprint }) => ({ messageId, caseKey, fingerprint })); }
  async discard(input) { const row = this.messages.get(input.messageId); if (row?.state === 'queued') Object.assign(row, { state: 'ignored', at: this.now() }); }
  async repeated(job) {
    return Boolean(job.fingerprint && [...this.messages.values()].some((item) => item.caseKey === job.caseKey &&
      item.fingerprint === job.fingerprint && item.state === 'answered' && this.now() - item.at < REPEAT_MS));
  }
  async acquire(job) {
    const previous = this.cases.get(job.caseKey);
    if (previous && previous.owner !== job.owner && previous.until > this.now()) return false;
    let slot;
    for (let id = 1; id <= this.maxSlots; id++) {
      const item = this.slots.get(id);
      if (!item || item.until <= this.now()) { slot = id; break; }
    }
    if (!slot) return false;
    job.slot = slot;
    const item = { owner: job.owner, until: this.now() + LEASE_MS };
    this.cases.set(job.caseKey, item); this.slots.set(slot, { ...item });
    return true;
  }
  async owned(job) {
    const message = this.messages.get(job.messageId);
    const lease = this.cases.get(job.caseKey);
    const slot = this.slots.get(job.slot);
    return Boolean(message?.owner === job.owner && message.state === 'processing' && message.until > this.now() &&
      (job.slot == null || (lease?.owner === job.owner && slot?.owner === job.owner && lease.until > this.now() && slot.until > this.now())));
  }
  async renew(job) {
    if (!(await this.owned(job))) return false;
    this.messages.get(job.messageId).until = this.now() + LEASE_MS;
    if (job.slot != null) {
      this.cases.get(job.caseKey).until = this.now() + LEASE_MS;
      this.slots.get(job.slot).until = this.now() + LEASE_MS;
    }
    return true;
  }
  async finish(job, state) {
    const message = this.messages.get(job.messageId);
    if (message?.owner === job.owner && message.state === 'processing') Object.assign(message, { state, at: this.now() });
    await this.release(job);
    for (const [key, item] of this.messages) if (item.at && this.now() - item.at > 24 * 60 * 60_000) this.messages.delete(key);
  }
  async release(job) {
    if (this.cases.get(job.caseKey)?.owner === job.owner) this.cases.delete(job.caseKey);
    if (this.slots.get(job.slot)?.owner === job.owner) this.slots.delete(job.slot);
  }
}

class SupportRuntime {
  constructor({ store = new MemoryRuntimeStore(), concurrency = 3, maxQueued = 24,
    waitMs = 60_000, heartbeatMs = 15_000, log = console.error } = {}) {
    this.store = store; this.concurrency = concurrency; this.maxQueued = maxQueued;
    this.waitMs = waitMs; this.heartbeatMs = heartbeatMs; this.log = log;
    this.running = 0; this.waiting = []; this.tasks = new Set(); this.jobs = new Map(); this.caseTails = new Map(); this.stopping = false; this.recovering = false;
  }
  run(input, work) {
    if (this.stopping) return Promise.resolve({ status: 'stopping' });
    const overloaded = this.tasks.size >= this.concurrency + this.maxQueued;
    // Reserve arrival order before any asynchronous database claim can finish.
    let reservation;
    if (!overloaded) {
      const prior = this.caseTails.get(input.caseKey) || Promise.resolve();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const tail = prior.then(() => gate);
      this.caseTails.set(input.caseKey, tail);
      tail.then(() => { if (this.caseTails.get(input.caseKey) === tail) this.caseTails.delete(input.caseKey); });
      reservation = { prior, release };
    }
    const task = overloaded ? this.store.enqueue(input).then(() => ({ status: 'queued' })) : this.execute(input, work, reservation);
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task)).catch(() => {});
    return task;
  }
  track(work) {
    if (this.stopping) return Promise.resolve({ status: 'stopping' });
    const task = Promise.resolve().then(work);
    this.tasks.add(task);
    task.finally(() => this.tasks.delete(task)).catch(() => {});
    return task;
  }
  async execute(input, work, reservation) {
    const job = { ...input, owner: randomUUID(), lost: false };
    let renewal = null;
    let localSlot = false;
    let runningRenewal = false;
    const renew = async () => {
      if (runningRenewal || job.lost) return;
      runningRenewal = true;
      try { if (!(await this.store.renew(job))) job.lost = true; }
      catch { job.lost = true; this.log('[SupportRuntime] lease renewal failed'); }
      finally { runningRenewal = false; }
    };
    const run = (fn) => context.run({ runtime: this, job }, fn);
    try {
      if (!(await this.store.claim(job))) return { status: 'duplicate' };
      job.claimed = true;
      this.jobs.set(job.owner, job);
      renewal = setInterval(renew, this.heartbeatMs); renewal.unref();
      await reservation.prior;
      if (this.running >= this.concurrency) await new Promise((resolve) => this.waiting.push(resolve));
      else this.running++;
      localSlot = true;
      const until = Date.now() + this.waitMs;
      while (!(await this.store.acquire(job))) {
        if (job.lost) throw new Error('support lease lost');
        if (Date.now() >= until) {
          await this.store.defer(job);
          return { status: 'queued' };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await this.assertOwned(job);
      if (await this.store.repeated(job)) {
        await this.store.finish(job, 'ignored');
        return { status: 'duplicate' };
      }
      job.started = true;
      const outcome = await run(work);
      const state = ['answered', 'ignored', 'failed'].includes(outcome) ? outcome : outcome ? 'answered' : 'ignored';
      await this.store.finish(job, state);
      return { status: state };
    } catch (err) {
      // Unknown delivery outcomes are not automatically retried as new answers.
      if (job.replySent) {
        err.replyAlreadySent = true;
        this.log('[SupportRuntime] completion uncertain after customer delivery');
        try { await this.store.release(job); } catch { this.log('[SupportRuntime] lease release failed'); }
      } else if (job.claimed) {
        try { await this.store.finish(job, 'failed'); } catch { this.log('[SupportRuntime] completion persistence failed'); }
      }
      throw err;
    } finally {
      clearInterval(renewal);
      this.jobs.delete(job.owner);
      reservation.release();
      if (localSlot) {
        const next = this.waiting.shift();
        if (next) next(); else this.running--;
      }
    }
  }
  async assertOwned(job) {
    if (job.lost || !(await this.store.owned(job))) throw new Error('support lease lost');
  }
  stopAccepting() { this.stopping = true; }
  async recoverQueued(handler) {
    if (this.stopping || this.recovering) return;
    const available = this.concurrency + this.maxQueued - this.tasks.size;
    if (available <= 0) return;
    this.recovering = true;
    try {
      const queued = await this.store.queued(Math.min(this.concurrency, available));
      await Promise.all(queued.map(handler));
    } finally { this.recovering = false; }
  }
  async drain(timeoutMs = 90_000) {
    this.stopAccepting();
    if (!this.tasks.size) return true;
    let timer;
    try {
      const drained = await Promise.race([
        Promise.allSettled([...this.tasks]).then(() => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
      ]);
      if (!drained) {
        await Promise.all([...this.jobs.values()].filter((job) => !job.started).map((job) => this.store.defer(job)));
      }
      return drained;
    } finally { clearTimeout(timer); }
  }
}

async function assertCurrentOwnership() {
  const current = context.getStore();
  if (current) await current.runtime.assertOwned(current.job);
}

function markCurrentReplySent() {
  const current = context.getStore();
  if (current) current.job.replySent = true;
}

module.exports = { initSchema, SupportRuntime, PostgresRuntimeStore, MemoryRuntimeStore, questionFingerprint, assertCurrentOwnership, markCurrentReplySent, isLeaseLost };
