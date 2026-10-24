const test = require('node:test');
const assert = require('node:assert/strict');
const utils = require('../utils');
const router = require('../router');

test('failed next-step feedback is reported, but hypothetical and navigation questions are not', () => {
  for (const text of ['It is still not working after those steps.', 'That did not work.', 'Sigue sin funcionar.', 'Los pasos no funcionan.']) {
    assert.equal(router.isFailedSupportFollowup(text), true, text);
  }
  for (const text of ['What if it is still not working?', 'I still cannot find where to change the language.', 'Thanks, those steps worked.']) {
    assert.equal(router.isFailedSupportFollowup(text), false, text);
  }
});

test('ordinary replies replace an email redirect with one truthful in-thread next step', () => {
  const result = utils.inThreadReply('Open Conversations. If you need help, email help@omi.me.\nSource: https://help.omi.me/synthetic-guide');
  assert.equal(result.empty, false);
  assert.match(result.text, /Open Conversations/);
  assert.match(result.text, /reply.*(?:here|thread)/i);
  assert.doesNotMatch(result.text, /help@omi\.me|has this|will reply|assigned/i);
  assert.ok(result.text.endsWith('Source: https://help.omi.me/synthetic-guide'));
  assert.equal(utils.inThreadReply(result.text).text, result.text, 'reprocessing adds no second next step');
});

test('redirect cleanup preserves independent context and safety clauses', () => {
  const text = 'The permission is already on; contact support. Do not clear local recordings; email help@omi.me.\nSource: https://help.omi.me/synthetic-guide';
  const cleaned = utils.stripSupportRedirect(text);
  assert.match(cleaned, /permission is already on/);
  assert.match(cleaned, /Do not clear local recordings/);
  assert.doesNotMatch(cleaned, /contact support|help@omi\.me/);
  assert.ok(cleaned.endsWith('Source: https://help.omi.me/synthetic-guide'));
});

for (const [language, answer, expected] of [
  ['es', 'Abre Conversaciones. Si necesitas ayuda, escribe a help@omi.me.', /responde.*hilo/i],
  ['zh', '打开对话列表。请发送邮件到 help@omi.me。', /在这个讨论串/],
]) test(`ordinary ${language} redirect replacement stays localized`, () => {
  const result = utils.inThreadReply(answer, { language });
  assert.equal(result.empty, false);
  assert.match(result.text, expected);
  assert.doesNotMatch(result.text, /help@omi\.me|reply here/i);
});

test('redirect-only output is not counted as a useful ordinary answer', () => {
  const result = utils.inThreadReply('Please email help@omi.me.\nSource: https://help.omi.me/synthetic-guide');
  assert.equal(result.empty, true);
});

test('normal answers and source URLs are unchanged, and real failed-delivery fallback remains', () => {
  const normal = 'Open the conversation.\n\nSource: https://help.omi.me/synthetic-guide';
  assert.equal(utils.inThreadReply(normal).text, normal);
  assert.match(utils.escalateReply('Keep the app installed.', { deliveryFailed: true }), /email help@omi\.me/);
  const protective = 'Never email your verification code to help@omi.me.';
  assert.equal(utils.stripSupportRedirect(protective), protective);
});

test('unrecognized language keys use English copy, never inherited object properties', () => {
  for (const language of ['unknown', '__proto__', 'constructor']) {
    const result = utils.inThreadReply('Open Conversations. Email help@omi.me.', { language });
    assert.match(result.text, /reply here in this thread/);
    assert.doesNotMatch(result.text, /\[object Object\]|function Object/);
  }
});

test('contact wording variants preserve a joined protective warning and earlier emailed context', () => {
  const text = 'Open Conversations. Send an email to help@omi.me and do not clear local recordings. Email team@basedhardware.com. You already emailed support yesterday.';
  const result = utils.inThreadReply(text);
  assert.match(result.text, /do not clear local recordings/i);
  assert.match(result.text, /already emailed support yesterday/i);
  assert.doesNotMatch(result.text, /help@omi\.me|team@basedhardware\.com/);
});

