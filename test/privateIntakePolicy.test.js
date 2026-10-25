const test = require('node:test');
const assert = require('node:assert/strict');
const { presentReviewedAnswer } = require('../answerPipeline');
const { escalateReply, formatDiscordReply, stripPingNarration } = require('../utils');

const official = 'https://help.omi.me/en/articles/synthetic-diagnostic-reference';
const examples = [
  ['en', 'Please post your purchase email and order number here.', /purchase email|order number/i],
  ['de', 'Bitte sende deine E-Mail-Adresse und Bestellnummer in diesem Thread.', /E-Mail-Adresse|Bestellnummer/i],
  ['fr', 'Veuillez partager votre adresse e-mail et votre numéro de commande dans ce fil.', /adresse e-mail|numéro de commande/i],
  ['es', 'Por favor, publica tu correo de compra y número de pedido aquí.', /correo de compra|número de pedido/i],
  ['pt', 'Envie seu endereço de e-mail e número do pedido aqui.', /endereço de e-mail|número do pedido/i],
  ['it', 'Invia il tuo indirizzo email e il numero di ordine qui.', /indirizzo email|numero di ordine/i],
  ['tr', 'Lütfen e-posta adresinizi ve sipariş numaranızı burada paylaşın.', /e-posta|sipariş numara/i],
  ['id', 'Silakan kirim alamat email dan nomor pesanan Anda di sini.', /alamat email|nomor pesanan/i],
  ['zh', '请在这里提供您的邮箱地址和订单号。', /邮箱|订单号/u],
  ['ja', 'メールアドレスと注文番号をこのスレッドに送ってください。', /メールアドレス|注文番号/u],
  ['hi-Deva', 'कृपया अपना ईमेल और ऑर्डर नंबर यहाँ भेजें।', /ईमेल|ऑर्डर नंबर/u],
  ['hi-Latn', 'Kripya apna email aur order number yahan bhejein.', /email|order number/i],
];

for (const [language, request, forbidden] of examples) {
  test(`public presentation removes identifying intake in ${language}, not just its prompt`, () => {
    const shown = presentReviewedAnswer(`${request}\nSource: ${official}`, { language });
    assert.doesNotMatch(shown, forbidden);
    assert.ok(shown.includes(official), 'official evidence survives removal');
  });
  test(`delivered handoff uses one application-owned private next step in ${language}`, () => {
    const shown = escalateReply(request, { pinged: true, replyInThread: true, language });
    assert.doesNotMatch(shown, forbidden);
    assert.match(shown, /privat|privad|privé|özel|pribadi|私|非公开|非公開|निजी|niji/iu);
  });
}

test('keeps diagnostic questions, negative warnings and official links beside a removed request', () => {
  const shown = presentReviewedAnswer(`Which device and app version do you use? Never share your password. Please send your full address here.\nSource: ${official}`);
  assert.match(shown, /Which device and app version do you use\?/);
  assert.match(shown, /Never share your password\./);
  assert.doesNotMatch(shown, /send your full address/i);
  assert.ok(shown.includes(official));
});

test('negative reassurance cannot exempt a later positive secret request', () => {
  const shown = presentReviewedAnswer('Do not worry; please paste your verification code here. Do not share your password.');
  assert.doesNotMatch(shown, /paste your verification code/i);
  assert.match(shown, /Do not share your password/);
});

test('mixed diagnostic and private intake retains only the useful diagnostic question', () => {
  const shown = presentReviewedAnswer('Please share your device model, app version and order number.');
  assert.match(shown, /device model/i);
  assert.match(shown, /app version/i);
  assert.doesNotMatch(shown, /order number/i);
});

