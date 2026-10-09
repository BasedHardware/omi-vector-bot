const { randomBytes, randomUUID } = require('node:crypto');
const { DiscordTransportError } = require('./supportDiscordTransport');

const ATTEMPT_TTL_MS = 2 * 60_000;
const RETRY_WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const SCOPE_KEYS = ['operationKey', 'kind', 'sourceMessageId', 'customerId', 'channelId', 'botUserId', 'caseId', 'referenceMessageId', 'caseGeneration', 'approvalId'];
const SCOPE_COLUMNS = ['operation_key', 'kind', 'source_message_id', 'customer_id', 'channel_id', 'bot_user_id', 'case_id', 'reference_message_id', 'case_generation', 'approval_id'];
const KNOWN_STATUSES = new Set([400, 401, 403, 404, 405, 429]);
const KNOWN_CODES = new Set([10003, 10008, 50001, 50006, 50007, 50013, 50035]);

class DeliveryUncertainError extends Error {
  constructor(code = 'delivery_unknown', receipt = null) {
    super('Delivery outcome is uncertain; automatic resend is blocked');
    this.name = 'DeliveryUncertainError'; this.deliveryUncertain = true; this.outcomeCode = code;
    if (receipt) this.receipt = receipt;
  }
}
class DeliveryBlockedError extends Error {
  constructor(code = 'delivery_store_unavailable') {
    super('Delivery is blocked before sending');
    this.name = 'DeliveryBlockedError'; this.deliveryBlocked = true; this.outcomeCode = code;
  }
}

function classifyDeliveryError(error) {
  const status = Number(error?.status ?? error?.httpStatus ?? error?.response?.status);
  const code = Number(error?.code);
  // Only definite Discord validation/auth/access/rate-limit responses permit
  // retry. Timeouts, sockets, unknown client errors and all server errors hold.
  const safePreflight = error instanceof DiscordTransportError && error.outcome === 'known_rejected' && error.dispatched === false;
  const rejected = safePreflight || (Number.isFinite(status)
    ? KNOWN_STATUSES.has(status)
    : KNOWN_CODES.has(code));
  const transportCode = error instanceof DiscordTransportError && /^DISCORD_[A-Z_]{1,64}$/.test(String(error.code || '')) ? error.code : null;
  return { outcome: rejected ? 'rejected' : 'unknown',
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    code: Number.isInteger(code) && code > 0 && code <= 999999 ? code : transportCode };
}

