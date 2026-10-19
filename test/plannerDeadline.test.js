const test = require('node:test');
const assert = require('node:assert/strict');
const { runPlannerWithDeadline, PLANNER_DEADLINE_MS } = require('../plannerDeadline');

function clock() {
  const timers = [];
  return { timers, setTimer(callback, delay) {
    const timer = { callback, delay, unreferenced: false, cleared: false, unref() { this.unreferenced = true; } };
    timers.push(timer); return timer;
  }, clearTimer(timer) { timer.cleared = true; } };
}

test('planner deadline aborts a hung transport after twenty seconds without waiting for it', async () => {
  const c = clock(); let signal, resolveLate;
  const operation = runPlannerWithDeadline(options => {
    signal = options.signal;
    return new Promise(resolve => { resolveLate = resolve; });
  }, c);
  const rejected = assert.rejects(operation, error => error.code === 'PLANNER_DEADLINE');
  await Promise.resolve();
  assert.equal(PLANNER_DEADLINE_MS, 20000);
  assert.equal(c.timers[0].delay, 20000);
  assert.equal(c.timers[0].unreferenced, true);
  c.timers[0].callback();
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(c.timers[0].cleared, true);
  resolveLate({ unsafeLatePlan: true });
  await Promise.resolve();
});

test('a completed planner clears its timer and a late callback cannot abort or replace it', async () => {
  const c = clock(); let signal;
  const plan = { standaloneQuestion: 'Synthetic question', queries: ['synthetic query'] };
  assert.equal(await runPlannerWithDeadline(options => { signal = options.signal; return plan; }, c), plan);
  assert.equal(c.timers[0].cleared, true);
  c.timers[0].callback();
  assert.equal(signal.aborted, false);
});

test('planner rejection clears the deadline and keeps the failure for the existing fallback', async () => {
  const c = clock(), failure = Object.assign(new Error('synthetic provider failure'), { response: { status: 429 } });
  await assert.rejects(runPlannerWithDeadline(() => { throw failure; }, c), error => error === failure);
  assert.equal(c.timers[0].cleared, true);
});
