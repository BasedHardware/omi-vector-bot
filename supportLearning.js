// This observes support conversations. It does not train a model, publish
// knowledge, rewrite prompts, or replay customer messages to test an answer.
const { createSupportMemory, configFromEnv, mergeHistory, safeMemoryText } = require('./supportMemory');

function createObserver(memory, { historyBudgetMs = 1500, maxPendingWrites = 100, maxPendingReads = 3 } = {}) {
  let failures = 0, droppedWrites = 0, pendingWrites = 0, pendingReads = 0;
  const readBudget = Math.max(1, Math.min(1500, Number(historyBudgetMs) || 1500));
  const readCapacity = Math.max(1, Math.min(3, Number(maxPendingReads) || 3));
  let writeTail = Promise.resolve();
  let cleanup;
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
    get enabled() { return Boolean(memory.enabled); },
    get contextEnabled() { return Boolean(memory.enabled && memory.contextEnabled); },
    cleanupEnabled: Boolean(memory.cleanupEnabled),
    supports: channel => Boolean(memory.scopeFor(channel)),
    health: () => ({ enabled: Boolean(memory.enabled), failures, pendingWrites, droppedWrites, pendingReads }),
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
        // An approved capture may still be queued before its first scope row.
        // Persist its tombstone now; non-pilot posts remain known-only.
        if (scope) await memory.forgetMessage({ ...scope, messageId: message.id }, { onlyKnown: !memory.scopeFor(message?.channel) });
      }, false);
    },
    forgetThread(channel) {
      return safe(async () => {
        const scope = (memory.deletionScopeFor || memory.scopeFor)(channel);
        if (scope) await memory.forgetThread(scope, { onlyKnown: !memory.scopeFor(channel) });
      }, false);
    },
    signal(channel, input, customerId) {
      return write(async () => {
        const scope = memory.scopeFor(channel);
        return scope && scope.customerId === String(customerId || '') ? memory.signal({ ...input, ...scope }) : false;
      });
    },
    async history(channel, excludeId, liveMessages, customerId) {
      const scope = memory.scopeFor(channel);
      if (!scope || scope.customerId !== String(customerId || '')) return [];
      const matches = (a, b) => a?.guildId === b.guildId && a.forumId === b.forumId && a.threadId === b.threadId && a.customerId === b.customerId;
      const live = liveMessages.filter(message => {
        const other = memory.scopeFor(message.channel);
        return matches(other, scope);
      }).map(entry).filter(Boolean);
      const fallback = mergeHistory([], live, excludeId);
      if (!memory.contextEnabled) return fallback;
      if (pendingReads >= readCapacity) {
        failures++;
        console.error('[SupportMemory] context capacity full; current post only');
        return fallback;
      }
      let timer, active = true;
      const permitted = () => active && memory.contextEnabled && matches(memory.scopeFor(channel), scope);
      async function readMessage(post, item, expected, onDeleted = () => {}) {
        if (!permitted()) return null;
        let message;
        try { message = await post.messages.fetch({ message: item.id, force: true, cache: false }); }
        catch (error) {
          if (permitted() && Number(error.code) === 10008) {
            await memory.forgetMessage({ ...expected, messageId: item.id });
            onDeleted();
          }
          return null;
        }
        if (!permitted() || !matches(memory.scopeFor(message?.channel), expected) || String(message?.id) !== item.id || message.createdTimestamp !== item.at) return null;
        const value = entry(message);
        return value?.author === item.author ? value : null;
      }
      async function previousPost(candidate) {
        if (!permitted()) return null;
        let post;
        try { post = await channel.client.channels.fetch(candidate.threadId, { force: true, cache: false }); }
        catch (error) {
          if (permitted() && [10003,10008].includes(Number(error.code))) await memory.forgetThread(candidate);
          return null;
        }
        if (!permitted() || !matches(memory.scopeFor(post), candidate)) return null;
        const references = await memory.contextReferences(candidate);
        if (!permitted() || !await memory.allowsContext(scope) || !permitted()) return null;
        let storedOutcome = candidate.outcome;
        const values = (await Promise.all(references.filter(item => ['customer','bot'].includes(item.author)).slice(-4)
          .map(item => readMessage(post,item,candidate,() => { storedOutcome = 'unknown'; })))).filter(Boolean);
        if (!permitted() || !values.length) return null;
        const outcomes = { answer_sent: 'answered', handoff_delivered: 'handed_off', resolved: 'resolved', needs_help: 'needs_help', reopened: 'needs_help' };
        const owner = values.filter(value => value.author === 'customer').slice(-3);
        const bot = values.filter(value => value.author === 'bot').at(-1);
        const content = [
          'Post title: ' + safeMemoryText(post.name).slice(0,120),
          'Stored outcome: ' + (outcomes[storedOutcome] || 'unknown'),
          ...owner.map(value => 'Earlier owner message: ' + value.content.slice(0,450)),
          bot ? 'Previous bot reply (not product evidence): ' + bot.content.slice(0,350) : '',
        ].filter(Boolean).join('\n');
        return { id: 'previous-' + candidate.threadId, author: 'earlier support context', at: candidate.at,
          content, source: 'previous_post', trust: 'conversation_only' };
      }
      const operation = async () => {
        if (!await memory.allowsContext(scope) || !permitted()) return fallback;
        const [saved, candidates] = await Promise.all([memory.history(scope), memory.otherThreads(scope)]);
        if (!permitted() || !await memory.allowsContext(scope) || !permitted()) return fallback;
        const visible = new Set(live.map(m => m.id));
        const seen = new Set();
        const earlier = candidates.filter(candidate => candidate.guildId === scope.guildId && candidate.forumId === scope.forumId
          && candidate.customerId === scope.customerId && candidate.threadId !== scope.threadId
          && typeof candidate.threadId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.threadId)
          && !seen.has(candidate.threadId) && seen.add(candidate.threadId)).slice(0,2);
        const [confirmed, prior] = await Promise.all([
          Promise.all(saved.filter(item => !visible.has(item.id) && item.id !== excludeId).slice(-5).map(item => readMessage(channel,item,scope))),
          Promise.all(earlier.map(previousPost)),
        ]);
        if (!permitted() || !await memory.allowsContext(scope) || !permitted()) return fallback;
        return [...prior.filter(Boolean), ...mergeHistory(confirmed.filter(Boolean), live, excludeId)];
      };
      pendingReads++;
      const running = operation();
      // A caller deadline does not cancel a DB/REST promise. Keep its capacity
      // reservation until it actually settles, and never start late-stage reads.
      running.then(() => { pendingReads--; }, () => { pendingReads--; });
      try {
        return await safe(() => Promise.race([running, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Support memory history deadline')), readBudget);
        })]), fallback);
      } finally { active = false; clearTimeout(timer); }
    },
    prune() {
      // Retention cleanup is mandatory, not a droppable optional observation.
      // Coalesce timer/startup overlap without competing for capture capacity.
      if (!cleanup) cleanup = safe(() => memory.prune(), false).finally(() => { cleanup = null; });
      return cleanup;
    },
    report: () => safe(() => memory.report(), []),
  };
}

