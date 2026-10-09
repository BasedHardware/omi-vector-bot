const { REST, Routes, MessagePayload } = require('discord.js');

const MAX_TIMEOUT_MS = 15_000;

class DiscordTransportError extends Error {
  constructor(message, { code, outcome, status, retryAfter, dispatched = false, referenceMissing = false } = {}) {
    super(message);
    this.name = 'DiscordTransportError';
    this.code = code;
    this.outcome = outcome;
    this.dispatched = dispatched;
    this.referenceMissing = referenceMissing === true;
    if (Number.isInteger(status)) this.status = status;
    if (Number.isFinite(retryAfter) && retryAfter > 0) this.retryAfter = retryAfter;
  }
}

function rejected(code) {
  return new DiscordTransportError('Discord message was not dispatched.', { code, outcome: 'known_rejected' });
}

function hasAttachments(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value.size === 'number') return value.size > 0;
  return true;
}

function sanitizedFailure(error, dispatched) {
  if (error instanceof DiscordTransportError) return error;
  const status = Number(error?.status);
  const rateLimited = /^RateLimitError(?:\[|$)/.test(String(error?.name || '')) || status === 429;
  const knownRejected = !dispatched || rateLimited || (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408);
  const apiCode = Number.isInteger(error?.code) ? error.code : Number.isInteger(error?.rawError?.code) ? error.rawError.code : undefined;
  const referenceErrors = error?.rawError?.errors?.message_reference?._errors;
  const referenceMissing = knownRejected && (apiCode === 10008 ||
    (Array.isArray(referenceErrors) && referenceErrors.some((entry) => entry?.code === 'MESSAGE_REFERENCE_UNKNOWN_MESSAGE')));
  return new DiscordTransportError(knownRejected ? 'Discord message was rejected.' : 'Discord message delivery is uncertain.', {
    code: apiCode ?? (rateLimited ? 'DISCORD_RATE_LIMITED' : 'DISCORD_DELIVERY_FAILED'),
    outcome: knownRejected ? 'known_rejected' : 'unknown',
    status: rateLimited ? 429 : status,
    retryAfter: rateLimited ? Number(error?.retryAfter) : undefined,
    dispatched,
    referenceMissing,
  });
}

function receipt(raw) {
  // Do not synthesize missing proof from the intended destination or client.
  // The delivery ledger verifies these actual response fields separately.
  const reference = raw?.message_reference;
  return {
    ...raw,
    channelId: raw?.channel_id,
    guildId: raw?.guild_id,
    reference: reference ? {
      messageId: reference.message_id, channelId: reference.channel_id,
      guildId: reference.guild_id, type: reference.type ?? 0,
    } : null,
  };
}

function createTransport({ restFactory = (options) => new REST(options), timeoutMs = MAX_TIMEOUT_MS } = {}) {
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, MAX_TIMEOUT_MS) : MAX_TIMEOUT_MS;
  const clients = new WeakMap();

  async function sendDiscordMessage(client, channel, payload, { replyToMessageId = null } = {}) {
    const options = payload instanceof MessagePayload ? { ...payload.options } : typeof payload === 'object' && payload ? { ...payload } : null;
    if (!options || hasAttachments(options.files) || hasAttachments(options.attachments)) throw rejected('DISCORD_UPLOADS_UNSUPPORTED');
    if (typeof options.nonce !== 'string' || !options.nonce.length || options.nonce.length > 25 || options.enforceNonce !== true) throw rejected('DISCORD_LEDGER_NONCE_REQUIRED');
    if (options.forward || (options.reply && replyToMessageId == null)) throw rejected('DISCORD_REFERENCE_UNSUPPORTED');
    if (!client || typeof client.token !== 'string' || !client.token) throw rejected('DISCORD_TRANSPORT_UNCONFIGURED');
    if (!channel || !/^\d{1,20}$/.test(String(channel.id || ''))) throw rejected('DISCORD_CHANNEL_INVALID');
    if (replyToMessageId != null) {
      if (!/^\d{1,20}$/.test(String(replyToMessageId))) throw rejected('DISCORD_REFERENCE_INVALID');
      options.reply = { messageReference: String(replyToMessageId), failIfNotExists: true };
    }

    const controller = new AbortController();
    let dispatched = false;
    const abort = new Promise((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DiscordTransportError('Discord delivery deadline reached.', {
        code: 'DISCORD_DELIVERY_TIMEOUT', outcome: dispatched ? 'unknown' : 'known_rejected', dispatched,
      })), { once: true });
    });
    const timer = setTimeout(() => controller.abort(), duration);
    try {
      const mapped = MessagePayload.create(channel, options).resolveBody();
      const resolved = await Promise.race([mapped.resolveFiles(), abort]);
      if (hasAttachments(resolved.files) || hasAttachments(resolved.body?.attachments)) throw rejected('DISCORD_UPLOADS_UNSUPPORTED');
      let rest = clients.get(client);
      if (!rest) {
        rest = restFactory({ version: '10', retries: 0, timeout: duration, rejectOnRateLimit: () => true });
        clients.set(client, rest);
      }
      rest.setToken(client.token);
      controller.signal.throwIfAborted();
      dispatched = true;
      const raw = await Promise.race([rest.post(Routes.channelMessages(String(channel.id)), {
        body: resolved.body, signal: controller.signal,
      }), abort]);
      return receipt(raw);
    } catch (error) {
      throw sanitizedFailure(error, dispatched);
    } finally {
      clearTimeout(timer);
    }
  }

  return { sendDiscordMessage };
}

const transport = createTransport();
let injected;
function setTransportForTests(sender) {
  if (sender != null && typeof sender !== 'function') throw new TypeError('A test Discord sender must be a function');
  injected = sender || null;
}
function sendDiscordMessage(...args) {
  return (injected || transport.sendDiscordMessage)(...args);
}

module.exports = { sendDiscordMessage, setTransportForTests, createTransport, DiscordTransportError, MAX_TIMEOUT_MS };
