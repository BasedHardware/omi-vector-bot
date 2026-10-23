const assert = require('node:assert/strict');
const test = require('node:test');
const {
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  presentReviewedAnswerWithEvidence,
  EMPTY_ANSWER_FALLBACK,
  addUnsyncedDataWarning,
  hasUnsyncedDataRisk,
  stripUnverifiedOrderClaims,
  UNSYNCED_DATA_WARNING,
} = require('../answerPipeline');

test('reviewed answers preserve legitimate conjunctions and link lines', () => {
  const answer = 'Or you can open Settings → Profile and pick your language.\nAnd if it still fails, send us the app version.\n[Omi guide](https://help.omi.me/guide)';
  const presented = presentReviewedAnswer(answer);
  assert.match(presented, /Or you can open Settings → Profile and pick your language\./);
  assert.match(presented, /And if it still fails, send us the app version\./);
  assert.match(presented, /\[Omi guide\]\(https:\/\/help\.omi\.me\/guide\)/);
  assert.match(presentReviewedAnswer(`There's a related change on GitHub; I can't confirm it fixes your case. https://github.com/BasedHardware/omi/pull/4500`), /omi\/pull\/4500/);
});

test('order replies remove unsupported customer-specific status but retain carrier steps', () => {
  const answer = [
    'Your order was delivered yesterday. It will arrive by Friday. The package is at the depot.',
    'Open the tracking link from the shipping email and contact the carrier about a missing parcel.',
    'Source: https://help.omi.me/en/articles/shipping',
  ].join('\n');
  const safe = stripUnverifiedOrderClaims(answer);
  assert.doesNotMatch(safe, /delivered yesterday|arrive by Friday|at the depot/i);
  assert.match(safe, /tracking link from the shipping email/i);
  assert.match(safe, /contact the carrier/i);
  assert.match(safe, /Source: https:\/\/help\.omi\.me/i);
  assert.equal(stripUnverifiedOrderClaims(answer, { verifiedLookup: true }), answer);
  assert.match(stripUnverifiedOrderClaims('If tracking shows delivered, contact the carrier.'), /contact the carrier/i);
  assert.equal(stripUnverifiedOrderClaims('Your Omi was delivered yesterday. Open the tracking link from the shipping email.'), 'Open the tracking link from the shipping email.');
});

test('unverified delivery status variants are removed but general and conditional advice remains', () => {
  for (const claim of [
    'Your package was marked as delivered on Monday.',
    'Your parcel is showing as shipped today.',
    'The shipment is listed as delivered.',
    'The carrier delivered it to your door.',
    'Your package is sitting at the depot.',
    'Your order was sitting with the carrier.',
    'It is sitting at customs.',
  ]) assert.equal(stripUnverifiedOrderClaims(claim), '', claim);
  for (const general of [
    'Tracking can show delivered before the package arrives.',
    'If it was marked delivered, check your tracking link.',
    'If the carrier delivered it to a neighbor, ask them to check.',
  ]) assert.equal(stripUnverifiedOrderClaims(general), general);
});

test('contractions and unverified depot or customs locations are stripped', () => {
  for (const claim of [
    "It's on its way.",
    'It is out for delivery.',
    "They're in transit.",
    'It has shipped.',
    "It's delivered.",
    'Your parcel is stuck at customs.',
    'The shipment has been held in a depot.',
    'The package is sitting at the sorting facility.',
    'It was stuck in the warehouse.',
  ]) assert.equal(stripUnverifiedOrderClaims(claim), '', claim);
  for (const general of [
    "If it's on its way, the tracking page should show it.",
    'If the package is held at customs, ask the carrier for details.',
    'Packages can be held at a sorting facility.',
  ]) assert.equal(stripUnverifiedOrderClaims(general), general, general);
});

test('sync stalls and missing conversations get a data-loss warning without the word offline', () => {
  for (const question of ['sync is stuck at 40%', 'lost my conversations after the update']) {
    const reply = addUnsyncedDataWarning('A person needs to check this.\n\nSource: https://help.omi.me/example', question);
    assert.match(reply, /unsynced/i);
    assert.match(reply, /do not reinstall|avoid reinstall/i);
    assert.match(reply, /Source: https:\/\/help\.omi\.me\/example/);
  }
  assert.equal(addUnsyncedDataWarning('Open the app.', 'How do I pair my Omi?'), 'Open the app.');
});

