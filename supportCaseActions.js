const { randomUUID } = require('node:crypto');

const LEASE_MS = 120_000;
const HEARTBEAT_MS = 15_000;
const WAIT_MS = 20_000;
const POLL_MS = 100;

class CaseActionBusyError extends Error {
  constructor() { super('Another action is updating this case'); this.name = 'CaseActionBusyError'; }
}
class CaseActionUnavailableError extends Error {
  constructor() { super('Case action coordination is unavailable'); this.name = 'CaseActionUnavailableError'; }
}
class CaseActionLeaseLostError extends Error {
  constructor() { super('Case action lease is no longer owned'); this.name = 'CaseActionLeaseLostError'; }
}

function identifier(value) {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(text)) throw new CaseActionUnavailableError();
  return text;
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_case_action_leases (
    case_id TEXT PRIMARY KEY, owner TEXT NOT NULL, lease_until TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS support_case_action_expiry_idx ON support_case_action_leases(lease_until);`);
}

function createPostgresStore(client) {
  return {
    async acquire(caseId, owner, leaseMs) {
      const { rows } = await client.query(`INSERT INTO support_case_action_leases(case_id,owner,lease_until)
        VALUES ($1,$2,NOW() + $3 * INTERVAL '1 millisecond')
        ON CONFLICT(case_id) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until
        WHERE support_case_action_leases.lease_until <= NOW() RETURNING case_id`, [caseId, owner, leaseMs]);
      return rows.length > 0;
    },
    async owned(caseId, owner) {
      const { rows } = await client.query('SELECT 1 FROM support_case_action_leases WHERE case_id=$1 AND owner=$2 AND lease_until>NOW()', [caseId, owner]);
      return rows.length > 0;
    },
    async renew(caseId, owner, leaseMs) {
      const { rows } = await client.query(`UPDATE support_case_action_leases SET lease_until=NOW() + $3 * INTERVAL '1 millisecond'
        WHERE case_id=$1 AND owner=$2 AND lease_until>NOW() RETURNING case_id`, [caseId, owner, leaseMs]);
      return rows.length > 0;
    },
    async release(caseId, owner) {
      const { rows } = await client.query('DELETE FROM support_case_action_leases WHERE case_id=$1 AND owner=$2 RETURNING case_id', [caseId, owner]);
      return rows.length > 0;
    },
  };
}

function createMemoryStore(state = { leases: new Map() }) {
  return {
    state,
    async acquire(caseId, owner, leaseMs, at = Date.now()) {
      const current = state.leases.get(caseId);
      if (current && current.leaseUntil > at) return false;
      state.leases.set(caseId, { caseId, owner, leaseUntil: at + leaseMs });
      return true;
    },
    async owned(caseId, owner, at = Date.now()) {
      const value = state.leases.get(caseId);
      return Boolean(value && value.owner === owner && value.leaseUntil > at);
    },
    async renew(caseId, owner, leaseMs, at = Date.now()) {
      const value = state.leases.get(caseId);
      if (!value || value.owner !== owner || value.leaseUntil <= at) return false;
      value.leaseUntil = at + leaseMs;
      return true;
    },
    async release(caseId, owner) {
      if (state.leases.get(caseId)?.owner !== owner) return false;
      state.leases.delete(caseId);
      return true;
    },
  };
}

function createActionService(store, { now = () => Date.now(), leaseMs = LEASE_MS,
  heartbeatMs = HEARTBEAT_MS, waitMs = WAIT_MS, log = console.error } = {}) {
  if (!store || ![leaseMs, heartbeatMs, waitMs].every(Number.isSafeInteger) ||
      leaseMs < 1 || heartbeatMs < 1 || waitMs < 0 || waitMs > WAIT_MS) throw new CaseActionUnavailableError();
  const intervalMs = Math.min(heartbeatMs, Math.max(1, Math.floor(leaseMs / 3)));
  const ioMs = Math.max(1, Math.min(leaseMs, WAIT_MS));
  // Timed-out acquisition may still finish remotely. Its owner may only
  // release that late grant, never execute work or delete a replacement lease.
  async function bounded(task, milliseconds, expired, late) {
    let timer; let timedOut = false;
    const pending = Promise.resolve().then(task);
    pending.then((value) => {
      if (timedOut && late) Promise.resolve().then(() => late(value)).catch(() => log('[CaseActions] late lease release unavailable'));
    }, () => {});
    try {
      return await Promise.race([pending, new Promise((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(expired()); }, Math.max(1, milliseconds));
      })]);
    } finally { clearTimeout(timer); }
  }
  return {
    async run(rawCaseId, work) {
      const caseId = identifier(rawCaseId);
      if (typeof work !== 'function') throw new CaseActionUnavailableError();
      const owner = randomUUID();
      const deadline = Date.now() + waitMs;
      let acquired = false; let lost = false; let heartbeat; let renewing;
      let attempted = false;
      const assertOwned = async () => {
        if (lost) throw new CaseActionLeaseLostError();
        try {
          if (!(await bounded(() => store.owned(caseId, owner, now()), ioMs, () => new CaseActionLeaseLostError()))) lost = true;
        } catch { lost = true; log('[CaseActions] lease ownership unavailable'); }
        if (lost) throw new CaseActionLeaseLostError();
      };
      const renew = () => {
        if (renewing || lost) return;
        renewing = bounded(() => store.renew(caseId, owner, leaseMs, now()), ioMs,
          () => new CaseActionLeaseLostError()).then((ok) => {
          if (!ok) { lost = true; log('[CaseActions] lease renewal unavailable'); }
        }, () => { lost = true; log('[CaseActions] lease renewal unavailable'); }).finally(() => { renewing = null; });
      };
      try {
        while (!acquired) {
          if (attempted && Date.now() >= deadline) throw new CaseActionBusyError();
          attempted = true;
          try {
            acquired = await bounded(() => store.acquire(caseId, owner, leaseMs, now()), deadline - Date.now(),
              () => new CaseActionBusyError(), (ok) => ok && store.release(caseId, owner));
          } catch (error) {
            if (error instanceof CaseActionBusyError) throw error;
            log('[CaseActions] lease acquisition unavailable');
            throw new CaseActionUnavailableError();
          }
          if (!acquired) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) throw new CaseActionBusyError();
            await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_MS, Math.max(1, Math.floor(remaining / 4)))));
          }
        }
        heartbeat = setInterval(renew, intervalMs); heartbeat.unref();
        await assertOwned();
        const result = await work(assertOwned);
        await assertOwned();
        return result;
      } finally {
        clearInterval(heartbeat);
        if (renewing) await renewing;
        if (acquired) {
          try { await bounded(() => store.release(caseId, owner), ioMs, () => new CaseActionUnavailableError()); }
          catch { log('[CaseActions] lease release unavailable'); }
        }
      }
    },
  };
}

const memory = createMemoryStore();
let injected; let postgres;
function getService() {
  if (injected) return injected;
  if (!process.env.DATABASE_URL) return createActionService(memory);
  if (!postgres) postgres = createPostgresStore(require('./db').pool);
  return createActionService(postgres);
}
function setStoreForTests(store, options) { injected = store ? createActionService(store, options) : null; }

module.exports = { initSchema, createMemoryStore, createPostgresStore, createActionService, getService, setStoreForTests,
  CaseActionBusyError, CaseActionUnavailableError, CaseActionLeaseLostError, LEASE_MS, HEARTBEAT_MS, WAIT_MS };
