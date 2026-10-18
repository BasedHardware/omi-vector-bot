const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
const { redactSensitive } = require('./privacy');

const DAY = 86400000;
const MAX_MESSAGES = 200;
const SIGNALS = new Set(['needs_help', 'reopened', 'no_official_source', 'review_rejected', 'delivery_failed', 'answer_sent', 'handoff_delivered', 'resolved']);
const AREAS = new Set(['app', 'desktop', 'firmware', 'shop', 'privacy', 'account', 'unknown']);
const keyOf = (...values) => values.join(':');
const clone = value => structuredClone(value);
function id(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw Error('Invalid support memory scope');
  return text;
}
function scopeOf(value) {
  return { guildId: id(value.guildId), threadId: id(value.threadId), customerId: id(value.customerId) };
}
function safeMemoryText(value) {
  return redactSensitive(String(value || ''), { issue: true }).replace(/https?:\/\/[^\s<>]+/gi, '[link in Discord]').slice(0, 2000);
}
function configFromEnv(env = process.env) {
  const supportForums = new Set([env.HELP_FORUM_CHANNEL_ID, env.VECTOR_TEST_CHANNEL_ID].filter(Boolean));
  const forumIds = [...new Set(String(env.SUPPORT_MEMORY_FORUM_IDS || '').split(',').map(v => v.trim()).filter(v => supportForums.has(v)))];
  const enabled = env.SUPPORT_MEMORY_ENABLED === '1' && env.SUPPORT_MEMORY_POLICY_APPROVED === '1' && Boolean(env.DATABASE_URL) && forumIds.length > 0;
  return {
    enabled,
    contextEnabled: enabled && env.SUPPORT_MEMORY_CONTEXT_ENABLED === '1',
    forumIds,
    deleteForumIds: [...supportForums],
    staffIds: String(env.STAFF_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean),
    retentionDays: Math.floor(Math.max(1, Math.min(30, Number(env.SUPPORT_MEMORY_RETENTION_DAYS) || 30))),
  };
}

// Development/test store only; production always selects the Postgres adapter.
function createMemoryStore() {
  const rows = new Map(), signals = new Map(), deleted = new Map(), owners = new Map();
  const threadKey = scope => keyOf(scope.guildId, scope.threadId);
  const blocked = (row, now) => [threadKey(row), keyOf(threadKey(row), row.messageId)].some(k => (deleted.get(k) || 0) > now);
  return {
    rows, signals,
    async put(row, now) {
      const key = keyOf(threadKey(row), row.messageId);
      if (blocked(row, now) || (owners.has(threadKey(row)) && owners.get(threadKey(row)) !== row.customerId)) return false;
      owners.set(threadKey(row), row.customerId);
      const old = rows.get(key);
      if (!old || old.version <= row.version) rows.set(key, { ...clone(row), at: old?.at || row.at, expiresAt: old?.expiresAt || row.expiresAt });
      const group = [...rows.entries()].filter(([, r]) => threadKey(r) === threadKey(row)).sort((a, b) => b[1].at - a[1].at || b[1].messageId.localeCompare(a[1].messageId));
      for (const [key] of group.slice(MAX_MESSAGES)) rows.delete(key);
      return true;
    },
    async list(scope, now) {
      return [...rows.values()].filter(r => threadKey(r) === threadKey(scope) && r.customerId === scope.customerId && r.expiresAt > now).sort((a, b) => a.at - b.at || a.messageId.localeCompare(b.messageId)).slice(-50).map(clone);
    },
    async forget(scope, messageId, until, { onlyKnown = false } = {}) {
      const base = threadKey(scope);
      if (onlyKnown && !owners.has(base)) return false;
      if (owners.has(base) && owners.get(base) !== scope.customerId) throw Error('Support memory owner mismatch');
      deleted.set(messageId ? keyOf(base, messageId) : base, until);
      for (const [key, row] of rows) if (threadKey(row) === base && (!messageId || row.messageId === messageId)) rows.delete(key);
      // A quality signal can depend on a deleted message; delete the thread's
      // signals conservatively rather than preserve an untraceable example.
      for (const [key, row] of signals) if (threadKey(row) === base) signals.delete(key);
    },
    async signal(row, now) {
      if (blocked(row, now) || (owners.has(threadKey(row)) && owners.get(threadKey(row)) !== row.customerId)) return false;
      owners.set(threadKey(row), row.customerId);
      const key = keyOf(threadKey(row), row.eventId);
      if (!signals.has(key)) signals.set(key, clone(row));
      return true;
    },
    async report(now) {
      const totals = new Map();
      for (const row of signals.values()) if (row.expiresAt > now) {
        const key = keyOf(row.kind, row.area);
        const total = totals.get(key) || { kind: row.kind, area: row.area, count: 0 };
        total.count++; totals.set(key, total);
      }
      return [...totals.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.area.localeCompare(b.area));
    },
    async prune(now) {
      for (const map of [rows, signals]) for (const [key, row] of map) if (row.expiresAt <= now) map.delete(key);
      for (const [key, expires] of deleted) if (expires <= now) deleted.delete(key);
      for (const key of owners.keys()) if (![...rows.values(), ...signals.values()].some(row => threadKey(row) === key)) owners.delete(key);
    },
  };
}

