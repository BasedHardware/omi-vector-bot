const assert = require('node:assert/strict');
const test = require('node:test');
const {
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  addUnsyncedDataWarning,
  EMPTY_ANSWER_FALLBACK,
} = require('../answerPipeline');

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

test('offline sync failures always carry the data-preservation warning', () => {
  const question = "I recorded offline all day and now it's stuck syncing at 12%";
  const answer = 'The recordings should sync when the phone is online.\n\nSource: https://help.omi.me/en/articles/123';
  const warned = addUnsyncedDataWarning(answer, question);
  assert.match(warned, /do not reinstall the app, log out, or clear Pending\/All storage/i);
  assert.ok(warned.indexOf('do not reinstall') < warned.indexOf('Source:'));
  assert.equal(addUnsyncedDataWarning(warned, question), warned);
  assert.equal(addUnsyncedDataWarning(answer, 'Can I record offline and sync later?'), answer);
});
