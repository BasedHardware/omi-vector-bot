const assert = require('node:assert/strict');
const test = require('node:test');
const github = require('../github');

test('draftFromQuestion never uses shop or privacy labels', () => {
  const draft = github.draftFromQuestion('macOS settings crash on launch', 'desktop');
  assert.match(draft.title, /macOS/);
  assert.equal(draft.labels.includes('vector'), true);
  assert.equal(draft.labels.includes('desktop'), true);
  assert.equal(github.draftFromQuestion('refund', 'shop').labels.includes('shop'), false);
});

test('searchIssues returns the first open hit', async () => {
  const prev = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghs_test';
  const fetchImpl = async (url) => {
    assert.match(String(url), /search\/issues/);
    assert.match(String(url), /BasedHardware%2Fomi|BasedHardware\/omi/);
    return {
      ok: true,
      json: async () => ({
        items: [{ number: 5917, title: 'macOS Device Settings', html_url: 'https://github.com/BasedHardware/omi/issues/5917' }],
      }),
    };
  };
  const hit = await github.searchIssues('macOS Device Settings unreachable', { fetchImpl });
  assert.equal(hit.ok, true);
  assert.equal(hit.duplicate.number, 5917);
  if (prev === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = prev;
});

test('createIssue posts to the repo', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const fetchImpl = async (url, opts) => {
    assert.match(String(url), /repos\/BasedHardware\/omi\/issues/);
    assert.equal(opts.method, 'POST');
    return {
      ok: true,
      status: 201,
      json: async () => ({ number: 42, html_url: 'https://github.com/BasedHardware/omi/issues/42' }),
    };
  };
  const created = await github.createIssue({ title: 'Bug', body: 'From Discord', labels: ['vector'] }, { fetchImpl });
  assert.equal(created.ok, true);
  assert.equal(created.number, 42);
  delete process.env.GITHUB_TOKEN;
});

test('webhook signature and closed/merged lines; never implies /done', () => {
  const secret = 'whsec';
  const body = '{"ok":true}';
  const crypto = require('node:crypto');
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  assert.equal(github.verifyWebhook(body, sig, secret), true);
  assert.equal(github.verifyWebhook(body, 'sha256=dead', secret), false);

  const closed = github.describeWebhookEvent({ action: 'closed', issue: { number: 9 } });
  assert.equal(closed.line, '#9 was closed.');
  assert.equal(/done/i.test(closed.line), false);

  const merged = github.describeWebhookEvent({
    action: 'closed',
    pull_request: { number: 12, merged: true, title: 'fix', body: 'Closes #9' },
  });
  assert.equal(merged.line, '#9 was merged.');
  assert.equal(merged.numbers.includes(9), true);
});

test('issue-thread map is used for webhook targets', () => {
  github.resetGithubMemory();
  github.linkIssueThread(9, 'thread-1');
  assert.deepEqual(github.threadsForIssue(9), ['thread-1']);
  github.resetGithubMemory();
});
