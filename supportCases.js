const { randomUUID } = require('node:crypto');
const { redactSensitive } = require('./privacy');

const STATUSES = ['queued', 'delivered', 'accepted', 'resolved', 'closed'];
const ACTIVE = ['queued', 'delivered', 'accepted'];
const AREAS = new Set(['general', 'shop', 'privacy', 'app', 'desktop', 'device', 'hardware', 'software', 'account', 'firmware', 'integrations', 'other', 'unknown']);
const REASONS = new Set(['needs_person', 'low_confidence', 'data_loss_risk', 'delivery_failed', 'customer_followup', 'customer_still_needs_help', 'provider_error', 'no_official_source', 'order_lookup', 'billing', 'refund', 'replacement', 'account', 'privacy', 'bug']);
const WORK_STATUSES = new Set(['in_progress', 'waiting_customer']);
const changes = new (require('node:events').EventEmitter)();
function changed(value) {
  if (value) for (const listener of changes.listeners('change')) {
    try { Promise.resolve(listener(value.id)).catch(() => console.error('[CaseCard] status refresh scheduling failed')); }
    catch { console.error('[CaseCard] status refresh scheduling failed'); }
  }
  return value;
}

function identifier(value, required = false) {
  const out = String(value || '').trim();
  if ((!out && required) || out.length > 128 || (out && !/^[A-Za-z0-9_.:-]+$/.test(out))) throw new Error('Invalid support case identifier');
  return out || null;
}

function safeContext(value = {}) {
  // Persist operational categories only. Free-form questions, summaries,
  // transcripts, order facts and model drafts deliberately have no field here.
  if (!value || typeof value !== 'object') value = {};
  const result = {};
  for (const key of ['area', 'lane']) {
    if (AREAS.has(value[key])) result[key] = value[key];
  }
  const reasons = value.reasonCodes || value.signals || [];
  if (Array.isArray(reasons)) result.reasonCodes = [...new Set(reasons.filter((item) => REASONS.has(item)))].slice(0, 12);
  for (const key of ['dataLossRisk', 'needsPerson']) {
    if (typeof value[key] === 'boolean') result[key] = value[key];
  }
  if (typeof value.replyLanguage === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{4})?$/.test(value.replyLanguage)) result.replyLanguage = value.replyLanguage;
  if (Number.isInteger(value.attachmentCount) && value.attachmentCount >= 0) result.attachmentCount = Math.min(value.attachmentCount, 100);
  return result;
}

function safeSources(values = []) {
  if (!Array.isArray(values)) return [];
  const urls = new Set();
  for (const item of values.slice(0, 20)) {
    try {
      const url = new URL(typeof item === 'string' ? item : item?.url);
      const official = ['omi.me', 'www.omi.me', 'help.omi.me', 'docs.omi.me'].includes(url.hostname) ||
        (url.hostname === 'github.com' && /^\/BasedHardware\/omi(?:\/|$)/i.test(url.pathname));
      if (!official || url.protocol !== 'https:' || url.username || url.password) continue;
      const path = decodeURIComponent(url.pathname);
      if (redactSensitive(path, { issue: true }) !== path) continue;
      url.search = '';
      url.hash = '';
      if (url.href.length <= 600) urls.add(url.href);
    } catch { /* Untrusted source metadata is omitted. */ }
  }
  return [...urls];
}

const clone = (value) => value ? JSON.parse(JSON.stringify(value)) : null;