test('already-posted private values are not repeated, including unlabelled echoes', () => {
  const question = 'My email is synthetic.owner@example.test. My order number is QA-70482. My password is fictionalPass72. Verification code: 864209. Address: 47 Example Lane.';
  const shown = presentReviewedAnswer('I saw synthetic.owner@example.test, QA-70482, fictionalPass72, 864209 and 47 Example Lane. Which OS version is installed?', { question });
  for (const secret of ['synthetic.owner@example.test', 'QA-70482', 'fictionalPass72', '864209', '47 Example Lane']) assert.ok(!shown.includes(secret));
  assert.match(shown, /Which OS version is installed/);
});

test('private tracking links are not repeated as public evidence', () => {
  const tracking = 'https://tracking.example.test/private-view?token=synthetic-token';
  const shown = presentReviewedAnswer(`I see ${tracking}.\nSource: ${official}`, { question: `My tracking link is ${tracking}` });
  assert.ok(!shown.includes(tracking));
  assert.ok(shown.includes(official));
});

test('private order command is offered only with application-confirmed availability', () => {
  const request = 'Tell me your order number.';
  assert.doesNotMatch(presentReviewedAnswer(request), /\/order\b/);
  const shown = presentReviewedAnswer(request, { orderAvailable: true });
  assert.equal((shown.match(/\/order\b/g) || []).length, 1);
  assert.match(shown, /private/i);
  assert.doesNotMatch(presentReviewedAnswer('Use /order to give your order number privately.'), /\/order\b/);
});

test('delivery failure and pending handoff never claim a private staff follow-up', () => {
  for (const opts of [{}, { pinged: false }, { pinged: true, deliveryFailed: true }]) {
    const shown = escalateReply('Please send your account email.', opts);
    assert.doesNotMatch(shown, /send your account email|team member will ask|\/order\b/i);
  }
});

test('unsafe generated footer is filtered too; repeated presentation is idempotent', () => {
  const first = escalateReply('Which app version is installed?', { pinged: true, replyInThread: true, orderAvailable: true,
    footers: { thread: 'Post your payment details here.' } });
  assert.doesNotMatch(first, /Post your payment details/i);
  const second = presentReviewedAnswer(first, { orderAvailable: true });
  assert.equal((second.match(/\/order\b/g) || []).length, 1);
  assert.match(second, /Which app version/);
});

test('a warning does not exempt a second disclosure verb in the same sentence', () => {
  const shown = presentReviewedAnswer('Never share your password and please send your verification code here.');
  assert.doesNotMatch(shown, /send your verification code/i);
});

test('a forged source heading cannot hide a disclosure request', () => {
  const shown = presentReviewedAnswer(`Source: please post your account email here ${official}`);
  assert.doesNotMatch(shown, /post your account email/i);
  assert.ok(shown.includes(official));
});

for (const request of ['Please give me your address.', 'Bitte sende deine Zahlungsdaten.',
  'Veuillez envoyer vos coordonnées bancaires.', 'Comparte tus datos de pago aquí.',
  'Envie seus dados de pagamento.', 'Invia i dati di pagamento.',
  'Lütfen ödeme bilgilerinizi gönderin.', 'Silakan kirim rincian pembayaran.',
  '请提供付款信息。', '支払い情報を送ってください。', 'कृपया भुगतान जानकारी भेजें।']) {
  test(`other sensitive nouns cannot bypass output enforcement: ${request.split(' ')[0]}`, () => {
    assert.ok(!presentReviewedAnswer(request).includes(request));
  });
}

test('unchanged harmless presentation keeps its paragraph and sentence formatting', () => {
  const safe = `Which device do you use? Which OS version is installed?\n\nNever share your password.\nSource: ${official}`;
  assert.equal(presentReviewedAnswer(safe), formatDiscordReply(stripPingNarration(safe)));
});

