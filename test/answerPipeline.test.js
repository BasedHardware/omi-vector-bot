const assert = require('node:assert/strict');
const test = require('node:test');
const {
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  EMPTY_ANSWER_FALLBACK,
  addUnsyncedDataWarning,
} = require('../answerPipeline');

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