function identifier(value, required = true, maximum = 128) {
  const result = value == null ? '' : String(value).trim();
  if ((!result && required) || (result && (result.length > maximum || !/^[A-Za-z0-9_.:-]+$/.test(result)))) throw new DeliveryBlockedError('invalid_delivery_scope');
  return result || null;
}
function scopeOf(input) {
  if (!['answer', 'staff-card', 'closure'].includes(input?.kind)) throw new DeliveryBlockedError('invalid_delivery_scope');
  const caseGeneration = input.caseGeneration ?? (input.kind === 'staff-card' ? 0 : null);
  if (caseGeneration != null && (!Number.isSafeInteger(caseGeneration) || caseGeneration < 0)) throw new DeliveryBlockedError('invalid_delivery_scope');
  if (input.kind === 'answer' && input.approvalId != null) throw new DeliveryBlockedError('invalid_delivery_scope');
  const scope = { operationKey: identifier(input.operationKey, true, 256), kind: input.kind,
    sourceMessageId: identifier(input.sourceMessageId), customerId: identifier(input.customerId),
    channelId: identifier(input.channelId), botUserId: identifier(input.botUserId),
    caseId: identifier(input.caseId, false), referenceMessageId: identifier(input.referenceMessageId, false), caseGeneration, approvalId: identifier(input.approvalId, false) };
  if (scope.kind === 'closure' && (!scope.caseId || scope.caseGeneration == null || scope.sourceMessageId !== scope.channelId ||
    scope.referenceMessageId != null || scope.approvalId != null ||
    scope.operationKey !== `closure:${scope.caseId}:${scope.caseGeneration}:${scope.channelId}`)) throw new DeliveryBlockedError('invalid_delivery_scope');
  return scope;
}
function sameScope(left, right) { return SCOPE_KEYS.every((key) => left[key] === right[key]); }
function receiptOf(row) {
  if (!row?.acceptedMessageId) return null;
  return { id: row.acceptedMessageId, channelId: row.channelId, author: { id: row.botUserId, bot: true }, nonce: row.nonce,
    reference: row.referenceMessageId ? { messageId: row.referenceMessageId, channelId: row.channelId } : null };
}
function rowDelivery(row) {
  if (!row) return null;
  const value = { id: row.id, ...Object.fromEntries(SCOPE_KEYS.map((key, index) => [key, row[SCOPE_COLUMNS[index]]])),
    nonce: row.nonce, state: row.state, attemptToken: row.attempt_token, attemptCount: row.attempt_count,
    createdAt: row.created_at, updatedAt: row.updated_at, attemptExpiresAt: row.attempt_expires_at,
    acceptedMessageId: row.accepted_message_id, acceptedAt: row.accepted_at, projectedAt: row.projected_at,
    messageId: row.accepted_message_id, projectionAttempts: row.projection_attempts || 0, nextProjectionAt: row.next_projection_at,
    errorCode: row.error_code, httpStatus: row.http_status };
  value.caseGeneration = value.caseGeneration == null ? null : Number(value.caseGeneration);
  value.receipt = receiptOf(value);
  return value;
}
function boundedLimit(value, maximum = 100) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new DeliveryBlockedError('invalid_inspection_limit');
  return value;
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_deliveries (
    id TEXT PRIMARY KEY, operation_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('answer','staff-card','closure')),
    source_message_id TEXT NOT NULL, customer_id TEXT NOT NULL, channel_id TEXT NOT NULL, bot_user_id TEXT NOT NULL,
    case_id TEXT, reference_message_id TEXT, case_generation INTEGER, approval_id TEXT,
    nonce TEXT NOT NULL UNIQUE, state TEXT NOT NULL CHECK(state IN ('dispatching','accepted','rejected','unknown')),
    attempt_token TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL, attempt_expires_at TIMESTAMPTZ NOT NULL,
    accepted_message_id TEXT, accepted_at TIMESTAMPTZ, projected_at TIMESTAMPTZ,
    projection_attempts INTEGER NOT NULL DEFAULT 0, next_projection_at TIMESTAMPTZ, error_code TEXT, http_status INTEGER
  );
  ALTER TABLE support_deliveries ADD COLUMN IF NOT EXISTS case_generation INTEGER;
  ALTER TABLE support_deliveries ADD COLUMN IF NOT EXISTS approval_id TEXT;
  ALTER TABLE support_deliveries ADD COLUMN IF NOT EXISTS projected_at TIMESTAMPTZ;
  ALTER TABLE support_deliveries ADD COLUMN IF NOT EXISTS projection_attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE support_deliveries ADD COLUMN IF NOT EXISTS next_projection_at TIMESTAMPTZ;
  ALTER TABLE support_deliveries DROP CONSTRAINT IF EXISTS support_deliveries_kind_check;
  ALTER TABLE support_deliveries ADD CONSTRAINT support_deliveries_kind_check CHECK(kind IN ('answer','staff-card','closure'));
  CREATE INDEX IF NOT EXISTS support_deliveries_nonce_idx ON support_deliveries(nonce);
  CREATE INDEX IF NOT EXISTS support_deliveries_pending_idx ON support_deliveries(state, attempt_expires_at);
  CREATE INDEX IF NOT EXISTS support_deliveries_projection_idx ON support_deliveries(accepted_at) WHERE state='accepted' AND projected_at IS NULL;`);
}

function createPostgresStore(client) {
  const scopeMatch = SCOPE_COLUMNS.slice(1).map((column) => `support_deliveries.${column} IS NOT DISTINCT FROM EXCLUDED.${column}`).join(' AND ');
  return {
    async begin(value, retryAfter) {
      const { rows } = await client.query(`INSERT INTO support_deliveries
        (id,${SCOPE_COLUMNS.join(',')},nonce,state,attempt_token,attempt_count,created_at,updated_at,attempt_expires_at)
        VALUES ($1,${SCOPE_KEYS.map((_key, index) => `$${index + 2}`).join(',')},$${SCOPE_KEYS.length + 2},'dispatching',$${SCOPE_KEYS.length + 3},1,$${SCOPE_KEYS.length + 4},$${SCOPE_KEYS.length + 4},$${SCOPE_KEYS.length + 5})
        ON CONFLICT(operation_key) DO UPDATE SET state='dispatching',attempt_token=EXCLUDED.attempt_token,
          attempt_count=support_deliveries.attempt_count+1,updated_at=EXCLUDED.updated_at,
          attempt_expires_at=EXCLUDED.attempt_expires_at,error_code=NULL,http_status=NULL
        WHERE support_deliveries.state='rejected' AND support_deliveries.attempt_count < 3
          AND support_deliveries.created_at >= $${SCOPE_KEYS.length + 6} AND ${scopeMatch} RETURNING *`,
      [value.id, ...SCOPE_KEYS.map((key) => value[key]), value.nonce, value.attemptToken, new Date(value.createdAt), new Date(value.attemptExpiresAt), new Date(retryAfter)]);
      if (rows.length) return rowDelivery(rows[0]);
      return this.get(value.operationKey);
    },
    async get(operationKey) { const { rows } = await client.query('SELECT * FROM support_deliveries WHERE operation_key=$1', [operationKey]); return rowDelivery(rows[0]); },
    async byNonce(nonce) { const { rows } = await client.query('SELECT * FROM support_deliveries WHERE nonce=$1', [nonce]); return rowDelivery(rows[0]); },
    async accepted(id, attemptToken, messageId, now) {
      const { rows } = await client.query(`UPDATE support_deliveries SET state='accepted',accepted_message_id=$3,
        accepted_at=$4,updated_at=$4,error_code=NULL,http_status=NULL
        WHERE id=$1 AND attempt_token=$2 AND state IN ('dispatching','unknown') RETURNING *`, [id, attemptToken, messageId, new Date(now)]);
      return rowDelivery(rows[0]);
    },
    async failed(id, attemptToken, state, code, status, now) {
      const { rows } = await client.query(`UPDATE support_deliveries SET state=$3,error_code=$4,http_status=$5,updated_at=$6
        WHERE id=$1 AND attempt_token=$2 AND state='dispatching' RETURNING *`, [id, attemptToken, state, code, status, new Date(now)]);
      return rowDelivery(rows[0]);
    },
    async pending(limit) { const { rows } = await client.query("SELECT * FROM support_deliveries WHERE state='dispatching' ORDER BY created_at LIMIT $1", [limit]); return rows.map(rowDelivery); },
    async listHeld(limit, now) { const { rows } = await client.query("SELECT * FROM support_deliveries WHERE state='unknown' OR (state='dispatching' AND attempt_expires_at <= $2) ORDER BY created_at LIMIT $1", [limit, new Date(now)]); return rows.map(rowDelivery); },
    async pendingReceipts(limit, now) { const { rows } = await client.query("SELECT * FROM support_deliveries WHERE state='accepted' AND projected_at IS NULL AND (next_projection_at IS NULL OR next_projection_at <= $2) ORDER BY accepted_at LIMIT $1", [limit, new Date(now)]); return rows.map(rowDelivery); },
    async markProjected(id, now) { const { rows } = await client.query("UPDATE support_deliveries SET projected_at=COALESCE(projected_at,$2) WHERE id=$1 AND state='accepted' RETURNING *", [id, new Date(now)]); return rowDelivery(rows[0]); },
    async deferProjection(id, now) {
      const { rows } = await client.query(`UPDATE support_deliveries SET projection_attempts=projection_attempts+1,
        next_projection_at=$2::timestamptz + LEAST(30000 * POWER(2,LEAST(projection_attempts,10)),900000) * INTERVAL '1 millisecond'
        WHERE id=$1 AND state='accepted' AND projected_at IS NULL RETURNING *`, [id, new Date(now)]);
      return rowDelivery(rows[0]);
    },
    async recentAnswers(limit, since) { const { rows } = await client.query("SELECT * FROM support_deliveries WHERE kind='answer' AND state='accepted' AND accepted_at >= $2 ORDER BY accepted_at DESC LIMIT $1", [limit, new Date(since)]); return rows.map(rowDelivery); },
  };
}

function createMemoryStore(state = { deliveries: new Map() }) {
  const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : null;
  function acceptValue(value) { const copy = clone(value); if (copy) { copy.receipt = receiptOf(copy); copy.messageId = copy.acceptedMessageId; } return copy; }
  return {
    state,
    async begin(value, retryAfter) {
      const current = state.deliveries.get(value.operationKey);
      if (!current) { state.deliveries.set(value.operationKey, { ...value, state: 'dispatching', attemptCount: 1, updatedAt: value.createdAt, acceptedMessageId: null, acceptedAt: null, projectedAt: null, projectionAttempts: 0, nextProjectionAt: null, errorCode: null, httpStatus: null }); }
      else if (current.state === 'rejected' && current.attemptCount < MAX_ATTEMPTS && current.createdAt >= retryAfter && sameScope(current, value)) {
        Object.assign(current, { state: 'dispatching', attemptToken: value.attemptToken, attemptCount: current.attemptCount + 1,
          updatedAt: value.createdAt, attemptExpiresAt: value.attemptExpiresAt, errorCode: null, httpStatus: null });
      }
      return acceptValue(state.deliveries.get(value.operationKey));
    },
    async get(key) { return acceptValue(state.deliveries.get(key)); },
    async byNonce(nonce) { return acceptValue([...state.deliveries.values()].find((value) => value.nonce === nonce)); },
    async accepted(id, token, messageId, now) {
      const value = [...state.deliveries.values()].find((row) => row.id === id);
      if (!value || value.attemptToken !== token || !['dispatching', 'unknown'].includes(value.state)) return null;
      Object.assign(value, { state: 'accepted', acceptedMessageId: messageId, acceptedAt: now, updatedAt: now, errorCode: null, httpStatus: null });
      return acceptValue(value);
    },
    async failed(id, token, status, code, httpStatus, now) {
      const value = [...state.deliveries.values()].find((row) => row.id === id);
      if (!value || value.attemptToken !== token || value.state !== 'dispatching') return null;
      Object.assign(value, { state: status, errorCode: code, httpStatus, updatedAt: now }); return acceptValue(value);
    },
    async pending(limit) { return [...state.deliveries.values()].filter((row) => row.state === 'dispatching').slice(0, limit).map(acceptValue); },
    async listHeld(limit, now) { return [...state.deliveries.values()].filter((row) => row.state === 'unknown' || (row.state === 'dispatching' && row.attemptExpiresAt <= now)).slice(0, limit).map(acceptValue); },
    async pendingReceipts(limit, now) { return [...state.deliveries.values()].filter((row) => row.state === 'accepted' && row.projectedAt == null && (row.nextProjectionAt == null || row.nextProjectionAt <= now)).slice(0, limit).map(acceptValue); },
    async markProjected(id, now) { const row = [...state.deliveries.values()].find((value) => value.id === id); if (!row || row.state !== 'accepted') return null; row.projectedAt ??= now; return acceptValue(row); },
    async deferProjection(id, now) {
      const row = [...state.deliveries.values()].find((value) => value.id === id);
      if (!row || row.state !== 'accepted' || row.projectedAt != null) return null;
      row.nextProjectionAt = now + Math.min(30_000 * 2 ** Math.min(row.projectionAttempts, 10), 900_000);
      row.projectionAttempts++; return acceptValue(row);
    },
    async recentAnswers(limit, since) { return [...state.deliveries.values()].filter((row) => row.kind === 'answer' && row.state === 'accepted' && row.acceptedAt >= since).sort((a, b) => b.acceptedAt - a.acceptedAt).slice(0, limit).map(acceptValue); },
  };
}

function receiptMatches(receipt, value, strict = false) {
  try { identifier(receipt?.id); } catch { return false; }
  const author = receipt?.author?.id;
  const channel = receipt?.channelId ?? receipt?.channel_id ?? receipt?.channel?.id;
  const reference = receipt?.reference?.messageId ?? receipt?.message_reference?.message_id ?? null;
  if (String(author || '') !== value.botUserId || String(channel || '') !== value.channelId) return false;
  if (receipt?.author?.bot === false) return false;
  if (receipt?.webhookId != null || receipt?.webhook_id != null) return false;
  if ((receipt?.reference?.type ?? receipt?.message_reference?.type ?? 0) !== 0) return false;
  for (const snapshots of [receipt?.messageSnapshots, receipt?.message_snapshots]) {
    if (snapshots != null && (Array.isArray(snapshots) ? snapshots.length > 0 : typeof snapshots.size === 'number' ? snapshots.size > 0 : true)) return false;
  }
  if ((strict || receipt?.nonce != null) && String(receipt?.nonce || '') !== value.nonce) return false;
  if ((strict || value.referenceMessageId != null || receipt?.reference != null || receipt?.message_reference != null) && reference !== value.referenceMessageId) return false;
  const referenceChannel = receipt?.reference?.channelId ?? receipt?.message_reference?.channel_id;
  return referenceChannel == null || String(referenceChannel) === value.channelId;
}

function closureButtonsMatch(message, nonce) {
  if (!Array.isArray(message?.components)) return false;
  const buttons = new Set();
  for (const row of message.components) {
    if ((row?.type ?? row?.data?.type) !== 1 || !Array.isArray(row.components)) continue;
    for (const button of row.components) {
      if ((button?.type ?? button?.data?.type) === 2) buttons.add(button.customId ?? button.custom_id ?? button.data?.custom_id);
    }
  }
  return buttons.has(`rate:yes:${nonce}`) && buttons.has(`rate:no:${nonce}`);
}

function createDeliveryService(store, { now = () => Date.now(), attemptTtlMs = ATTEMPT_TTL_MS, log = console.log } = {}) {
  const emit = (value, state) => { try { log(`[Delivery] id=${value.id} kind=${value.kind} state=${state}`); } catch { /* Telemetry cannot change delivery. */ } };
  async function markUnknown(value, code = 'delivery_unknown') {
    let saved;
    try { saved = await store.failed(value.id, value.attemptToken, 'unknown', code, null, now()); } catch { /* The existing dispatching row also blocks replay. */ }
    if (saved?.state === 'unknown') { emit(saved, 'unknown'); return saved; }
    return store.get(value.operationKey).catch(() => null);
  }
  return {
    async send(input, sendFn) {
      if (typeof sendFn !== 'function') throw new DeliveryBlockedError('invalid_sender');
      const scoped = scopeOf(input); const at = now();
      const attempt = { ...scoped, id: randomUUID(), nonce: randomBytes(12).toString('hex'), attemptToken: randomUUID(), createdAt: at, attemptExpiresAt: at + attemptTtlMs };
      let value;
      try { value = await store.begin(attempt, at - RETRY_WINDOW_MS); }
      catch { throw new DeliveryBlockedError(); }
      if (!value || !sameScope(value, scoped)) throw new DeliveryBlockedError('delivery_scope_conflict');
      if (value.state === 'accepted') return receiptOf(value);
      if (value.state === 'rejected') throw new DeliveryBlockedError('delivery_retry_exhausted');
      if (value.state !== 'dispatching' || value.attemptToken !== attempt.attemptToken) throw new DeliveryUncertainError(value.state === 'unknown' ? 'delivery_unknown' : 'delivery_in_flight');
      emit(value, 'dispatching');
      let receipt;
      try { receipt = await sendFn({ nonce: value.nonce, enforceNonce: true }); }
      catch (error) {
        const gatewayAccepted = await store.get(value.operationKey).catch(() => null);
        if (gatewayAccepted?.state === 'accepted' && sameScope(gatewayAccepted, scoped)) return receiptOf(gatewayAccepted);
        const classified = classifyDeliveryError(error);
        if (classified.outcome === 'rejected') {
          let saved;
          try { saved = await store.failed(value.id, value.attemptToken, 'rejected', classified.code == null ? 'http_rejected' : String(classified.code), classified.status, now()); }
          catch { throw new DeliveryUncertainError('rejection_record_unknown'); }
          if (!saved) throw new DeliveryUncertainError('rejection_record_unknown');
          emit(value, 'rejected');
          const rejected = new Error('Discord rejected delivery'); rejected.name = 'DeliveryRejectedError'; rejected.deliveryRejected = true;
          if (classified.code != null) rejected.code = classified.code;
          if (classified.status != null) rejected.status = classified.status;
          if (error.referenceMissing === true) rejected.referenceMissing = true;
          throw rejected;
        }
        const resolved = await markUnknown(value);
        if (resolved?.state === 'accepted' && sameScope(resolved, scoped)) return receiptOf(resolved);
        throw new DeliveryUncertainError();
      }
      if (!receiptMatches(receipt, value)) {
        const resolved = await markUnknown(value, 'invalid_receipt');
        if (resolved?.state === 'accepted' && sameScope(resolved, scoped)) return receiptOf(resolved);
        throw new DeliveryUncertainError('invalid_receipt');
      }
      let accepted;
      try { accepted = await store.accepted(value.id, value.attemptToken, String(receipt.id), now()); }
      catch {
        const resolved = await markUnknown(value, 'receipt_record_unknown');
        if (resolved?.state === 'accepted' && sameScope(resolved, scoped)) return receiptOf(resolved);
        throw new DeliveryUncertainError('receipt_record_unknown', receiptOf({ ...value, acceptedMessageId: String(receipt.id) }));
      }
      if (!accepted) {
        const current = await store.get(value.operationKey).catch(() => null);
        if (current?.state !== 'accepted' || current.acceptedMessageId !== String(receipt.id)) throw new DeliveryUncertainError('receipt_record_unknown', receiptOf({ ...value, acceptedMessageId: String(receipt.id) }));
      }
      if (accepted) emit(accepted, 'accepted');
      return receipt;
    },
    async acceptGatewayReceipt(message) {
      if (!/^[0-9a-f]{24}$/.test(String(message?.nonce || ''))) return null;
      const value = await store.byNonce(String(message.nonce));
      if (!value || !receiptMatches(message, value, true)) return null;
      if (value.state === 'accepted') return value.acceptedMessageId === String(message.id) ? value : null;
      if (!['dispatching', 'unknown'].includes(value.state)) return null;
      const accepted = await store.accepted(value.id, value.attemptToken, String(message.id), now());
      if (accepted) emit(accepted, 'accepted');
      return accepted;
    },
    async acceptClosureInteractionReceipt(message, nonce) {
      if (!/^[0-9a-f]{24}$/.test(String(nonce || ''))) return null;
      const value = await store.byNonce(String(nonce));
      // This is a distinct trusted interaction-message proof: Discord may omit
      // the original nonce from old messages, so the bot-authored button pair
      // attests it. Never manufacture a Gateway nonce or accept an answer/card.
      if (!value || value.kind !== 'closure' || !receiptMatches(message, value) ||
        message?.reference != null || message?.message_reference != null || !closureButtonsMatch(message, value.nonce)) return null;
      if (value.state === 'accepted') return value.acceptedMessageId === String(message.id) ? value : null;
      if (!['dispatching', 'unknown'].includes(value.state)) return null;
      const accepted = await store.accepted(value.id, value.attemptToken, String(message.id), now());
      if (accepted) { emit(accepted, 'accepted'); return accepted; }
      const current = await store.byNonce(value.nonce);
      return current?.state === 'accepted' && current.acceptedMessageId === String(message.id) && sameScope(current, value) ? current : null;
    },
    get: (key) => store.get(identifier(key, true, 256)),
    getByNonce: (nonce) => /^[0-9a-f]{24}$/.test(String(nonce || '')) ? store.byNonce(String(nonce)) : Promise.resolve(null),
    pending: (limit = 20) => store.pending(boundedLimit(limit)),
    listHeld: (limit = 20) => store.listHeld(boundedLimit(limit), now()),
    pendingReceipts: (limit = 20) => store.pendingReceipts(boundedLimit(limit), now()),
    markProjected: (id) => store.markProjected(identifier(id), now()),
    deferProjection: (id) => store.deferProjection(identifier(id), now()),
    recentAnswers(input = {}) {
      const { limit = 2000, since = now() - 24 * 60 * 60_000 } = typeof input === 'number' ? { limit: input } : input;
      return store.recentAnswers(boundedLimit(limit, 2000), new Date(since).getTime());
    },
  };
}

let injected = null;
let memory = createMemoryStore();
let postgres = null;
function getService() {
  if (injected) return injected;
  if (!process.env.DATABASE_URL) return createDeliveryService(memory);
  if (!postgres) postgres = createPostgresStore(require('./db').pool);
  return createDeliveryService(postgres);
}
module.exports = {
  initSchema, createMemoryStore, createPostgresStore, createDeliveryService, getService,
  setStoreForTests: (store, options) => { injected = store ? createDeliveryService(store, options) : null; },
  resetMemory: () => { memory = createMemoryStore(); injected = null; },
  isDeliveryUncertain: (error) => error?.deliveryUncertain === true,
  classifyDeliveryError, DeliveryUncertainError, DeliveryBlockedError,
};
