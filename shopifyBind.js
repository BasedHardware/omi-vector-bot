const { configuredKey, getStore } = require('./supportIdentityStore');

function isReady() {
  return Boolean(configuredKey());
}

async function get(discordUserId) {
  if (!isReady()) return null;
  return getStore().getBinding(discordUserId);
}

async function set(discordUserId, email) {
  if (!isReady()) return false;
  return getStore().setBinding(discordUserId, email);
}

async function remove(discordUserId) {
  // Revocation also consumes pending challenges, even if Shopify/email is offline.
  return getStore().revoke(discordUserId);
}

function reset() {
  // Test/dev cleanup never deletes production identities.
  if (!process.env.DATABASE_URL) getStore().resetMemory();
}

module.exports = { isReady, get, set, remove, reset };
