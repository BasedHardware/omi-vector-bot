const { createSupportMemory, configFromEnv } = require('./supportMemory');
const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

// Derive scope from an application channel, never customer-supplied case IDs.
function caseScopeFor(channel, customerId) {
  if (!customerId || String(channel?.ownerId || '') !== String(customerId)) return {};
  const memory = createSupportMemory({ policy: configFromEnv() });
  const scope = memory.deletionScopeFor(channel);
  return scope && scope.customerId === String(customerId) ? { guildId: scope.guildId, forumId: scope.forumId } : {};
}

async function eraseOwnedKnowledge(scope, { store } = {}) {
  if (!scope || !['guildId', 'forumId', 'threadId', 'customerId'].every(key => valid(scope[key]))) return { ok: false, reason: 'invalid' };
  try {
    if (!store) {
      // Isolated development has no durable registry. A production database
      // error must never select this branch or silently fall back to memory.
      if (!process.env.DATABASE_URL) return { ok: true, remaining: false };
      store = require('./knowledgeReviewStore').createPostgresStore(require('./db').pool);
    }
    for (let pass = 0; pass < 10; pass++) {
      const result = await store.eraseOwnedReferences(scope);
      if (!result?.ok || !result.remaining) return result || { ok: false, reason: 'unavailable' };
    }
    // The mandatory sweep also removes references covered by durable opt-outs.
    // Do not claim complete deletion from a bounded partial synchronous pass.
    return { ok: false, reason: 'pending' };
  } catch {
    console.error('[KnowledgeReview] customer erasure not confirmed');
    return { ok: false, reason: 'unavailable' };
  }
}

module.exports = { caseScopeFor, eraseOwnedKnowledge };
