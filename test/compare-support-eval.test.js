const test = require('node:test');
const assert = require('node:assert/strict');
const row = (id, run, pass, handoff, reply = 'One useful next step.') => ({ id, run, pass, handoff, reply,
  turnReplies: [reply], escalationSignals: [], problems: pass ? [] : ['unwanted handoff'], latencyMs: run * 100 });

test('comparison includes every run of a changed case with verbatim replies, signals and problems', () => {
  const { compareResults } = require('../scripts/compare-support-eval');
  const main = { rows: [row('same', 1, true, false), row('changed', 1, false, true, 'Original\n\nreply.'), row('changed', 2, true, false)] };
  main.rows[1].escalationSignals = ['[Bot] Escalating channel=fixture area=app signals=reported-failure'];
  const candidate = { rows: [row('same', 1, true, false), row('changed', 1, true, false, 'Shorter reply.'), row('changed', 2, true, false)] };
  const result = compareResults(main, candidate);
  assert.equal(result.cases.length, 1);
  assert.equal(result.cases[0].id, 'changed');
  assert.equal(result.cases[0].runs.length, 2);
  assert.equal(result.cases[0].runs[0].main.reply, 'Original\n\nreply.');
  assert.deepEqual(result.cases[0].runs[0].main.problems, ['unwanted handoff']);
  assert.deepEqual(result.cases[0].runs[0].main.escalationSignals, main.rows[1].escalationSignals);
  assert.equal(result.cases[0].runs[0].candidate.signalCoverage, 'captured');
});

test('comparison refuses missing/duplicate rows and preserves unscored outcomes instead of inventing passes', () => {
  const { compareResults } = require('../scripts/compare-support-eval');
  const main = { rows: [row('a', 1, true, false)] };
  assert.throws(() => compareResults(main, { rows: [] }), /same case\/run/);
  assert.throws(() => compareResults(main, { rows: [main.rows[0], main.rows[0]] }), /duplicate/i);
  const unavailable = { ...row('a', 1, null, false), invalid: true };
  delete unavailable.escalationSignals;
  const result = compareResults(main, { rows: [unavailable] });
  assert.equal(result.summary.candidate.unscoredCases, 1);
  assert.equal(result.cases[0].runs[0].candidate.signalCoverage, 'unavailable');
  assert.equal(result.summary.readyForGrading, false);
});

test('word counts include each delivered turn, handle non-Latin text, and report empty replies separately', () => {
  const { compareResults, wordCount } = require('../scripts/compare-support-eval');
  assert.equal(wordCount('Open the app. https://help.omi.me/en/example'), 4);
  assert.ok(wordCount('打开应用，然后选择录音。') > 1);
  const arm = { rows: [row('a', 1, true, false, 'One two three'), row('b', 1, true, false, '')] };
  arm.rows[0].turnReplies = ['One two', 'One two three'];
  const { wordCounts } = compareResults(arm, arm);
  assert.deepEqual(wordCounts.main.deliveredTurns, { count: 2, median: 2, p90: 3 });
  assert.equal(wordCounts.main.emptyTurns, 1);
});
