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
  assert.match(canned, /help@omi\.me/);
  assert.doesNotMatch(canned, /Order lookup in chat is not live yet/);
  const delivered = require('../utils').stripSupportRedirect(canned);
  assert.match(delivered, /can't see order status from here/i);
  assert.match(delivered, /needs someone with access to the order system/i);
  assert.doesNotMatch(delivered, /Email help@omi\.me/);
  assert.equal(/\/order/.test(canned), false);
  assert.equal(/necklace|blue light|recording|iphone/i.test(canned), false);
});

test('a checkout shipping quote is not treated as order status', () => {
  const q =
    'I live on Reunion island and the shipping cost at cashout is 145 euros. Can someone arrange normal-cost shipping from Europe or Asia?';
  const route = router.classify(q);
  assert.equal(route.area, 'shop');
  assert.equal(route.lane, 'shop');
  assert.equal(route.intent, 'shipping_quote');
  assert.equal(route.responseMode, 'grounded');
  assert.equal(route.escalate, true);
  assert.equal(router.requiresGroundedAnswer(route), true);
  assert.equal(router.isPublicForumSafe(q), true);

  const reply = router.cannedReply(route, q);
  assert.match(reply, /checkout shipping quote/i);
  assert.match(reply, /another shipping option/i);
  assert.equal(/order status from here|where that order is|\/order\b/i.test(reply), false);
  assert.match(router.staffReason(route, q), /checkout shipping quote/i);
});

test('an order customer asking for a human gets a handoff answer, not another /order instruction', () => {
  const q = 'Please help me get in touch with the human who is responsible for shipping.';
  const route = router.classify(`Where is my order?\n${q}`);
  assert.equal(route.wantHuman, true);
  const reply = router.cannedReply(route, q);
  assert.match(reply, /person from the shop team/i);
  assert.doesNotMatch(reply, /\/order\b|order status from here/i);
});

test('direct human-contact requests route to staff without misreading ordinary conversation', () => {
  for (const question of [
    'I want to talk to someone',
    'Connect me with the team please',
    'Can someone from sales contact me?',
    'Is there a live agent?',
    'Can I speak with an actual human?',
    'I would like to chat with a representative',
    'Put me in touch with support',
    'Help me get in touch with a human',
  ]) {
    assert.equal(router.classify(question).wantHuman, true, question);
  }
  for (const question of [
    'Does Omi keep recording when I talk to someone on a call?',
    "Can it tell who I'm speaking with?",
    'Can I share a conversation with someone?',
  ]) {
    assert.equal(router.classify(question).wantHuman, false, question);
  }
  for (const question of [
    'I need a human',
    'We want a real person to look at this',
    'Need a person please',
    'I want to speak to an agent',
    'can I get a real person please',
    'real person please',
    'is this a real person or a bot? i need help',
    'I need someone from the team to look at this',
  ]) assert.equal(router.classify(question).wantHuman, true, question);
  for (const question of [
    'Does Omi need a person to be close to the mic?',
    'I want a person to see my summaries, can I share?',
    'Does recording need a real person to be present?',
    'do I need a person to set it up?',
    'can omi tell which person is speaking?',
    'I need a human-readable export of my notes',
  ]) assert.equal(router.classify(question).wantHuman, false, question);
});

test('a customer nudge is recognized without treating arbitrary questions as nudges', () => {
  assert.equal(router.looksLikeSupportNudge("anyone? even a bot's answer will be appreciated."), true);
  assert.equal(router.looksLikeSupportNudge('Can anyone explain how pairing works?'), false);
});

test('same-problem follow-ups are support nudges in an existing case', () => {
  assert.equal(router.looksLikeSupportNudge("I'm having the same problem too"), true);
  assert.equal(router.looksLikeSupportNudge('I like the same color too'), false);
});

test('model-down battery fallback uses the case history and does not repeat support work', () => {
  const context = [
    'The battery went from 9% to 3%, then 73%, then 19% after unplugging.',
    'It flashes blue and green while charging.',
    'I opened ticket #138637367 and sent diagnostics and screenshots.',
    "I'm having the same problem too.",
  ].join('\n');
  const result = router.whenModelDown({ lane: 'firmware', area: 'firmware' }, context);
  assert.match(result.reply, /green and blue means it is charging while connected/i);
  assert.match(result.reply, /percentage changes/i);
  assert.match(result.reply, /already opened a support ticket/i);
  assert.match(result.reply, /sent diagnostics or screenshots/i);
  assert.doesNotMatch(result.reply, /email help@omi\.me|open (?:a|another) ticket/i);
});

