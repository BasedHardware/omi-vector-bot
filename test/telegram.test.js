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
