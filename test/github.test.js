const assert = require('node:assert/strict');
const test = require('node:test');
const github = require('../github');

test('GitHub App env is enough to be configured; a personal token is not required', () => {
  const prev = {
    token: process.env.GITHUB_TOKEN,
    id: process.env.GITHUB_APP_ID,
    inst: process.env.GITHUB_APP_INSTALLATION_ID,
    key: process.env.GITHUB_APP_PRIVATE_KEY,
  };
  delete process.env.GITHUB_TOKEN;
  process.env.GITHUB_APP_ID = '1';
  process.env.GITHUB_APP_INSTALLATION_ID = '2';
  process.env.GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----';
  try {
    assert.equal(github.isAppConfigured(), true);
    assert.equal(github.isConfigured(), true);
  } finally {
    if (prev.token === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prev.token;
    if (prev.id === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = prev.id;
    if (prev.inst === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
    else process.env.GITHUB_APP_INSTALLATION_ID = prev.inst;
    if (prev.key === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = prev.key;
  }
});

test('draftFromQuestion never uses shop or privacy labels', () => {
  const draft = github.draftFromQuestion('macOS settings crash on launch', 'desktop');
  assert.match(draft.title, /macOS/);
  assert.equal(draft.labels.includes('vector'), true);
  assert.equal(draft.labels.includes('desktop'), true);
  assert.equal(github.draftFromQuestion('refund', 'shop').labels.includes('shop'), false);
  const named = github.draftFromQuestion(
    'Just got omi\nnpm error ERESOLVE\nomi-windows@1.0.35',
    'desktop',
    { topic: 'omi-windows ERESOLVE', labels: ['desktop', 'tech'] }
  );
  assert.equal(named.title, 'omi-windows ERESOLVE');
  assert.match(named.body, /What they wrote/);
  const card = github.formatIssueCard(named);
  assert.match(card.title, /ERESOLVE/);
  const labelField = card.fields.find((f) => f.name === 'Labels').value;
  assert.match(labelField, /desktop/);
  assert.equal(/vector/i.test(labelField), false);
  assert.equal(named.labels.includes('vector'), true);
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
  let posted;
  const fetchImpl = async (url, opts) => {
    assert.match(String(url), /repos\/BasedHardware\/omi\/issues/);
    assert.equal(opts.method, 'POST');
    posted = JSON.parse(opts.body);
    return {
      ok: true,
      status: 201,
      json: async () => ({ number: 42, html_url: 'https://github.com/BasedHardware/omi/issues/42' }),
    };
  };
  const created = await github.createIssue(
    { title: 'Bug', body: 'From Discord', labels: ['vector'], threadId: '1550182642874589194' },
    { fetchImpl }
  );
  assert.equal(created.ok, true);
  assert.equal(created.number, 42);
  assert.match(posted.body, /vector-thread:1550182642874589194/);
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

test('thread markers survive in issue bodies and webhook events', () => {
  const marked = github.withThreadMarker('Reported in Discord.', '1550182642874589194');
  assert.match(marked, /<!-- vector-thread:1550182642874589194 -->/);
  assert.deepEqual(github.parseThreadIds(marked), ['1550182642874589194']);

  const opened = github.describeWebhookEvent({
    action: 'opened',
    issue: { number: 9, body: marked },
  });
  assert.equal(opened.line, '#9 was opened.');
  assert.deepEqual(opened.threadIds, ['1550182642874589194']);

  const reopened = github.describeWebhookEvent({
    action: 'reopened',
    issue: { number: 9, body: marked },
  });
  assert.equal(reopened.line, '#9 was reopened.');

  const note = github.describeWebhookEvent({
    action: 'created',
    issue: { number: 9, body: marked },
    comment: { body: 'looking now', user: { login: 'mdmohsin7', type: 'User' } },
  });
  assert.equal(note.line, 'A note was added on #9.');
  assert.equal(/looking now/i.test(note.line), false);
  assert.deepEqual(note.threadIds, ['1550182642874589194']);

  const skipped = github.describeWebhookEvent({
    action: 'created',
    issue: { number: 9, body: marked },
    comment: { body: '<!-- vector-thread:1 -->', user: { login: 'bot', type: 'Bot' } },
  });
  assert.equal(skipped, null);
});

test('shop ticket card is not a GitHub issue', () => {
  const card = github.formatShopTicketCard({
    title: 'import tax on order #20716',
    labels: ['shop', 'money'],
  });
  assert.match(card.title, /import tax/i);
  assert.match(card.fields.find((f) => f.name === 'Labels').value, /shop/);
  assert.match(card.fields.find((f) => f.name === 'GitHub').value, /Not a GitHub issue/);
  const draft = github.draftFromQuestion('import tax on order #20716', 'shop', {
    labels: ['shop', 'money'],
  });
  assert.equal(draft.labels.includes('shop'), false);
  assert.equal(draft.labels.includes('money'), false);
});

test('an open pull request in the message is told to the customer and not called fixed', async () => {
  const q = [
    'Once again, I cannot delete memories or conversations on either the desktop app or the mobile app.',
    'https://github.com/BasedHardware/omi/pull/14691',
  ].join('\n');
  const refs = github.linkedChanges(q);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].number, '14691');
  assert.equal(refs[0].kind, 'pull');
  const fromCard = github.textFromEmbeds([
    {
      title: 'fix(backend): make memory & conversation deletion work again',
      url: 'https://github.com/BasedHardware/omi/pull/14691',
      description: 'Desktop errors, mobile comes back.',
    },
  ]);
  assert.match(github.linkedChanges(fromCard)[0].url, /14691/);
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/pulls\/14691$/);
    return {
      ok: true,
      json: async () => ({ state: 'open', merged: false, html_url: refs[0].url }),
    };
  };
  const lookup = await github.lookupChange(refs[0], { fetchImpl });
  const sentence = github.customerChangeSentence(refs[0], lookup, {
    question: q,
    title: 'fix(backend): make memory & conversation deletion work again on desktop and mobile',
  });
  assert.match(sentence, /14691/);
  assert.match(sentence, /already open/i);
  assert.match(sentence, /review it and merge it/i);
  assert.match(sentence, /has not shipped/i);
  assert.match(sentence, /desktop error and the phone deletions/i);
  assert.equal(/half[- ]solved|\bfixed\b|been merged|already been solved/i.test(sentence), false);
  const merged = github.customerChangeSentence(refs[0], { ok: true, state: 'merged' });
  assert.match(merged, /has been merged/i);
  const missed = github.customerChangeSentence(refs[0], { ok: false });
  assert.match(missed, /cannot see whether it shipped/i);
  assert.match(missed, /14691/);
});

test('pull search prefers the deletion pull over a memories search pull', () => {
  const q = 'Once again, I cannot delete memories or conversations on either the desktop app or the mobile app. The desktop app gives me an error and the mobile app shows them deleted and then they resurface 30 seconds later.';
  const wrong = { number: 11743, title: 'Windows search: find anything across conversations, memories, tasks and screen' };
  const right = {
    number: 14691,
    title: 'fix(backend): make memory & conversation deletion work again on desktop and mobile',
  };
  assert.equal(github.scorePull(q, wrong), 0);
  assert.ok(github.scorePull(q, right) >= 4);
  const partial = github.customerChangeSentence(
    { number: '9', url: 'https://github.com/BasedHardware/omi/pull/9', title: 'fix desktop delete' },
    { ok: true, state: 'open' },
    { question: q, title: 'fix desktop delete' }
  );
  assert.match(partial, /desktop part/i);
  assert.match(partial, /phone part is not/i);
});