test('conversation deletion distinguishes cloud data, phone copies, and device storage', () => {
  const question =
    'I want to remove stored past conversations from the Omi app and phone. Does that remove them from the device?';
  const result = router.whenModelDown({ lane: 'faq', area: 'unknown' }, question);
  assert.match(result.reply, /Delete conversation/i);
  assert.match(result.reply, /Settings → Device → Offline Sync/i);
  assert.match(result.reply, /clear \*\*Synced\*\* copies/i);
  assert.match(result.reply, /does not erase the pendant\/device storage/i);
  assert.match(result.reply, /Pending.*All.*unsynced/is);
  assert.doesNotMatch(result.reply, /delete account|email help@omi\.me/i);
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

test('a Plaud 24-hour recording question is a product answer, not an app bug', () => {
  const q = "I'd like to keep my new Omi device (not app) to keep recording, just like Plaud does for 24 hours. I kept turning on the device for couple days, but seems nothing has recorded yet.";
  const route = router.classify(q);
  assert.equal(route.lane, 'faq');
  assert.equal(route.escalate, false);
  assert.equal(router.skipModel(route), false);
  const other = router.classify('Any clue what the blue light means on the device?');
  assert.equal(other.lane, 'faq');
  assert.equal(other.escalate, false);
  const failed = router.classify('The app stayed open, the light was blue, and still nothing recorded.');
  assert.equal(failed.lane === 'faq' && failed.escalate === false, false);
  assert.equal(router.classify('The Android app crashes every time I open it.').lane, 'tech');
});

test('where, which, and offline product questions reach documentation retrieval', () => {
  for (const question of [
    'Where do I create an Omi developer API key?',
    'Where can I change how long silence lasts before Omi ends a conversation?',
    'Which Omi device can record on its own without the phone app?',
    'If I record while my phone has no internet, can the conversation sync later?',
  ]) {
    const route = router.classify(question);
    assert.equal(route.lane, 'faq', question);
    assert.equal(route.escalate, false, question);
  }
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
  const omiWindow = router.classify(
    'What triggers the Omi app to come to the front? In the middle of working on an app, Omi window will open and come to the front and has to be hidden.'
  );
  assert.equal(omiWindow.area, 'desktop');
  assert.equal(omiWindow.lane, 'tech');
  const withStaffTranscription = router.classify(
    [
      'What triggers the Omi app to come to the front? Omi window will open and come to the front.',
      'Likely an alert when Omi hits a mic or transcription error in the background.',
    ].join('\n')
  );
  assert.equal(withStaffTranscription.area, 'desktop');
});

test('blocked calendar extensions and failed integrations are app tickets', () => {
  const blocked = router.classify(
    'I use a personal Google account. Google Calendar says this app is blocked, there is no Advanced option, and the Omi integration only gets my main calendar. How can I fix both?'
  );
  assert.equal(blocked.area, 'app');
  assert.equal(blocked.lane, 'tech');
  assert.equal(blocked.escalate, true);
});

test('a device-button question that is transcribed but never answered uses the grounded app pipeline', () => {
  const q = [
    'I received my Omi yesterday. When the device is working I press it and get the vibration,',
    'ask my question, press again, and see the transcription of my question in the app,',
    'but I never get any answers. I disconnected and reconnected it and even deleted my account.',
    'iPhone 15 Pro, iOS 27, Omi CV1 fw 3.0.21, app 1.0.552 (1246).',
  ].join(' ');
  const route = router.classify(q);
  assert.equal(route.area, 'app');
  assert.equal(route.lane, 'tech');
  assert.equal(route.escalate, true);
  assert.equal(router.skipModel(route), false);
  assert.equal(router.requiresGroundedAnswer(route), true);
  assert.match(router.cannedReply(route, q), /phone app/i);
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
  assert.equal(router.looksLikePii('call me at 555-123-4567'), true);
  assert.equal(router.looksLikePii('error code 1011'), false);
  assert.equal(router.isPublicForumSafe('Where is my order?'), false);
  assert.equal(router.isPublicForumSafe('#12345 never arrived'), false);
  assert.equal(router.isPublicForumSafe('See pull request #14691'), true);
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

test('an unknown-area technical fallback does not invent a phone-app diagnosis', () => {
  const reply = router.cannedReply({ area: 'unknown', lane: 'tech', escalate: true }, 'Omi keeps disconnecting');
  assert.match(reply, /technical problem/i);
  assert.doesNotMatch(reply, /phone app/i);
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
  assert.equal(router.specialistNames('shop', 'money'), 'Mohsin');
  assert.equal(router.specialistNames('app', 'tech'), 'Mohsin');
  assert.equal(router.specialistNames('desktop', 'tech'), 'Aryan');
  assert.equal(router.specialistNames('firmware', 'firmware'), 'TuEmb');
  assert.equal(router.specialistNames('privacy', 'privacy'), 'David');
  assert.equal(router.specialistNames('unknown', 'unknown'), 'Aryan, David, undivisible');
  assert.equal(router.specialistNames('unknown', 'faq'), '');
  assert.equal(/@/.test(router.specialistNames('shop', 'money')), false);
});

test('AREA_OWNERS default covers unknown and unassigned areas without overriding named owners', () => {
  const owners = router.parseAreaOwners(
    'shop:123456789012345678,default:role:987654321098765432'
  );
  assert.equal(router.ownerMention('shop', owners), '<@123456789012345678>');
  assert.equal(router.ownerMention('unknown', owners), '<@&987654321098765432>');
  assert.equal(router.ownerMention('desktop', owners), '<@&987654321098765432>');
  assert.equal(
    router.ownerMention('app', router.parseAreaOwners('app:MOHSIN_ID,default:111111111111111111')),
    '<@111111111111111111>'
  );
  assert.equal(router.ownerMention('unknown', router.parseAreaOwners('default:111111111111111111')), '<@111111111111111111>');
  assert.equal(router.ownerMention('unknown', router.parseAreaOwners('shop:123456789012345678')), '');
  const json = router.parseAreaOwners('{"default":"role:987654321098765432"}');
  assert.equal(router.ownerMention('app', json), '<@&987654321098765432>');
});

test('device not capturing stays with transcription and does not become a firmware repair', () => {
  const q = "Have pro sub and device doesn't capture anything. Keep getting transcription unavailable.";
  const route = router.classify(q);
  assert.equal(route.area, 'app');
  assert.equal(route.lane, 'tech');
  assert.equal(route.captureFailure, true);
  assert.equal(router.skipModel(route), false);
  assert.equal(route.lane === 'money', false);
  const reason = router.staffReason(route, q);
  assert.match(reason, /transcription unavailable/i);
  assert.match(reason, /not capturing/i);
  assert.equal(/app bug/i.test(reason), false);
  const replaced = router.pickStaffReason(
    route,
    'Phone app reports transcription unavailable repeatedly; app bug needs investigation',
    q
  );
  assert.equal(replaced, reason);
  const triage = require('../triage');
  const merged = triage.merge(route, { topic: 'Transcription unavailable in phone app', labels: ['app'] }, q);
  assert.equal(merged.topic, 'Transcription unavailable, device not capturing');
});

test('known issue reply does not invent a diagnosis', () => {
  const reply = router.knownIssueReply();
  assert.match(reply, /already marked as a known issue/i);
  assert.match(reply, /person has to confirm/i);
  assert.equal(/app bug|app-side|watch or phone/i.test(reply), false);
});

test('a docs question that mentions a paid plan stays faq, not shop', () => {
  const q = 'Are there any instructions or documentation on this feature? How it works and how it\'s different from paying for a paid plan?';
  const route = router.classify(q);
  assert.equal(route.lane, 'faq');
  assert.equal(route.area, 'unknown');
  assert.equal(route.escalate, false);
  assert.equal(router.skipModel(route), false);
  assert.match(router.staffReason(route, q), /Docs question/i);
  assert.equal(/shop|account access/i.test(router.staffReason(route, q)), false);
  const refund = router.classify('I want a refund. Where is the documentation for that?');
  assert.equal(refund.lane, 'money');
});

test('desktop and phone together name both apps', () => {
  const q = 'Once again, I cannot delete memories or conversations on either the desktop app or the mobile app. The desktop app gives me an error and the mobile app shows them deleted and then they resurface 30 seconds later.';
  const route = router.classify(q);
  assert.equal(route.area, 'desktop');
  assert.equal(route.lane, 'tech');
  const reason = router.staffReason(route, q);
  assert.match(reason, /computer app/i);
  assert.match(reason, /phone app/i);
  assert.equal(/app bug/i.test(reason), false);
  const picked = router.pickStaffReason(route, 'Cannot see the computer app from chat', q);
  assert.equal(picked, reason);
});

test('a MAC address question is not a computer-app ticket', () => {
  const q = 'What is the MAC address of my Omi?';
  const route = router.classify(q);
  assert.equal(route.area, 'unknown');
  assert.equal(/computer app/i.test(router.staffReason(route, q)), false);
  assert.equal(router.classify('need the mac-address of my omi for my router').area, 'unknown');
  assert.equal(router.classify('whats the mac adress of my omi').area, 'unknown');
  assert.equal(router.classify('the MAC of my omi').area, 'unknown');
  assert.equal(router.classify('mac addr').area, 'unknown');
  assert.equal(router.classify('mac addresses').area, 'unknown');
  assert.equal(router.classify('MAC of the omi').area, 'unknown');
  assert.equal(router.classify('the MAC of this omi').area, 'unknown');
  assert.equal(router.classify('MAC of omi').area, 'unknown');
  assert.equal(router.classify('the mac on my omi').area, 'unknown');
  assert.equal(router.classify('mac\'s address').area, 'unknown');
  assert.equal(router.classify('MAC ID of my omi').area, 'unknown');
  assert.equal(router.classify('hardware MAC').area, 'unknown');
  assert.equal(router.classify('is the mic bug on mac addressed yet').area, 'desktop');
  assert.equal(router.classify('macOS desktop app').area, 'desktop');
  assert.equal(router.classify('macOS desktop app cannot pair').area, 'desktop');
  const mac = router.classify('The Omi app on my Mac keeps crashing');
  assert.equal(mac.area, 'desktop');
  assert.equal(mac.lane, 'tech');
  assert.equal(router.classify('Mac keeps crashing').area, 'desktop');
  assert.equal(router.classify('Mac keeps crashing').lane, 'tech');
  assert.equal(router.classify('macOS keeps crashing').area, 'desktop');
});

test('an order number does not override a device bug; a real order question still beats the app', () => {
  const off = router.classify('My Omi keeps turning itself off. Order #1042 if you need it.');
  assert.equal(off.area, 'firmware');
  assert.equal(off.lane, 'firmware');

  const where = router.classify('Where is my order? The Windows app shows nothing.');
  assert.equal(where.area, 'shop');
  assert.equal(where.lane, 'shop');

  const status = router.classify('What is the status of my order #5120? The iOS app is fine.');
  assert.equal(status.area, 'shop');
  assert.equal(status.lane, 'shop');

  const orderStatus = router.classify('What is the order status? The Windows app shows nothing.');
  assert.equal(orderStatus.area, 'shop');
  assert.equal(orderStatus.lane, 'shop');

  const android = router.classify(
    'The Android app crashes every time I open it. I got my order yesterday.'
  );
  assert.equal(android.area, 'app');
  const detail = router.classify('give detail for order no 21519');
  assert.equal(detail.lane, 'shop');
  assert.equal(router.skipModel(detail), true);
  assert.equal(android.lane, 'tech');

  const win = router.classify('The Windows app crashes. Order #9 if you need it.');
  assert.equal(win.area, 'desktop');
  assert.equal(win.lane, 'tech');

  assert.equal(router.classify('I got my order').area, 'unknown');
  assert.equal(router.classify('I received my order').area, 'unknown');
  assert.equal(router.classify('order #88').lane, 'shop');
  assert.equal(router.classify('order number 88').lane, 'shop');
  assert.equal(router.classify('order id 88').lane, 'shop');

  const refund = router.classify('My Omi keeps turning itself off. I want a refund.');
  assert.equal(refund.area, 'shop');
  assert.equal(refund.lane, 'money');
  const charged = router.classify('I was charged twice and the device keeps turning itself off.');
  assert.equal(charged.area, 'shop');
  assert.equal(charged.lane, 'money');
  const tax = router.classify('import tax and my Omi keeps turning itself off');
  assert.equal(tax.area, 'shop');
  assert.equal(tax.lane, 'money');
  const duties = router.classify('extra duties and the device keeps turning itself off');
  assert.equal(duties.area, 'shop');
  assert.equal(duties.lane, 'money');
});

test('a question that is not in a Latin script goes to the model, not an English bug report', () => {
  const q = '我的设备无法充电，指示灯不亮，已经插了一整晚';
  const route = router.classify(q);
  assert.equal(route.lane, 'faq');
  assert.equal(route.escalate, false);
  assert.equal(router.isTechLane(route), false);
  assert.equal(router.skipModel(route), false);
  const down = router.whenModelDown(route, q);
  assert.equal(down.agent.escalate, true);
  assert.match(down.reply, /language/i);
});

test('a refund written in another language still reaches a person', () => {
  const route = router.classify('请帮我 refund 这个订单，钱已经扣了两次');
  assert.equal(route.lane, 'money');
  assert.equal(route.escalate, true);
});

test('a refund names help@omi.me on the first reply and keeps the order number', () => {
  const q = 'Please refund Order #RUFKREEIX. We do not want the replacement.';
  const route = router.classify(q);
  assert.equal(route.lane, 'money');
  const reply = router.cannedReply(route, q);
  assert.match(reply, /help@omi\.me/);
  assert.match(reply, /RUFKREEIX/);
  assert.equal(/order made right/i.test(reply), false);
});

test('how to reset the device follows the help center, not an account wipe', () => {
  const q = 'How to reset an Omi device';
  const route = router.classify(q);
  assert.equal(route.lane, 'faq');
  assert.equal(route.escalate, false);
  const reply = router.cannedReply(route, q);
  assert.match(reply, /while still holding/);
  assert.match(reply, /6–8 hours/);
  assert.match(reply, /help\.omi\.me\/en\/articles\/12847359/);
  assert.equal(/which one|not sure|delete everything/i.test(reply), false);
  const crash = router.classify('I reset my Omi and the app still crashes');
  assert.equal(crash.lane, 'tech');
});