test('presentation preserves a sourced troubleshooting step after draft filtering', () => {
  const question = 'Why does my Omi keep disconnecting?';
  const draft = 'Try reconnecting Bluetooth from the Omi app.';
  const filtered = prepareDraftForReview(draft, 'tech', question);
  assert.doesNotMatch(filtered, /reconnecting Bluetooth/i);

  const reviewed =
    'The Help Center recommends reconnecting Bluetooth from the Omi app for this symptom.\n\nSource: https://help.omi.me/en/articles/example';
  const presented = presentReviewedAnswer(reviewed);
  assert.match(presented, /reconnecting Bluetooth from the Omi app/);
  assert.match(presented, /Source: https:\/\/help\.omi\.me\/en\/articles\/example/);
});

test('unsynced-data warning catches missing audio and conversations in varied wording', () => {
  for (const question of [
    'Nothing synced and my meeting audio vanished.',
    'I am losing recordings from the app.',
    'My conversations never showed up after recording.',
    'The memories are gone and I may have unsynced audio.',
  ]) {
    const reply = addUnsyncedDataWarning('A person needs to check this.', question);
    assert.match(reply, /Do not reinstall the app, log out, or clear Pending\/All/i, question);
  }
});

test('blank output after a real recording risks data loss, but transcript how-tos do not', () => {
  for (const question of [
    'I recorded my whole lecture and the transcript is blank',
    "The app shows an empty transcript for yesterday's two hour call",
    'Nothing was recorded during my meeting',
  ]) {
    assert.equal(hasUnsyncedDataRisk(question), true, question);
    assert.match(addUnsyncedDataWarning('I will check this.', question), /Do not reinstall/i);
  }
  for (const question of [
    'Where do I find the transcript of a conversation?',
    'Is there a transcript export?',
  ]) {
    assert.equal(hasUnsyncedDataRisk(question), false, question);
    assert.equal(addUnsyncedDataWarning('Open the app.', question), 'Open the app.');
  }
});

test('spoken sessions and spelled-out durations count as completed recordings', () => {
  for (const question of [
    'I talked through a whole meeting and there is no transcript at all',
    'I spoke for an hour and got zero audio',
    'I dictated notes all day but nothing was transcribed',
    'I said everything during the call and the transcript came back blank',
  ]) assert.equal(hasUnsyncedDataRisk(question), true, question);
  for (const question of [
    'where do I find the transcript of a conversation?',
    'is there a transcript export?',
    'how do I turn off recording?',
  ]) assert.equal(hasUnsyncedDataRisk(question), false, question);
});

test('the fixed English data-loss warning is never appended to a non-English reply', () => {
  const question = 'I recorded a lecture and the transcript is blank';
  const spanish = addUnsyncedDataWarning('La transcripción está vacía.', question, { language: 'es', dataLossRisk: true });
  assert.equal(spanish, 'La transcripción está vacía.');
  assert.match(addUnsyncedDataWarning('The transcript is blank.', question, { language: 'en', dataLossRisk: true }), /Do not reinstall/);
});

test('the presentation step does not prepend a saved staff note', () => {
  const answer = 'I cannot confirm a shipping date for this order.';
  assert.equal(presentReviewedAnswer(answer), answer);
});

test('an erased fixed claim is available to the reviewer as removed text', () => {
  const original = 'Yes, this has been fixed in the latest release.';
  const prepared = prepareDraftForReviewWithAudit(
    original,
    'unknown',
    'is the memories sync problem between phone and desktop fixed yet?'
  );
  assert.equal(prepared.draft, '');
  assert.deepEqual(prepared.removed, [original]);
  assert.equal(presentReviewedAnswer('  '), EMPTY_ANSWER_FALLBACK);
});

test('a long answer is clipped in its body and its source link stays whole', () => {
  const step = 'Open the Omi app, go to Settings, then Device, and check that the firmware shown is current. ';
  for (const source of [
    'Source: https://help.omi.me/en/articles/10401566-build-your-own-omi-device',
    'Fuente: https://help.omi.me/es/articles/10401566-build-your-own-omi-device https://docs.omi.me/doc/get_started/introduction',
  ]) {
    for (const repeats of [20, 24]) {
      const presented = presentReviewedAnswer(`${step.repeat(repeats).trim()}\n\n${source}`);
      assert.ok(presented.length <= 1900, String(presented.length));
      assert.ok(presented.endsWith(source), presented.slice(-100));
      assert.match(presented, /…\n+\S+: https:/u);
    }
  }
});

