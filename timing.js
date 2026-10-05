const TOKEN_STAGES = ['planner', 'answer', 'review'];

function newUsageCounters() {
  return Object.fromEntries(TOKEN_STAGES.map((stage) => [stage, {
    completion: 0, reasoning: 0, completionKnown: true, reasoningKnown: true,
  }]));
}

function addStageUsage(counters, event) {
  if (!event || !Object.hasOwn(counters, event.stage)) return;
  const bucket = counters[event.stage];
  for (const [field, value] of [
    ['completion', event.completionTokens],
    ['reasoning', event.reasoningTokens],
  ]) {
    if (value == null || !Number.isFinite(Number(value))) bucket[`${field}Known`] = false;
    else bucket[field] += Math.max(0, Number(value));
  }
}

function timingLogLine(stages, usage) {
  const milliseconds = (value) => Math.max(0, Math.round(Number(value) || 0));
  const tokenCount = (bucket, field) => bucket?.[`${field}Known`] === false
    ? 'na'
    : Math.max(0, Math.round(Number(bucket?.[field]) || 0));
  return [
    '[Timing]',
    ...['planner', 'retrieval', 'answer', 'review', 'total'].map((stage) => `${stage}_ms=${milliseconds(stages[stage])}`),
    ...TOKEN_STAGES.flatMap((stage) => [
      `${stage}_completion_tokens=${tokenCount(usage[stage], 'completion')}`,
      `${stage}_reasoning_tokens=${tokenCount(usage[stage], 'reasoning')}`,
    ]),
  ].join(' ');
}

module.exports = { newUsageCounters, addStageUsage, timingLogLine };
