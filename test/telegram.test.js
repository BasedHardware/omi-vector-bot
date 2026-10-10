const { isBotEscalationReply } = require('../telegram');
const { SAFE_REPLY_MENTIONS } = require('../utils');
const assert = require('node:assert/strict');
const test = require('node:test');

const BOT_ID = 777;
const ESCALATION = 'Thread: 1492645283002318898\nUser asked: how do I pair?\nWhy: needs a person.';

test('accepts a reply to a bot-sent escalation', () => {
  const msg = { reply_to_message: { from: { id: BOT_ID }, text: ESCALATION } };
  assert.equal(isBotEscalationReply(msg, BOT_ID), true);
});

test('rejects a reply to a forged Thread: message from another user', () => {
  const msg = {
    reply_to_message: {
      from: { id: 4242 },
      text: 'Thread: 999888777\nUser asked: forged',
    },
  };
  assert.equal(isBotEscalationReply(msg, BOT_ID), false);
});

test('rejects a reply to a bot message with no Thread: marker', () => {
  const msg = { reply_to_message: { from: { id: BOT_ID }, text: 'just chatting' } };
  assert.equal(isBotEscalationReply(msg, BOT_ID), false);
});

test('rejects messages that are not replies', () => {
  assert.equal(isBotEscalationReply({ text: 'A: hi' }, BOT_ID), false);
  assert.equal(isBotEscalationReply({}, BOT_ID), false);
});

test('fails closed when the bot id is unknown', () => {
  const msg = { reply_to_message: { from: { id: BOT_ID }, text: ESCALATION } };
  assert.equal(isBotEscalationReply(msg, null), false);
});

test('an authenticated Telegram KB line enters the in-memory staff-note pool without a database', async () => {
  const axios = require('axios');
  const knowledge = require('../knowledge');
  const moduleId = require.resolve('../telegram');
  const previousModule = require.cache[moduleId];
  const previousGet = axios.get;
  const previousToken = process.env.TELEGRAM_TOKEN;
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  const previousDb = process.env.DATABASE_URL;
  const sent = [];
  knowledge.resetKnowledge();
  process.env.TELEGRAM_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '12345';
  delete process.env.DATABASE_URL;
  delete require.cache[moduleId];
  const telegram = require('../telegram');
  axios.get = async () => ({ data: { ok: true, result: { id: BOT_ID } } });
  telegram.setDiscordClient({
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (payload) => sent.push(payload) }) },
  });
  try {
    await telegram.handleUpdate({
      message: {
        chat: { id: 12345 },
        text: 'A: The app can run in the background.\nKB: Omi stays connected when the app runs in the background.',
        reply_to_message: { from: { id: BOT_ID }, text: ESCALATION },
      },
    });
    assert.match(knowledge.search('background')[0], /stays connected/);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  } finally {
    knowledge.resetKnowledge();
    axios.get = previousGet;
    if (previousToken === undefined) delete process.env.TELEGRAM_TOKEN;
    else process.env.TELEGRAM_TOKEN = previousToken;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
    require.cache[moduleId] = previousModule;
  }
});

test('reply mention policy does not parse users or roles', () => {
  const { SAFE_REPLY_MENTIONS, replyMentions, rewriteUserMentions } = require('../utils');
  assert.deepEqual(SAFE_REPLY_MENTIONS.parse, []);
  assert.deepEqual(SAFE_REPLY_MENTIONS.roles, []);
  const message = {
    author: { id: '111111111111111111', username: 'customer' },
    mentions: { users: new Map([['99', { id: '99', username: 'staffer' }]]) },
  };
  const mentions = replyMentions(message, { pingAuthor: true, repliedUser: true });
  assert.deepEqual(mentions.parse, []);
  assert.deepEqual(mentions.users, ['111111111111111111']);
  assert.equal(mentions.repliedUser, true);
  const out = rewriteUserMentions('Hey @customer and @staffer', message);
  assert.match(out, /<@111111111111111111>/);
  assert.equal(out.includes('<@99>'), false);
  assert.match(out, /@staffer/);
});

