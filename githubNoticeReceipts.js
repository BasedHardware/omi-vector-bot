const { createHash } = require('node:crypto');

function validDeliveryId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}
function keys(repo, deliveryId, recipient) {
  if (!validDeliveryId(deliveryId) || !Array.isArray(recipient) || !recipient.length) throw Error('invalid_notice_scope');
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const repository = String(repo).toLowerCase();
  return { eventKey: digest(['github-event', repository, deliveryId.toLowerCase()]),
    recipientKey: digest(['github-recipient', repository, ...recipient]) };
}
function validate(value) {
  if (!value || ![value.eventKey, value.recipientKey].every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))) {
    throw Error('invalid_notice_receipt');
  }
}
function validMessageId(value) { return typeof value === 'string' && /^\d{17,20}$/.test(value); }

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_github_notice_receipts (
    event_key TEXT NOT NULL CHECK (event_key ~ '^[a-f0-9]{64}$'),
    recipient_key TEXT NOT NULL CHECK (recipient_key ~ '^[a-f0-9]{64}$'),
    state TEXT NOT NULL CHECK (state IN ('started','sent','uncertain')),
    message_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_key, recipient_key)
  );`);
}
function createPostgresStore(pool) {
  return {
    async begin(value) {
      validate(value);
      const { rows } = await pool.query(`INSERT INTO support_github_notice_receipts(event_key,recipient_key,state)
        VALUES ($1,$2,'started') ON CONFLICT DO NOTHING RETURNING event_key`, [value.eventKey, value.recipientKey]);
      return rows.length === 1;
    },
    async confirm(value) {
      validate(value); if (!validMessageId(value.messageId)) throw Error('invalid_notice_message');
      const { rows } = await pool.query(`UPDATE support_github_notice_receipts SET state='sent',message_id=$3,updated_at=NOW()
        WHERE event_key=$1 AND recipient_key=$2 AND state='started' RETURNING event_key`,
      [value.eventKey, value.recipientKey, value.messageId]);
      return rows.length === 1;
    },
    async uncertain(value) {
      validate(value);
      await pool.query(`UPDATE support_github_notice_receipts SET state='uncertain',updated_at=NOW()
        WHERE event_key=$1 AND recipient_key=$2 AND state='started'`, [value.eventKey, value.recipientKey]);
    },
  };
}
// Explicit test adapter only. Missing production configuration or SQL errors
// never switch production coordination to this process-local map.
function createMemoryStore(state = new Map()) {
  const key = value => { validate(value); return `${value.eventKey}:${value.recipientKey}`; };
  return { state,
    async begin(value) { const k = key(value); if (state.has(k)) return false; state.set(k, { state: 'started' }); return true; },
    async confirm(value) { const row = state.get(key(value)); if (!validMessageId(value.messageId)) throw Error('invalid_notice_message');
      if (row?.state !== 'started') return false; row.state = 'sent'; row.messageId = value.messageId; return true; },
    async uncertain(value) { const row = state.get(key(value)); if (row?.state === 'started') row.state = 'uncertain'; },
  };
}
let testStore = null;
function service() {
  if (testStore) return testStore;
  if (!process.env.DATABASE_URL) throw Error('notice_database_required');
  return createPostgresStore(require('./db').pool);
}
module.exports = { initSchema, keys, validDeliveryId, validMessageId, createPostgresStore, createMemoryStore,
  setStoreForTests: store => { testStore = store; },
  begin: value => service().begin(value), confirm: value => service().confirm(value), uncertain: value => service().uncertain(value) };
