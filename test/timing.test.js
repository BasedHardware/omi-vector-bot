const assert = require('node:assert/strict');
const test = require('node:test');
const { newUsageCounters, addStageUsage, timingLogLine } = require('../timing');

test('one timing line contains stage durations and token counts but no supplied text', () => {
  const usage = newUsageCounters();
  addStageUsage(usage, { stage: 'planner', completionTokens: 19, reasoningTokens: 4, customerText: 'private question' });
  addStageUsage(usage, { stage: 'planner', completionTokens: 11, reasoningTokens: 2 });
  addStageUsage(usage, { stage: 'answer', completionTokens: 40, reasoningTokens: 30 });
  addStageUsage(usage, { stage: 'review', completionTokens: null, reasoningTokens: null });
  const line = timingLogLine({ planner: 10.6, retrieval: 4, answer: 20, review: 8, total: 45 }, usage);
  assert.equal(line, '[Timing] planner_ms=11 retrieval_ms=4 answer_ms=20 review_ms=8 total_ms=45 planner_completion_tokens=30 planner_reasoning_tokens=6 answer_completion_tokens=40 answer_reasoning_tokens=30 review_completion_tokens=na review_reasoning_tokens=na');
  assert.doesNotMatch(line, /private question/);
});
