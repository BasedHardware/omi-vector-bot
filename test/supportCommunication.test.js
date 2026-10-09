const assert = require('node:assert/strict');
const test = require('node:test');
const router = require('../router');
const { escalateReply } = require('../utils');
const { addUnsyncedDataWarning } = require('../answerPipeline');
const { buildSystemPrompt, buildUserPrompt, buildToolFacts, SUPPORT_COMMUNICATION_POLICY } = require('../prompt');

const cases = [
  ['refund', { lane: 'money', area: 'shop' }, 'Please refund this purchase', /refund/i],
  ['order', { lane: 'shop', area: 'shop' }, 'Where is my order?', /delivery|order/i],
  ['device', { lane: 'firmware', area: 'firmware' }, 'The device powers off by itself', /device/i],
  ['app', { lane: 'tech', area: 'app' }, 'The phone app keeps crashing', /phone app/i],
  ['account', { lane: 'account', area: 'shop' }, 'My account shows a fair-use warning', /account limits|plan/i],
  ['privacy', { lane: 'privacy', area: 'privacy' }, 'Please delete my account', /data deletion/i],
  ['data loss', { lane: 'tech', area: 'app' }, 'I recorded a meeting but its transcript is missing', /phone app/i],
];

for (const [kind, route, question, subject] of cases) {
  test(`${kind} replies lead with the goal and use only the delivery-confirmed next step`, () => {
    let body = router.cannedReply(route, question);
    if (kind === 'data loss') body = addUnsyncedDataWarning(body, question);
    assert.match(body, subject);
    assert.doesNotMatch(body, /^I\s+(?:can['’]?t|cannot|do not|don['’]?t)/i);
    assert.doesNotMatch(body, /(?:has this now|will reply|email help@omi\.me|assigned|approved|guaranteed)/i);

    const delivered = escalateReply(body, { pinged: true, replyInThread: true });
    assert.match(delivered, /will reply in this thread/i);
    assert.doesNotMatch(delivered, /help@omi\.me|use \/order|contact support/i);
    assert.equal((delivered.match(/will reply in this thread/gi) || []).length, 1);

    const failed = escalateReply(body, { deliveryFailed: true });
    assert.match(failed, /Please email help@omi\.me/i);
    assert.doesNotMatch(failed, /has this now|will reply in this thread/i);
    assert.equal((failed.match(/help@omi\.me/gi) || []).length, 1);

    if (kind === 'data loss') {
      for (const reply of [delivered, failed]) {
        assert.match(reply, /Do not reinstall the app, log out, or clear Pending\/All storage/i);
        assert.doesNotMatch(reply, /(?:can|will) recover|saved on (?:the|your) (?:phone|device)/i);
      }
    }
  });
}

test('payment-action acknowledgments match the requested action without inventing another one', () => {
  const cases = [
    ['Cancel my order', /cancel|cancellation/i, /refund|address change/i],
    ['Change my shipping address', /shipping address/i, /refund|cancellation/i],
    ['I was charged twice', /payment or charge/i, /refund|shipping address/i],
  ];
  for (const [question, wanted, unrelated] of cases) {
    const reply = router.cannedReply({ lane: 'money', area: 'shop' }, question);
    assert.match(reply, wanted);
    assert.doesNotMatch(reply, unrelated);
  }
});

test('an unavailable answer service is honest without promising an undelivered handoff', () => {
  for (const [route, question] of [
    [{ lane: 'tech', area: 'app' }, 'The phone app crashed'],
    [{ lane: 'faq', area: 'unknown' }, 'Which unsupported feature is this?'],
    [{ lane: 'faq', area: 'unknown' }, '我的录音找不到了，应该怎么办？'],
  ]) {
    const down = router.whenModelDown(route, question);
    assert.equal(down.agent.escalate, true);
    assert.match(down.reply, /Automated answers are temporarily unavailable/i);
    assert.doesNotMatch(down.reply, /^I can|a person will|has this now|will reply|recover|within \d/i);
    assert.match(escalateReply(down.reply, { pinged: true, replyInThread: true }), /will reply in this thread/i);
    const failed = escalateReply(down.reply, { deliveryFailed: true });
    assert.match(failed, /Please email help@omi\.me/i);
    assert.doesNotMatch(failed, /will reply/i);
  }
});

test('answer contracts require helpful honesty, supported steps, and delivery-controlled acknowledgments', () => {
  for (const lane of ['faq', 'money', 'shop', 'account', 'privacy', 'tech', 'firmware']) {
    const system = buildSystemPrompt({ lane });
    assert.ok(system.includes(SUPPORT_COMMUNICATION_POLICY));
    assert.match(system, /one clear support next step/i);
    assert.match(system, /before delivery is confirmed/i);
    assert.match(system, /Never guarantee a refund, replacement, recovery/i);
    assert.match(system, /safe.*official steps/i);
    assert.match(system, /do not hide uncertainty or pretend to inspect anything/i);
  }
  const tools = buildToolFacts({ route: { lane: 'shop' } });
  assert.match(tools, /No verified order lookup was provided/i);
  assert.doesNotMatch(tools, /Shopify is not connected/i);
  const lost = buildUserPrompt({ question: 'Were my recordings deleted?', route: { lane: 'tech' } });
  assert.match(lost, /do not infer where the audio is stored/i);
  assert.doesNotMatch(lost, /may still be on the watch or phone/i);
});
