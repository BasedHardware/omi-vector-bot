// Evaluation/test only: no process event, logger, database or environment switch.
// The ephemeral key never leaves a collection; hashes are not cross-run IDs.
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomBytes, createHmac } = require('node:crypto');
const context = new AsyncLocalStorage();
const STAGES = new Set(['generated', 'draft_input', 'draft_safety', 'review_parsed',
  'review_safety', 'review_returned', 'review_selected', 'presentation_input',
  'presentation_filtered', 'presentation_output', 'clip_input', 'clip_output',
  'handoff_input', 'handoff_output', 'send_input', 'send_payload']);

function recordStage(stage, text) {
  const state = context.getStore();
  if (!state?.active || !STAGES.has(stage) || typeof text !== 'string') return text;
  if (state.records.length >= state.maxRecords || text.length > 131072) {
    state.truncated = true;
    return text;
  }
  state.records.push({ stage, chars: text.length, bytes: Buffer.byteLength(text, 'utf8'),
    lines: text ? text.split('\n').length : 0,
    fingerprint: createHmac('sha256', state.key).update(text, 'utf8').digest('hex') });
  return text;
}

function createStageEvidence({ maxRecords = 64 } = {}) {
  const state = { active: false, key: randomBytes(32), records: [], truncated: false,
    maxRecords: Number.isInteger(maxRecords) ? Math.max(1, Math.min(64, maxRecords)) : 64 };
  let used = false;
  return {
    async run(operation) {
      if (used) throw Error('Stage evidence collection already used');
      used = true;
      state.active = true;
      try { return await context.run(state, operation); }
      finally { state.active = false; state.key.fill(0); }
    },
    snapshot: () => ({ version: 1, records: state.records.map(row => ({ ...row })), truncated: state.truncated }),
  };
}

module.exports = { createStageEvidence, recordStage };
