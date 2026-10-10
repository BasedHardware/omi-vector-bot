const assert = require('node:assert/strict');
const test = require('node:test');
const { SupportIdentityStore, initSchema, memoryBackend } = require('../supportIdentityStore');
const { PersistentVerificationService } = require('../verification');

const KEY = Buffer.alloc(32, 17);
const EMAIL = 'owner@example.com';

// Models PostgreSQL's row/advisory locks and transaction rollback without touching
// a database. Each store instance uses an independent client against shared rows.
function fakePool() {
  const pool = { bindings: new Map(), challenges: new Map(), sends: new Map(), calls: [], locks: new Map(), fail: null };
  const result = (rows = []) => ({ rows, rowCount: rows.length });
  function execute(sql, args = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    pool.calls.push({ text, args });
    if (pool.fail?.(text)) throw new Error('identity database unavailable');
    if (text.startsWith('CREATE TABLE')) return result();
    if (text.startsWith('INSERT INTO support_verified_emails')) {
      const [discord_user_id, email_ciphertext, iv, auth_tag, verified_at, expires_at] = args;
      pool.bindings.set(discord_user_id, { discord_user_id, email_ciphertext, iv, auth_tag, verified_at, expires_at });
      return result();
    }
    if (text.startsWith('SELECT * FROM support_verified_emails')) {
      const row = pool.bindings.get(args[0]);
      return result(row && row.expires_at > args[1] ? [{ ...row }] : []);
    }
    if (text.startsWith('INSERT INTO support_otp_challenges')) {
      const [discord_user_id, email_ciphertext, iv, auth_tag, code_salt, code_digest, expires_at, max_attempts] = args;
      pool.challenges.set(discord_user_id, { discord_user_id, email_ciphertext, iv, auth_tag, code_salt, code_digest, expires_at, max_attempts, attempts: 0 });
      return result();
    }
    if (text.startsWith('SELECT * FROM support_otp_challenges')) {
      assert.match(text, /FOR UPDATE$/);
      const row = pool.challenges.get(args[0]);
      return result(row ? [{ ...row }] : []);
    }
    if (text.startsWith('UPDATE support_otp_challenges')) {
      pool.challenges.get(args[0]).attempts += 1;
      return result();
    }
    if (text.startsWith('INSERT INTO support_verification_sends')) {
      assert.match(text, /ON CONFLICT \(limiter_key\) DO UPDATE/);
      assert.match(text, /WHERE \(SELECT count\(\*\)/);
      const [key, id, now, expiry, cutoff, maximum] = args;
      const current = (pool.sends.get(key)?.reservations || []).filter((item) => item.at > cutoff);
      if (current.length >= maximum) return result();
      current.push({ id, at: now });
      pool.sends.set(key, { reservations: current, expires_at: expiry });
      return result([{ limiter_key: key }]);
    }
    if (text.startsWith('UPDATE support_verification_sends')) {
      const row = pool.sends.get(args[0]);
      if (row) row.reservations = row.reservations.filter((item) => item.id !== args[1]);
      return result();
    }
    if (text.startsWith('DELETE FROM')) {
      const table = text.match(/^DELETE FROM (\w+)/)[1];
      const map = { support_verified_emails: pool.bindings, support_otp_challenges: pool.challenges, support_verification_sends: pool.sends }[table];
      if (text.includes('WHERE expires_at')) {
        for (const [id, row] of map) if (row.expires_at <= args[0]) map.delete(id);
        return result();
      }
      const existed = map.delete(args[0]);
      return result(existed ? [{ discord_user_id: args[0] }] : []);
    }
    throw new Error(`Unexpected identity SQL: ${text}`);
  }
  pool.query = async (sql, args) => execute(sql, args);
  pool.connect = async () => {
    let unlock;
    let snapshot;
    return {
      async query(sql, args = []) {
        if (sql === 'BEGIN') return result();
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = pool.locks.get(args[0]) || Promise.resolve();
          const held = new Promise((resolve) => { unlock = resolve; });
          pool.locks.set(args[0], previous.then(() => held));
          await previous;
          snapshot = {
            bindings: structuredClone(pool.bindings), challenges: structuredClone(pool.challenges), sends: structuredClone(pool.sends),
          };
          return result();
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          if (sql === 'ROLLBACK' && snapshot) Object.assign(pool, snapshot);
          unlock?.();
          unlock = null;
          return result();
        }
        return execute(sql, args);
      },
      release() { assert.equal(unlock, null); },
    };
  };
  return pool;
}

function stores(options = {}) {
  const pool = fakePool();
  const first = new SupportIdentityStore({ pool, key: KEY, ...options });
  const restarted = new SupportIdentityStore({ pool, key: KEY, ...options });
  return { pool, first, restarted };
}