function rowCase(row) {
  if (!row) return null;
  return {
    id: row.id, channelId: row.channel_id, customerId: row.customer_id,
    customerThreadId: row.customer_thread_id, handoffThreadId: row.handoff_thread_id,
    escalationId: row.escalation_id, status: row.status, context: row.context || {}, sources: row.sources || [],
    deliveryId: row.delivery_id, deliveryDestination: row.delivery_destination,
    acceptedBy: row.accepted_by, acceptedAt: row.accepted_at, generation: Number(row.generation || 0),
    sourceMessageId: row.source_message_id, workStatus: row.work_status,
    acceptanceGeneration: row.acceptance_generation,
    acceptanceNoticeStarted: row.acceptance_notice_started, acceptanceNoticeId: row.acceptance_notice_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function initSchema(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS support_cases (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      customer_thread_id TEXT,
      handoff_thread_id TEXT,
      escalation_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'accepted', 'resolved', 'closed')),
      context JSONB NOT NULL DEFAULT '{}',
      sources JSONB NOT NULL DEFAULT '[]',
      delivery_id TEXT,
      delivery_destination TEXT,
      accepted_by TEXT,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS accepted_by TEXT;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS generation INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS source_message_id TEXT;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS work_status TEXT CHECK (work_status IN ('in_progress', 'waiting_customer'));
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS acceptance_notice_started BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS acceptance_notice_id TEXT;
    ALTER TABLE support_cases ADD COLUMN IF NOT EXISTS acceptance_generation TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS support_cases_active_scope_idx
      ON support_cases(channel_id, customer_id) WHERE status IN ('queued', 'delivered', 'accepted');
    CREATE INDEX IF NOT EXISTS support_cases_customer_thread_idx ON support_cases(customer_thread_id);
    CREATE INDEX IF NOT EXISTS support_cases_handoff_thread_idx ON support_cases(handoff_thread_id);
  `);
}

function createPostgresStore(client) {
  return {
    async getOrCreate(input) {
      const { rows } = await client.query(`
        INSERT INTO support_cases (id, channel_id, customer_id, customer_thread_id, status, context, sources, source_message_id)
        VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6::jsonb, $7)
        ON CONFLICT (channel_id, customer_id) WHERE status IN ('queued', 'delivered', 'accepted')
        DO UPDATE SET context = support_cases.context || EXCLUDED.context,
          sources = CASE WHEN jsonb_array_length(EXCLUDED.sources) > 0 THEN EXCLUDED.sources ELSE support_cases.sources END,
          customer_thread_id = COALESCE(EXCLUDED.customer_thread_id, support_cases.customer_thread_id),
          source_message_id = COALESCE(support_cases.source_message_id, EXCLUDED.source_message_id), updated_at = NOW()
        RETURNING *`, [input.id, input.channelId, input.customerId, input.customerThreadId, JSON.stringify(input.context), JSON.stringify(input.sources), input.sourceMessageId]);
      return rowCase(rows[0]);
    },
    async getActive(channelId, customerId) {
      const { rows } = await client.query(`SELECT * FROM support_cases WHERE channel_id = $1 AND customer_id = $2 AND status IN ('queued', 'delivered', 'accepted') ORDER BY created_at DESC LIMIT 1`, [channelId, customerId]);
      return rowCase(rows[0]);
    },
    async getById(caseId) {
      const { rows } = await client.query('SELECT * FROM support_cases WHERE id = $1', [caseId]);
      return rowCase(rows[0]);
    },
    async accept(caseId, staffId, generation) {
      const { rows } = await client.query(`UPDATE support_cases SET status = 'accepted',
        accepted_by = COALESCE(accepted_by, $2), accepted_at = COALESCE(accepted_at, NOW()),
        acceptance_generation = $3, updated_at = NOW()
        WHERE id = $1 AND status = 'delivered' RETURNING *`, [caseId, staffId, generation]);
      if (rows.length) return rowCase(rows[0]);
      const existing = await client.query("SELECT * FROM support_cases WHERE id = $1 AND status = 'accepted'", [caseId]);
      return rowCase(existing.rows[0]);
    },
    async setWorkStatus(caseId, workStatus) {
      const { rows } = await client.query(`UPDATE support_cases SET work_status = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'accepted' RETURNING *`, [caseId, workStatus]);
      return rowCase(rows[0]);
    },
    async claimAcceptanceNotice(caseId, generation) {
      const { rows } = await client.query(`UPDATE support_cases SET acceptance_notice_started = true
        WHERE id = $1 AND status = 'accepted' AND accepted_by IS NOT NULL AND accepted_at IS NOT NULL
          AND acceptance_notice_started = false AND acceptance_generation = $2 RETURNING *`, [caseId, generation]);
      return rowCase(rows[0]);
    },
    async saveAcceptanceNotice(caseId, generation, messageId) {
      await client.query(`UPDATE support_cases SET acceptance_notice_id = $3
        WHERE id = $1 AND acceptance_generation = $2 AND acceptance_notice_started = true`, [caseId, generation, messageId]);
    },
    async getByThread(threadId, customerId) {
      const { rows } = await client.query(`SELECT * FROM support_cases
        WHERE (customer_thread_id = $1 OR handoff_thread_id = $1 OR (channel_id = $1 AND customer_id = $2))
          AND ($2::text IS NULL OR customer_id = $2)
        ORDER BY created_at DESC LIMIT 2`, [threadId, customerId]);
      // A shared/ambiguous channel can never select an arbitrary customer's case.
      return rows.length === 1 ? rowCase(rows[0]) : null;
    },
    async link(caseId, input) {
      const { rows } = await client.query(`UPDATE support_cases SET
        handoff_thread_id = COALESCE($2, handoff_thread_id), customer_thread_id = COALESCE($3, customer_thread_id),
        escalation_id = COALESCE($4, escalation_id), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [caseId, input.handoffThreadId, input.customerThreadId, input.escalationId]);
      return rowCase(rows[0]);
    },
    async transition(caseId, status, from, delivery = {}) {
      try {
        const { rows } = await client.query(`UPDATE support_cases AS current_case SET status = $2,
          generation = generation + CASE WHEN $2 = 'queued' AND status IN ('closed', 'resolved') THEN 1 ELSE 0 END,
          delivery_id = CASE WHEN $2 = 'queued' THEN NULL ELSE COALESCE($4, delivery_id) END,
          delivery_destination = CASE WHEN $2 = 'queued' THEN NULL ELSE COALESCE($5, delivery_destination) END,
          accepted_by = CASE WHEN $2 = 'queued' THEN NULL ELSE accepted_by END,
          accepted_at = CASE WHEN $2 = 'queued' THEN NULL ELSE accepted_at END,
          work_status = CASE WHEN $2 = 'queued' THEN NULL ELSE work_status END,
          acceptance_notice_started = CASE WHEN $2 = 'queued' THEN false ELSE acceptance_notice_started END,
          acceptance_notice_id = CASE WHEN $2 = 'queued' THEN NULL ELSE acceptance_notice_id END,
          acceptance_generation = CASE WHEN $2 = 'queued' THEN NULL ELSE acceptance_generation END, updated_at = NOW()
          WHERE current_case.id = $1 AND current_case.status = ANY($3::text[])
            AND ($6::integer IS NULL OR generation = $6)
            AND ($2 NOT IN ('queued', 'delivered', 'accepted') OR NOT EXISTS (
              SELECT 1 FROM support_cases other WHERE other.channel_id = current_case.channel_id AND other.customer_id = current_case.customer_id
                AND other.id <> current_case.id AND other.status IN ('queued', 'delivered', 'accepted')
            )) RETURNING current_case.*`, [caseId, status, from, delivery.messageId || null, delivery.destination || null, delivery.expectedGeneration ?? null]);
        return rowCase(rows[0]);
      } catch (error) {
        // A concurrent new case can win the unique active-scope index after
        // the snapshot read. The earlier closed case must then stay closed.
        if (error.code === '23505') return null;
        throw error;
      }
    },
  };
}

