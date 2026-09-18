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

test('reply mention policy blocks everyone/here/roles but keeps user pings', () => {
  assert.deepEqual([...SAFE_REPLY_MENTIONS.parse].sort(), ['users']);
  assert.deepEqual(SAFE_REPLY_MENTIONS.roles, []);
  assert.equal(SAFE_REPLY_MENTIONS.repliedUser, true);
});