async function withTelegram(fn) {
  const moduleId = require.resolve('../telegram');
  const previousModule = require.cache[moduleId];
  const previousChat = process.env.TELEGRAM_CHAT_ID;
  const previousToken = process.env.TELEGRAM_TOKEN;
  const previousDb = process.env.DATABASE_URL;
  process.env.TELEGRAM_CHAT_ID = '12345';
  process.env.TELEGRAM_TOKEN = 'unit-test-token';
  delete process.env.DATABASE_URL;
  delete require.cache[moduleId];
  try { await fn(require('../telegram')); }
  finally {
    require.cache[moduleId] = previousModule;
    if (previousChat === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = previousChat;
    if (previousToken === undefined) delete process.env.TELEGRAM_TOKEN;
    else process.env.TELEGRAM_TOKEN = previousToken;
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
}

function staffUpdate(text, threadId = 'help-thread') {
  return { message: { chat: { id: 12345 }, text: 'A: A documented next step.',
    reply_to_message: { from: { id: BOT_ID }, text: text || `Thread: ${threadId}\nWhy: needs a person` },
  } };
}

test('Telegram never resolves cases or escalations after missing or failed Discord delivery', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  await withTelegram(async (telegram) => {
    const cases = createCaseService(createMemoryStore());
    const value = await cases.getOrCreateCase({ channelId: 'help-thread', customerId: 'alice', customerThreadId: 'help-thread' });
    await cases.linkHandoff(value.id, { escalationId: 42 });
    let resolutions = 0;
    const db = { getPendingEscalation: async () => ({ id: 42 }), resolveEscalation: async () => resolutions++ };
    const base = { cases, db, getBotUserId: async () => BOT_ID };
    for (const discordClient of [null,
      { channels: { fetch: async () => null } },
      { channels: { fetch: async () => ({ isTextBased: () => true, isThread: () => true, send: async () => { throw new Error('Missing Access'); } }) } },
    ]) {
      await telegram.handleUpdate(staffUpdate(), { ...base, discordClient });
      assert.equal((await cases.getCaseById(value.id)).status, 'queued');
      assert.equal(resolutions, 0);
    }
  });
});

test('Telegram exact case marker isolates customers in a shared channel and resolves after confirmed send', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  await withTelegram(async (telegram) => {
    const cases = createCaseService(createMemoryStore());
    const alice = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
    const bob = await cases.getOrCreateCase({ channelId: 'general', customerId: 'bob' });
    await cases.linkHandoff(alice.id, { escalationId: 10 });
    await cases.linkHandoff(bob.id, { escalationId: 11 });
    const events = [];
    const discordClient = { channels: { fetch: async () => ({ isTextBased: () => true, isThread: () => false,
      send: async () => { events.push('send'); return { id: 'delivered-answer' }; },
    }) } };
    const db = { getPendingEscalation: async () => assert.fail('shared channel cannot select latest escalation'), resolveEscalation: async (id) => events.push(`resolve:${id}`) };
    await telegram.handleUpdate(staffUpdate(`Thread: general\nCase: ${alice.id}`), { cases, db, discordClient, getBotUserId: async () => BOT_ID });
    assert.deepEqual(events, ['send', 'resolve:10']);
    assert.equal((await cases.getCaseById(alice.id)).status, 'resolved');
    assert.equal((await cases.getCaseById(bob.id)).status, 'queued');
  });
});

test('Telegram rejects a case marker for a different destination', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  await withTelegram(async (telegram) => {
    const cases = createCaseService(createMemoryStore());
    const value = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
    await telegram.handleUpdate(staffUpdate(`Thread: unrelated\nCase: ${value.id}`), {
      cases, getBotUserId: async () => BOT_ID,
      discordClient: { channels: { fetch: async () => assert.fail('wrong case destination must not send') } },
    });
    assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  });
});

test('legacy Telegram shared-channel reply cannot resolve an arbitrary escalation', async () => {
  await withTelegram(async (telegram) => {
    const { createCaseService, createMemoryStore } = require('../supportCases');
    await telegram.handleUpdate(staffUpdate('Thread: general'), {
      cases: createCaseService(createMemoryStore()), getBotUserId: async () => BOT_ID,
      discordClient: { channels: { fetch: async () => ({ isTextBased: () => true, isThread: () => false, send: async () => ({ id: 'sent' }) }) } },
      db: { getPendingEscalation: async () => assert.fail('general channel has no customer binding'), resolveEscalation: async () => assert.fail('must stay pending') },
    });
  });
});

test('Telegram shutdown drains an active customer send and never schedules another poll', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  await withTelegram(async (telegram) => {
    const cases = createCaseService(createMemoryStore());
    const value = await cases.getOrCreateCase({ channelId: 'help-thread', customerId: 'alice', customerThreadId: 'help-thread' });
    let releaseSend;
    let started;
    const sendGate = new Promise((resolve) => { releaseSend = resolve; });
    const sendStarted = new Promise((resolve) => { started = resolve; });
    let schedules = 0;
    const task = telegram.startPolling({
      schedule: () => { schedules++; },
      poll: () => telegram.handleUpdate(staffUpdate(), { cases, getBotUserId: async () => BOT_ID,
        discordClient: { channels: { fetch: async () => ({ isTextBased: () => true, isThread: () => true,
          send: async () => { started(); await sendGate; return { id: 'customer-receipt' }; },
        }) } },
      }),
    });
    await sendStarted;
    let drained = false;
    const draining = telegram.drainPolling(1000).then((result) => { drained = true; return result; });
    assert.equal(drained, false);
    assert.equal((await cases.getCaseById(value.id)).status, 'queued');
    releaseSend();
    assert.equal(await draining, true);
    await task;
    assert.equal((await cases.getCaseById(value.id)).status, 'resolved');
    assert.equal(schedules, 0);
  });
});

test('Telegram polling drain reports its timeout while preserving the active task', async () => {
  await withTelegram(async (telegram) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let schedules = 0;
    const task = telegram.startPolling({ poll: () => gate, schedule: () => { schedules++; } });
    assert.equal(await telegram.drainPolling(5), false);
    release();
    await task;
    assert.equal(schedules, 0);
    assert.equal(await telegram.drainPolling(5), true);
  });
});