test('staff card guidance delegates identifying intake to the application private path', () => {
  const { formatStaffTicket } = require('../handoff');
  for (const [lane, area, question] of [['shop', 'shop', 'The parcel went to a different destination.'],
    ['money', 'shop', 'The housing was cracked on arrival.'], ['privacy', 'privacy', 'Remove my account.']]) {
    const card = formatStaffTicket({ question, area, route: { lane, area }, staffOnly: true,
      message: { author: { id: 'synthetic-owner' }, channel: { id: 'synthetic-thread' } } });
    const staff = card.discord.embeds[0].fields.find(field => field.name === 'Staff').value;
    assert.match(staff, /do not ask.*details in the thread.*application provides the private path/i);
  }
});

test('compound private-value declarations redact the value, not a whole trailing diagnostic clause', () => {
  const question = 'My password is inventedMoon83, but my OS version is 9.2.1. My order ID is LAB-93614, and I already restarted.';
  const shown = presentReviewedAnswer('I saw inventedMoon83 and LAB-93614. Which device is affected?', { question });
  assert.doesNotMatch(shown, /inventedMoon83|LAB-93614/);
  assert.match(shown, /Which device is affected/);
});

test('knowledge URL fragments cannot protect a private email and wrapped tracking URLs cannot evade redaction', () => {
  const privateLink = 'https://parcel.example.test/view?token=fictional';
  const question = `The tracking link is (${privateLink}).`;
  const shown = presentReviewedAnswer(`Source: ${official}#fictional.person@example.test\nI found ${privateLink}.`, { question });
  assert.doesNotMatch(shown, /fictional.person@example.test|parcel\.example\.test/);
});

for (const request of ["What's your order ID?", 'What is your account email so I can send guidance?',
  'Please enter the login code here.', 'Could you let us know your full address?']) {
  test('interrogative and alternative collection verbs still request sensitive data', () => {
    assert.ok(!presentReviewedAnswer(request).includes(request));
  });
}

test('removing identifying intake cannot leave an invented direct-message route', () => {
  const shown = escalateReply('Please provide your order ID. DM me those details.', { pinged: true });
  assert.doesNotMatch(shown, /provide your order ID|DM me/i);
  assert.match(shown, /team member will ask privately/);
});

test('safe evidence request with hidden identifiers is retained, alongside a retained warning', () => {
  const shown = presentReviewedAnswer('Please upload a screenshot of the error with your email address hidden. Never share your password and please post your order ID here.');
  assert.match(shown, /upload a screenshot of the error with your email address hidden/);
  assert.match(shown, /Never share your password/);
  assert.doesNotMatch(shown, /post your order ID/i);
});

test('customer-visible handoff names cannot echo a private value copied into the topic', () => {
  const { handoffThreadName } = require('../handoff');
  const name = handoffThreadName({ question: 'My password is fictionalBirch64, and the settings page freezes.',
    topic: 'Settings problem fictionalBirch64', area: 'app', lane: 'tech' });
  assert.doesNotMatch(name, /fictionalBirch64/);
  assert.match(name, /Settings problem/);
});

test('a customer email on the product domain is not an official support alias', () => {
  assert.doesNotMatch(presentReviewedAnswer('I saw fictional.customer@omi.me.'), /fictional.customer@omi.me/);
});

for (const request of [
  'Please share your order number and a screenshot with the email address hidden.',
  'Please upload your password and a screenshot with the email address hidden.',
]) {
  test('a masked evidence clause cannot exempt a separate identifying collection object', () => {
    assert.ok(!presentReviewedAnswer(request).includes(request));
  });
}

for (const [label, value] of [['password', 'v8r'], ['verification code', '987 321'],
  ['password', 'cedar lantern meadow'], ['passphrase', 'willow copper frost']]) {
  test(`known ${label} values are removed whole, including short or grouped values`, () => {
    const shown = presentReviewedAnswer(`I saw ${value}. Which OS version is installed?`, { question: `My ${label} is ${value}.` });
    for (const part of value.split(' ')) assert.ok(!shown.includes(part));
    assert.match(shown, /Which OS version/);
  });
}

