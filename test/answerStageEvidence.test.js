const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../answerStageEvidence');
const pipeline = require('../answerPipeline');

test('real draft and presentation functions expose text-free transitions only inside an explicit collection', async () => {
  const draft = 'The device detail needs review; contact support. Which app version do you use?';
  const plain = pipeline.prepareDraftForReviewWithAudit(draft, 'tech', 'The app closes.');
  const collector = evidence.createStageEvidence();
  const value = await collector.run(() => {
    const prepared = pipeline.prepareDraftForReviewWithAudit(draft, 'tech', 'The app closes.');
    return pipeline.presentReviewedAnswer(prepared.draft);
  });
  assert.equal(value, pipeline.presentReviewedAnswer(plain.draft));
  const records = collector.snapshot().records;
  for (const stage of ['draft_input', 'draft_safety', 'presentation_input', 'presentation_filtered', 'clip_input', 'clip_output', 'presentation_output']) {
    assert.ok(records.some(row => row.stage === stage), stage);
  }
  assert.doesNotMatch(JSON.stringify(collector.snapshot()), /device detail|contact support|app version|The app closes/);
});

test('fingerprints compare within one collection but cannot be joined across collections', async () => {
  const a = evidence.createStageEvidence(), b = evidence.createStageEvidence();
  const run = collector => collector.run(() => {
    evidence.recordStage('generated', 'SYNTHETIC_PRIVATE_VALUE');
    evidence.recordStage('review_selected', 'SYNTHETIC_PRIVATE_VALUE');
  });
  await run(a); await run(b);
  const first = a.snapshot().records, second = b.snapshot().records;
  assert.equal(first[0].fingerprint, first[1].fingerprint);
  assert.notEqual(first[0].fingerprint, second[0].fingerprint);
  assert.match(first[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(first[0]).sort(), ['bytes','chars','fingerprint','lines','stage']);
  assert.doesNotMatch(JSON.stringify(a.snapshot()), /SYNTHETIC|PRIVATE|key|secret/);
});

test('concurrent collectors remain isolated, bounded and closed to late asynchronous work', async () => {
  const a = evidence.createStageEvidence({ maxRecords: 2 }), b = evidence.createStageEvidence();
  let release, late;
  const barrier = new Promise(resolve => { release = resolve; });
  await Promise.all([
    a.run(async () => {
      evidence.recordStage('generated', 'first');
      late = barrier.then(() => evidence.recordStage('send_payload', 'late'));
      evidence.recordStage('review_selected', 'first');
      evidence.recordStage('send_payload', 'overflow');
      evidence.recordStage('UNTRUSTED_CUSTOMER_TEXT', 'ignored');
    }),
    b.run(async () => { await Promise.resolve(); evidence.recordStage('generated', 'second'); }),
  ]);
  release(); await late;
  evidence.recordStage('generated', 'outside');
  assert.equal(a.snapshot().records.length, 2);
  assert.equal(a.snapshot().truncated, true);
  assert.equal(b.snapshot().records.length, 1);
  assert.equal(b.snapshot().truncated, false);
  const snapshot = b.snapshot(); snapshot.records[0].stage = 'mutated';
  assert.equal(b.snapshot().records[0].stage, 'generated');
});

test('collection preserves operation results and exceptions and does not stringify unexpected input', async () => {
  const collector = evidence.createStageEvidence();
  const expected = Error('synthetic operation failure');
  await assert.rejects(collector.run(() => {
    evidence.recordStage('generated', { toString: () => { throw Error('must not inspect objects'); } });
    throw expected;
  }), error => error === expected);
  assert.deepEqual(collector.snapshot().records, []);
});

test('the actual reviewer exposes parsed model output separately from technical safety', async () => {
  const { reviewAnswer } = require('../commandcode');
  const collector = evidence.createStageEvidence();
  const text = 'The screen closes unexpectedly. Reinstall the app.';
  const reviewed = await collector.run(async () => {
    evidence.recordStage('generated', text);
    return reviewAnswer({ question: 'The settings screen closes.', draft: text, lane: 'tech',
      sources: '[S1 | Official Help Center]\nhttps://help.omi.me/en/articles/synthetic-screen\nThe screen shows settings.',
      understanding: { replyLanguage: 'en' },
      post: async () => ({ data: { choices: [{ message: { content: JSON.stringify({
        final_answer: text, grounded: true, relevant: true, sources_used: ['S1'],
      }) } }] } }),
    });
  });
  assert.doesNotMatch(reviewed.final_answer, /Reinstall the app/);
  const records = collector.snapshot().records;
  assert.equal(records.find(row => row.stage === 'generated').fingerprint,
    records.find(row => row.stage === 'review_parsed').fingerprint);
  assert.notEqual(records.find(row => row.stage === 'review_parsed').fingerprint,
    records.find(row => row.stage === 'review_safety').fingerprint);
});

test('real clipping records shortening while preserving the existing source output', async () => {
  const collector = evidence.createStageEvidence();
  const source = 'https://help.omi.me/en/articles/synthetic-presentation';
  const text = 'One complete useful sentence. '.repeat(100) + '\nSource: ' + source;
  const actual = await collector.run(() => pipeline.fitPublicReply({ text }, 300));
  assert.equal(actual, pipeline.fitPublicReply({ text }, 300));
  assert.ok(actual.length <= 300);
  assert.ok(actual.includes(source));
  const records = collector.snapshot().records;
  assert.ok(records[0].chars > records[1].chars);
  assert.notEqual(records[0].fingerprint, records[1].fingerprint);
});