let observer, activeBotId = '';
function getObserver(botId) {
  if (botId) activeBotId = String(botId);
  if (!observer) {
    // No implicit memory-only fallback when the durable database fails.
    const store = process.env.DATABASE_URL ? require('./supportMemoryStore').createPostgresStore(require('./db').pool) : null;
    const policy = () => ({ ...configFromEnv(), botId: activeBotId });
    observer = createObserver(createSupportMemory({ policy, store }));
  }
  return observer;
}

async function forgetOwnedThread(channel, customerId, { store, eraseKnowledge = require('./supportKnowledgePrivacy').eraseOwnedKnowledge,
  eraseNotices = require('./githubNoticeReceipts').eraseCustomer } = {}) {
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
  if (!await memory.forgetThread(scope, { optOut: true })) return false;
  // Persist erasure/opt-out first. A later registry failure must not re-enable
  // context, or let a command claim that every related reference was removed.
  let knowledgeOk = false;
  try { knowledgeOk = (await eraseKnowledge(scope))?.ok === true; }
  catch {
    console.error('[KnowledgeReview] customer erasure not confirmed');
  }
  // Attempt both independent erasure groups even when one is unavailable.
  // Both must confirm; memory opt-out above remains durable on either failure.
  try { return (await eraseNotices(scope))?.ok === true && knowledgeOk; }
  catch { console.error('[GitHub] customer notice erasure not confirmed'); return false; }
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
