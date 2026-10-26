const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCaseLine, loadCasesFile, judge, summarize, captureModelUsage, evaluationDocsEvidence } = require('../scripts/live-eval');

test('live-eval keeps per-call model usage next to stage timings', () => {
  const state = { timings: { planner: 10 }, modelCalls: [] };
  captureModelUsage(state, { stage: 'planner', model: 'test-model', promptTokens: 30, completionTokens: 12, reasoningTokens: 4 });
  assert.deepEqual(state.modelCalls, [{ stage: 'planner', model: 'test-model', promptTokens: 30, completionTokens: 12, reasoningTokens: 4 }]);
});
const { hasTroubleshootingStep } = require('../supportSteps');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('optional stage-evidence harness uses the same operation and preserves metadata after a failure', async () => {
  const { withTurnEvidence } = require('../scripts/live-eval');
  const stageModule = require('../answerStageEvidence');
  const state = {};
  const failure = Error('synthetic failure');
  await assert.rejects(withTurnEvidence(state, () => {
    stageModule.recordStage('generated', 'synthetic secret');
    throw failure;
  }, { enabled: true, stageModule, turn: 2 }), error => error === failure);
  assert.equal(state.stageEvidenceStatus, 'captured');
  assert.equal(state.stageEvidence.length, 1);
  assert.equal(state.stageEvidence[0].turn, 2);
  assert.doesNotMatch(JSON.stringify(state), /synthetic secret/);
  const disabled = {}, absent = {};
  assert.equal(await withTurnEvidence(disabled, () => 'same bytes', { stageModule }), 'same bytes');
  assert.equal(disabled.stageEvidenceStatus, 'disabled');
  assert.equal(disabled.stageEvidence, undefined);
  assert.equal(await withTurnEvidence(absent, () => 7, { enabled: true }), 7);
  assert.equal(absent.stageEvidenceStatus, 'unavailable');
});

test('comparison instrumentation captures only actual escalation lines in the current case', () => {
  const { captureEscalation } = require('../scripts/live-eval');
  const first = { escalationSignals: [] }, second = { escalationSignals: [] };
  const line = '[Bot] Escalating channel=synthetic area=app signals=reported-failure';
  captureEscalation(first, [line]);
  captureEscalation(second, ['[Bot] unrelated log']);
  captureEscalation(null, [line]);
  assert.deepEqual(first.escalationSignals, [line]);
  assert.deepEqual(second.escalationSignals, []);
});

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

test('multi-part live evidence uses one joint corpus while ordinary lookup keeps later Help Center blocks', () => {
  const parts = ['recording', 'language', 'summaries', 'deletion'].map(question => ({ question, query: question }));
  const calls = [];
  const chunks = [{ url: 'https://help.omi.me/en/articles/fixture-guide', body: 'Fixture guidance' }];
  const docs = '[Documentation blocks]\n' + 'D'.repeat(9000);
  const help = '[Help Center blocks]\n' + 'H'.repeat(8000);
  const retrieval = {
    normalizeSubQuestions: subQuestions => subQuestions || [],
    jointMultipartEvidence: (...args) => { calls.push(args); return 'joint coverage'; },
    supportQueries: () => ['neutral query'], rankLocalChunks: () => chunks,
    formatEvidence: () => help, combineEvidence: (...blocks) => blocks.join('\n\n'),
  };
  const options = { queries: parts.map(part => part.query), subQuestions: parts };
  assert.equal(evaluationDocsEvidence(retrieval, 'A multi-part request', options, docs, chunks), 'joint coverage');
  assert.deepEqual(calls[0], ['A multi-part request', docs, chunks, options]);
  const ordinary = evaluationDocsEvidence(retrieval, 'One ordinary request', {}, docs, chunks);
  assert.ok(ordinary.length > 17000);
  assert.ok(ordinary.includes('[Help Center blocks]'));
  assert.equal(calls.length, 1, 'ordinary evidence must not be re-budgeted or merged through multipart policy');
});

test('ordinary evaluation evidence forwards only actual retrieved metadata, not prose links', () => {
  const retrieval = require('../retrieval');
  const source = 'https://docs.omi.me/synthetic-task-guide';
  const help = 'https://help.omi.me/en/articles/synthetic-task-guide';
  const urls = [];
  evaluationDocsEvidence(retrieval, 'Task list', {
    sourceUrls: [source], onSources: selected => urls.push(...selected),
  }, retrieval.formatEvidence([{ url: source, title: 'Tasks', body: 'Task list https://docs.omi.me/synthetic-not-fetched' }]),
  [{ url: help, title: 'Task list', body: 'Task list guidance.', source: 'help' }]);
  assert.deepEqual([...new Set(urls)].sort(), [source, help].sort());
});