test('an answer that fits is not clipped, with or without a source line', () => {
  const step = 'Open the Omi app, go to Settings, then Device, and check that the firmware shown is current.';
  const sourced = presentReviewedAnswer(`${step}\n\nSource: https://help.omi.me/en/articles/10401566`);
  assert.ok(sourced.startsWith(step));
  assert.ok(sourced.endsWith('Source: https://help.omi.me/en/articles/10401566'));
  assert.equal(sourced.includes('…'), false);
  const long = presentReviewedAnswer(`${step} `.repeat(30));
  assert.ok(long.length <= 1900);
  assert.ok(long.endsWith('…'));
  assert.ok(long.slice(0, -2).endsWith(step));
});

test('overflow keeps whole numbered steps and their wrapped continuation lines', () => {
  const source = 'Source: https://help.omi.me/en/articles/recording-reference';
  const first = '1. Start the recording with the microphone button.';
  const continuation = '   Keep the app recording while the meeting is in progress.';
  const oversized = `2. ${'Review the transcript and make sure the meeting has finished. '.repeat(40)}`;
  const shown = presentReviewedAnswer(`${first}\n${continuation}\n${oversized}\n3. Open the summary.\n\n${source}`);
  assert.equal(shown, `${first}\n${continuation.trim()}\n…\n${source}`);
  assert.ok(shown.length <= 1900);
});

test('overflow never retains part of a bullet even when its first line fits', () => {
  const source = 'Fuente: https://help.omi.me/es/articles/recording-reference';
  const complete = '- Abre la conversación y revisa el resumen.';
  const shown = presentReviewedAnswer(`${complete}\n- Comprueba los detalles de la grabación.\n  ${'Espera a que termine el procesamiento. '.repeat(70)}\n- Guarda los cambios.\n\n${source}`);
  assert.equal(shown, `${complete}\n…\n${source}`);
  assert.doesNotMatch(shown, /Comprueba|procesamiento|Guarda/);
});

test('overflow clips prose at a whole sentence and does not split a word', () => {
  const sentence = 'Open the conversation and read its summary.';
  const shown = presentReviewedAnswer(`${sentence} ${'supercalifragilisticexpialidocious '.repeat(80)}`);
  assert.equal(shown, `${sentence}\n…`);
});

test('a first item too long to display is not partially shown and keeps complete sources', () => {
  const source = '来源：https://help.omi.me/en/articles/recording-reference';
  const shown = presentReviewedAnswer(`- ${'A single long checklist item with no safe item boundary. '.repeat(50)}\n\n${source}`);
  assert.ok(shown.length <= 1900);
  assert.ok(shown.endsWith(source));
  assert.doesNotMatch(shown, /checklist item/);
});

test('four long source URLs remain complete while numbered steps fit the shared reply limit', () => {
  const urls = [1, 2, 3, 4].map((part) => `https://help.omi.me/en/articles/${part}-${'official-guide-'.repeat(12)}`);
  const source = `Fuente: ${urls.join(' ')}`;
  const steps = [
    `1) Open the app and check the recording controls. ${'Read each control carefully. '.repeat(10)}`,
    `2) Review the completed conversation. ${'Read the transcript before continuing. '.repeat(10)}`,
    `3) Choose the appropriate language. ${'Check the saved choice before the meeting. '.repeat(30)}`,
  ];
  const shown = presentReviewedAnswer(`${steps.join('\n')}\n\n${source}`);
  assert.ok(shown.length <= 1900);
  assert.equal(shown, `${steps.slice(0, 2).map((step) => step.trim()).join('\n')}\n…\n${source}`);
  assert.equal((shown.match(/^Fuente:/gmu) || []).length, 1);
  for (const url of urls) assert.ok(shown.includes(url));
});

test('making room for the data-loss warning also keeps whole steps and complete sources', () => {
  const source = 'Source: https://help.omi.me/en/articles/recording-reference';
  const first = '1. Keep the existing recordings in place.';
  const oversized = `2. ${'Review the stored recording before continuing. '.repeat(50)}`;
  const shown = addUnsyncedDataWarning(`${first}\n${oversized}\n\n${source}`, 'The recording from my meeting is missing.');
  assert.equal(shown, `${first}\n…\n\n${UNSYNCED_DATA_WARNING}\n\n${source}`);
  assert.ok(shown.length <= 1750);
});

