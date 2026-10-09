// Read-only private operations summary. Never prints a nonce, customer,
// channel/source identifier, message content, payload or connection string.
const { getService } = require('../supportDeliveries');

function summarize(row, now = Date.now()) {
  return { id: row.id, kind: row.kind, state: row.state,
    attemptCount: row.attemptCount, hasReceipt: Boolean(row.messageId),
    projectionPending: row.state === 'accepted' && !row.projectedAt,
    ageSeconds: Math.max(0, Math.floor((now - new Date(row.createdAt).getTime()) / 1000)) };
}

async function inspect(service, { limit = 20, now = Date.now() } = {}) {
  const [held, pending] = await Promise.all([service.listHeld(limit), service.pendingReceipts(limit)]);
  return { held: held.map((row) => summarize(row, now)), pendingProjections: pending.map((row) => summarize(row, now)) };
}

async function main() {
  require('dotenv').config();
  const raw = process.argv.slice(2);
  if (raw.length > 2 || (raw.length && raw[0] !== '--limit')) throw new Error('Invalid inspection options');
  const limit = raw.length ? Number(raw[1]) : 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid inspection limit');
  if (!process.env.DATABASE_URL) throw new Error('A private support database connection is required');
  try { console.log(JSON.stringify(await inspect(getService(), { limit }), null, 2)); }
  finally { await require('../db').shutdown(); }
}

if (require.main === module) main().catch(() => {
  console.error('[Delivery] private read-only inspection unavailable');
  process.exitCode = 1;
});

module.exports = { summarize, inspect };
