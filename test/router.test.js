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
  const win = router.classify(
    "I'm getting this error when trying to do the command\nnpm error ERESOLVE unable to resolve dependency tree\nWhile resolving: omi-windows@1.0.35\npeer react@\">=19 <19.3\" from @react-three/fiber"
  );
  assert.equal(win.area, 'desktop');
  assert.equal(win.lane, 'tech');
});

test('firmware death escalates; talk to a human always does', () => {
  assert.equal(router.classify('it powers off by itself at 100% battery').area, 'firmware');
  assert.equal(router.classify('I need a real person').escalate, true);
  const autoOff = router.classify(
    'Hi, I just got my omi and paired it with the omi app, however the device keeps turning itself off after 5 seconds? Video attached'
  );
  assert.equal(autoOff.area, 'firmware');
  assert.equal(autoOff.lane, 'firmware');
  assert.equal(autoOff.escalate, true);
  assert.equal(router.skipModel(autoOff), false);
  assert.equal(router.classify('How do I pair my Omi?').lane, 'faq');
});

test('PII and orders are not public-forum safe', () => {
  assert.equal(router.looksLikePii('email is jane@omi.me'), true);
  assert.equal(router.isPublicForumSafe('Where is my order?'), false);
  assert.equal(router.isPublicForumSafe('delete my data'), false);
  assert.equal(router.isPublicForumSafe('How do I pair my Omi?'), true);
});

test('desktop voice 402 is tech, not a refund', () => {
  const part1 = [
    'Hello Omi Support, problem with voice replies in the Omi macOS desktop app.',
    'Omi can transcribe. It does not speak a response.',
    'Couldn’t get a voice reply.',
    "Omi’s AI service declined this request for billing reasons.",
  ].join(' ');
  const route1 = router.classify(part1);
  assert.equal(route1.area, 'desktop');
  assert.equal(route1.lane, 'tech');
  assert.equal(router.skipModel(route1), false);
  assert.match(router.cannedReply(route1), /computer app/i);
  assert.equal(/refund/i.test(router.cannedReply(route1)), false);
  assert.equal(/\blogs\b/i.test(router.cannedReply(route1)), false);

  const part2 = [
    'The AI response fails with a billing-related error. HTTP 402.',
    "Omi Desktop's local API is working. OpenRouter key is configured.",
    'Should OpenRouter BYOK work for voice replies?',
  ].join(' ');
  const route2 = router.classify(part2);
  assert.equal(route2.area, 'desktop');
  assert.equal(route2.lane, 'tech');

  const shortSmoke = router.classify('The Mac voice / "billing reasons"');
  assert.equal(shortSmoke.area, 'desktop');
  assert.equal(shortSmoke.lane, 'tech');
  assert.equal(router.skipModel(shortSmoke), false);

  assert.equal(router.classify('I have a billing question').lane, 'money');
  assert.equal(router.classify('I was charged twice on the macOS desktop app').lane, 'money');
});

test('only money and privacy skip the model; crash, firmware, and pairing do not', () => {
  const refund = router.classify('I want a refund');
  assert.equal(router.skipModel(refund), true);
  assert.match(router.cannedReply(refund), /money|refund|charge/i);
  assert.equal(/bluetooth/i.test(router.cannedReply(refund)), false);

  const crash = router.classify('the app crashed on iPhone');
  assert.equal(router.skipModel(crash), false);
  assert.match(router.cannedReply(crash), /phone app/i);
  assert.equal(/pair/i.test(router.cannedReply(crash)), false);
  assert.equal(/\blogs\b/i.test(router.cannedReply(crash)), false);

  const privacy = router.classify('delete my data');
  assert.equal(router.skipModel(privacy), true);
  assert.match(router.cannedReply(privacy), /delet/i);

  assert.equal(router.skipModel(router.classify('How do I pair my Omi?')), false);
  assert.equal(router.skipModel(router.classify('Where is my order?')), false);
  assert.equal(router.skipModel(router.classify('it powers off by itself at 100% battery')), false);
});

test('AREA_OWNERS parses users and roles; empty means no ping', () => {
  const map = router.parseAreaOwners('shop:123456789012345678,firmware:role:987654321098765432');
  assert.equal(router.ownerMention('shop', map), '<@123456789012345678>');
  assert.equal(router.ownerMention('firmware', map), '<@&987654321098765432>');
  assert.equal(router.ownerMention('app', map), '');
  assert.equal(router.shouldPingOwner(router.classify('Where is my order?')), true);
  assert.equal(router.shouldPingOwner(router.classify('How do I pair my Omi?')), false);
});
