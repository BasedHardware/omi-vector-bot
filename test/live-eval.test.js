const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCaseLine, loadCasesFile, judge, summarize } = require('../scripts/live-eval');
const { hasTroubleshootingStep } = require('../supportSteps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('held-out cases accept only structural fields and ignore answer-specific expectations', () => {
  const scene = parseCaseLine(JSON.stringify({ id: 'external-1', ask: 'How does this work?', first: 'answer', must: ['secret'] }));
  assert.equal(scene.heldout, true);
  assert.deepEqual(judge(scene, 'A sourced explanation. Source: https://help.omi.me/example', false, 'faq'), []);
  assert.throws(() => parseCaseLine('{"id":"bad","first":"person"}'), /requires ask/);
});

test('held-out JSONL must live outside the repository', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omi-eval-test-'));
  const file = path.join(dir, 'cases.jsonl');
  try {
    fs.writeFileSync(file, '{"id":"external-1","ask":"How does this work?","first":"answer"}\n');
    assert.equal(loadCasesFile(file, path.resolve(__dirname, '..')).length, 1);
    assert.throws(() => loadCasesFile(path.join(__dirname, 'live-eval.test.js'), path.resolve(__dirname, '..')), /outside the repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('eval citation check shares the production instruction definition', () => {
  assert.equal(hasTroubleshootingStep('The app keeps the conversation open so a person can check.'), false);
  assert.equal(hasTroubleshootingStep('You can check Battery Optimization.'), true);
  assert.equal(hasTroubleshootingStep('If the problem continues, restart the app.'), true);
  assert.equal(hasTroubleshootingStep('When sync is stuck, do a factory reset.'), true);
  const scene = { id: 'step', first: 'answer', heldout: true };
  assert.deepEqual(judge(scene, 'The app keeps the conversation open so a person can check.', false, 'tech'), []);
  assert.match(judge(scene, 'You can check Battery Optimization.', false, 'tech').join(' '), /step without official/i);
  assert.match(judge(scene, 'If the problem continues, restart the app.', false, 'tech').join(' '), /step without official/i);
});

test('three-run scoring accepts two passes and lists that case as flaky', () => {
  const rows = [
    { id: 'a', run: 1, pass: true, latencyMs: 10, timings: { planner: 1, total: 10 } },
    { id: 'a', run: 2, pass: false, latencyMs: 20, timings: { planner: 2, total: 20 } },
    { id: 'a', run: 3, pass: true, latencyMs: 30, timings: { planner: 3, total: 30 } },
  ];
  const summary = summarize(rows, 3);
  assert.deepEqual(summary.pass, ['a']);
  assert.deepEqual(summary.flaky, ['a']);
  assert.deepEqual(summary.fail, []);
  assert.deepEqual(summary.latency.planner, { p50: 2, p95: 3 });
});
