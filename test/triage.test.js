const assert = require('node:assert/strict');
const test = require('node:test');
const triage = require('../triage');
const router = require('../router');

test('sanitizeTopic drops greetings and keeps the problem', () => {
  assert.equal(triage.sanitizeTopic('Hi, I just got my omi'), '');
  assert.match(triage.sanitizeTopic('fair use warning after one day'), /fair use/i);
  assert.equal(triage.sanitizeTopic('Handoff · needs-human · hello').length > 0, true);
});

test('merge names fair-use tickets without needs-human', () => {
  const q = [
    'Just got omi in the mail on Wed and was like nintendo kid excited.',
    'A) FAIR USE WARNING',
    'B) FILLED the memory. What are all these plans?',
  ].join('\n');
  const merged = triage.merge(router.classify(q), {
    topic: 'fair use warning and plans',
    labels: ['account', 'shop'],
    area: 'shop',
    lane: 'account',
    escalate: true,
    file_issue: false,
  }, q);
  assert.equal(merged.area, 'shop');
  assert.equal(merged.lane, 'account');
  assert.equal(merged.fileIssue, false);
  assert.equal(merged.labels.includes('needs-human'), false);
  assert.match(merged.topic, /fair use/i);
  assert.equal(/nintendo/i.test(merged.topic), false);
});

test('merge will not file a refund as a GitHub issue', () => {
  const q = 'I want a refund';
  const merged = triage.merge(router.classify(q), { file_issue: true, topic: 'refund' }, q);
  assert.equal(merged.fileIssue, false);
  assert.equal(merged.lane, 'money');
});

test('merge files a desktop npm bug and keeps a short topic', () => {
  const q = 'npm error ERESOLVE\nWhile resolving: omi-windows@1.0.35';
  const merged = triage.merge(router.classify(q), {
    topic: 'omi-windows ERESOLVE',
    labels: ['desktop', 'tech'],
    area: 'desktop',
    lane: 'tech',
    file_issue: true,
  }, q);
  assert.equal(merged.area, 'desktop');
  assert.equal(merged.fileIssue, true);
  assert.equal(merged.topic, 'omi-windows ERESOLVE');
});
