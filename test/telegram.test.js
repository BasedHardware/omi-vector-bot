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
