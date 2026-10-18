const { redactSensitive } = require('./privacy');

const DAY = 86400000;
const MAX_MESSAGES = 200;
const SIGNALS = new Set(['needs_help', 'reopened', 'no_official_source', 'review_rejected', 'delivery_failed', 'answer_sent', 'handoff_delivered', 'resolved']);
const OUTCOMES = new Set(['needs_help', 'reopened', 'answer_sent', 'handoff_delivered', 'resolved']);
const AREAS = new Set(['app', 'desktop', 'firmware', 'shop', 'privacy', 'account', 'unknown']);
const keyOf = (...values) => values.join(':');
const clone = value => structuredClone(value);
function id(value) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(text)) throw Error('Invalid support memory scope');
  return text;
}
function scopeOf(value) {
  return { guildId: id(value.guildId), forumId: id(value.forumId), threadId: id(value.threadId), customerId: id(value.customerId) };
}
// For transient live context only. This value is never handed to the store.
function safeMemoryText(value) {
  return redactSensitive(String(value || ''), { issue: true }).replace(/https?:\/\/[^\s<>]+/gi, '[link in Discord]').slice(0, 2000);
}
function configFromEnv(env = process.env) {
  const supportForums = new Set([env.HELP_FORUM_CHANNEL_ID, env.VECTOR_TEST_CHANNEL_ID].filter(Boolean));
  const forumIds = [...new Set(String(env.SUPPORT_MEMORY_FORUM_IDS || '').split(',').map(v => v.trim()).filter(v => supportForums.has(v)))];
  const enabled = env.SUPPORT_MEMORY_ENABLED === '1' && env.SUPPORT_MEMORY_POLICY_APPROVED === '1' && Boolean(env.DATABASE_URL) && forumIds.length > 0;
  return {
    enabled, contextEnabled: enabled && env.SUPPORT_MEMORY_CONTEXT_ENABLED === '1',
    forumIds, deleteForumIds: [...supportForums],
    staffIds: String(env.STAFF_USER_IDS || '').split(',').map(v => v.trim()).filter(Boolean),
    retentionDays: Math.floor(Math.max(1, Math.min(30, Number(env.SUPPORT_MEMORY_RETENTION_DAYS) || 30))),
  };
}
function reference(row) {
  return { ...scopeOf(row), messageId: id(row.messageId), role: row.role, at: row.at, expiresAt: row.expiresAt };
}
function outcome(row) {
  return { ...scopeOf(row), eventId: id(row.eventId), kind: row.kind, area: row.area, at: row.at, expiresAt: row.expiresAt };
}

// Development/test adapter only. Production selects Postgres, never an error fallback.
function createMemoryStore() {
  const rows = new Map(), signals = new Map(), deleted = new Map(), scopes = new Map(), optOuts = new Set();
  const threadKey = scope => keyOf(scope.guildId, scope.threadId);
  const ownerKey = scope => keyOf(scope.guildId, scope.forumId, scope.customerId);
  const sameOwner = (a, b) => a.guildId === b.guildId && a.forumId === b.forumId && a.customerId === b.customerId;
  const optedOut = scope => optOuts.has(ownerKey(scope));
  const blocked = (row, now) => optedOut(row) || [threadKey(row), keyOf(threadKey(row), row.messageId || '')].some(k => (deleted.get(k)?.expiresAt || 0) > now);
  function register(row, now) {
    const old = scopes.get(threadKey(row));
    if (blocked(row, now) || (old && !sameOwner(old, row))) return false;
    scopes.set(threadKey(row), { ...scopeOf(row), expiresAt: Math.max(old?.expiresAt || 0, row.expiresAt) });
    return true;
  }
  return {
    rows, signals,
    async put(input, now) {
      const row = reference(input);
      if (!register(row, now)) return false;
      const key = keyOf(threadKey(row), row.messageId), old = rows.get(key);
      rows.set(key, { ...clone(row), at: old?.at ?? row.at, expiresAt: old?.expiresAt ?? row.expiresAt });
      const group = [...rows.entries()].filter(([, r]) => threadKey(r) === threadKey(row)).sort((a, b) => b[1].at - a[1].at || b[1].messageId.localeCompare(a[1].messageId));
      for (const [extra] of group.slice(MAX_MESSAGES)) rows.delete(extra);
      return true;
    },
    async list(scope, now) {
      if (optedOut(scope) || blocked(scope, now)) return [];
      return [...rows.values()].filter(r => threadKey(r) === threadKey(scope) && sameOwner(r, scope) && r.expiresAt > now)
        .sort((a, b) => a.at - b.at || a.messageId.localeCompare(b.messageId)).slice(-50).map(clone);
    },
    async otherThreads(scope, now) {
      if (optedOut(scope)) return [];
      return [...scopes.values()].filter(row => sameOwner(row, scope) && row.threadId !== scope.threadId && row.expiresAt > now && !blocked(row, now))
        .map(row => {
          const messages = [...rows.values()].filter(r => threadKey(r) === threadKey(row) && sameOwner(r, scope) && r.expiresAt > now);
          const events = [...signals.values()].filter(r => threadKey(r) === threadKey(row) && sameOwner(r, scope) && r.expiresAt > now).sort((a, b) => b.at - a.at || b.eventId.localeCompare(a.eventId));
          const at = Math.max(0, ...messages.map(r => r.at), ...events.map(r => r.at));
          return { ...scopeOf(row), at, outcome: events.find(event => OUTCOMES.has(event.kind))?.kind || 'unknown' };
        }).filter(row => row.at > 0).sort((a, b) => b.at - a.at || b.threadId.localeCompare(a.threadId)).slice(0, 2).map(clone);
    },
    async forget(scope, messageId, until, { onlyKnown = false } = {}) {
      const base = threadKey(scope), old = scopes.get(base);
      if (onlyKnown && !old) return false;
      if (old && !sameOwner(old, scope)) throw Error('Support memory owner mismatch');
      deleted.set(messageId ? keyOf(base, messageId) : base, { ...scopeOf(scope), expiresAt: until });
      for (const [key, row] of rows) if (threadKey(row) === base && (!messageId || row.messageId === messageId)) rows.delete(key);
      for (const [key, row] of signals) if (threadKey(row) === base) signals.delete(key);
      return true;
    },
    async forgetCustomer(scope) {
      optOuts.add(ownerKey(scope));
      for (const map of [rows, signals, scopes]) for (const [key, row] of map) if (sameOwner(row, scope)) map.delete(key);
      for (const [key, row] of deleted) if (sameOwner(row, scope)) deleted.delete(key);
      return true;
    },
    async signal(input, now) {
      const row = outcome(input);
      if (!register(row, now)) return false;
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
      for (const map of [rows, signals, scopes]) for (const [key, row] of map) if (row.expiresAt <= now) map.delete(key);
      for (const [key, row] of deleted) if (row.expiresAt <= now) deleted.delete(key);
      // Customer/forum opt-outs have no expiry: deleting them would silently opt in.
    },
  };
}
function mergeHistory(saved, live, excludeId) {
  const entries = new Map();
  for (const entry of [...saved, ...live]) if (entry.id !== excludeId) entries.set(entry.id, { ...entry, trust: 'conversation_only' });
  return [...entries.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-50);
}

