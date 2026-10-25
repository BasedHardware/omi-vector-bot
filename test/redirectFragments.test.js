const test = require('node:test');
const assert = require('node:assert/strict');
const {stripSupportRedirect, inThreadReply, escalateReply} = require('../utils');

test('a redirect cannot leave its pronoun-subject explanation after a semicolon', () => {
  for (const [lead, tail] of [
    ['Contact Omi support', 'they will identify the right setting'],
    ['Write to help@omi.me', 'that provides the next update'],
    ['Contact support', 'it is the recommended route'],
  ]) assert.equal(stripSupportRedirect(`${lead}; ${tail}.`), '');
});

test('an orphaned following sentence is removed across lines of the same paragraph', () => {
  assert.equal(stripSupportRedirect('Write to help@omi.me.\nThose are the people who can answer.\nThat would settle the question.'), '');
  assert.equal(stripSupportRedirect('Contact Omi support.\n\nThe capture still ends early.'), 'The capture still ends early.');
});

test('supported localized references cannot survive the removed contact clause', () => {
  for (const text of [
    'Écrivez à help@omi.me ; ils pourront préciser la suite.',
    'Schreiben Sie an help@omi.me; das ist der passende Weg.',
    'Escribe a help@omi.me. Ellos pueden orientarte.',
    'Envie a help@omi.me. Isso resolve a dúvida.',
    'help@omi.me に連絡してください。それが次の窓口です。',
  ]) assert.equal(stripSupportRedirect(text), '', text);
});

test('independent nouns, prior customer attempts, warnings and Source lines stay', () => {
  const source = 'Source: https://docs.omi.me/synthetic-reference';
  const input = `You already retried the transfer. Email help@omi.me; The duration remains zero.\nDo not share private keys with anyone.\n${source}`;
  assert.equal(stripSupportRedirect(input), `You already retried the transfer. The duration remains zero.\nDo not share private keys with anyone.\n${source}`);
  assert.equal(stripSupportRedirect('Email help@omi.me; You already retried the transfer.'), 'You already retried the transfer.');
});

test('following references with their own instruction, link or warning remain', () => {
  for (const following of [
    'You can open the saved conversation.',
    'This is documented at https://docs.omi.me/synthetic-reference.',
    'Those recordings must not be deleted.',
  ]) assert.equal(stripSupportRedirect(`Email help@omi.me. ${following}`), following);
});

test('ordinary and delivered-handoff formatting use the same cleaned body', () => {
  assert.equal(inThreadReply('Write to help@omi.me; they will advise you.').empty, true);
  assert.equal(escalateReply('Write to help@omi.me; they will advise you.', {pinged:true,replyInThread:true}), 'A person on the team has this now and will reply in this thread.');
});

test('unknown language falls back conservatively and unrelated formatting is unchanged', () => {
  assert.equal(stripSupportRedirect('Email help@omi.me; An unknown-language clause follows.', {language:'xx'}), '');
  assert.equal(stripSupportRedirect('Email help@omi.me; Do not share private keys.', {language:'xx'}), 'Do not share private keys.');
  const normal = '  - First complete sentence.   Another complete sentence.\n続きです。別の文です。';
  assert.equal(stripSupportRedirect(normal), normal.trim());
});

test('Markdown cannot conceal a removed-reference subject and joined warnings survive', () => {
  assert.equal(stripSupportRedirect('Email help@omi.me. **They** can clarify the options.'), '');
  assert.equal(stripSupportRedirect('Contact support; _That_ is the next route.'), '');
  assert.equal(stripSupportRedirect('Email help@omi.me; Those recordings must not be deleted.'), 'Those recordings must not be deleted.');
  assert.equal(stripSupportRedirect('Email help@omi.me. वे अगला चरण समझाएँगे।', {language:'hi-Deva'}), '');
});

test('risk/consequence warnings and Markdown instructions retain their own useful meaning', () => {
  for (const warning of [
    'These actions may irreversibly erase unsent audio.',
    'Those unsent clips could be lost forever.',
    'Those pending clips will be lost for good.',
    'These actions would delete the unsent clips.',
    'Cela peut supprimer les fichiers locaux.',
    'Eso puede eliminar los archivos locales.',
  ]) {
    for (const joint of ['; ', '. ']) assert.equal(stripSupportRedirect(`Email help@omi.me${joint}${warning}`), warning);
  }
  const step = 'This time, you can **open** the saved entry.';
  assert.equal(stripSupportRedirect(`Email help@omi.me. ${step}`), step);
});

test('describing a support topic is not itself a protective consequence warning', () => {
  for (const tail of ['They process deletion tickets.', 'Those are the staff who investigate data loss.']) {
    assert.equal(stripSupportRedirect(`Contact support; ${tail}`), '');
  }
});
