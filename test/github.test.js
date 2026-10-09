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
  const formatted = github.issueBody({
    technicalSummary: 'There is 2 min conversation but it shows 40+ min.',
    reason: 'Cannot see the phone app from chat',
    threadUrl: 'https://discord.com/channels/1/2',
    related: [{ title: 'compute conversation duration from transcript', url: 'https://github.com/BasedHardware/omi/pull/7528', state: 'merged' }],
  });
  assert.doesNotMatch(formatted, /discord\.com|Discord thread:/);
  assert.match(formatted, /40\+ min/);
  assert.match(formatted, /#7528|pull\/7528/);
  assert.match(formatted, /still a problem after those changes/);
  const withPhoto = github.issueBody({
    quote: 'It is not charging.',
    reason: 'Device stopped charging.',
    files: [{ name: 'photo.jpg', url: 'https://cdn.discordapp.com/attachments/1/2/photo.jpg', type: 'image/jpeg' }],
  });
  assert.match(withPhoto, /Attachments in Discord: 1/);
  assert.doesNotMatch(withPhoto, /cdn\.discordapp\.com/);
  assert.equal(github.isImportantLead('thanks'), false);
  assert.equal(github.isImportantLead('what should I do?'), false);
  assert.equal(github.isImportantLead('It charged on Monday and the light never comes on now.'), true);
  assert.equal(github.isImportantLead('ok', [{ name: 'clip.mp4', url: 'https://cdn.example/clip.mp4', type: 'video/mp4' }]), true);
  const openCharging = github.issueBody({
    quote: 'My OMI is not charging on the charger.',
    reason: 'Device stopped charging.',
    related: [{ kind: 'issue', title: 'Charging reliability', url: 'https://github.com/BasedHardware/omi/issues/5469', state: 'open' }],
  });
  assert.match(openCharging, /issues\/5469/);
  assert.match(openCharging, /Not treated as the fix/);
  assert.equal(openCharging.includes('still a problem after those changes'), false);
  assert.equal(/fixed|I think|probably/i.test(formatted), false);
  const card = github.formatIssueCard(named);
  assert.equal(card.title, 'Issue tracking');
  assert.doesNotMatch(JSON.stringify(card), /ERESOLVE|npm error/);
  const labelField = card.fields.find((f) => f.name === 'Labels').value;
  assert.match(labelField, /desktop/);
  assert.equal(/vector/i.test(labelField), false);
  assert.equal(named.labels.includes('vector'), true);
});

test('a not-charging report lists the open charging issue', async () => {
  const hits = await github.relatedIssues('Device not charging on the charger', {
    fetchImpl: async (url) => {
      assert.match(String(url), /is%3Aissue\+is%3Aopen\+charging/);
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              title: "Charging reliability — device not recognized or won't charge intermittently",
              html_url: 'https://github.com/BasedHardware/omi/issues/5469',
              state: 'open',
            },
            {
              title: 'iOS background BLE timeouts leave live transcription unavailable',
              html_url: 'https://github.com/BasedHardware/omi/issues/11307',
              state: 'open',
            },
          ],
        }),
      };
    },
  });
  assert.equal(hits.length, 1);
  assert.match(hits[0].url, /5469/);
  assert.equal(hits[0].kind, 'issue');
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

