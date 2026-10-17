// This observes support conversations. It does not train a model, publish
// knowledge, rewrite prompts, or replay customer messages to test an answer.
const { createSupportMemory, configFromEnv, mergeHistory, safeMemoryText } = require('./supportMemory');

function createObserver(memory, { historyBudgetMs = 2000, maxPendingWrites = 100 } = {}) {
  let failures = 0, droppedWrites = 0, pendingWrites = 0;
  let writeTail = Promise.resolve();
  async function safe(operation, fallback) {
    try { return await operation(); }
    catch {
      failures++;
      console.error('[SupportMemory] operation failed; optional memory unavailable');
      return fallback;
    }
  }
  function write(operation) {
    if (pendingWrites >= maxPendingWrites) {
      droppedWrites++;
      console.error('[SupportMemory] optional write queue full; history coverage reduced');
      return Promise.resolve(false);
    }
    pendingWrites++;
    const result = writeTail.then(() => safe(operation, false));
    writeTail = result.then(() => { pendingWrites--; });
    return result;
  }
  const entry = message => {
    const author = memory.roleFor(message);
    if (!author || !message?.id || !Number.isFinite(message.createdTimestamp)) return null;
    return { id: String(message.id), author, content: safeMemoryText(message.content), at: message.createdTimestamp, trust: 'conversation_only' };
  };
  return {
    enabled: Boolean(memory.enabled),
    cleanupEnabled: Boolean(memory.cleanupEnabled),
    supports: channel => Boolean(memory.scopeFor(channel)),
    health: () => ({ enabled: Boolean(memory.enabled), failures, pendingWrites, droppedWrites }),
    capture: message => safe(async () => {
      if (memory.scopeFor && !memory.scopeFor(message?.channel)) return false;
      return write(() => memory.capture(message));
    }, false),
    update: message => safe(async () => {
      if (!memory.scopeFor(message?.channel)) return false;
      return write(async () => {
        const current = message.partial && typeof message.fetch === 'function' ? await message.fetch() : message;
        return memory.capture(current);
      });
    }, false),
    forgetMessage(message) {
      return safe(async () => {
        const scope = (memory.deletionScopeFor || memory.scopeFor)(message?.channel);
        if (scope) await memory.forgetMessage({ ...scope, messageId: message.id }, { onlyKnown: true });
      }, false);
    },
    forgetThread(channel) {
      return safe(async () => {
        const scope = (memory.deletionScopeFor || memory.scopeFor)(channel);
        if (scope) await memory.forgetThread(scope, { onlyKnown: true });
      }, false);
    },
    signal(channel, input) {
      return write(async () => {
        const scope = memory.scopeFor(channel);
        return scope ? memory.signal({ ...input, ...scope }) : false;
      });
    },
    async history(channel, excludeId, liveMessages, customerId) {
      const scope = memory.scopeFor(channel);
      if (!scope || scope.customerId !== String(customerId || '')) return [];
      const live = liveMessages.filter(message => {
        const other = memory.scopeFor(message.channel);
        return other?.guildId === scope.guildId && other.threadId === scope.threadId && other.customerId === scope.customerId;
      }).map(entry).filter(Boolean);
      let timer;
      const operation = async () => {
        const saved = await memory.history(scope);
        const visible = new Set(live.map(m => m.id));
        const confirmed = [];
        // Missed deletes during an outage must not resurrect removed content.
        // Each older reference is checked live; denied/unknown reads are omitted.
        await Promise.all(saved.filter(item => !visible.has(item.id) && item.id !== excludeId).slice(-5).map(async item => {
          try {
            const message = await channel.messages.fetch({ message: item.id, force: true, cache: false });
            const actualScope = memory.scopeFor(message?.channel);
            if (actualScope?.guildId !== scope.guildId || actualScope?.threadId !== scope.threadId || actualScope?.customerId !== scope.customerId || String(message?.id) !== item.id) return;
            const current = entry(message);
            if (current) confirmed.push(current);
          } catch (error) {
            if (Number(error.code) === 10008) await memory.forgetMessage({ ...scope, messageId: item.id });
          }
        }));
        return mergeHistory(confirmed, live, excludeId);
      };
      try {
        return await safe(() => Promise.race([operation(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Support memory history deadline')), historyBudgetMs);
        })]), mergeHistory([], live, excludeId));
      } finally { clearTimeout(timer); }
    },
    prune: () => write(() => memory.prune()),
    report: () => safe(() => memory.report(), []),
  };
}

let observer, activePolicy;
function getObserver(botId) {
  if (!observer) {
    const policy = configFromEnv(); policy.botId = botId || ''; activePolicy = policy;
    if (policy.enabled && !require('./supportIdentityStore').configuredKey()) {
      policy.enabled = false; policy.contextEnabled = false;
      console.error('[SupportMemory] capture disabled; encryption unavailable');
    }
    // No implicit memory-only fallback when the durable database fails.
    const store = process.env.DATABASE_URL ? require('./supportMemoryStore').createPostgresStore(require('./db').pool) : null;
    observer = createObserver(createSupportMemory({ policy, store, key: require('./supportIdentityStore').configuredKey }));
    observer.contextEnabled = policy.contextEnabled;
  }
  if (botId) activePolicy.botId = String(botId);
  return observer;
}

async function forgetOwnedThread(channel, customerId, { store } = {}) {
  // Erasure must remain available after the capture kill switch is turned off.
  // This path needs no decryption key and never reads message content.
  if (!channel?.ownerId || String(channel.ownerId) !== String(customerId)) return false;
  const policy = { ...configFromEnv(), enabled: true,
    forumIds: [process.env.HELP_FORUM_CHANNEL_ID, process.env.VECTOR_TEST_CHANNEL_ID].filter(Boolean) };
  if (!process.env.DATABASE_URL && !store) return false;
  const memory = createSupportMemory({ policy,
    store: store || require('./supportMemoryStore').createPostgresStore(require('./db').pool) });
  const scope = memory.scopeFor(channel);
  if (!scope) return false;
  await memory.forgetThread(scope, { optOut: true });
  return true;
}

function improvementCandidates(outcomes = []) {
  // Only aggregate outcome categories enter improvement work. This does not
  // copy an identifiable case into a training set or an authoritative FAQ.
  const actions = {
    delivery_failed: [0, 'Check and repair staff delivery before claiming a handoff succeeded.'],
    review_rejected: [1, 'Review source coverage and answer relevance for this area.'],
    no_official_source: [2, 'Add or clarify official help content for unanswered questions in this area.'],
    needs_help: [3, 'Review unresolved support outcomes; do not infer a cause from feedback alone.'],
    reopened: [3, 'Check whether cases were closed before the customer was helped.'],
  };
  const areas = new Set(['app', 'desktop', 'firmware', 'shop', 'privacy', 'account', 'unknown']);
  return outcomes.filter(row => actions[row.kind] && areas.has(row.area) && Number.isSafeInteger(row.count) && row.count > 0)
    .map(row => ({ kind: row.kind, area: row.area, count: row.count, status: 'needs_review', nextAction: actions[row.kind][1] }))
    .sort((a, b) => actions[a.kind][0] - actions[b.kind][0] || b.count - a.count || a.area.localeCompare(b.area)).slice(0, 20);
}

module.exports = { createObserver, getObserver, forgetOwnedThread, improvementCandidates };
