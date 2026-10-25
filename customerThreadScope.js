const supportCases = require('./supportCases');

// A recorded per-customer binding is not proof that a thread is dedicated.
// Resolve the thread without a customer filter so ambiguity cannot be hidden.
async function isDedicatedCustomerThread(channel, value, {cases = supportCases} = {}) {
  const id = String(channel?.id || '');
  if (!id || !channel?.isThread?.() || !value?.id || !value.customerId) return false;
  const handoff = String(value.handoffThreadId || '') === id;
  const customerPost = String(value.customerThreadId || '') === id &&
    String(channel.ownerId || '') === String(value.customerId);
  if (!handoff && !customerPost) return false;
  try {
    const unique = await cases.getCaseByThread?.(id);
    return Boolean(unique && unique.id === value.id &&
      String(unique.customerId) === String(value.customerId));
  } catch {
    return false;
  }
}

module.exports = {isDedicatedCustomerThread};
