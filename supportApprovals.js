const { randomUUID, randomBytes, createCipheriv, createDecipheriv, createHmac } = require('node:crypto');
const { redactSensitive, attachmentCount } = require('./privacy');
const { configuredKey } = require('./supportIdentityStore');

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FILING_LEASE_MS = 2 * 60 * 1000;
const EDIT_TTL_MS = 10 * 60 * 1000;
const OUTCOME_CODES = new Set(['unconfigured', 'preflight_failed', 'existing_work', 'http_rejected', 'invalid_draft', 'transport_failed', 'invalid_response', 'remote_unknown', 'lease_expired', 'unspecified']);
const SCOPE_COLUMNS = ['case_id', 'customer_id', 'source_message_id', 'channel_id', 'thread_id', 'bot_user_id', 'repository', 'kind', 'target_issue_number'];
const SCOPE_KEYS = ['caseId', 'customerId', 'sourceMessageId', 'channelId', 'threadId', 'botUserId', 'repo', 'kind', 'targetIssueNumber'];
const SCOPE_WHERE = SCOPE_COLUMNS.map((column, index) => column === 'repository'
  ? `LOWER(repository) IS NOT DISTINCT FROM LOWER($${index + 2}::text)`
  : `${column} IS NOT DISTINCT FROM $${index + 2}`).join(' AND ');

function identifier(value, required = false) {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9_.:-]{1,128}$/.test(text)) return text;
  if (required) throw new Error('Incomplete support approval scope');
  return null;
}
function safeText(value, maximum) {
  return redactSensitive(String(value || '')
    .replace(/-----BEGIN [^-\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\n]*PRIVATE KEY-----/g, '[private key]')
    .replace(/\b(?:verification|security|one[- ]time|otp|recovery)\s*(?:code|pin)?\s*[:=]?\s*\d{4,8}\b/gi, '[verification code]')
    .replace(/\b(?:ghs_|ghu_|shpat_|shpua_|re_)[A-Za-z0-9_-]{8,}\b/g, '[token]')
    .replace(/https?:\/\/[^\s<>]+/gi, '[link omitted]'), { issue: true }).slice(0, maximum).trim();
}
function publicDraft(draft = {}) {
  const count = Number(draft.attachmentCount ?? attachmentCount(draft.files));
  // Customer quotes and arbitrary nested fields are never part of the proposal.
  return { title: safeText(draft.title, 180), body: safeText(draft.body, 4000),
    labels: [...new Set((Array.isArray(draft.labels) ? draft.labels : [])
      .map((label) => safeText(label, 40).toLowerCase()).filter((label) => /^[a-z][a-z0-9 _-]{0,39}$/.test(label)))].slice(0, 20),
    files: { size: Number.isSafeInteger(count) && count >= 0 ? Math.min(count, 100) : 0 } };
}
function scope(input = {}) {
  const repo = String(input.repo || 'BasedHardware/omi').trim().toLowerCase();
  const kind = input.kind || 'issue';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !['issue', 'comment'].includes(kind)) throw new Error('Invalid approval target');
  const targetIssueNumber = kind === 'comment' ? Number(input.targetIssueNumber) : null;
  if (kind === 'comment' && (!Number.isSafeInteger(targetIssueNumber) || targetIssueNumber <= 0)) throw new Error('A fixed target issue is required');
  if (kind === 'issue' && input.targetIssueNumber != null) throw new Error('An issue proposal cannot change its target');
  return { caseId: identifier(input.caseId, true), customerId: identifier(input.customerId, true),
    sourceMessageId: identifier(input.sourceMessageId, true), channelId: identifier(input.channelId, true),
    threadId: identifier(input.threadId, true), botUserId: identifier(input.botUserId, true), repo, kind, targetIssueNumber };
}
function scopedArgs(input) { return SCOPE_KEYS.map((key) => input[key]); }
function writerAppId(value) {
  if (value == null || value === '') return null;
  const id = String(value);
  if (!/^[1-9]\d*$/.test(id)) throw new Error('Invalid publication application identity');
  return id;
}
function canonicalReceiptUrl(value, repository, issueNumber, commentId = null) {
  if (!Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) <= 0 ||
      (commentId != null && (!Number.isSafeInteger(Number(commentId)) || Number(commentId) <= 0))) return null;
  try {
    const url = new URL(String(value || ''));
    const fragment = commentId == null ? '' : `#issuecomment-${Number(commentId)}`;
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search ||
        url.pathname.replace(/\/$/, '').toLowerCase() !== `/${repository}/issues/${Number(issueNumber)}`.toLowerCase() || url.hash !== fragment) return null;
    return `https://github.com/${repository}/issues/${Number(issueNumber)}${fragment}`;
  } catch { return null; }
}
function sameScopeValue(key, left, right) {
  return key === 'repo' ? String(left).toLowerCase() === String(right).toLowerCase() : left === right;
}
function matches(value, input) { return value && SCOPE_KEYS.every((key) => sameScopeValue(key, value[key], input[key])); }
function rowApproval(row) {
  if (!row) return null;
  return { id: row.id, ...Object.fromEntries(SCOPE_KEYS.map((key, index) => [key, row[SCOPE_COLUMNS[index]]])),
    writerAppId: row.writer_app_id || null,
    targetIssueNumber: row.target_issue_number == null ? null : Number(row.target_issue_number),
    ciphertext: row.payload_ciphertext, iv: row.payload_iv, tag: row.payload_tag,
    revision: row.payload_revision, payloadHash: row.payload_hash,
    cardMessageId: row.card_message_id, previewMessageId: row.preview_message_id, previewStaffId: row.preview_staff_id,
    editTokenHash: row.edit_token_hash, editActor: row.edit_actor, editExpiresAt: row.edit_expires_at, editRevision: row.edit_revision,
    editedBy: row.edited_by, status: row.status, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at,
    approvedBy: row.approved_by, approvedAt: row.approved_at, outcomeCode: row.outcome_code,
    externalIssueNumber: row.external_issue_number == null ? null : Number(row.external_issue_number),
    externalCommentId: row.external_comment_id == null ? null : Number(row.external_comment_id), externalIssueUrl: row.external_issue_url,
    createdAt: row.created_at, expiresAt: row.expires_at };
}