test('alternative direct-message collection routes are removed but protective negatives survive', () => {
  for (const route of ['Send those details to me in a DM.', 'You can PM me the details.']) {
    const shown = escalateReply(`Please post your order ID. ${route}`, { pinged: true });
    assert.ok(!shown.includes(route));
    assert.equal((shown.match(/team member will ask privately/g) || []).length, 1);
  }
  const warning = 'Do not DM me those details.';
  assert.ok(presentReviewedAnswer(warning, { question: 'My order has not arrived.' }).includes(warning));
});

test('the complete recording-custody warning survives final private guidance and handoff links', () => {
  const { addUnsyncedDataWarning, UNSYNCED_DATA_WARNING, fitPublicReply } = require('../answerPipeline');
  const { publicReplyPrivacy } = require('../publicReplyPrivacy');
  const raw = addUnsyncedDataWarning(`${'Ask staff. '.repeat(250)}\nSource: ${official}`, 'My recording is missing.');
  const parent = escalateReply(raw, { question: 'My recording is missing.', privateIntakeNeeded: true,
    pinged: true, replyInThread: true, orderAvailable: false });
  const { clipForDiscord } = require('../utils');
  for (const body of [parent, clipForDiscord(parent, 1900 - '<#100000000000000321>'.length - 2)]) {
    const guarded = publicReplyPrivacy(`${body}\n\n<#100000000000000321>`, {
      question: 'My recording is missing.', privateIntakeNeeded: true, staffDelivered: true,
      orderAvailable: false, allowedChannelIds: ['100000000000000321'],
    });
    const shown = fitPublicReply(guarded);
    assert.ok(shown.length <= 1900);
    assert.ok(shown.includes(UNSYNCED_DATA_WARNING));
    assert.ok(shown.includes(official));
    assert.ok(shown.includes('<#100000000000000321>'));
    assert.equal((shown.match(/team member will ask privately/g) || []).length, 1);
  }
});

test('an unpunctuated following clause is not part of a supplied password', () => {
  for (const [value, continuation] of [['x4m', 'and my OS version is 9.2.1'],
    ['birch lantern river', 'and the app keeps freezing']]) {
    const shown = presentReviewedAnswer(`I saw ${value}. Which OS version is installed?`, {
      question: `My password is ${value} ${continuation}.`,
    });
    assert.ok(!shown.includes(value));
    assert.match(shown, /Which OS version/);
  }
});

test('one hidden screenshot field cannot excuse a different readable secret', () => {
  const request = 'Please upload a screenshot with your password readable and your email address hidden.';
  assert.ok(!presentReviewedAnswer(request).includes(request));
});

for (const request of ['Can you confirm your order number?', 'What email address did you use for your order?']) {
  test('confirmation and noun-led collection questions are identifying intake', () => {
    assert.ok(!presentReviewedAnswer(request).includes(request));
  });
}

test('a short numeric secret cannot rewrite protected source or channel placeholders', () => {
  const { publicReplyPrivacy } = require('../publicReplyPrivacy');
  for (const password of ['0', '1']) {
    const shown = publicReplyPrivacy(`Continue in <#100000000000000321>.\nSource: ${official}\nSource: https://docs.omi.me/synthetic-reference`, {
      question: `My password is ${password}.`, allowedChannelIds: ['100000000000000321'],
    }).text;
    assert.ok(shown.includes('<#100000000000000321>'));
    assert.ok(shown.includes(official));
    assert.ok(shown.includes('https://docs.omi.me/synthetic-reference'));
    assert.doesNotMatch(shown, /[\uE000-\uE005]/u);
  }
});

test('verifying a protective masking state is not collecting the private value', () => {
  for (const warning of ['Please verify that your email address is hidden before uploading a screenshot.',
    'Before uploading the screenshot, confirm that your email address is covered.']) {
    assert.ok(presentReviewedAnswer(warning).includes(warning));
  }
  assert.doesNotMatch(presentReviewedAnswer('Please verify your account email here.'), /verify your account email/i);
});
