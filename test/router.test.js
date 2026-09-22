const assert = require('node:assert/strict');
const test = require('node:test');
const router = require('../router');

test('tax, duties, and customs stay shop/money and never skip as tech', () => {
  const tax = router.classify('import tax on order #20716');
  assert.equal(tax.area, 'shop');
  assert.equal(tax.lane, 'money');
  assert.equal(router.skipModel(tax), true);
  assert.equal(router.isTechLane(tax), false);
  assert.match(router.cannedReply(tax, 'import tax on order #20716'), /tax or duties/i);
  assert.equal(/refund or a charge/i.test(router.cannedReply(tax, 'import tax on order #20716')), false);
  assert.match(router.staffReason(tax, 'import tax on order #20716'), /tax/i);

  const duties = router.classify('I was charged extra duties on my Omi');
  assert.equal(duties.lane, 'money');
  assert.equal(duties.area, 'shop');

  const customs = router.classify('My package is stuck in customs');
  assert.equal(customs.area, 'shop');
  assert.equal(customs.lane, 'shop');
  assert.equal(router.skipModel(customs), true);
  assert.equal(router.isTechLane(customs), false);
});

test('order and tracking are shop', () => {
  const route = router.classify('Where is my order?');
  assert.equal(route.area, 'shop');
  assert.equal(route.lane, 'shop');
  assert.equal(route.escalate, true);
  const numbered = router.classify('where is order #1042');
  assert.equal(numbered.area, 'shop');
  assert.equal(numbered.lane, 'shop');
  assert.equal(router.skipModel(numbered), true);
  const canned = router.cannedReply(numbered, 'where is order #1042');
  assert.match(canned, /\/order/);
  assert.equal(/necklace|blue light|recording|iphone/i.test(canned), false);
});

test('paid plan / redemption is money, not shipping, even if they mention Order IDs', () => {
  const q = [
    'Hi Omi team - reporting an app/billing bug and hoping someone can fix my account.',
    'I purchased Omi Unlimited Yearly (bundle) and received a redemption code. In the app I accidentally redeemed it while the Plus plan was selected, so my account became Plus. I then tapped "Upgrade to Unlimited" - but instead of upgrading, my account was downgraded to Free, and the redemption code stopped working. So I\'ve paid for Unlimited Yearly but I\'m now stuck on Free with no active plan.',
    'Per the pinned guidelines I\'ve already emailed help@omi.me with my Order IDs for both this subscription and a separate glasses order. Could a team member please check my account and either reissue the code or manually apply Unlimited Yearly?',
  ].join('\n');
  const route = router.classify(q);
  assert.equal(route.area, 'shop');
  assert.equal(route.lane, 'money');
  assert.equal(router.skipModel(route), true);
  assert.equal(router.isTechLane(route), false);
  const canned = router.cannedReply(route, q);
  assert.match(canned, /paid plan or a redemption code/i);
  assert.equal(/\/order|where that order is|guess a date/i.test(canned), false);
  assert.match(router.staffReason(route, q), /plan or redemption/i);
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
  assert.equal(router.classify('npm error ERESOLVE unable to resolve dependency tree').area, 'desktop');
  const watch = router.classify(
    'I recorded 2.5 hours on my Apple Watch. It didn\'t sync to the app. I also made two very small recordings of about 2 minutes and those are missing as well.'
  );
  assert.equal(watch.area, 'app');
  assert.equal(watch.lane, 'tech');
  const blueDot = router.classify(
    'My omi is showing disconnected in app even though I have blue dot on the device'
  );
  assert.equal(blueDot.area, 'app');
  assert.equal(blueDot.lane, 'tech');
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

test('fair use and plan confusion is account, not a refund or pairing how-to', () => {
  const q = [
    'Just got omi in the mail on Wed and was like nintendo kid excited to set it up.',
    'A) a "FAIR USE WARNING". how can i use it as a second brain',
    'B) FILLED the memory. its asking me for a plan',
    '2) Do I need to have omi everywhere all the time for it to work (pc, phone, etc)',
    '3) What are all these plans? do i need a diff one for every device?',
    'now i want to put it back in the mail to return it. help me change my mind.',
  ].join('\n');
  const route = router.classify(q);
  assert.equal(route.area, 'shop');
  assert.equal(route.lane, 'account');
  assert.equal(route.escalate, true);
  assert.equal(router.skipModel(route), false);
  assert.equal(router.classify('I want a refund').lane, 'money');
  assert.match(router.staffReason(route), /Fair use/i);
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

test('model-down fallback still escalates a phone-app ticket without naming the model', () => {
  const crash = router.classify('the app crashed on iPhone');
  const down = router.whenModelDown(crash, 'the app crashed on iPhone');
  assert.equal(down.agent.escalate, true);
  assert.match(down.reply, /phone app/i);
  assert.equal(/opencode|credit|429|weekly/i.test(down.reply), false);
  assert.equal(/pair/i.test(down.reply), false);
  const tax = router.classify('import tax on order #20716');
  const taxDown = router.whenModelDown(tax, 'import tax on order #20716');
  assert.match(taxDown.reply, /tax or duties/i);
});

test('money, privacy, and shop skip the model; crash, firmware, and pairing do not', () => {
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
  assert.equal(router.skipModel(router.classify('Where is my order?')), true);
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