async function initSchema(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS support_issue_approvals (
    id TEXT PRIMARY KEY, case_id TEXT NOT NULL, channel_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    bot_user_id TEXT NOT NULL, repository TEXT NOT NULL, public_draft JSONB NOT NULL DEFAULT '{}',
    card_message_id TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','filing','filed','rejected','unknown')),
    lease_token TEXT, lease_expires_at TIMESTAMPTZ, approved_by TEXT, approved_at TIMESTAMPTZ, outcome_code TEXT,
    external_issue_number BIGINT, external_issue_url TEXT, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL
  );
  ALTER TABLE support_issue_approvals ALTER COLUMN public_draft SET DEFAULT '{}';
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS customer_id TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS source_message_id TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'issue';
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS target_issue_number BIGINT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS payload_ciphertext TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS payload_iv TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS payload_tag TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS payload_revision INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS payload_hash TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS preview_message_id TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS preview_staff_id TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS edit_token_hash TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS edit_actor TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS edit_expires_at TIMESTAMPTZ;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS edit_revision INTEGER;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS edited_by TEXT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS external_comment_id BIGINT;
  ALTER TABLE support_issue_approvals ADD COLUMN IF NOT EXISTS writer_app_id TEXT;
  CREATE INDEX IF NOT EXISTS support_issue_approvals_case_idx ON support_issue_approvals (case_id);
  CREATE UNIQUE INDEX IF NOT EXISTS support_issue_approvals_action_idx ON support_issue_approvals
    (repository, case_id, kind, source_message_id, (COALESCE(target_issue_number, 0)));
  -- Preserve historical repository bytes: they authenticate encrypted payloads.
  -- This additive index fails on conflicting historical actions; an operator
  -- must reconcile them rather than choosing/deleting a record at startup.
  CREATE UNIQUE INDEX IF NOT EXISTS support_issue_approvals_action_canonical_idx ON support_issue_approvals
    (LOWER(repository), case_id, kind, source_message_id, (COALESCE(target_issue_number, 0)));
  CREATE INDEX IF NOT EXISTS support_issue_approvals_uncertain_idx ON support_issue_approvals (status, lease_expires_at);`);
}
function createPostgresStore(client) {
  async function mutate(id, input, now, set, conditions, extra) {
    const { rows } = await client.query(`UPDATE support_issue_approvals SET ${set}
      WHERE id = $1 AND ${SCOPE_WHERE} AND status IN ('pending','rejected') AND expires_at > $11 ${conditions} RETURNING *`,
    [id, ...scopedArgs(input), new Date(now), ...extra]);
    return rowApproval(rows[0]);
  }
  return {
    async create(input) {
      const { rows } = await client.query(`INSERT INTO support_issue_approvals
        (id, ${SCOPE_COLUMNS.join(', ')}, payload_ciphertext, payload_iv, payload_tag, payload_hash, payload_revision, created_at, expires_at, writer_app_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,$16,$17)
        ON CONFLICT ((LOWER(repository)), case_id, kind, source_message_id, (COALESCE(target_issue_number, 0)))
        DO UPDATE SET id = support_issue_approvals.id RETURNING *`,
      [input.id, ...scopedArgs(input), input.ciphertext, input.iv, input.tag, input.payloadHash, input.createdAt, input.expiresAt, input.writerAppId]);
      return rowApproval(rows[0]);
    },
    async get(id, now) {
      await client.query("UPDATE support_issue_approvals SET status = 'unknown', outcome_code = 'lease_expired' WHERE id = $1 AND status = 'filing' AND lease_expires_at <= $2", [id, new Date(now)]);
      const { rows } = await client.query('SELECT * FROM support_issue_approvals WHERE id = $1', [id]);
      return rowApproval(rows[0]);
    },
    bindCard: (id, input, now) => mutate(id, input, now, 'card_message_id = $12',
      'AND (card_message_id IS NULL OR card_message_id = $12)', [input.cardMessageId]),
    beginEdit: (id, input, now) => mutate(id, input, now,
      'edit_token_hash = $12, edit_actor = $13, edit_expires_at = $14, edit_revision = payload_revision',
      'AND card_message_id = $15', [input.tokenHash, input.staffId, input.editExpiresAt, input.cardMessageId]),
    update: (id, input, now) => mutate(id, input, now,
      `payload_ciphertext = $12, payload_iv = $13, payload_tag = $14, payload_hash = $15, payload_revision = payload_revision + 1,
      edited_by = $16, edit_token_hash = NULL, edit_actor = NULL, edit_expires_at = NULL, edit_revision = NULL,
      preview_message_id = NULL, preview_staff_id = NULL`,
      'AND edit_actor = $16 AND edit_token_hash = $17 AND edit_expires_at > $11 AND edit_revision = payload_revision AND payload_revision = $18',
      [input.ciphertext, input.iv, input.tag, input.payloadHash, input.staffId, input.tokenHash, input.expectedRevision]),
    bindPreview: (id, input, now) => mutate(id, input, now, 'preview_message_id = $12, preview_staff_id = $13',
      'AND edited_by = $13 AND payload_revision = $14 AND payload_hash = $15 AND (preview_message_id IS NULL OR preview_message_id = $12)',
      [input.previewMessageId, input.staffId, input.revision, input.payloadHash]),
    claim: (id, input, now, leaseMs) => mutate(id, input, now,
      "status = 'filing', lease_token = $12, lease_expires_at = $13, approved_by = $14, approved_at = $11, outcome_code = NULL",
      'AND preview_staff_id = $14 AND preview_message_id = $15 AND payload_revision = $16 AND payload_hash = $17',
      [input.leaseToken, new Date(now + leaseMs), input.staffId, input.previewMessageId, input.revision, input.payloadHash]),
    async complete(id, input) {
      const { rows } = await client.query(`UPDATE support_issue_approvals SET status = $3, outcome_code = $4,
        external_issue_number = $5, external_issue_url = $6, external_comment_id = $8
        WHERE id = $1 AND lease_token = $2 AND status = ANY($7::text[]) RETURNING *`,
      [id, input.leaseToken, input.status, input.code, input.number || null, input.url || null,
        input.status === 'filed' ? ['filing','unknown'] : ['filing'], input.commentId || null]);
      return rowApproval(rows[0]);
    },
  };
}
function createMemoryStore(state = { approvals: new Map() }) {
  const clone = (value) => value ? structuredClone(value) : null;
  function mutable(id, input, now) {
    const value = state.approvals.get(id);
    return matches(value, input) && ['pending','rejected'].includes(value.status) && new Date(value.expiresAt).getTime() > now ? value : null;
  }
  return {
    state,
    async create(input) {
      const existing = [...state.approvals.values()].find((value) =>
        ['repo', 'caseId', 'kind', 'sourceMessageId', 'targetIssueNumber'].every((key) => sameScopeValue(key, value[key], input[key])));
      if (existing) return clone(existing);
      const value = { ...input, status: 'pending', cardMessageId: null, previewMessageId: null, previewStaffId: null,
        editTokenHash: null, editActor: null, editExpiresAt: null, editRevision: null, editedBy: null,
        leaseToken: null, leaseExpiresAt: null, approvedBy: null, approvedAt: null, outcomeCode: null,
        externalIssueNumber: null, externalCommentId: null, externalIssueUrl: null };
      state.approvals.set(value.id, value); return clone(value);
    },
    async get(id, now) {
      const value = state.approvals.get(id);
      if (value?.status === 'filing' && new Date(value.leaseExpiresAt).getTime() <= now) Object.assign(value, { status: 'unknown', outcomeCode: 'lease_expired' });
      return clone(value);
    },
    async bindCard(id, input, now) {
      const value = mutable(id, input, now);
      if (!value || (value.cardMessageId && value.cardMessageId !== input.cardMessageId)) return null;
      value.cardMessageId = input.cardMessageId; return clone(value);
    },
    async beginEdit(id, input, now) {
      const value = mutable(id, input, now);
      if (!value || value.cardMessageId !== input.cardMessageId) return null;
      Object.assign(value, { editTokenHash: input.tokenHash, editActor: input.staffId, editExpiresAt: input.editExpiresAt, editRevision: value.revision });
      return clone(value);
    },
    async update(id, input, now) {
      const value = mutable(id, input, now);
      if (!value || value.editActor !== input.staffId || value.editTokenHash !== input.tokenHash || new Date(value.editExpiresAt).getTime() <= now || value.editRevision !== value.revision || value.revision !== input.expectedRevision) return null;
      Object.assign(value, { ciphertext: input.ciphertext, iv: input.iv, tag: input.tag, payloadHash: input.payloadHash, revision: value.revision + 1,
        editedBy: input.staffId, editTokenHash: null, editActor: null, editExpiresAt: null, editRevision: null, previewMessageId: null, previewStaffId: null });
      return clone(value);
    },
    async bindPreview(id, input, now) {
      const value = mutable(id, input, now);
      if (!value || value.editedBy !== input.staffId || value.revision !== input.revision || value.payloadHash !== input.payloadHash || (value.previewMessageId && value.previewMessageId !== input.previewMessageId)) return null;
      Object.assign(value, { previewMessageId: input.previewMessageId, previewStaffId: input.staffId }); return clone(value);
    },
    async claim(id, input, now, leaseMs) {
      const value = mutable(id, input, now);
      if (!value || value.previewStaffId !== input.staffId || value.previewMessageId !== input.previewMessageId || value.revision !== input.revision || value.payloadHash !== input.payloadHash) return null;
      Object.assign(value, { status: 'filing', leaseToken: input.leaseToken, leaseExpiresAt: new Date(now + leaseMs).toISOString(), approvedBy: input.staffId, approvedAt: new Date(now).toISOString(), outcomeCode: null });
      return clone(value);
    },
    async complete(id, input) {
      const value = state.approvals.get(id);
      if (!value || value.leaseToken !== input.leaseToken || !(input.status === 'filed' ? ['filing','unknown'] : ['filing']).includes(value.status)) return null;
      Object.assign(value, { status: input.status, outcomeCode: input.code, externalIssueNumber: input.number || null, externalCommentId: input.commentId || null, externalIssueUrl: input.url || null });
      return clone(value);
    },
  };
}
function createApprovalService(store, { key = configuredKey, now = () => Date.now(), ttlMs = DRAFT_TTL_MS, leaseMs = FILING_LEASE_MS, editTtlMs = EDIT_TTL_MS } = {}) {
  const keyProvider = typeof key === 'function' ? key : () => key;
  function encryptionKey() { const value = keyProvider(); if (!Buffer.isBuffer(value) || value.length !== 32) throw new Error('Approval encryption is unavailable'); return value; }
  function aad(value) { return Buffer.from(JSON.stringify([value.id, ...scopedArgs(value), value.revision])); }
  function tokenHash(id, actor, token) { return createHmac('sha256', encryptionKey()).update('omi-support-editor').update(id).update(actor).update(String(token)).digest('hex'); }
  function encode(value, draft) {
    const plaintext = JSON.stringify(publicDraft(draft));
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv); cipher.setAAD(aad(value));
    return { ciphertext: Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'),
      payloadHash: createHmac('sha256', encryptionKey()).update(aad(value)).update(plaintext).digest('hex') };
  }
  function decode(value) {
    if (!value || !value.ciphertext) return null;
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(value.iv, 'base64')); decipher.setAAD(aad(value)); decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const draft = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    return { ...value, draft };
  }
  const getRaw = (id) => store.get(identifier(id, true), now());
  function authorized(input) { return input.authorized === true && input.staffId && input.botUserId && String(input.cardAuthorId || '') === String(input.botUserId); }
  async function complete(id, input, status) {
    const raw = await getRaw(id); if (!raw) return null;
    const result = { leaseToken: identifier(input.leaseToken, true), status, code: OUTCOME_CODES.has(input.code) ? input.code : 'unspecified' };
    if (status === 'filed') {
      const number = raw.kind === 'comment' ? raw.targetIssueNumber : Number(input.number);
      const commentId = raw.kind === 'comment' ? Number(input.commentId) : null;
      if (!Number.isSafeInteger(number) || number <= 0 || (raw.kind === 'comment' && (!Number.isSafeInteger(commentId) || commentId <= 0))) throw new Error('A verified external receipt is required');
      const expected = canonicalReceiptUrl(input.url, raw.repo, number, commentId);
      if (!expected) throw new Error('A verified receipt in the approved repository is required');
      if (raw.status === 'unknown' && input.reconciled !== true) throw new Error('Read-only reconciliation is required for an unknown outcome');
      Object.assign(result, { number, commentId, url: expected });
      if (raw.status === 'filed' && raw.leaseToken === result.leaseToken && raw.externalIssueUrl === expected) return decode(raw);
    }
    return decode(await store.complete(raw.id, result));
  }
  return {
    async createDraft(draft, input) {
      const at = now(); const value = { id: randomUUID(), ...scope(input), writerAppId: writerAppId(input.writerAppId), revision: 1, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + ttlMs).toISOString() };
      const created = await store.create({ ...value, ...encode(value, draft) });
      if (!matches(created, value)) throw new Error('This support action already has a different immutable scope');
      return decode(created);
    },
    getDraft: async (id) => decode(await getRaw(id)),
    async bindCard(id, input) {
      const scoped = scope(input); if (String(input.cardAuthorId || '') !== scoped.botUserId) return null;
      return decode(await store.bindCard(identifier(id, true), { ...scoped, cardMessageId: identifier(input.cardMessageId, true) }, now()));
    },
    async beginEdit(id, input) {
      if (!authorized(input)) return { ok: false, status: 'forbidden' };
      const scoped = scope(input); const token = randomUUID(); const actor = identifier(input.staffId, true);
      const value = await store.beginEdit(identifier(id, true), { ...scoped, staffId: actor, cardMessageId: identifier(input.cardMessageId, true),
        tokenHash: tokenHash(id, actor, token), editExpiresAt: new Date(now() + editTtlMs) }, now());
      return value ? { ok: true, approval: decode(value), editToken: token } : { ok: false, status: 'unavailable' };
    },
    async updateDraft(id, input) {
      const scoped = scope(input.scope); const actor = identifier(input.staffId, true); const raw = await getRaw(id);
      if (!matches(raw, scoped)) return null;
      const value = { ...raw, revision: raw.revision + 1 };
      const proposal = { ...decode(raw).draft, ...input.draft };
      return decode(await store.update(raw.id, { ...scoped, ...encode(value, proposal), staffId: actor, expectedRevision: raw.revision,
        tokenHash: tokenHash(id, actor, identifier(input.editToken, true)) }, now()));
    },
    async bindPreview(id, input) {
      if (!authorized(input)) return null;
      return decode(await store.bindPreview(identifier(id, true), { ...scope(input), staffId: identifier(input.staffId, true),
        previewMessageId: identifier(input.previewMessageId, true), revision: Number(input.revision), payloadHash: identifier(input.payloadHash, true) }, now()));
    },
    async claimDraft(id, input) {
      if (!authorized(input)) return { ok: false, status: 'forbidden' };
      const scoped = scope(input); const raw = await getRaw(id);
      if (!raw) return { ok: false, status: 'missing' };
      if (!matches(raw, scoped) || raw.previewMessageId !== input.previewMessageId || raw.previewStaffId !== input.staffId || raw.revision !== Number(input.revision) || raw.payloadHash !== input.payloadHash) return { ok: false, status: 'forbidden' };
      if (new Date(raw.expiresAt).getTime() <= now() && ['pending','rejected'].includes(raw.status)) return { ok: false, status: 'expired' };
      const value = decode(raw);
      if (!value?.draft.body || (value.kind === 'issue' && !value.draft.title) || !value.editedBy) return { ok: false, status: 'invalid_draft' };
      const claimed = await store.claim(raw.id, { ...scoped, staffId: identifier(input.staffId, true), previewMessageId: identifier(input.previewMessageId, true),
        revision: Number(input.revision), payloadHash: identifier(input.payloadHash, true), leaseToken: randomUUID() }, now(), leaseMs);
      return claimed ? { ok: true, status: 'filing', approval: decode(claimed), leaseToken: claimed.leaseToken } : { ok: false, status: (await getRaw(id))?.status || 'missing' };
    },
    recordFiled: (id, input) => complete(id, input, 'filed'),
    recordCommented: (id, input) => complete(id, input, 'filed'),
    recordRejected: (id, input) => complete(id, input, 'rejected'),
    recordUnknown: (id, input) => complete(id, input, 'unknown'),
  };
}

const developmentStore = createMemoryStore(); let injectedStore;
function isReady() { return Boolean(configuredKey()); }
function service() { return createApprovalService(injectedStore || (process.env.DATABASE_URL ? createPostgresStore(require('./db').pool) : developmentStore)); }
function setStoreForTests(store) { injectedStore = store || null; }
function resetMemory() { developmentStore.state.approvals.clear(); }
const methods = ['createDraft','getDraft','bindCard','beginEdit','updateDraft','bindPreview','claimDraft','recordFiled','recordCommented','recordRejected','recordUnknown'];
module.exports = { initSchema, createMemoryStore, createPostgresStore, createApprovalService, publicDraft, canonicalReceiptUrl, DRAFT_TTL_MS, FILING_LEASE_MS, EDIT_TTL_MS,
  isReady, getReady: isReady, setStoreForTests, resetMemory,
  ...Object.fromEntries(methods.map((name) => [name, (...args) => {
    if (!isReady()) return Promise.resolve(['claimDraft','beginEdit'].includes(name) ? { ok: false, status: 'unavailable' } : null);
    return service()[name](...args);
  }])) };
