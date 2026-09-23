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
    assert.match(String(url), /search\/issues/);
    return { ok: true, json: async () => ({ items: [closed] }) };
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
    return {
      ok: true,
      json: async () => ({
        items: [{ number: 80, state: 'open', title: 'fix(stt): streaming hop' }],
      }),
    };
  };
  assert.equal(await github.searchPulls(q, { fetchImpl }), null);
  assert.equal(calls, 1);
});
