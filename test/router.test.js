const assert = require('node:assert/strict');
const test = require('node:test');
const router = require('../router');

test('money and privacy beat shop and never go to GitHub lanes', () => {
  assert.equal(router.classify('I want a refund').lane, 'money');
  assert.equal(router.classify('I want a refund').area, 'shop');
  assert.equal(router.classify('delete my data').area, 'privacy');
  assert.equal(router.classify('delete my data').escalate, true);
  assert.equal(router.isTechLane(router.classify('I want a refund')), false);
});

test('order and tracking are shop', () => {
  const route = router.classify('Where is my order?');
  assert.equal(route.area, 'shop');
  assert.equal(route.lane, 'shop');
  assert.equal(route.escalate, true);
});

test('app crash and macOS are tech; pairing how-to is faq', () => {
  assert.equal(router.classify('the app crashed on iPhone').area, 'app');
  assert.equal(router.classify('the app crashed on iPhone').lane, 'tech');
  assert.equal(router.classify('macOS desktop app cannot pair in settings').area, 'desktop');
  assert.equal(router.classify('How do I pair my Omi?').lane, 'faq');
  assert.equal(router.classify('How do I pair my Omi?').escalate, false);
  assert.equal(router.classify('in order to pair, I press the button').lane, 'faq');
});

test('firmware death escalates; talk to a human always does', () => {
  assert.equal(router.classify('it powers off by itself at 100% battery').area, 'firmware');
  assert.equal(router.classify('I need a real person').escalate, true);
});

test('PII and orders are not public-forum safe', () => {
  assert.equal(router.looksLikePii('email is jane@omi.me'), true);
  assert.equal(router.isPublicForumSafe('Where is my order?'), false);
  assert.equal(router.isPublicForumSafe('delete my data'), false);
  assert.equal(router.isPublicForumSafe('How do I pair my Omi?'), true);
});

test('refund, privacy, and app crash skip the model and do not use pairing steps', () => {
  const refund = router.classify('I want a refund');
  assert.equal(router.skipModel(refund), true);
  assert.match(router.cannedReply(refund), /person/);
  assert.equal(/bluetooth/i.test(router.cannedReply(refund)), false);

  const crash = router.classify('the app crashed on iPhone');
  assert.equal(router.skipModel(crash), true);
  assert.match(router.cannedReply(crash), /logs/);
  assert.equal(/pair/i.test(router.cannedReply(crash)), false);

  const privacy = router.classify('delete my data');
  assert.equal(router.skipModel(privacy), true);
  assert.match(router.cannedReply(privacy), /deletion/);
});

test('AREA_OWNERS parses users and roles; empty means no ping', () => {
  const map = router.parseAreaOwners('shop:123456789012345678,firmware:role:987654321098765432');
  assert.equal(router.ownerMention('shop', map), '<@123456789012345678>');
  assert.equal(router.ownerMention('firmware', map), '<@&987654321098765432>');
  assert.equal(router.ownerMention('app', map), '');
  assert.equal(router.shouldPingOwner(router.classify('Where is my order?')), true);
  assert.equal(router.shouldPingOwner(router.classify('How do I pair my Omi?')), false);
});
