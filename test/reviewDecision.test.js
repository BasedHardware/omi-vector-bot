const assert = require('node:assert/strict');
const test = require('node:test');
const { approvedReview, reviewWithSecondLook } = require('../reviewDecision');

const reviewArgs = {
  question: 'How do I change this setting?',
  draft: 'Open the app settings.',
  sources: '[S1 | Help Center]\nhttps://help.omi.me/settings\nChange the setting.',
};

function result(finalAnswer, grounded, relevant, extra = {}) {
  return { final_answer: finalAnswer, grounded, relevant, ...extra };
}

test('a rejected first review gets one provider-default second look and uses an approved answer', async () => {
  const calls = [];
  const logs = [];
  const first = result('Unrelated draft.', true, false);
  const second = result('Open the app settings.', true, true);
  const chosen = await reviewWithSecondLook(reviewArgs, {
    review: async (args) => { calls.push(args); return calls.length === 1 ? first : second; },
    log: (line) => logs.push(line),
  });
  assert.equal(chosen, second);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].reasoningEffort, undefined);
  assert.equal(calls[1].reasoningEffort, null);
  assert.deepEqual({ ...calls[1], reasoningEffort: undefined }, { ...calls[0], reasoningEffort: undefined });
  assert.deepEqual(logs, ['[Review] second look approved=true']);
});

test('two rejected reviews keep the existing fallback decision', async () => {
  const first = result('Unrelated draft.', false, true);
  const second = result('Still unsupported.', true, false);
  const logs = [];
  let calls = 0;
  const chosen = await reviewWithSecondLook(reviewArgs, {
    review: async () => (++calls === 1 ? first : second),
    log: (line) => logs.push(line),
  });
  assert.equal(chosen, first);
  assert.equal(approvedReview(chosen), false);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ['[Review] second look approved=false']);
});

test('a thrown second review preserves the caller error path', async () => {
  let calls = 0;
  const logs = [];
  await assert.rejects(() => reviewWithSecondLook(reviewArgs, {
    review: async () => {
      calls += 1;
      if (calls === 1) return result('', true, true);
      throw new Error('review unavailable');
    },
    log: (line) => logs.push(line),
  }), /review unavailable/);
  assert.equal(calls, 2);
  assert.deepEqual(logs, ['[Review] second look approved=false']);
});

test('a thrown first review is not retried', async () => {
  let calls = 0;
  const logs = [];
  await assert.rejects(() => reviewWithSecondLook(reviewArgs, {
    review: async () => { calls += 1; throw new Error('first review unavailable'); },
    log: (line) => logs.push(line),
  }), /first review unavailable/);
  assert.equal(calls, 1);
  assert.deepEqual(logs, []);
});

test('an approved first review never gets a second look', async () => {
  const approved = result('Open the app settings.', true, true);
  let calls = 0;
  const logs = [];
  const chosen = await reviewWithSecondLook(reviewArgs, {
    review: async () => { calls += 1; return approved; },
    log: (line) => logs.push(line),
  });
  assert.equal(chosen, approved);
  assert.equal(calls, 1);
  assert.deepEqual(logs, []);
});

test('the safe-handoff review never gets a second look', async () => {
  const handoff = result('A person needs to check this.', false, false, { safeHandoff: true });
  let calls = 0;
  const logs = [];
  const chosen = await reviewWithSecondLook(reviewArgs, {
    review: async () => { calls += 1; return handoff; },
    log: (line) => logs.push(line),
  });
  assert.equal(chosen, handoff);
  assert.equal(calls, 1);
  assert.deepEqual(logs, []);
});
