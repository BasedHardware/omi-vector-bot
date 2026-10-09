const { REST, Routes } = require('discord.js');
const { DiscordTransportError, MAX_TIMEOUT_MS } = require('./supportDiscordTransport');

const ID = /^[1-9]\d{0,19}$/;
const FIELDS = new Set(['archived', 'locked', 'appliedTags']);
const PREFLIGHT_CODES = new Set(['DISCORD_THREAD_INVALID', 'DISCORD_THREAD_CHANGES_INVALID', 'DISCORD_THREAD_TRANSPORT_UNCONFIGURED']);

function rejected(code) {
  return new DiscordTransportError('Discord thread change was not dispatched.', { code, outcome: 'known_rejected' });
}
function validTags(value) {
  return Array.isArray(value) && value.length <= 5 && new Set(value).size === value.length &&
    value.every((id) => typeof id === 'string' && ID.test(id));
}
function bodyFor(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw rejected('DISCORD_THREAD_CHANGES_INVALID');
  const keys = Object.keys(changes);
  if (!keys.length || keys.some((key) => !FIELDS.has(key))) throw rejected('DISCORD_THREAD_CHANGES_INVALID');
  const body = {};
  for (const key of keys) {
    const value = changes[key];
    if (key === 'appliedTags') {
      if (!validTags(value)) throw rejected('DISCORD_THREAD_CHANGES_INVALID');
      body.applied_tags = [...value];
    } else {
      if (typeof value !== 'boolean') throw rejected('DISCORD_THREAD_CHANGES_INVALID');
      body[key] = value;
    }
  }
  return body;
}

function failure(error, dispatched) {
  const status = Number(error?.status);
  const rateLimited = /^RateLimitError(?:\[|$)/.test(String(error?.name || '')) || status === 429;
  const preflight = !dispatched && PREFLIGHT_CODES.has(error?.code);
  const known = !dispatched || rateLimited || (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408);
  const apiCode = Number.isInteger(error?.code) ? error.code : Number.isInteger(error?.rawError?.code) ? error.rawError.code : undefined;
  const timeout = error?.code === 'DISCORD_THREAD_TIMEOUT';
  return new DiscordTransportError(known ? 'Discord thread change was rejected.' : 'Discord thread change is unconfirmed.', {
    code: preflight ? error.code : timeout ? 'DISCORD_THREAD_TIMEOUT' : apiCode ?? (rateLimited ? 'DISCORD_RATE_LIMITED' : 'DISCORD_THREAD_CHANGE_FAILED'),
    outcome: known ? 'known_rejected' : 'unknown', status: rateLimited ? 429 : status,
    retryAfter: rateLimited ? Number(error?.retryAfter) : undefined, dispatched,
  });
}

function verifiedMetadata(raw, channelId, body) {
  if (!raw || typeof raw.id !== 'string' || raw.id !== channelId) throw new Error('Invalid thread response');
  const result = { id: raw.id };
  for (const key of ['archived', 'locked']) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof raw.thread_metadata?.[key] !== 'boolean' || raw.thread_metadata[key] !== body[key]) throw new Error('Invalid thread response');
    result[key] = raw.thread_metadata[key];
  }
  if (Object.hasOwn(body, 'applied_tags')) {
    const tags = raw.applied_tags;
    if (!validTags(tags) || tags.length !== body.applied_tags.length || tags.some((id) => !body.applied_tags.includes(id))) throw new Error('Invalid thread response');
    result.appliedTags = [...tags];
  }
  return result;
}

function createThreadTransport({ restFactory = (options) => new REST(options), timeoutMs = MAX_TIMEOUT_MS } = {}) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS;
  const clients = new WeakMap();
  async function editDiscordThread(client, channel, changes) {
    let dispatched = false; let timer;
    try {
      if (!channel || typeof channel.id !== 'string' || !ID.test(channel.id) || channel.isThread?.() !== true) throw rejected('DISCORD_THREAD_INVALID');
      if (!client || typeof client.token !== 'string' || !client.token.trim()) throw rejected('DISCORD_THREAD_TRANSPORT_UNCONFIGURED');
      const body = bodyFor(changes);
      const controller = new AbortController();
      const abort = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(
        new DiscordTransportError('Discord thread change deadline reached.', {
          code: 'DISCORD_THREAD_TIMEOUT', outcome: dispatched ? 'unknown' : 'known_rejected', dispatched,
        })
      ), { once: true }));
      timer = setTimeout(() => controller.abort(), duration);
      let rest = clients.get(client);
      if (!rest) {
        rest = restFactory({ version: '10', retries: 0, timeout: duration, rejectOnRateLimit: () => true });
        clients.set(client, rest);
      }
      rest.setToken(client.token);
      controller.signal.throwIfAborted();
      dispatched = true;
      const raw = await Promise.race([rest.patch(Routes.channel(channel.id), { body, signal: controller.signal }), abort]);
      return verifiedMetadata(raw, channel.id, body);
    } catch (error) {
      throw failure(error, dispatched);
    } finally { clearTimeout(timer); }
  }
  return { editDiscordThread };
}

const transport = createThreadTransport();
let injected;
function setThreadTransportForTests(editor) {
  if (editor != null && typeof editor !== 'function') throw new TypeError('A test thread editor must be a function');
  injected = editor || null;
}
function editDiscordThread(...args) { return (injected || transport.editDiscordThread)(...args); }

module.exports = { createThreadTransport, editDiscordThread, setThreadTransportForTests };