function createMemoryStore(state = { cases: new Map() }) {
  return {
    state,
    async getOrCreate(input) {
      const existing = [...state.cases.values()].find((item) => item.channelId === input.channelId && item.customerId === input.customerId && ACTIVE.includes(item.status));
      if (existing) {
        Object.assign(existing.context, input.context);
        if (input.sources.length) existing.sources = input.sources;
        if (input.customerThreadId) existing.customerThreadId = input.customerThreadId;
        existing.sourceMessageId ||= input.sourceMessageId;
        return clone(existing);
      }
      const value = { ...input, generation: 0, handoffThreadId: null, escalationId: null, status: 'queued', deliveryId: null, deliveryDestination: null, acceptedBy: null, acceptedAt: null, acceptanceGeneration: null, workStatus: null, acceptanceNoticeStarted: false, acceptanceNoticeId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.cases.set(value.id, value);
      return clone(value);
    },
    async getActive(channelId, customerId) {
      return clone([...state.cases.values()].find((item) => item.channelId === channelId && item.customerId === customerId && ACTIVE.includes(item.status)));
    },
    async getById(caseId) { return clone(state.cases.get(caseId)); },
    async accept(caseId, staffId, generation) {
      const value = state.cases.get(caseId);
      if (!value || !['delivered', 'accepted'].includes(value.status)) return null;
      if (value.status === 'delivered') {
        value.status = 'accepted';
        value.acceptedBy ||= staffId;
        value.acceptedAt ||= new Date().toISOString();
        value.acceptanceGeneration = generation;
        value.updatedAt = new Date().toISOString();
      }
      return clone(value);
    },
    async setWorkStatus(caseId, workStatus) {
      const value = state.cases.get(caseId);
      if (!value || value.status !== 'accepted') return null;
      value.workStatus = workStatus;
      value.updatedAt = new Date().toISOString();
      return clone(value);
    },
    async claimAcceptanceNotice(caseId, generation) {
      const value = state.cases.get(caseId);
      if (!value || value.status !== 'accepted' || !value.acceptedBy || !value.acceptedAt || value.acceptanceNoticeStarted || value.acceptanceGeneration !== generation) return null;
      value.acceptanceNoticeStarted = true;
      return clone(value);
    },
    async saveAcceptanceNotice(caseId, generation, messageId) {
      const value = state.cases.get(caseId);
      if (value && value.acceptanceGeneration === generation && value.acceptanceNoticeStarted) value.acceptanceNoticeId = messageId;
    },
    async getByThread(threadId, customerId) {
      const matches = [...state.cases.values()].filter((item) =>
        (!customerId || item.customerId === customerId) &&
        (item.customerThreadId === threadId || item.handoffThreadId === threadId || (customerId && item.channelId === threadId && item.customerId === customerId)));
      return matches.length === 1 ? clone(matches[0]) : null;
    },
    async link(caseId, input) {
      const value = state.cases.get(caseId);
      if (!value) return null;
      for (const key of ['handoffThreadId', 'customerThreadId', 'escalationId']) if (input[key] != null) value[key] = input[key];
      value.updatedAt = new Date().toISOString();
      return clone(value);
    },
    async transition(caseId, status, from, delivery = {}) {
      const value = state.cases.get(caseId);
      if (!value || !from.includes(value.status)) return null;
      if (delivery.expectedGeneration != null && value.generation !== delivery.expectedGeneration) return null;
      if (ACTIVE.includes(status) && [...state.cases.values()].some((other) => other.id !== value.id && other.channelId === value.channelId && other.customerId === value.customerId && ACTIVE.includes(other.status))) return null;
      if (status === 'queued' && ['closed', 'resolved'].includes(value.status)) {
        value.generation++;
        value.deliveryId = value.deliveryDestination = value.acceptedBy = value.acceptedAt = null;
      }
      value.status = status;
      if (status === 'queued') {
        value.acceptedBy = null; value.acceptedAt = null; value.workStatus = null;
        value.acceptanceNoticeStarted = false; value.acceptanceNoticeId = null;
        value.acceptanceGeneration = null;
      }
      if (delivery.messageId) value.deliveryId = delivery.messageId;
      if (delivery.destination) value.deliveryDestination = delivery.destination;
      value.updatedAt = new Date().toISOString();
      return clone(value);
    },
  };
}

function createCaseService(store) {
  return {
    async getOrCreateCase(input) {
      return store.getOrCreate({ id: randomUUID(), channelId: identifier(input.channelId, true), customerId: identifier(input.customerId, true), customerThreadId: identifier(input.customerThreadId), sourceMessageId: identifier(input.sourceMessageId), context: safeContext(input.context), sources: safeSources(input.sources) });
    },
    getActiveCase: (channelId, customerId) => store.getActive(identifier(channelId, true), identifier(customerId, true)),
    getCaseById: (caseId) => store.getById(identifier(caseId, true)),
    getCaseByThread: (threadId, customerId) => store.getByThread(identifier(threadId, true), identifier(customerId)),
    linkHandoff: (caseId, input = {}) => store.link(identifier(caseId, true), {
      handoffThreadId: identifier(input.handoffThreadId), customerThreadId: identifier(input.customerThreadId),
      escalationId: Number.isSafeInteger(input.escalationId) && input.escalationId > 0 ? input.escalationId : null,
    }),
    markDelivered(caseId, delivery = {}) {
      if (!delivery.messageId && delivery.confirmed !== true) throw new Error('Confirmed delivery is required');
      if (delivery.expectedGeneration != null && (!Number.isSafeInteger(delivery.expectedGeneration) || delivery.expectedGeneration < 0)) {
        throw new Error('A valid case generation is required');
      }
      return store.transition(identifier(caseId, true), 'delivered', ['queued', 'delivered'], {
        messageId: identifier(delivery.messageId), destination: identifier(delivery.destination),
        expectedGeneration: Number.isSafeInteger(delivery.expectedGeneration) && delivery.expectedGeneration >= 0 ? delivery.expectedGeneration : null,
      }).then(changed);
    },
    markAccepted(caseId, { staffId } = {}) { return store.accept(identifier(caseId, true), identifier(staffId, true), randomUUID()).then(changed); },
    setWorkStatus(caseId, workStatus) {
      if (!WORK_STATUSES.has(workStatus)) throw new Error('Invalid case work status');
      return store.setWorkStatus(identifier(caseId, true), workStatus).then(changed);
    },
    claimAcceptanceNotice: (caseId, generation) => store.claimAcceptanceNotice(identifier(caseId, true), identifier(generation, true)),
    saveAcceptanceNotice: (caseId, generation, messageId) => store.saveAcceptanceNotice(identifier(caseId, true), identifier(generation, true), identifier(messageId, true)),
    resolveCase(caseId, { close = false, deliveryId, confirmed = false } = {}) {
      if (!deliveryId && !confirmed) throw new Error('Confirmed customer delivery is required');
      return store.transition(identifier(caseId, true), close ? 'closed' : 'resolved', STATUSES, { messageId: identifier(deliveryId) }).then(changed);
    },
    async resolveByThread(threadId, { customerId, close = false, deliveryId, confirmed = false } = {}) {
      if (!deliveryId && !confirmed) throw new Error('Confirmed customer delivery is required');
      const value = await store.getByThread(identifier(threadId, true), identifier(customerId));
      if (!value) return null;
      return changed(await store.transition(value.id, close ? 'closed' : 'resolved', STATUSES, { messageId: identifier(deliveryId) }));
    },
    async reopenByThread(threadId, customerId) {
      const value = await store.getByThread(identifier(threadId, true), identifier(customerId, true));
      if (!value) return null;
      if (ACTIVE.includes(value.status)) return value;
      return changed(await store.transition(value.id, 'queued', ['resolved', 'closed']));
    },
  };
}

let injectedStore = null;
const localStore = createMemoryStore();
let postgresStore = null;
function service() {
  if (injectedStore) return createCaseService(injectedStore);
  if (!process.env.DATABASE_URL) return createCaseService(localStore);
  if (!postgresStore) postgresStore = createPostgresStore(require('./db').pool);
  return createCaseService(postgresStore);
}

module.exports = {
  initSchema, createPostgresStore, createMemoryStore, createCaseService, safeContext, safeSources,
  setStoreForTests: (store) => { injectedStore = store; },
  onChange(listener) { changes.on('change', listener); return () => changes.off('change', listener); },
  ...Object.fromEntries(['getOrCreateCase', 'getActiveCase', 'getCaseById', 'getCaseByThread', 'linkHandoff', 'markDelivered', 'markAccepted', 'setWorkStatus', 'claimAcceptanceNotice', 'saveAcceptanceNotice', 'resolveCase', 'resolveByThread', 'reopenByThread'].map((name) => [name, (...args) => service()[name](...args)])),
};