for (const [language, body, contact, next] of [
  ['fr', 'Ouvrez la fiche du rendez-vous.', 'Notre adresse pour la suite est help@omi.me.', /répondez ici dans ce fil/],
  ['de', 'Wähle den gewünschten Eintrag aus.', 'Für weitere Fragen lautet die Adresse team@basedhardware.com.', /antworte hier in diesem Thread/],
  ['ja', '一覧から予定を開きます。', 'お問い合わせ先は help@omi.me です。', /このスレッドに返信/],
  ['pt', 'Selecione o item salvo.', 'O endereço de atendimento é team@basedhardware.com.', /responda aqui nesta conversa/],
]) {
  const source = 'Source: https://help.omi.me/synthetic-guide';
  const answer = `${body} ${contact}\n${source}`;
  test(`${language} support-address clauses leave an ordinary in-thread next step`, () => {
    const result = utils.inThreadReply(answer, { language });
    assert.equal(result.empty, false);
    assert.ok(result.text.includes(body));
    assert.match(result.text, next);
    assert.doesNotMatch(result.text, /help@omi\.me|team@basedhardware\.com/i);
    assert.ok(result.text.endsWith(source));
  });
  test(`${language} delivered handoffs have no competing support-address route`, () => {
    const result = utils.escalateReply(answer, { pinged: true, replyInThread: true });
    assert.ok(result.includes(body));
    assert.ok(result.includes(source));
    assert.doesNotMatch(result, /help@omi\.me|team@basedhardware\.com/i);
    assert.match(result, /will reply in this thread/);
  });
}

test('address-based stripping keeps Source lines and existing secret-sharing warnings', () => {
  const text = [
    'Never share your verification code with help@omi.me.',
    'No compartas tu código con team@basedhardware.com.',
    '不要发送验证码到 help@omi.me。',
    'Source: https://help.omi.me/synthetic-guide?contact=help@omi.me',
  ].join('\n');
  assert.equal(utils.stripSupportRedirect(text), text);
  const failed = utils.escalateReply('O endereço de atendimento é team@basedhardware.com.', { deliveryFailed: true });
  assert.match(failed, /could not deliver this to the support team/i);
  assert.equal((failed.match(/help@omi\.me/g) || []).length, 1);
  assert.doesNotMatch(failed, /team@basedhardware\.com|will reply in this thread/i);
});

test('retaining intake details cannot reintroduce a stripped support address', () => {
  const result = utils.inThreadReply('Keep the view open. Contact support and include team@basedhardware.com in the message.');
  assert.match(result.text, /Keep the view open/);
  assert.doesNotMatch(result.text, /team@basedhardware\.com/);
  assert.match(result.text, /reply here/);
});

for (const label of ['Sources:', '出典:', '出典：', 'Srot:', 'स्रोत:', 'Fontes:', '來源：']) {
  test(`${label} remains a source, not an address redirect or a useful answer`, () => {
    const source = `${label} https://help.omi.me/synthetic-guide?contact=help@omi.me`;
    assert.equal(utils.stripSupportRedirect(source), source);
    const answer = utils.inThreadReply(`Abra a lista salva. Atendimento: team@basedhardware.com.\n${source}`, { language: 'pt' });
    assert.ok(answer.text.endsWith(source));
    assert.match(answer.text, /Abra a lista salva/);
    assert.doesNotMatch(answer.text, /team@basedhardware\.com/);
    const sourceOnly = utils.inThreadReply(`窓口は help@omi.me です。\n${label} https://help.omi.me/synthetic-guide`, { language: 'ja' });
    assert.equal(sourceOnly.empty, true);
    assert.equal(sourceOnly.text, `${label} https://help.omi.me/synthetic-guide`);
    const delivered = utils.escalateReply(`窓口は help@omi.me です。\n${source}`, { pinged: true, replyInThread: true });
    assert.ok(delivered.includes(source));
    assert.match(delivered, /will reply in this thread/);
  });
}