function mergeHistory(saved, live, excludeId) {
  const entries = new Map();
  for (const entry of [...saved, ...live]) if (entry.id !== excludeId) entries.set(entry.id, { ...entry, trust: 'conversation_only' });
  return [...entries.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-50);
}

function createSupportMemory({ store, policy = configFromEnv(), key, now = () => Date.now() } = {}) {
  const ttl = Math.max(1, Math.min(30, Number(policy.retentionDays) || 30)) * DAY;
  const getKey = () => {
    const value = typeof key === 'function' ? key() : key;
    if (!Buffer.isBuffer(value) || value.length !== 32) throw Error('Support memory encryption unavailable');
    return value;
  };
  const aad = row => Buffer.from(`omi-support-memory:v1:${row.guildId}:${row.threadId}:${row.customerId}:${row.messageId}:${row.role}`);
  const channelScope = (channel, forums) => {
    if (!channel?.isThread?.() || !forums.includes(String(channel.parentId))) return null;
    if (!channel.guildId || !channel.ownerId) return null;
    return scopeOf({ guildId: channel.guildId, threadId: channel.id, customerId: channel.ownerId });
  };
  const scopeFor = channel => policy.enabled ? channelScope(channel, policy.forumIds) : null;
  const deletionScopeFor = channel => channelScope(channel, policy.deleteForumIds || policy.forumIds);
  const roleFor = message => {
    if (message.webhookId) return null;
    const author = message.author;
    if (author?.bot) return String(author.id) === String(policy.botId) ? 'bot' : null;
    if (String(author?.id) === String(message.channel?.ownerId)) return 'customer';
    return policy.staffIds.includes(String(author?.id)) ? 'staff' : null;
  };
  return {
    enabled: policy.enabled, cleanupEnabled: Boolean(store), scopeFor, deletionScopeFor, roleFor,
    async capture(message) {
      const scope = scopeFor(message?.channel), role = roleFor(message || {});
      if (!scope || !role || (message.guildId && message.guildId !== scope.guildId)) return false;
      const at = Number(message.createdTimestamp);
      if (!Number.isFinite(at) || at <= 0 || at > now() + 300000 || at + ttl <= now()) return false;
      const content = safeMemoryText(message.content);
      const attachmentCount = Math.min(100, Math.max(0, Number(message.attachments?.size) || 0));
      if (!content && !attachmentCount) return false;
      const row = { ...scope, messageId: id(message.id), role, at, expiresAt: at + ttl,
        version: Number(message.editedTimestamp) || at };
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', getKey(), iv); cipher.setAAD(aad(row));
      row.ciphertext = Buffer.concat([cipher.update(JSON.stringify({ content, attachmentCount }), 'utf8'), cipher.final()]).toString('base64');
      row.iv = iv.toString('base64'); row.tag = cipher.getAuthTag().toString('base64');
      return store.put(row, now());
    },
    async history(input) {
      if (!policy.enabled) return [];
      const scope = scopeOf(input);
      const rows = await store.list(scope, now());
      return rows.map(row => {
        const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(row.iv, 'base64'));
        decipher.setAAD(aad(row)); decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
        const text = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
        return { id: row.messageId, author: row.role, at: row.at, ...JSON.parse(text), trust: 'conversation_only' };
      });
    },
    async forgetMessage(input, { onlyKnown = false } = {}) {
      if (store) await store.forget(scopeOf(input), id(input.messageId), now() + ttl, { onlyKnown });
    },
    async forgetThread(input, { optOut = false, onlyKnown = false } = {}) {
      // The opt-out retains only an opaque thread suppression reference, not
      // text or customer details, so a future message cannot silently opt in.
      if (store) await store.forget(scopeOf(input), null, optOut ? Number.MAX_SAFE_INTEGER : now() + ttl, { onlyKnown });
    },
    async signal(input) {
      if (!policy.enabled) return false;
      if (!SIGNALS.has(input.kind)) throw Error('Invalid support quality signal');
      const row = { ...scopeOf(input), eventId: id(input.eventId), kind: input.kind,
        area: AREAS.has(input.area) ? input.area : 'unknown', expiresAt: now() + ttl };
      return store.signal(row, now());
    },
    report: () => policy.enabled ? store.report(now()) : Promise.resolve([]),
    prune: () => store ? store.prune(now()) : Promise.resolve(),
  };
}

module.exports = { createSupportMemory, createMemoryStore, configFromEnv, mergeHistory, safeMemoryText, MAX_MESSAGES };