test('narration filtering removes only the unsupported clause and keeps symptoms and attempts', () => {
  const cases = [
    ['The sync stalls after the update; this needs a person who can look. What is your app version?', /sync stalls after the update\. What is your app version\?/],
    ['The light stays red after charging, but this one needs a person who can look.', /^The light stays red after charging\.$/],
    ['The app freezes on launch — this one needs a person who can look.', /^The app freezes on launch\.$/],
    ['Ich habe die App neu gestartet; this one needs a person who can look. Welche Version nutzt du?', /^Ich habe die App neu gestartet\. Welche Version nutzt du\?/],
    ['Needs a person who can look; I reinstalled the app twice.', /^I reinstalled the app twice\.$/],
  ];
  for (const [input, expected] of cases) {
    const out = presentReviewedAnswer(input);
    assert.match(out, expected, input);
    assert.doesNotMatch(out, /needs a person/i);
  }
});

test('narration filtering keeps citations and safety warnings beside removed narration', () => {
  const out = presentReviewedAnswer([
    `Do not clear Pending storage; this one needs a person who can look.`,
    'Source: https://help.omi.me/en/articles/sync',
  ].join('\n'));
  assert.match(out, /^Do not clear Pending storage\.\nSource: https:\/\/help\.omi\.me\/en\/articles\/sync$/);
  assert.match(presentReviewedAnswer('Do not reinstall the app; I have not pinged anyone.'), /^Do not reinstall the app\.$/);
});

test('a reply that is entirely narration falls back to an honest non-empty reply', () => {
  assert.equal(presentReviewedAnswer('This one needs a person; I have not pinged anyone.'), EMPTY_ANSWER_FALLBACK);
});

test('stage evidence traces which stage shortened a reply without exposing text', () => {
  const secret = 'ZZ-private-marker';
  const { answer, stages } = presentReviewedAnswerWithEvidence(`${secret} stalls; this one needs a person who can look.`);
  assert.deepEqual(stages.map((s) => s.stage), ['input', 'narration_filter', 'format', 'clip', 'final']);
  assert.ok(stages[1].length < stages[0].length);
  assert.equal(stages[1].changed, true);
  assert.equal(stages[3].clipped, false);
  assert.equal(stages[4].fallback, false);
  assert.match(answer, /ZZ-private-marker stalls\./);
  assert.doesNotMatch(JSON.stringify(stages), /ZZ-private|stalls/);
  const empty = presentReviewedAnswerWithEvidence('This one needs a person.');
  assert.equal(empty.stages.at(-1).fallback, true);
  const long = presentReviewedAnswerWithEvidence(`${'A full sentence here. '.repeat(200)}`);
  assert.equal(long.stages.find((s) => s.stage === 'clip').clipped, true);
});

test('support redirect stripping keeps earlier-attempt context and the application-owned footer', () => {
  const { escalateReply } = require('../utils');
  const sent = escalateReply('I already reinstalled the app; you can contact support for more help. What phone model do you use?', { pinged: true });
  assert.match(sent, /^I already reinstalled the app\. What phone model do you use\?\n\nA person on the team has this now\.$/);
  const comma = escalateReply('You restarted the device, but please email help@omi.me about it.', { pinged: true, replyInThread: true });
  assert.match(comma, /^You restarted the device\./);
  assert.doesNotMatch(comma, /help@omi\.me\b(?!.*\n\n)/s);
  const dash = escalateReply('Reinstalling did not help — contact support with the details.', { pinged: true });
  assert.match(dash, /^Reinstalling did not help\./);
  const failed = escalateReply('Ya reinstalé la app; contact support again.', { deliveryFailed: true });
  assert.match(failed, /^Ya reinstalé la app\.\n\nI could not deliver this to the support team/);
  const allGone = escalateReply('Contact support; email help@omi.me.', { pinged: true, conversation: true });
  assert.equal(allGone, 'A person on the team has this now.');
  assert.match(escalateReply('Contact support; email help@omi.me.', { pinged: true }), /^A person on the team has this now\.$/);
});