test('official source search retrieves and labels current app behavior', async () => {
  const prev = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = 'ghs_test';
  const searched = [];
  const path = 'app/lib/providers/message_provider.dart';
  const apiUrl = `https://api.github.com/repos/BasedHardware/omi/contents/${path}`;
  const htmlUrl = `https://github.com/BasedHardware/omi/blob/main/${path}`;
  const body = [
    '// Device-button voice questions add an AI response message to Chat.',
    '// The reply audio is played when voiceResponseEnabled is true.',
    'Future<void> sendVoiceMessageStreamToServer() async {}',
  ].join('\n');
  try {
    const evidence = await github.searchOfficialCode(
      'I press the Omi button and see my question transcription, but no answer or response appears.',
      {
        queries: ['voice question button', 'transcription AI response'],
        fetchImpl: async (url) => {
          const target = String(url);
          if (target.includes('/search/code')) {
            searched.push(new URL(target).searchParams.get('q'));
            return {
              ok: true,
              json: async () => ({ items: [{ path, url: apiUrl, html_url: htmlUrl }] }),
            };
          }
          assert.equal(target, apiUrl);
          return {
            ok: true,
            json: async () => ({ encoding: 'base64', content: Buffer.from(body).toString('base64') }),
          };
        },
      }
    );
    assert.ok(searched.some((query) => /voice question button/i.test(query)));
    assert.ok(searched.some((query) => /transcription ai response/i.test(query)));
    assert.match(evidence, /Official GitHub \| authoritative/);
    assert.match(evidence, /AI response message to Chat/i);
    assert.match(evidence, /voiceResponseEnabled/i);
    assert.match(evidence, /message_provider\.dart/);
  } finally {
    if (prev === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prev;
  }
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
  assert.doesNotMatch(posted.body, /vector-thread:|1550182642874589194/);
  delete process.env.GITHUB_TOKEN;
});

test('createIssue redacts every public write even if a draft was stored raw', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  let posted;
  try {
    const created = await github.createIssue({
      title: 'Order #22777 for @DorkKnight',
      body: 'Email ada@example.com, call +91 98765 43210 at 12 Rue de Paris, 97400 Saint-Denis. sk-abcdefgh12345678 https://cdn.discordapp.com/attachments/1/2/photo.jpg',
      files: [{ name: 'photo.jpg', url: 'https://cdn.discordapp.com/attachments/1/2/photo.jpg' }],
      labels: ['vector'],
      threadId: '1550182642874589194',
    }, {
      fetchImpl: async (_url, opts) => {
        posted = JSON.parse(opts.body);
        return { ok: true, status: 201, json: async () => ({ number: 43 }) };
      },
    });
    assert.equal(created.ok, true);
    const blob = JSON.stringify(posted);
    for (const value of ['22777', 'DorkKnight', 'ada@example.com', '98765', 'Rue de Paris', 'Saint-Denis', 'abcdefgh12345678', 'photo.jpg']) {
      assert.equal(blob.includes(value), false, value);
    }
    assert.match(blob, /Attachments in Discord: 1/);
    assert.doesNotMatch(blob, /vector-thread:|1550182642874589194/);
  } finally {
    delete process.env.GITHUB_TOKEN;
  }
});

test('public issue and comment writes strip private links and old thread markers, using only the opaque approval marker', async (t) => {
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'fixture-token';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const approvalId = '11111111-1111-4111-8111-111111111111';
  const body = 'Staff technical summary. https://discord.com/channels/1/2/3 <!-- vector-thread:123456789012345678 --> https://private.example/audio?token=CANARY_TOKEN';
  let sentIssue; let sentComment;
  const issue = await github.createIssue({ title: 'Technical report', body, approvalId, files: { size: 2 } }, {
    fetchImpl: async (_url, options) => { sentIssue = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ number: 44 }) }; },
  });
  const comment = await github.commentOnIssue(44, body, { approvalId,
    fetchImpl: async (_url, options) => { sentComment = JSON.parse(options.body); return { ok: true, status: 201, json: async () => ({ id: 99, html_url: 'https://github.com/BasedHardware/omi/issues/44#issuecomment-99' }) }; },
  });
  assert.equal(issue.outcome, 'accepted'); assert.equal(comment.outcome, 'accepted');
  for (const payload of [sentIssue, sentComment]) {
    assert.doesNotMatch(JSON.stringify(payload), /discord\.com|vector-thread:|123456789012345678|private\.example|CANARY_TOKEN/);
    assert.match(payload.body, /omi-support-approval:11111111-1111-4111-8111-111111111111/);
  }
  assert.deepEqual(sentIssue, github.issuePublicationPayload({ title: 'Technical report', body, approvalId, files: { size: 2 } }));
  assert.equal(sentComment.body, github.publicMutationBody(body, approvalId));
});

