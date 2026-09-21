const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const memory = new Map();

function encryptionKey() {
  const raw = String(process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) return null;
  return key;
}

function isReady() {
  return Boolean(encryptionKey());
}

function encrypt(email, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(email), 'utf8'), cipher.final()]);
  return {
    emailCiphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    verifiedAt: new Date().toISOString(),
  };
}

function decrypt(row, key) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(row.emailCiphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function get(discordUserId) {
  const key = encryptionKey();
  if (!key) return null;
  const row = memory.get(String(discordUserId));
  if (!row) return null;
  try {
    return { email: decrypt(row, key), verifiedAt: row.verifiedAt };
  } catch {
    return null;
  }
}

async function set(discordUserId, email) {
  const key = encryptionKey();
  if (!key) return false;
  memory.set(String(discordUserId), encrypt(email, key));
  return true;
}

async function remove(discordUserId) {
  return memory.delete(String(discordUserId));
}

function reset() {
  memory.clear();
}

module.exports = { isReady, get, set, remove, reset };