function createSupportMemory({ store, policy = configFromEnv(), now = () => Date.now() } = {}) {
  const current = () => typeof policy === 'function' ? policy() : policy;
  const ttl = () => Math.max(1, Math.min(30, Number(current().retentionDays) || 30)) * DAY;
  const channelScope = (channel, forums) => {
    if (!channel?.isThread?.() || !forums.includes(String(channel.parentId)) || /^Handoff(?:\b|\s*[·:—-])/i.test(String(channel.name || ''))) return null;
    if (!channel.guildId || !channel.ownerId) return null;
    return scopeOf({ guildId: channel.guildId, forumId: channel.parentId, threadId: channel.id, customerId: channel.ownerId });
  };
  const scopeFor = channel => current().enabled ? channelScope(channel, current().forumIds) : null;
  const permitted = input => {
    const scope = scopeOf(input);
    return current().enabled && current().forumIds.includes(scope.forumId) ? scope : null;
  };
  const deletionScopeFor = channel => channelScope(channel, current().deleteForumIds || current().forumIds);
  const roleFor = message => {
    if (message.webhookId) return null;
    const author = message.author;
    if (author?.bot) return String(author.id) === String(current().botId) ? 'bot' : null;
    if (String(author?.id) === String(message.channel?.ownerId)) return 'customer';
    return (current().staffIds || []).includes(String(author?.id)) ? 'staff' : null;
  };
  return {
    get enabled() { return Boolean(current().enabled); },
    get contextEnabled() { return Boolean(current().enabled && current().contextEnabled); },
    cleanupEnabled: Boolean(store), scopeFor, deletionScopeFor, roleFor,
    async capture(message) {
      const scope = scopeFor(message?.channel), role = roleFor(message || {});
      if (!scope || !role || (message.guildId && message.guildId !== scope.guildId)) return false;
      const at = Number(message.createdTimestamp), timestamp = now();
      if (!Number.isFinite(at) || at <= 0 || at > timestamp + 300000 || at + ttl() <= timestamp) return false;
      // Content, URLs, attachment data and encryption keys are deliberately not read.
      return store.put({ ...scope, messageId: id(message.id), role, at, expiresAt: at + ttl() }, timestamp);
    },
    async history(input) {
      if (!current().enabled) return [];
      const scope = permitted(input);
      if (!scope) return [];
      return (await store.list(scope, now())).map(row => ({ id: row.messageId, author: row.role, at: row.at, trust: 'conversation_only' }));
    },
    async otherThreads(input) {
      if (!current().enabled) return [];
      const scope = permitted(input);
      return scope ? store.otherThreads(scope, now()) : [];
    },
    async forgetMessage(input, { onlyKnown = false } = {}) {
      if (store) await store.forget(scopeOf(input), id(input.messageId), now() + ttl(), { onlyKnown });
    },
    async forgetThread(input, { optOut = false, onlyKnown = false } = {}) {
      if (optOut) return this.forgetCustomer(input);
      if (store) await store.forget(scopeOf(input), null, now() + ttl(), { onlyKnown });
    },
    async forgetCustomer(input) {
      const scope = scopeOf(input);
      if (!(current().deleteForumIds || current().forumIds).includes(scope.forumId)) return false;
      return store ? store.forgetCustomer(scope) : false;
    },
    async signal(input) {
      if (!current().enabled) return false;
      if (!SIGNALS.has(input.kind)) throw Error('Invalid support quality signal');
      const scope = permitted(input);
      if (!scope) return false;
      const timestamp = now();
      return store.signal({ ...scope, eventId: id(input.eventId), kind: input.kind,
        area: AREAS.has(input.area) ? input.area : 'unknown', at: timestamp, expiresAt: timestamp + ttl() }, timestamp);
    },
    report: () => current().enabled ? store.report(now()) : Promise.resolve([]),
    prune: () => store ? store.prune(now()) : Promise.resolve(),
  };
}
module.exports = { createSupportMemory, createMemoryStore, configFromEnv, mergeHistory, safeMemoryText, MAX_MESSAGES };
