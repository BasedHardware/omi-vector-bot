const { createHash } = require('node:crypto');
const RETENTION_MS = 30 * 86400000;
const FUTURE_SKEW_MS = 5 * 60000;
const BATCH = 100;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validDeliveryId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}
function keys(repo, deliveryId, recipient) {
  if (!validDeliveryId(deliveryId) || !Array.isArray(recipient) || !recipient.length) throw Error('invalid_notice_scope');
  const repository = String(repo).toLowerCase();
  return { eventKey: digest(['github-event', repository, deliveryId.toLowerCase()]),
    recipientKey: digest(['github-recipient', repository, ...recipient]) };
}
function customerKey(customerId) {
  if (typeof customerId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(customerId)) throw Error('invalid_notice_customer');
  return digest(['github-notice-customer', customerId]);
}
function eventTimestamp(payload) {
  let time;
  if (payload?.pull_request && payload.action === 'closed' && payload.pull_request.merged) time = payload.pull_request.merged_at;
  else if (payload?.comment && payload.action === 'created' && payload.issue) time = payload.comment.created_at;
  else if (payload?.issue) time = ({ opened: payload.issue.created_at, reopened: payload.issue.updated_at, closed: payload.issue.closed_at })[payload.action];
  if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time)) return null;
  const value = Date.parse(time);
  return Number.isSafeInteger(value) && new Date(value).toISOString().slice(0,19) === time.slice(0,19) ? value : null;
}
function recent(eventAt, now = Date.now()) {
  return Number.isSafeInteger(eventAt) && eventAt > 0 && eventAt <= now + FUTURE_SKEW_MS && eventAt + RETENTION_MS > now;
}
function validate(value) {
  if (!value || ![value.eventKey, value.recipientKey, value.customerKey].every(hash) ||
      !Number.isSafeInteger(value.eventAt) || value.eventAt <= 0) throw Error('invalid_notice_receipt');
}
function validMessageId(value) { return typeof value === 'string' && /^\d{17,20}$/.test(value); }

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_github_notice_receipts (
    event_key TEXT NOT NULL CHECK (event_key ~ '^[a-f0-9]{64}$'),
    recipient_key TEXT NOT NULL CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
    customer_key TEXT NOT NULL CHECK (customer_key ~ '^[a-f0-9]{64}$'),
    event_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started','sent','uncertain')),
    message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (event_key, recipient_key)
  );
  ALTER TABLE support_github_notice_receipts ADD COLUMN IF NOT EXISTS customer_key TEXT;
  ALTER TABLE support_github_notice_receipts ADD COLUMN IF NOT EXISTS event_at TIMESTAMPTZ;
  ALTER TABLE support_github_notice_receipts ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
  -- The pre-lifecycle candidate was never released. Never guess ownership/time
  -- or drop old fences if an unexpected populated development schema exists.
  DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM support_github_notice_receipts WHERE customer_key IS NULL OR event_at IS NULL OR expires_at IS NULL)
      THEN RAISE EXCEPTION 'notice_lifecycle_migration_requires_review'; END IF;
  END $$;
  ALTER TABLE support_github_notice_receipts ALTER COLUMN customer_key SET NOT NULL;
  ALTER TABLE support_github_notice_receipts ALTER COLUMN event_at SET NOT NULL;
  ALTER TABLE support_github_notice_receipts ALTER COLUMN expires_at SET NOT NULL;
  CREATE INDEX IF NOT EXISTS github_notice_expiry ON support_github_notice_receipts(expires_at,event_key,recipient_key);
  CREATE INDEX IF NOT EXISTS github_notice_customer ON support_github_notice_receipts(customer_key,event_at);
  CREATE TABLE IF NOT EXISTS support_github_notice_erasures (
    customer_key TEXT PRIMARY KEY CHECK (customer_key ~ '^[a-f0-9]{64}$'),
    erased_before TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS github_notice_erasure_expiry ON support_github_notice_erasures(expires_at,customer_key);`);
}
function createPostgresStore(pool) {
  async function locked(key, action) {
    if (!hash(key)) throw Error('invalid_notice_customer');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='2s'");
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['github-notice-customer:' + key]);
      const result = await action(client);
      await client.query('COMMIT'); return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original failure; no memory fallback */ }
      throw error;
    } finally { client.release(); }
  }
  return {
    async begin(value) {
      validate(value);
      return locked(value.customerKey, async client => {
        const { rows } = await client.query(`INSERT INTO support_github_notice_receipts
          (event_key,recipient_key,customer_key,event_at,expires_at,state)
          SELECT $1,$2,$3,to_timestamp($4::double precision/1000),to_timestamp($4::double precision/1000) + INTERVAL '30 days','started'
          WHERE to_timestamp($4::double precision/1000) > clock_timestamp() - INTERVAL '30 days'
            AND to_timestamp($4::double precision/1000) <= clock_timestamp() + INTERVAL '5 minutes'
            AND NOT EXISTS (SELECT 1 FROM support_github_notice_erasures
              WHERE customer_key=$3 AND erased_before >= to_timestamp($4::double precision/1000))
          ON CONFLICT DO NOTHING RETURNING event_key`, [value.eventKey,value.recipientKey,value.customerKey,value.eventAt]);
        return rows.length === 1;
      });
    },
    async confirm(value) {
      validate(value); if (!validMessageId(value.messageId)) throw Error('invalid_notice_message');
      const { rows } = await pool.query(`UPDATE support_github_notice_receipts SET state='sent',message_id=$3,updated_at=clock_timestamp()
        WHERE event_key=$1 AND recipient_key=$2 AND state='started' RETURNING event_key`,
      [value.eventKey,value.recipientKey,value.messageId]);
      return rows.length === 1;
    },
    async uncertain(value) {
      validate(value);
      await pool.query(`UPDATE support_github_notice_receipts SET state='uncertain',updated_at=clock_timestamp()
        WHERE event_key=$1 AND recipient_key=$2 AND state='started'`, [value.eventKey,value.recipientKey]);
    },
    async eraseCustomer(key) {
      return locked(key, async client => {
        await client.query(`INSERT INTO support_github_notice_erasures(customer_key,erased_before,expires_at)
          SELECT $1,cutoff,cutoff + INTERVAL '30 days' FROM
            (SELECT GREATEST(clock_timestamp(),COALESCE((SELECT event_at FROM support_github_notice_receipts
              WHERE customer_key=$1 ORDER BY event_at DESC LIMIT 1),clock_timestamp())) AS cutoff) t
          ON CONFLICT(customer_key) DO UPDATE SET
            erased_before=GREATEST(support_github_notice_erasures.erased_before,EXCLUDED.erased_before),
            expires_at=GREATEST(support_github_notice_erasures.erased_before,EXCLUDED.erased_before) + INTERVAL '30 days'`, [key]);
        await client.query(`WITH batch AS (SELECT event_key,recipient_key FROM support_github_notice_receipts
          WHERE customer_key=$1 AND event_at <= (SELECT erased_before FROM support_github_notice_erasures WHERE customer_key=$1)
          ORDER BY event_at,event_key,recipient_key LIMIT 100 FOR UPDATE SKIP LOCKED)
          DELETE FROM support_github_notice_receipts r USING batch b WHERE r.event_key=b.event_key AND r.recipient_key=b.recipient_key`, [key]);
        const { rows } = await client.query(`SELECT EXISTS(SELECT 1 FROM support_github_notice_receipts r
          JOIN support_github_notice_erasures e USING(customer_key) WHERE customer_key=$1 AND r.event_at<=e.erased_before) AS remaining`, [key]);
        return { ok:true, remaining:rows[0].remaining };
      });
    },
    async pruneExpired(_now, { shouldStop = () => false } = {}) {
      return locked(digest(['github-notice-cleanup']), async client => {
      // Independent bounded batches: expiry cannot starve erasure or vice versa.
      for (const query of [
        `WITH batch AS (SELECT event_key,recipient_key FROM support_github_notice_receipts WHERE expires_at<=clock_timestamp()
          ORDER BY expires_at,event_key,recipient_key LIMIT 100 FOR UPDATE SKIP LOCKED)
          DELETE FROM support_github_notice_receipts r USING batch b WHERE r.event_key=b.event_key AND r.recipient_key=b.recipient_key`,
        `WITH batch AS (SELECT r.event_key,r.recipient_key FROM support_github_notice_receipts r JOIN support_github_notice_erasures e USING(customer_key)
          WHERE r.event_at<=e.erased_before ORDER BY r.event_at,r.event_key,r.recipient_key LIMIT 100 FOR UPDATE OF r SKIP LOCKED)
          DELETE FROM support_github_notice_receipts r USING batch b WHERE r.event_key=b.event_key AND r.recipient_key=b.recipient_key`,
        `WITH batch AS (SELECT customer_key FROM support_github_notice_erasures WHERE expires_at<=clock_timestamp()
          ORDER BY expires_at,customer_key LIMIT 100 FOR UPDATE SKIP LOCKED)
          DELETE FROM support_github_notice_erasures e USING batch b WHERE e.customer_key=b.customer_key AND e.expires_at<=clock_timestamp()`,
      ]) {
        if (shouldStop()) return { remaining:true };
        await client.query(query);
      }
      const { rows } = await client.query(`SELECT EXISTS(SELECT 1 FROM support_github_notice_receipts WHERE expires_at<=clock_timestamp())
        OR EXISTS(SELECT 1 FROM support_github_notice_receipts r JOIN support_github_notice_erasures e USING(customer_key) WHERE r.event_at<=e.erased_before)
        OR EXISTS(SELECT 1 FROM support_github_notice_erasures WHERE expires_at<=clock_timestamp()) AS remaining`);
      return { remaining:rows[0].remaining };
      });
    },
  };
}
// Explicit test adapter only. No production SQL error can select this map.
function createMemoryStore(state = new Map(), { now = Date.now } = {}) {
  const erasures = state.erasures || (state.erasures = new Map());
  const key = value => { validate(value); return value.eventKey + ':' + value.recipientKey; };
  return { state, erasures,
    async begin(value) { const k=key(value); if (!recent(value.eventAt,now()) || state.has(k) ||
      (erasures.get(value.customerKey)?.before ?? -1) >= value.eventAt) return false;
      state.set(k,{state:'started',customerKey:value.customerKey,eventAt:value.eventAt,expiresAt:value.eventAt+RETENTION_MS}); return true; },
    async confirm(value) { const row=state.get(key(value)); if (!validMessageId(value.messageId)) throw Error('invalid_notice_message');
      if (row?.state!=='started') return false; row.state='sent'; row.messageId=value.messageId; return true; },
    async uncertain(value) { const row=state.get(key(value)); if(row?.state==='started') row.state='uncertain'; },
    async eraseCustomer(customer) {
      if(!hash(customer)) throw Error('invalid_notice_customer');
      const before=Math.max(now(),erasures.get(customer)?.before || 0,...[...state.values()].filter(r=>r.customerKey===customer).map(r=>r.eventAt));
      erasures.set(customer,{before,expiresAt:before+RETENTION_MS});
      for (const [k,row] of [...state].filter(([,r])=>r.customerKey===customer && r.eventAt<=before).slice(0,BATCH)) state.delete(k);
      return {ok:true,remaining:[...state.values()].some(r=>r.customerKey===customer && r.eventAt<=before)};
    },
    async pruneExpired() {
      for (const [k,row] of [...state].filter(([,r])=>r.expiresAt<=now()).slice(0,BATCH)) state.delete(k);
      for (const [k,row] of [...state].filter(([,r])=>(erasures.get(r.customerKey)?.before ?? -1)>=r.eventAt).slice(0,BATCH)) state.delete(k);
      for (const [k,row] of [...erasures].filter(([,r])=>r.expiresAt<=now()).slice(0,BATCH)) erasures.delete(k);
      return {remaining:[...state.values()].some(r=>r.expiresAt<=now() || (erasures.get(r.customerKey)?.before ?? -1)>=r.eventAt) ||
        [...erasures.values()].some(r=>r.expiresAt<=now())};
    },
  };
}
let testStore = null;
function service() {
  if(testStore) return testStore;
  if(!process.env.DATABASE_URL) throw Error('notice_database_required');
  return createPostgresStore(require('./db').pool);
}
async function eraseCustomer({ customerId } = {}) {
  try {
    const customer=customerKey(customerId);
    if (!testStore && !process.env.DATABASE_URL) return {ok:true,remaining:false};
    for (let pass=0;pass<10;pass++) {
      const result=await service().eraseCustomer(customer);
      if(!result?.ok || !result.remaining) return result || {ok:false};
    }
    return {ok:false,reason:'pending'};
  } catch { console.error('[GitHub] customer notice erasure not confirmed'); return {ok:false,reason:'unavailable'}; }
}
module.exports = { initSchema,keys,customerKey,eventTimestamp,recent,RETENTION_MS,validDeliveryId,validMessageId,
  createPostgresStore,createMemoryStore,eraseCustomer,setStoreForTests:store=>{testStore=store;},
  begin:value=>service().begin(value),confirm:value=>service().confirm(value),uncertain:value=>service().uncertain(value),
  pruneExpired:(...args)=>service().pruneExpired(...args) };