test('schema stores encrypted emails, salted digests, expiring challenges and hashed limiter keys', async () => {
  const calls = [];
  await initSchema({ query: async (sql) => calls.push(sql) });
  assert.match(calls[0], /support_verified_emails/);
  assert.match(calls[0], /support_otp_challenges/);
  assert.match(calls[0], /support_verification_sends/);
  assert.match(calls[0], /email_ciphertext TEXT NOT NULL/);
  assert.match(calls[0], /code_digest TEXT NOT NULL/);
  assert.doesNotMatch(calls[0], /\bemail TEXT|\bcode TEXT/);
});

test('a second process recovers links, pending verification and send limits without plaintext persistence', async () => {
  const { pool, first, restarted } = stores();
  const firstService = new PersistentVerificationService({ store: first });
  const secondService = new PersistentVerificationService({ store: restarted });
  await first.setBinding('existing', EMAIL);
  assert.equal((await restarted.getBinding('existing')).email, EMAIL);
  assert.equal(await restarted.getBinding('another-owner'), null);
  const code = await firstService.create('pending', EMAIL);
  assert.equal((await secondService.verify('another-owner', code)).ok, false);
  assert.deepEqual(await secondService.verify('pending', code), { ok: true, email: EMAIL });
  assert.equal((await first.getBinding('pending')).email, EMAIL);
  assert.equal((await firstService.verify('pending', code)).ok, false);
  for (let i = 0; i < 3; i += 1) assert.ok(await firstService.reserveAttempt('pending', EMAIL));
  assert.equal(await secondService.reserveAttempt('pending', EMAIL), false);
  assert.equal(JSON.stringify(pool.calls).includes(EMAIL), false);
  assert.equal(pool.calls.some((call) => call.args.includes(code)), false);
  for (const key of pool.sends.keys()) assert.match(key, /^[a-f\d]{64}$/);
});

test('concurrent processes atomically admit three send reservations and release only the exact token', async () => {
  const { pool, first, restarted } = stores({ now: () => 1000 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : restarted).reserveAttempt('owner', EMAIL)));
  const admitted = results.filter(Boolean);
  assert.equal(admitted.length, 3);
  assert.equal(new Set(admitted).size, 3);
  await restarted.releaseAttempt('owner', EMAIL, admitted[0]);
  const records = [...pool.sends.values()][0].reservations;
  assert.deepEqual(records.map((item) => item.id), admitted.slice(1));
  assert.ok(await first.reserveAttempt('owner', EMAIL));
  assert.equal(await restarted.reserveAttempt('owner', EMAIL), false);
});