test('HTTP rejection can be retried explicitly, but transport/5xx/malformed success outcomes never auto-retry', async (t) => {
  const previous = process.env.GITHUB_TOKEN; const oldError = console.error;
  process.env.GITHUB_TOKEN = 'fixture-token'; console.error = () => {};
  t.after(() => { console.error = oldError; if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  for (const [status, expected] of [[422, 'known_rejected'], [429, 'known_rejected'], [408, 'unknown'], [500, 'unknown']]) {
    let calls = 0;
    const response = async () => { calls++; return { ok: false, status }; };
    assert.equal((await github.createIssue({ title: 'Report', body: 'Staff summary', labels: ['app'] }, { fetchImpl: response })).outcome, expected);
    assert.equal(calls, 1);
    calls = 0;
    assert.equal((await github.commentOnIssue(44, 'Staff summary', { fetchImpl: response })).outcome, expected);
    assert.equal(calls, 1);
  }
  for (const response of [
    async () => { throw new Error('response lost'); },
    async () => ({ ok: true, status: 201, json: async () => { throw new Error('invalid response'); } }),
    async () => ({ ok: true, status: 201, json: async () => ({}) }),
  ]) {
    assert.equal((await github.createIssue({ title: 'Report', body: 'Staff summary' }, { fetchImpl: response })).outcome, 'unknown');
    assert.equal((await github.commentOnIssue(44, 'Staff summary', { fetchImpl: response })).outcome, 'unknown');
  }
});

test('a public marker or substring cannot establish a trusted Discord link or reconcile without writer and payload proof', async () => {
  github.resetGithubMemory(); let calls = 0;
  assert.equal(await github.findIssueForThread('123456789012345678', { fetchImpl: async () => { calls++; } }), '');
  assert.equal(calls, 0);
  const approval = { id: '11111111-1111-4111-8111-111111111111', status: 'unknown', writerAppId: '123', kind: 'issue', repo: 'BasedHardware/omi', draft: { title: 'Technical report', body: 'Approved staff summary.', labels: ['app'] } };
  const publicPayload = github.issuePublicationPayload({ ...approval.draft, approvalId: approval.id });
  const data = { number: 44, html_url: 'https://github.com/BasedHardware/omi/issues/44', ...publicPayload, labels: [{ name: 'app' }], user: { type: 'Bot' }, performed_via_github_app: { id: 123 } };
  assert.equal(github.matchesApprovalPublication(approval, data, { appId: 123 }), true);
  for (const changed of [{ user: { type: 'User' } }, { performed_via_github_app: { id: 999 } }, { body: publicPayload.body + ' Unapproved content' }, { title: 'Different report' }, { labels: [] }, { html_url: 'https://github.com/other/repo/issues/44' }]) {
    assert.equal(github.matchesApprovalPublication(approval, { ...data, ...changed }, { appId: 123 }), false);
  }
  assert.equal(github.matchesApprovalPublication({ ...approval, kind: 'comment', targetIssueNumber: 44 }, {
    id: 99, issue_url: 'https://api.github.com/repos/BasedHardware/omi/issues/44', html_url: 'https://github.com/BasedHardware/omi/issues/44#issuecomment-99',
    body: github.publicMutationBody(approval.draft.body, approval.id), user: { type: 'Bot' }, performed_via_github_app: { id: 123 },
  }, { appId: 123 }), true);
});

function unknownApproval(kind = 'issue') {
  return { id: '11111111-1111-4111-8111-111111111111', status: 'unknown', writerAppId: '123', kind,
    repo: 'BasedHardware/omi', targetIssueNumber: kind === 'comment' ? 44 : null,
    approvedAt: '2026-10-09T12:00:00.000Z', draft: { title: 'Technical report', body: 'Staff-approved technical summary.', labels: ['app'] } };
}

function publishedIssue(approval, number = 44) {
  return { number, html_url: `https://github.com/basedhardware/OMI/issues/${number}/`,
    ...github.issuePublicationPayload({ ...approval.draft, approvalId: approval.id }), labels: [{ name: 'app' }],
    user: { type: 'Bot' }, performed_via_github_app: { id: 123 } };
}

test('read-only reconciliation uses the saved app identity after configuration changes and returns only canonical receipt data', async (t) => {
  const previous = { token: process.env.GITHUB_TOKEN, app: process.env.GITHUB_APP_ID };
  process.env.GITHUB_TOKEN = 'fixture-token'; process.env.GITHUB_APP_ID = '999';
  t.after(() => {
    for (const [name, old] of [['GITHUB_TOKEN', previous.token], ['GITHUB_APP_ID', previous.app]]) {
      if (old === undefined) delete process.env[name]; else process.env[name] = old;
    }
  });
  const approval = unknownApproval(); const requests = [];
  const result = await github.findApprovalPublication(approval, { fetchImpl: async (url, options) => {
    requests.push({ url: String(url), method: options.method });
    return { ok: true, json: async () => [
      { ...publishedIssue(approval), performed_via_github_app: { id: 999 } }, publishedIssue(approval),
    ] };
  } });
  assert.deepEqual(result, { ok: true, found: true, outcomeData: { number: 44, url: 'https://github.com/BasedHardware/omi/issues/44' } });
  assert.equal(requests.length, 1); assert.equal(requests[0].method, 'GET');
  assert.match(requests[0].url, /\/repos\/BasedHardware\/omi\/issues\?/);
  assert.equal(new URL(requests[0].url).searchParams.get('since'), '2026-10-09T11:59:00.000Z');
  assert.doesNotMatch(JSON.stringify(result), /Staff-approved technical summary|labels|performed_via/);
});

test('read-only reconciliation for comments checks the fixed issue target and returns comment receipt fields', async (t) => {
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'fixture-token';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const approval = unknownApproval('comment'); let requests = 0;
  const item = { id: 99, issue_url: 'https://api.github.com/repos/basedhardware/OMI/issues/44',
    html_url: 'https://github.com/basedhardware/omi/issues/44#issuecomment-99',
    body: github.publicMutationBody(approval.draft.body, approval.id), user: { type: 'Bot' }, performed_via_github_app: { id: 123 } };
  const result = await github.findApprovalPublication(approval, { fetchImpl: async (url, options) => {
    requests++; assert.equal(options.method, 'GET'); assert.match(String(url), /\/issues\/44\/comments\?/);
    return { ok: true, json: async () => [{ ...item, issue_url: 'https://api.github.com/repos/BasedHardware/omi/issues/45' }, item] };
  } });
  assert.equal(requests, 1);
  assert.deepEqual(result.outcomeData, { number: 44, id: 99, commentId: 99, url: 'https://github.com/BasedHardware/omi/issues/44#issuecomment-99' });
});

test('reconciliation without a saved application identity or unknown state makes no request', async () => {
  let requests = 0; const fetchImpl = async () => { requests++; assert.fail('must remain unverified'); };
  for (const writerAppId of [null, undefined, '', 'not-an-app-id']) {
    assert.equal((await github.findApprovalPublication({ ...unknownApproval(), writerAppId }, { fetchImpl })).reason, 'unverified_app_identity');
  }
  assert.equal((await github.findApprovalPublication({ ...unknownApproval(), status: 'filed' }, { fetchImpl })).reason, 'not_unknown');
  assert.equal(requests, 0);
});

test('reconciliation reads at most three bounded pages and never retries publication when no match is found', async (t) => {
  const previous = process.env.GITHUB_TOKEN; process.env.GITHUB_TOKEN = 'fixture-token';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const approval = unknownApproval(); let requests = 0;
  const result = await github.findApprovalPublication(approval, { fetchImpl: async (url, options) => {
    requests++; assert.equal(options.method, 'GET'); assert.equal(new URL(url).searchParams.get('page'), String(requests));
    assert.equal(new URL(url).searchParams.get('per_page'), '100');
    return { ok: true, json: async () => Array.from({ length: 100 }, () => ({ ...publishedIssue(approval), body: 'Unapproved body' })) };
  } });
  assert.deepEqual(result, { ok: true, found: false, reason: 'not_found_in_window' });
  assert.equal(requests, 3); assert.equal(approval.status, 'unknown');
});

test('ambiguous publication receipts remain unverified and API failures expose no raw details', async (t) => {
  const previous = process.env.GITHUB_TOKEN; const oldError = console.error; const logs = [];
  process.env.GITHUB_TOKEN = 'fixture-token'; console.error = (...args) => logs.push(args.join(' '));
  t.after(() => { console.error = oldError; if (previous === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previous; });
  const approval = unknownApproval();
  assert.equal((await github.findApprovalPublication(approval, { fetchImpl: async () => ({ ok: true, json: async () => [publishedIssue(approval, 44), publishedIssue(approval, 45)] }) })).reason, 'ambiguous_publications');
  const result = await github.findApprovalPublication(approval, { fetchImpl: async (_url, options) => {
    assert.equal(options.method, 'GET'); throw new Error('CANARY_PRIVATE_ERROR');
  } });
  assert.deepEqual(result, { ok: false, found: false, reason: 'github_unavailable' });
  assert.equal(logs.length, 0);
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
  assert.equal(merged.line, 'Pull request #12 was merged. This does not confirm a released fix.');
  assert.doesNotMatch(merged.line, /#9 was merged/);
  assert.equal(merged.numbers.includes(9), true);
});

test('issue-thread map is used for webhook targets', () => {
  github.resetGithubMemory();
  github.linkIssueThread(9, 'thread-1');
  assert.deepEqual(github.threadsForIssue(9), ['thread-1']);
  github.resetGithubMemory();
});

test('legacy thread ownership is not reused for a different repository', async (t) => {
  const previousRepo = process.env.GITHUB_REPO;
  const previousDatabase = process.env.DATABASE_URL;
  t.after(() => {
    if (previousRepo === undefined) delete process.env.GITHUB_REPO; else process.env.GITHUB_REPO = previousRepo;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabase;
    github.resetGithubMemory();
  });
  github.linkIssueThread(9, 'thread-1', { persist: false });
  process.env.GITHUB_REPO = 'another/repository';
  process.env.DATABASE_URL = 'unused-test-database';
  assert.equal(await github.findIssueForThread('thread-1'), '');
  assert.equal(await github.hydrateIssueThreads(), 0);
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

  const filedByBot = github.describeWebhookEvent({
    action: 'opened',
    issue: { number: 18473, body: marked, user: { login: 'omi-vector', type: 'Bot' } },
  });
  assert.equal(filedByBot, null);

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

  const forged = github.describeWebhookEvent({
    action: 'created',
    issue: { number: 9, body: marked },
    comment: { body: '<!-- vector-thread:999 -->', user: { login: 'someone', type: 'User' } },
  });
  assert.equal(forged, null);

  assert.equal(github.webhookRepoOk({ repository: { full_name: 'BasedHardware/omi' } }), true);
  assert.equal(github.webhookRepoOk({ repository: { full_name: 'someone/else' } }), false);
  assert.equal(github.webhookRepoOk({}), false);

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
  assert.equal(card.title, 'Shop ticket');
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

test('a listen-socket report does not match the on-premise pull request', async () => {
  const q = [
    'Connection problem with api.omi.me/v4/listen',
    'Daily reports are not being produced. Transcription unavailable.',
    'The server closed wss://api.omi.me/v4/listen with WebSocket code 1011 approximately every 20 seconds.',
  ].join('\n');
  const onprem = {
    number: 10887,
    state: 'closed',
    title: 'Omi fully on-premise via Docker Compose or Helm/k8s: every managed service',
    body: 'connection problem listen daily reports transcription websocket soniox',
  };
  assert.ok(github.scorePull(q, onprem) < 4);
  const fetchImpl = async (url) => {
    assert.match(String(url), /search\/issues/);
    return {
      ok: true,
      json: async () => ({ items: [onprem] }),
    };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('pull search still returns the deletion pull', async () => {
  const q = 'Once again, I cannot delete memories or conversations on either the desktop app or the mobile app. The desktop app gives me an error and the mobile app shows them deleted and then they resurface 30 seconds later.';
  const wrong = {
    number: 11743,
    state: 'open',
    title: 'Windows search: find anything across conversations, memories, tasks and screen',
  };
  const right = {
    number: 14691,
    state: 'open',
    title: 'fix(backend): make memory & conversation deletion work again on desktop and mobile',
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    assert.equal(/in:title|in%3Atitle/i.test(u), false);
    return { ok: true, json: async () => ({ items: [wrong, right] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '14691');
});

test('a rare token in the pull title matches even when the generic score is under 4', async () => {
  const q = [
    'Connection problem with api.omi.me/v4/listen',
    'Daily reports are not being produced. Transcription unavailable.',
    'The server closed wss://api.omi.me/v4/listen with WebSocket code 1011 approximately every 20 seconds.',
  ].join('\n');
  const onprem = {
    number: 10887,
    state: 'closed',
    title: 'Omi fully on-premise via Docker Compose or Helm/k8s: every managed service',
    body: 'connection problem listen daily reports transcription websocket soniox',
  };
  const listen = {
    number: 5235,
    state: 'closed',
    title: 'Fix VAD gate keepalive: 20s → 5s to prevent DG 1011 disconnect',
    html_url: 'https://github.com/BasedHardware/omi/pull/5235',
  };
  assert.ok(github.scorePull(q, onprem) < 4);
  assert.ok(github.scorePull(q, listen) < 4);
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      const query = decodeURIComponent(u.replace(/\+/g, ' '));
      assert.match(query, /1011/);
      assert.match(query, /in:title/);
      assert.equal(/is:open/i.test(query), false);
      assert.equal(/\bconnection\b/.test(query), false);
      assert.equal(/\b(problem|every|reports)\b/.test(query), false);
      return { ok: true, json: async () => ({ items: [onprem, listen] }) };
    }
    assert.match(u, /\/pulls\/5235$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: true, merged_at: '2026-02-28T02:41:38Z' }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '5235');
  assert.match(found.title, /1011/);
});

test('a closed rare-token pull that was not merged does not match', async () => {
  const q = 'Soniox keeps failing the live transcript.';
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      return {
        ok: true,
        json: async () => ({
          items: [{ number: 50, state: 'closed', title: 'fix(stt): restore Soniox as the streaming failover hop' }],
        }),
      };
    }
    assert.match(u, /\/pulls\/50$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: false }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

function listenSocketQuestion() {
  return [
    'Connection problem with api.omi.me/v4/listen',
    'Daily reports are not being produced. Transcription unavailable.',
    'The server closed wss://api.omi.me/v4/listen with WebSocket code 1011 approximately every 20 seconds.',
  ].join('\n');
}

function onPremisePull(state) {
  return {
    number: 10887,
    state,
    title: 'Omi fully on-premise via Docker Compose or Helm/k8s: every managed service',
    body: 'connection problem listen daily reports transcription websocket soniox stt 1011',
  };
}

function decodedSearchQuery(url) {
  return decodeURIComponent(String(url).replace(/\+/g, ' '));
}

test('an open stt title is recalled when no open title has the rare token', async () => {
  const q = listenSocketQuestion();
  const onprem = onPremisePull('closed');
  const sttPull = {
    number: 13001,
    state: 'open',
    title: 'fix(stt): streaming failover hop',
    html_url: 'https://github.com/BasedHardware/omi/pull/13001',
    body: 'generic notes',
  };
  assert.equal(onprem.title.toLowerCase().includes('listen'), false);
  assert.equal(onprem.title.toLowerCase().includes('stt'), false);
  assert.ok(github.scorePull(q, onprem) < 4);
  assert.ok(github.scorePull(q, sttPull) < 4);
  assert.equal(/\blisten\b/i.test(sttPull.title), false);
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.equal(/in:title/.test(query), false);
      assert.match(query, /(?:^|[^a-z0-9])1011(?:[^a-z0-9]|$)/);
      assert.equal(/soniox|transcription unavailable|\bwebsocket\b|\bwss\b|\blisten\b|\bstt\b/.test(query), false);
      return { ok: true, json: async () => ({ items: [] }) };
    }
    assert.match(query, /in:title/);
    assert.equal(/in:body/.test(query), false);
    if (/\bstt\b/.test(query) || /\blisten\b/.test(query)) {
      assert.match(query, /is:open/);
      assert.match(query, /\blisten\b/);
      assert.match(query, /\bstt\b/);
      return { ok: true, json: async () => ({ items: [onprem, sttPull] }) };
    }
    assert.match(query, /1011/);
    return { ok: true, json: async () => ({ items: [onprem] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '13001');
  assert.match(found.title, /\bstt\b/i);
});

test('an open listen title is recalled for transcription without the word listen', async () => {
  const q = 'Transcription unavailable. The socket died with code 1011.';
  assert.equal(q.toLowerCase().includes('listen'), false);
  const onprem = onPremisePull('open');
  const listenPull = {
    number: 13002,
    state: 'open',
    title: 'fix(listen): vendor hop',
    html_url: 'https://github.com/BasedHardware/omi/pull/13002',
    body: 'on-premise helm notes',
  };
  assert.equal(listenPull.title.toLowerCase().includes('stt'), false);
  assert.ok(github.scorePull(q, listenPull) < 4);
  assert.ok(github.scorePull(q, onprem) < 4);
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.equal(/in:title/.test(query), false);
      assert.match(query, /(?:^|[^a-z0-9])1011(?:[^a-z0-9]|$)/);
      assert.equal(/\blisten\b|\bstt\b/.test(query), false);
      return { ok: true, json: async () => ({ items: [] }) };
    }
    assert.match(query, /in:title/);
    assert.equal(/in:body/.test(query), false);
    if (/\blisten\b/.test(query) || /\bstt\b/.test(query)) {
      assert.match(query, /is:open/);
      return { ok: true, json: async () => ({ items: [onprem, listenPull] }) };
    }
    assert.match(query, /1011/);
    assert.equal(/\blisten\b/.test(query), false);
    return { ok: true, json: async () => ({ items: [onprem] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '13002');
  assert.match(found.title, /\blisten\b/i);
});

test('an open on-premise pull is not recalled from body words', async () => {
  const q = listenSocketQuestion();
  const onprem = onPremisePull('open');
  assert.equal(onprem.title.toLowerCase().includes('listen'), false);
  assert.equal(onprem.title.toLowerCase().includes('stt'), false);
  assert.ok(github.scorePull(q, onprem) < 4);
  const fetchImpl = async (url) => {
    assert.match(String(url), /search\/issues/);
    return { ok: true, json: async () => ({ items: [onprem] }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('a closed stt title is not recalled', async () => {
  const q = listenSocketQuestion();
  const closed = {
    number: 77,
    state: 'closed',
    title: 'fix(stt): vendor hop',
    body: 'listen 1011 websocket soniox transcription unavailable',
  };
  assert.ok(github.scorePull(q, closed) < 4);
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      return { ok: true, json: async () => ({ items: [closed] }) };
    }
    assert.match(u, /\/pulls\/77$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: false }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('a closed high-score listen title that was not merged does not match', async () => {
  const q = listenSocketQuestion();
  const closed = {
    number: 78,
    state: 'closed',
    title: 'fix(listen): vendor hop',
    body: 'notes',
  };
  assert.ok(github.scorePull(q, closed) >= 4);
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      return { ok: true, json: async () => ({ items: [closed] }) };
    }
    assert.match(u, /\/pulls\/78$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: false }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('an open rare-token title is not replaced by listen recall', async () => {
  const q = listenSocketQuestion();
  const listenOnly = {
    number: 7001,
    state: 'open',
    title: 'fix(stt): buffer hop',
    html_url: 'https://github.com/BasedHardware/omi/pull/7001',
  };
  const rareOpen = {
    number: 7002,
    state: 'open',
    title: 'fix 1011 disconnect',
    html_url: 'https://github.com/BasedHardware/omi/pull/7002',
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    assert.match(query, /1011/);
    assert.equal(/\bstt\b/.test(query), false);
    return { ok: true, json: async () => ({ items: [listenOnly, rareOpen] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '7002');
});

test('transcript alone does not recall an open stt title', async () => {
  const q = 'Soniox keeps failing the live transcript.';
  assert.equal(q.toLowerCase().includes('transcription'), false);
  assert.equal(q.toLowerCase().includes('listen'), false);
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    assert.match(query, /soniox/i);
    assert.equal(/\blisten\b|\bstt\b/.test(query), false);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.equal(/\b(keeps|failing|live|transcript)\b/.test(query), false);
      return { ok: true, json: async () => ({ items: [] }) };
    }
    assert.match(query, /in:title/);
    return {
      ok: true,
      json: async () => ({
        items: [{ number: 80, state: 'open', title: 'fix(stt): streaming hop' }],
      }),
    };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
  assert.equal(calls, 2);
});

test('an open pull whose title shares no question words is recalled from one rare body token', async () => {
  const q = listenSocketQuestion();
  const onprem = onPremisePull('open');
  const missed = {
    number: 14001,
    state: 'open',
    title: 'fix(backend): vendor failover hop',
    html_url: 'https://github.com/BasedHardware/omi/pull/14001',
  };
  assert.ok(github.scorePull(q, missed) < 4);
  assert.ok(github.scorePull(q, onprem) < 4);
  assert.equal(/1011|soniox|unavailable|listen|websocket|transcription/i.test(missed.title), false);
  const queries = [];
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    queries.push(query);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.equal(/in:title/.test(query), false);
      assert.match(query, /(?:^|[^a-z0-9])1011(?:[^a-z0-9]|$)/);
      assert.equal(/soniox|transcription unavailable|websocket|\bwss\b|\blisten\b|connection|reports/.test(query), false);
      return { ok: true, json: async () => ({ items: [onprem, missed] }) };
    }
    assert.match(query, /in:title/);
    return { ok: true, json: async () => ({ items: [onprem] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '14001');
  assert.equal(queries.filter((query) => /in:body/.test(query)).length, 1);
  const openLine = github.customerChangeSentence(found, { ok: true, state: 'open' });
  assert.match(openLine, /has not shipped/i);
  assert.equal(/\bfixed\b|\bsolved\b/i.test(openLine), false);
  const mergedLine = github.customerChangeSentence(found, { ok: true, state: 'merged' });
  assert.match(mergedLine, /has been merged/i);
  assert.equal(/\bfixed\b|\bsolved\b/i.test(mergedLine), false);
});

test('transcription unavailable searches the body as one phrase', async () => {
  const q = 'Keep getting transcription unavailable.';
  const pull = {
    number: 14010,
    state: 'open',
    title: 'fix(backend): vendor failover hop',
    html_url: 'https://github.com/BasedHardware/omi/pull/14010',
  };
  assert.ok(github.scorePull(q, pull) < 4);
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.match(query, /"transcription unavailable"/);
      assert.equal(/\b(keep|getting)\b/.test(query), false);
      assert.equal(/1011|soniox/.test(query), false);
      return { ok: true, json: async () => ({ items: [pull] }) };
    }
    assert.match(query, /in:title/);
    assert.match(query, /"transcription unavailable"/);
    return { ok: true, json: async () => ({ items: [] }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '14010');
  const line = github.customerChangeSentence(found, { ok: true, state: 'open' });
  assert.match(line, /already open/i);
  assert.match(line, /has not shipped/i);
  assert.equal(/\bfixed\b|\bsolved\b/i.test(line), false);
});

test('body recall skips on-prem, onprem, self-host, and on premise titles', async () => {
  const q = 'Soniox failed overnight.';
  const titles = [
    'Document on-prem install',
    'Document onprem install',
    'Document self-host install',
    'Document on premise install',
  ];
  const fetchImpl = async (url) => {
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    if (/in:body/.test(query)) {
      assert.match(query, /is:pr/);
      assert.match(query, /is:open/);
      assert.match(query, /\bsoniox\b/);
      assert.equal(/\b(failed|overnight|document|install)\b/.test(query), false);
      return {
        ok: true,
        json: async () => ({
          items: titles.map((title, i) => ({ number: 300 + i, state: 'open', title })),
        }),
      };
    }
    return { ok: true, json: async () => ({ items: [] }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('body recall drops a closed unmerged pull and keeps a merged one', async () => {
  const q = 'Soniox failed overnight.';
  const closed = { number: 91, state: 'closed', title: 'fix(backend): hop a' };
  const merged = {
    number: 92,
    state: 'closed',
    title: 'fix(backend): hop b',
    html_url: 'https://github.com/BasedHardware/omi/pull/92',
  };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      const query = decodedSearchQuery(u);
      if (/in:body/.test(query)) {
        assert.match(query, /is:open/);
        assert.match(query, /\bsoniox\b/);
        assert.equal(/\b(failed|overnight)\b/.test(query), false);
        return { ok: true, json: async () => ({ items: [closed, merged] }) };
      }
      assert.match(query, /in:title/);
      return { ok: true, json: async () => ({ items: [] }) };
    }
    if (u.includes('/pulls/91')) {
      return { ok: true, json: async () => ({ state: 'closed', merged: false }) };
    }
    assert.match(u, /\/pulls\/92$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: true, merged_at: '2026-03-01T00:00:00Z' }) };
  };
  const found = await github.searchPulls(q, { fetchImpl });
  assert.equal(found.number, '92');
  const line = github.customerChangeSentence(found, { ok: true, state: 'merged' });
  assert.match(line, /has been merged/i);
  assert.equal(/\bfixed\b|\bsolved\b/i.test(line), false);
});

test('body recall does not accept a closed pull that was not merged', async () => {
  const q = 'Soniox failed overnight.';
  const closed = { number: 93, state: 'closed', title: 'fix(backend): hop c' };
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u.includes('/search/issues')) {
      const query = decodedSearchQuery(u);
      if (/in:body/.test(query)) return { ok: true, json: async () => ({ items: [closed] }) };
      return { ok: true, json: async () => ({ items: [] }) };
    }
    assert.match(u, /\/pulls\/93$/);
    return { ok: true, json: async () => ({ state: 'closed', merged: false }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('generic listen words do not match a closed on-prem pull', async () => {
  const q = 'every listen';
  const onprem = onPremisePull('closed');
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const u = String(url);
    assert.match(u, /search\/issues/);
    const query = decodedSearchQuery(u);
    assert.equal(/in:body/.test(query), false);
    assert.equal(/1011|soniox|transcription unavailable/.test(query), false);
    return { ok: true, json: async () => ({ items: [onprem] }) };
  };
  assert.ok(github.scorePull(q, onprem) < 4);
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
  assert.equal(calls, 1);
});

test('ordinary words do not search pull bodies', async () => {
  const q = 'App crash and battery order problem';
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const query = decodedSearchQuery(url);
    assert.equal(/in:body/.test(query), false);
    assert.match(query, /\bcrash\b/);
    assert.match(query, /\bbattery\b/);
    assert.match(query, /\border\b/);
    return { ok: true, json: async () => ({ items: [] }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
  assert.equal(calls, 1);
});

test('a Soniox 1011 report does not cite the merged Deepgram keepalive pull', async () => {
  const q = 'Transcription unavailable. Socket wss://api.omi.me/v4/listen closes with 1011. Soniox fails. OpenAI whisper works.';
  const dg = {
    number: 5235,
    title: 'Fix VAD gate keepalive: 20s → 5s to prevent DG 1011 disconnect',
    state: 'closed',
    html_url: 'https://github.com/BasedHardware/omi/pull/5235',
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ items: [dg], merged: true, state: 'closed', title: dg.title }) });
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
});

test('websocket alone does not search pull bodies', async () => {
  const q = 'websocket closed unexpectedly';
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    const query = decodedSearchQuery(url);
    assert.match(query, /in:title/);
    assert.match(query, /websocket/);
    assert.equal(/in:body/.test(query), false);
    return { ok: true, json: async () => ({ items: [] }) };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
  assert.equal(calls, 1);
});
