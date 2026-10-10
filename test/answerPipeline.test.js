const assert = require('node:assert/strict');
const test = require('node:test');
const {
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  EMPTY_ANSWER_FALLBACK,
  addUnsyncedDataWarning,
  hasUnsyncedDataRisk,
  stripUnverifiedOrderClaims,
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
  assert.equal(long.length, 1900);
  assert.ok(long.endsWith('…'));
});