test('simultaneous correct codes are consumed once and persist the binding in the same transaction', async () => {
  const { pool, first, restarted } = stores();
  const code = await first.createChallenge('owner', EMAIL);
  const results = await Promise.all([first.verifyChallenge('owner', code), restarted.verifyChallenge('owner', code)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(pool.challenges.size, 0);
  assert.equal((await restarted.getBinding('owner')).email, EMAIL);
});

test('failed attempts and expiry survive restart; expired bindings and throttle reservations are unusable', async () => {
  let now = 1000;
  const { first, restarted } = stores({ now: () => now, bindingTtlMs: 1000 });
  let code = await first.createChallenge('owner', EMAIL, { maxAttempts: 2, ttlMinutes: 1 });
  const wrong = code === '000000' ? '000001' : '000000';
  await first.verifyChallenge('owner', wrong);
  await restarted.verifyChallenge('owner', wrong);
  assert.match((await first.verifyChallenge('owner', code)).reason, /Too many attempts/);
  code = await restarted.createChallenge('owner', EMAIL, { ttlMinutes: 1 });
  now += 60001;
  assert.match((await first.verifyChallenge('owner', code)).reason, /expired/);
  await restarted.setBinding('owner', EMAIL);
  now += 1000;
  assert.equal(await first.getBinding('owner'), null);
  for (let i = 0; i < 3; i += 1) await first.reserveAttempt('owner', EMAIL);
  assert.equal(await restarted.reserveAttempt('owner', EMAIL), false);
  now += 3600001;
  assert.ok(await restarted.reserveAttempt('owner', EMAIL));
});

test('unlink revokes an owner link and pending code without affecting another owner or resetting send limits', async () => {
  const { first, restarted } = stores();
  await first.setBinding('owner', EMAIL);
  await first.setBinding('other', 'other@example.com');
  const code = await first.createChallenge('owner', EMAIL);
  for (let i = 0; i < 3; i += 1) await first.reserveAttempt('owner', EMAIL);
  assert.equal(await restarted.revoke('owner'), true);
  assert.equal(await first.getBinding('owner'), null);
  assert.equal((await first.verifyChallenge('owner', code)).ok, false);
  assert.equal((await first.getBinding('other')).email, 'other@example.com');
  assert.equal(await first.reserveAttempt('owner', EMAIL), false);
});

test('a verification racing unlink cannot leave a verified link after revocation completes', async () => {
  for (const unlinkFirst of [false, true]) {
    const { first, restarted } = stores();
    const code = await first.createChallenge('owner', EMAIL);
    await Promise.all(unlinkFirst
      ? [first.revoke('owner'), restarted.verifyChallenge('owner', code)]
      : [first.verifyChallenge('owner', code), restarted.revoke('owner')]);
    assert.equal(await restarted.getBinding('owner'), null);
    assert.equal((await first.verifyChallenge('owner', code)).ok, false);
  }
});

test('database failure rolls back binding creation and preserves the unused challenge for a retry', async () => {
  const { pool, first, restarted } = stores();
  const code = await first.createChallenge('owner', EMAIL);
  pool.fail = (sql) => sql.startsWith('DELETE FROM support_otp_challenges');
  await assert.rejects(first.verifyChallenge('owner', code), /identity database unavailable/);
  assert.equal(pool.bindings.size, 0);
  assert.equal(pool.challenges.size, 1);
  pool.fail = null;
  assert.equal((await restarted.verifyChallenge('owner', code)).ok, true);
});

test('database errors never fall back to memory for reads, writes, reservations or verification', async () => {
  const unavailable = new SupportIdentityStore({ key: KEY, pool: {
    query: async () => { throw new Error('database down'); },
    connect: async () => { throw new Error('database down'); },
  } });
  for (const operation of [
    () => unavailable.getBinding('owner'), () => unavailable.setBinding('owner', EMAIL),
    () => unavailable.reserveAttempt('owner', EMAIL), () => unavailable.createChallenge('owner', EMAIL),
    () => unavailable.verifyChallenge('owner', '123456'), () => unavailable.revoke('owner'),
  ]) await assert.rejects(operation(), /database down/);
  assert.equal(unavailable.memory.bindings.size + unavailable.memory.challenges.size + unavailable.memory.sends.size, 0);
});

test('development memory mode shares injected state, still encrypts contacts, and expires links', async () => {
  let now = 1000;
  const memory = memoryBackend();
  const first = new SupportIdentityStore({ memory, key: KEY, now: () => now, bindingTtlMs: 1000 });
  const second = new SupportIdentityStore({ memory, key: KEY, now: () => now, bindingTtlMs: 1000 });
  const code = await first.createChallenge('owner', EMAIL);
  assert.equal((await second.verifyChallenge('owner', code)).ok, true);
  assert.equal((await first.getBinding('owner')).email, EMAIL);
  assert.equal(JSON.stringify([...memory.bindings.values()]).includes(EMAIL), false);
  now += 1000;
  assert.equal(await second.getBinding('owner'), null);
});

test('ciphertext cannot be transplanted to another Discord owner', async () => {
  const { pool, first } = stores();
  await first.setBinding('owner', EMAIL);
  pool.bindings.set('other', { ...pool.bindings.get('owner'), discord_user_id: 'other' });
  await assert.rejects(first.getBinding('other'));
  assert.equal((await first.getBinding('owner')).email, EMAIL);
});

test('expiry is enforced at its exact boundary and pruning removes expired sensitive rows', async () => {
  let now = 1000;
  const { pool, first } = stores({ now: () => now, bindingTtlMs: 60000 });
  const code = await first.createChallenge('owner', EMAIL, { ttlMinutes: 1 });
  await first.setBinding('owner', EMAIL);
  await first.reserveAttempt('owner', EMAIL);
  now += 60000;
  assert.match((await first.verifyChallenge('owner', code)).reason, /expired/);
  assert.equal(await first.getBinding('owner'), null);
  await first.pruneExpired();
  assert.equal(pool.bindings.size + pool.challenges.size, 0);
  now += 3600000;
  await first.pruneExpired();
  assert.equal(pool.sends.size, 0);
});

test('configured production storage uses Postgres even when development memory has a link', async (t) => {
  const previousUrl = process.env.DATABASE_URL;
  const previousKey = process.env.DATA_ENCRYPTION_KEY;
  process.env.DATABASE_URL = '';
  process.env.DATA_ENCRYPTION_KEY = KEY.toString('base64');
  const bind = require('../shopifyBind');
  bind.reset();
  await bind.set('owner', EMAIL);
  const db = require('../db');
  const previousQuery = db.pool.query;
  const previousConnect = db.pool.connect;
  t.after(() => {
    db.pool.query = previousQuery;
    db.pool.connect = previousConnect;
    process.env.DATABASE_URL = '';
    bind.reset();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = previousKey;
  });
  process.env.DATABASE_URL = 'postgresql://test.invalid/support';
  db.pool.query = async () => { throw new Error('production database unavailable'); };
  db.pool.connect = async () => { throw new Error('production database unavailable'); };
  await assert.rejects(bind.get('owner'), /production database unavailable/);
  await assert.rejects(bind.set('owner', EMAIL), /production database unavailable/);
  await assert.rejects(bind.remove('owner'), /production database unavailable/);
});
