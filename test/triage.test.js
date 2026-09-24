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

test('import tax on an order is a shop ticket, not GitHub', () => {
  const q = 'import tax on order #20716';
  const merged = triage.merge(router.classify(q), { file_issue: true, topic: 'tax' }, q);
  assert.equal(merged.area, 'shop');
  assert.equal(merged.lane, 'money');
  assert.equal(merged.fileIssue, false);
  assert.equal(triage.wantsShopTicket(merged), true);
  assert.match(merged.topic, /tax|order #20716/i);
  const privacy = triage.merge(router.classify('delete my data'), {}, 'delete my data');
  assert.equal(triage.wantsShopTicket(privacy), false);
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

test('a docs question stays faq when the model calls it shop', () => {
  const q = 'Are there any instructions or documentation on this feature? How it works and how it\'s different from paying for a paid plan?';
  const merged = triage.merge(
    router.classify(q),
    {
      area: 'shop',
      lane: 'account',
      labels: ['faq', 'account', 'shop'],
      topic: 'Feature docs vs paid plan unclear',
      escalate: true,
    },
    q
  );
  assert.equal(merged.lane, 'faq');
  assert.equal(merged.area, 'unknown');
  assert.equal(merged.labels.includes('shop'), false);
  assert.equal(merged.labels.includes('account'), false);
  assert.equal(merged.labels.includes('faq'), true);
  assert.equal(merged.escalate, false);
  assert.equal(merged.fileIssue, false);
});

test('capture and transcription stays off shop when the model calls it an account', () => {
  const q = "in order to pair, device doesn't capture and transcription is unavailable";
  const merged = triage.merge(
    router.classify(q),
    {
      area: 'shop',
      lane: 'account',
      labels: ['shop', 'account', 'money'],
      topic: 'Account shop takeover',
    },
    q
  );
  assert.equal(merged.area, 'unknown');
  assert.equal(merged.lane, 'faq');
  assert.equal(merged.topic, 'Transcription unavailable, device not capturing');
  assert.equal(merged.labels.includes('shop'), false);
  assert.equal(merged.labels.includes('account'), false);
  assert.equal(merged.labels.includes('money'), false);
  assert.equal(merged.labels.includes('faq'), true);
  assert.equal(merged.fileIssue, false);
});
