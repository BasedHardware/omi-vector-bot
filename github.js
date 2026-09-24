const crypto = require('crypto');
const { clipForDiscord } = require('./utils');

const DEFAULT_REPO = 'BasedHardware/omi';
const TIMEOUT_MS = 8000;
const drafts = new Map();
const issueThreads = new Map();

function repo() {
  return String(process.env.GITHUB_REPO || DEFAULT_REPO).replace(/^https?:\/\/github.com\//i, '').replace(/\.git$/, '');
}

function webhookRepoOk(payload) {
  const name = String(payload?.repository?.full_name || '').trim();
  if (!name) return false;
  return name.toLowerCase() === repo().toLowerCase();
}

function appPrivateKey() {
  return String(process.env.GITHUB_APP_PRIVATE_KEY || '')
    .replace(/\\n/g, '\n')
    .trim();
}

function isAppConfigured() {
  return Boolean(
    String(process.env.GITHUB_APP_ID || '').trim() &&
      String(process.env.GITHUB_APP_INSTALLATION_ID || '').trim() &&
      appPrivateKey()
  );
}

function isConfigured() {
  return Boolean(String(process.env.GITHUB_TOKEN || '').trim()) || isAppConfigured();
}

function appJwt() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(process.env.GITHUB_APP_ID).trim() })
  ).toString('base64url');
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256').update(data).sign(appPrivateKey(), 'base64url');
  return `${data}.${sign}`;
}

let installationCache = { token: '', exp: 0 };

async function installationToken(fetchImpl) {
  const now = Date.now();
  if (installationCache.token && installationCache.exp - 60_000 > now) return installationCache.token;
  const id = String(process.env.GITHUB_APP_INSTALLATION_ID || '').trim();
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(`https://api.github.com/app/installations/${id}/access_tokens`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${appJwt()}`,
      'User-Agent': 'omi-vector-bot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GitHub App token HTTP ${res.status}`);
  const data = await res.json();
  const token = String(data?.token || '');
  if (!token) throw new Error('GitHub App token missing');
  installationCache = {
    token,
    exp: data.expires_at ? Date.parse(data.expires_at) : now + 50 * 60_000,
  };
  return token;
}

async function accessToken(fetchImpl) {
  if (isAppConfigured()) return installationToken(fetchImpl);
  return String(process.env.GITHUB_TOKEN || '').trim();
}

function searchQuery(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(' ');
}

function issueUrl(number) {
  return `https://github.com/${repo()}/issues/${number}`;
}

function draftFromQuestion(question, area, extra = {}) {
  const asked = clipForDiscord(String(question || '').trim(), 1500);
  const topic = String(extra.topic || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const title = clipForDiscord(topic || asked.split('\n').find((line) => line.trim().length > 12) || 'Discord report', 80);
  const labels = ['vector'];
  if (area && area !== 'unknown' && area !== 'shop' && area !== 'privacy') labels.push(area);
  for (const label of extra.labels || []) {
    const clean = String(label || '').toLowerCase();
    if (clean && !labels.includes(clean) && clean !== 'shop' && clean !== 'privacy' && clean !== 'money' && clean !== 'account') {
      labels.push(clean);
    }
  }
  return {
    title,
    body: `Reported in Discord.\n\n## What they wrote\n\n${asked || '(no text)'}\n\nCannot see the app or device from chat. No versions invented.`,
    labels,
  };
}

function threadMarker(threadId) {
  const id = String(threadId || '').trim();
  if (!/^\d+$/.test(id)) return '';
  return `<!-- vector-thread:${id} -->`;
}

function withThreadMarker(body, threadId) {
  const marker = threadMarker(threadId);
  if (!marker) return String(body || '');
  const text = String(body || '');
  if (text.includes(marker)) return text;
  return `${text.trim()}\n\n${marker}`;
}

function parseThreadIds(...blobs) {
  const ids = new Set();
  const re = /<!--\s*vector-thread:(\d+)\s*-->/g;
  for (const blob of blobs) {
    const s = String(blob || '');
    let match;
    while ((match = re.exec(s))) ids.add(match[1]);
  }
  return [...ids];
}

function formatIssueCard(draft, extra = {}) {
  const visible = (draft?.labels || []).filter((label) => String(label).toLowerCase() !== 'vector');
  const labels = visible.map((label) => `\`${label}\``).join('  ') || '`none`';
  const embed = {
    title: clipForDiscord(draft?.title || 'Issue', 80),
    color: 0x5865f2,
    description: clipForDiscord(String(draft?.body || '').trim(), 900),
    fields: [{ name: 'Labels', value: labels, inline: true }],
  };
  if (extra.url) {
    embed.fields.push({ name: 'GitHub', value: extra.url, inline: true });
  } else {
    embed.fields.push({
      name: 'GitHub',
      value: 'Not filed on GitHub yet. This card is the issue in Discord.',
      inline: false,
    });
  }
  return embed;
}

function formatShopTicketCard({ title, labels } = {}) {
  const labs = (labels || [])
    .map((label) => String(label || '').trim())
    .filter(Boolean)
    .map((label) => `\`${label}\``)
    .join('  ') || '`shop`';
  return {
    title: clipForDiscord(title || 'Shop ticket', 80),
    color: 0x5865f2,
    description: 'Tracked in this Discord thread. GitHub is not used for tax or orders.',
    fields: [
      { name: 'Labels', value: labs, inline: true },
      {
        name: 'GitHub',
        value: 'Not a GitHub issue. Updates stay in this thread.',
        inline: false,
      },
    ],
  };
}

function stashDraft(draft, meta = {}) {
  const id = crypto.randomBytes(4).toString('hex');
  drafts.set(id, { ...draft, ...meta, at: Date.now() });
  return id;
}

function takeDraft(id) {
  const draft = drafts.get(id);
  if (!draft) return null;
  drafts.delete(id);
  return draft;
}

function restoreDraft(id, draft) {
  drafts.set(id, draft);
}

function peekDraft(id) {
  return drafts.get(id) || null;
}

function linkIssueThread(number, threadId) {
  const key = String(number);
  if (!issueThreads.has(key)) issueThreads.set(key, new Set());
  if (threadId) issueThreads.get(key).add(String(threadId));
}

function threadsForIssue(number) {
  return [...(issueThreads.get(String(number)) || [])];
}

function resetGithubMemory() {
  drafts.clear();
  issueThreads.clear();
  installationCache = { token: '', exp: 0 };
}

async function githubFetch(url, { method = 'GET', body, fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  const token = await accessToken(fetchImpl);
  const res = await fetchFn(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'omi-vector-bot',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
}

async function searchIssues(question, { fetchImpl } = {}) {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  const q = searchQuery(question);
  if (!q) return { ok: false, reason: 'no-query' };
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', `repo:${repo()} is:issue is:open ${q}`);
  url.searchParams.set('per_page', '3');
  try {
    const res = await githubFetch(url, { fetchImpl });
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = await res.json();
    const items = Array.isArray(data?.items) ? data.items : [];
    if (!items.length) return { ok: true, duplicate: null };
    const hit = items[0];
    return {
      ok: true,
      duplicate: {
        number: hit.number,
        title: hit.title,
        url: hit.html_url || issueUrl(hit.number),
      },
    };
  } catch (err) {
    console.error('[GitHub] search failed:', err.message);
    return { ok: false, reason: 'error' };
  }
}

function checkedNote() {
  return 'Checked GitHub before filing. No open issue, open pull request, or merged fix had a matching title.';
}

async function existingWork(text, { fetchImpl } = {}) {
  const issues = await searchIssues(text, { fetchImpl });
  if (!issues.ok && issues.reason !== 'no-query') return { error: true };
  if (issues.duplicate) return { hit: { ...issues.duplicate, kind: 'issue' } };
  const pull = await searchPulls(text, { fetchImpl });
  if (pull) return { hit: { ...pull, kind: 'pull' } };
  return { hit: null };
}

async function createIssue(draft, { fetchImpl } = {}) {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  const url = `https://api.github.com/repos/${repo()}/issues`;
  const body = withThreadMarker(draft.body, draft.threadId);
  try {
    const res = await githubFetch(url, {
      method: 'POST',
      body: {
        title: draft.title,
        body,
        labels: draft.labels,
      },
      fetchImpl,
    });
    if (res.status === 422 && draft.labels?.length) {
      return createIssue({ ...draft, labels: [] }, { fetchImpl });
    }
    if (!res.ok) return { ok: false, reason: 'error' };
    const data = await res.json();
    return {
      ok: true,
      number: data.number,
      url: data.html_url || issueUrl(data.number),
    };
  } catch (err) {
    console.error('[GitHub] create failed:', err.message);
    return { ok: false, reason: 'error' };
  }
}

function verifyWebhook(rawBody, signature, secret) {
  const key = secret === undefined ? process.env.GITHUB_WEBHOOK_SECRET : secret;
  if (!key) return false;
  const hmac = crypto.createHmac('sha256', key).update(rawBody).digest('hex');
  const expected = Buffer.from(`sha256=${hmac}`);
  const got = Buffer.from(String(signature || ''));
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(expected, got);
}

function isVectorOrBotComment(payload) {
  const user = payload?.comment?.user || {};
  const login = String(user.login || '');
  const type = String(user.type || '');
  const body = String(payload?.comment?.body || '');
  if (/bot/i.test(type)) return true;
  if (/\[bot\]$/i.test(login)) return true;
  if (/omi-vector-bot/i.test(login)) return true;
  if (/vector-thread:/i.test(body)) return true;
  return false;
}

function describeWebhookEvent(payload) {
  if (payload?.pull_request && payload.action === 'closed' && payload.pull_request.merged) {
    const pr = payload.pull_request.number;
    const extras = [];
    const blob = `${payload.pull_request.title || ''}\n${payload.pull_request.body || ''}`;
    const re = /\b(?:closes|closed|close|fixes|fixed|fix|resolves|resolved|resolve)\s+#(\d+)/gi;
    let match;
    while ((match = re.exec(blob))) extras.push(Number(match[1]));
    const numbers = [...new Set([pr, ...extras].filter(Boolean))];
    return {
      kind: 'merged',
      number: extras[0] || pr,
      numbers,
      threadIds: parseThreadIds(payload.pull_request.body, payload.pull_request.title),
      line: extras[0] ? `#${extras[0]} was merged.` : `#${pr} was merged.`,
    };
  }
  if (payload?.comment && payload.action === 'created' && payload.issue) {
    if (isVectorOrBotComment(payload)) return null;
    const number = payload.issue.number;
    return {
      kind: 'comment',
      number,
      numbers: [number],
      threadIds: parseThreadIds(payload.issue.body),
      line: `A note was added on #${number}.`,
    };
  }
  if (payload?.issue && payload.action === 'opened') {
    const opener = payload.issue.user || {};
    if (/bot/i.test(String(opener.type || '')) || /omi-vector/i.test(String(opener.login || ''))) {
      return null;
    }
    const number = payload.issue.number;
    return {
      kind: 'opened',
      number,
      numbers: [number],
      threadIds: parseThreadIds(payload.issue.body),
      line: `#${number} was opened.`,
    };
  }
  if (payload?.issue && payload.action === 'reopened') {
    const number = payload.issue.number;
    return {
      kind: 'reopened',
      number,
      numbers: [number],
      threadIds: parseThreadIds(payload.issue.body),
      line: `#${number} was reopened.`,
    };
  }
  if (payload?.issue && payload.action === 'closed') {
    const number = payload.issue.number;
    return {
      kind: 'closed',
      number,
      numbers: [number],
      threadIds: parseThreadIds(payload.issue.body),
      line: `#${number} was closed.`,
    };
  }
  return null;
}

function linkedChanges(text) {
  const refs = [];
  const seen = new Set();
  const re = /https?:\/\/github\.com\/BasedHardware\/omi\/(pull|issues)\/(\d+)/gi;
  for (const match of String(text || '').matchAll(re)) {
    const kind = match[1].toLowerCase() === 'pull' ? 'pull' : 'issue';
    const number = match[2];
    const key = `${kind}:${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({
      kind,
      number,
      url: `https://github.com/BasedHardware/omi/${kind === 'pull' ? 'pull' : 'issues'}/${number}`,
    });
  }
  return refs;
}

function textFromEmbeds(embeds) {
  const list = !embeds
    ? []
    : typeof embeds.values === 'function'
      ? [...embeds.values()]
      : Array.isArray(embeds)
        ? embeds
        : [];
  const lines = [];
  for (const embed of list) {
    const title = String(embed?.title || embed?.data?.title || '').trim();
    const url = String(embed?.url || embed?.data?.url || '').trim();
    const description = String(embed?.description || embed?.data?.description || '').trim();
    if (title) lines.push(title);
    if (url) lines.push(url);
    if (description) lines.push(description.slice(0, 500));
  }
  return lines.join('\n');
}

async function lookupChange(ref, { fetchImpl } = {}) {
  if (!ref?.number) return { ok: false };
  const fetchFn = fetchImpl || fetch;
  const path = ref.kind === 'pull' ? 'pulls' : 'issues';
  const url = `https://api.github.com/repos/${repo()}/${path}/${ref.number}`;
  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'omi-vector-bot',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const data = await res.json();
    if (data.merged === true || data.merged_at) return { ok: true, state: 'merged' };
    const state = String(data.state || '').toLowerCase();
    if (state === 'open' || state === 'closed') return { ok: true, state };
    return { ok: false };
  } catch (err) {
    console.error('[GitHub] public lookup failed:', err.message);
    return { ok: false };
  }
}

const SHIPPED_CLAIM = [
  /\bhalf[- ]solved\b/i,
  /\b(is|it's|it is|has been) fixed\b/i,
  /\bfixed this\b/i,
  /\bdeletions will stick\b/i,
  /\b(it |this )?(has|have) shipped\b/i,
];

function stripShippedClaims(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (!line.trim() || !SHIPPED_CLAIM.some((re) => re.test(line))) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !SHIPPED_CLAIM.some((re) => re.test(sentence)))
        .join(' ')
        .trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function coverNote(question, title) {
  const q = String(question || '').toLowerCase();
  const t = String(title || '').toLowerCase();
  const desktop = /\bdesktop\b/.test(q);
  const phone = /\b(mobile|phone)\b/.test(q);
  const titleDesktop = /\bdesktop\b/.test(t);
  const titlePhone = /\bmobile\b/.test(t);
  if (desktop && phone && titleDesktop && titlePhone) {
    return 'It covers the desktop error and the phone deletions that come back.';
  }
  if (desktop && phone && titleDesktop && !titlePhone) {
    return 'It covers the desktop part. The phone part is not in this change.';
  }
  if (desktop && phone && !titleDesktop && titlePhone) {
    return 'It covers the phone part. The desktop part is not in this change.';
  }
  return '';
}

function keepMergedPull(history, answer) {
  const blob = (history || []).map((item) => item?.content || '').join('\n');
  const match = blob.match(/https:\/\/github\.com\/BasedHardware\/omi\/pull\/(\d+)/i);
  if (!match || !/has been merged/i.test(blob)) return String(answer || '');
  const url = match[0];
  const number = match[1];
  let text = String(answer || '')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !/cause is still unknown|look at the app|leaving it for them|can(?:not|'t) sort out|still needs someone/i.test(sentence))
    .join(' ')
    .trim();
  if (!text.includes(url)) {
    text = [text, `Pull request #${number} has been merged. ${url}`].filter(Boolean).join('\n\n');
  }
  return text;
}

function customerChangeSentence(ref, lookup, extra = {}) {
  const url = ref?.url || '';
  if (!url) return '';
  const number = ref.number ? `#${ref.number}` : 'this change';
  const cover = coverNote(extra.question, extra.title || ref.title);
  const scope = cover ? ` ${cover}` : '';
  if (!lookup?.ok) {
    return `Pull request ${number} was already opened for this.${scope} I cannot see whether it shipped. ${url}`;
  }
  if (lookup.state === 'merged') {
    return `Pull request ${number} has been merged.${scope} ${url}`;
  }
  if (lookup.state === 'open') {
    return `Pull request ${number} is already open for this.${scope} Maintainers still have to review it and merge it. It has not shipped. ${url}`;
  }
  return `Pull request ${number} was already opened for this.${scope} It has not shipped. ${url}`;
}

const SEARCH_STOP = new Set([
  'once',
  'again',
  'either',
  'cannot',
  'gives',
  'shows',
  'them',
  'then',
  'later',
  'seconds',
  'error',
  'there',
  'this',
  'that',
  'with',
  'from',
  'have',
  'your',
  'about',
  'after',
]);

function symptomTokens(question) {
  return String(question || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !SEARCH_STOP.has(word));
}

function scorePull(question, item) {
  const title = String(item?.title || '').toLowerCase();
  const asked = String(question || '').toLowerCase();
  if (/\bdelet/.test(asked) && !/delet/.test(title)) return 0;
  let score = 0;
  for (const token of symptomTokens(question)) {
    const stem = token.slice(0, 5);
    if (title.includes(stem)) score += 2;
  }
  return score;
}

// Sharp tokens name one pull. websocket / wss are shared by many titles.
// If no open title has one, an open listen/stt title can still match a question
// that says listen or transcription. After that title search misses, 1011,
// soniox, or "transcription unavailable" may match one open pull by that token
// in the body. On-prem titles are skipped. Other words never search bodies.
const RARE_SHARP = ['1011', 'soniox', 'transcription unavailable'];
const RARE_BROAD = ['websocket', 'wss'];

function hasRareToken(text, token) {
  const hay = String(text || '').toLowerCase();
  if (token.includes(' ')) return hay.includes(token);
  if (token.length <= 4) return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`).test(hay);
  return hay.includes(token);
}

function rareTokensIn(text) {
  return [...RARE_SHARP, ...RARE_BROAD].filter((token) => hasRareToken(text, token));
}

const PROVIDERS = [
  ['soniox', /soniox/i],
  ['deepgram', /\b(?:deepgram|dg)\b/i],
  ['openai', /openai/i],
  ['whisper', /whisper/i],
];

function namedProviders(text) {
  return PROVIDERS.filter(([, re]) => re.test(String(text || ''))).map(([name]) => name);
}

function providerClash(question, title) {
  const asked = namedProviders(question);
  const titled = namedProviders(title);
  if (!asked.length || !titled.length) return false;
  return !asked.some((name) => titled.includes(name));
}

function titleSharesRareToken(question, item) {
  const title = item?.title;
  return rareTokensIn(question).some((token) => hasRareToken(title, token));
}

function pullSearchQuery(question) {
  const present = rareTokensIn(question);
  const sharp = present.filter((token) => RARE_SHARP.includes(token));
  const rare = sharp.length ? sharp : present;
  if (rare.length) {
    const clause = rare.map((token) => (token.includes(' ') ? `"${token}"` : token)).join(' OR ');
    return [`repo:${repo()}`, 'is:pr', `(${clause})`, 'in:title'].join(' ');
  }
  const tokens = symptomTokens(question).slice(0, 6);
  if (!tokens.length) return '';
  return [`repo:${repo()}`, 'is:pr', ...tokens].join(' ');
}

function isOpenPull(item) {
  return String(item?.state || '').toLowerCase() === 'open';
}

function questionWantsListenRecall(question) {
  const q = String(question || '').toLowerCase();
  return q.includes('listen') || q.includes('transcription');
}

function titleHasListenOrStt(title) {
  const t = String(title || '').toLowerCase();
  return t.includes('listen') || t.includes('stt');
}

function listenRecallQuery() {
  return [`repo:${repo()}`, 'is:pr', 'is:open', '(listen OR stt)', 'in:title'].join(' ');
}

function bodyRecallQuery(token) {
  const term = token.includes(' ') ? `"${token}"` : token;
  return [`repo:${repo()}`, 'is:pr', 'is:open', term, 'in:body'].join(' ');
}

function titleBlocksBodyRecall(title) {
  const t = String(title || '').toLowerCase();
  return t.includes('on-prem') || t.includes('onprem') || t.includes('self-host') || t.includes('on premise');
}

async function recallOpenPullFromBody(question, fetchImpl) {
  const token = RARE_SHARP.find((item) => hasRareToken(question, item));
  if (!token) return null;
  const items = await fetchIssueSearch(bodyRecallQuery(token), fetchImpl);
  if (!items) return null;
  for (const item of items) {
    if (titleBlocksBodyRecall(item?.title) || providerClash(question, item?.title)) continue;
    const state = String(item?.state || '').toLowerCase();
    const score = scorePull(question, item);
    if (state === 'open') return toPullRef(item, score);
    if (state !== 'closed') continue;
    const accepted = await finishPull(item, score, fetchImpl);
    if (accepted) return accepted;
  }
  return null;
}

function toPullRef(item, score) {
  return {
    kind: 'pull',
    number: String(item.number),
    title: String(item.title || ''),
    url: item.html_url || `https://github.com/${repo()}/pull/${item.number}`,
    score,
  };
}

async function fetchIssueSearch(q, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const url = new URL('https://api.github.com/search/issues');
  url.searchParams.set('q', q);
  url.searchParams.set('per_page', '8');
  const res = await fetchFn(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'omi-vector-bot',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data?.items) ? data.items : [];
}

async function finishPull(item, score, fetchImpl) {
  if (!item) return null;
  const ref = toPullRef(item, score);
  if (String(item.state || '').toLowerCase() === 'closed') {
    const lookup = await lookupChange(ref, { fetchImpl });
    if (lookup.state !== 'merged') return null;
  }
  return ref;
}

function pickOpenListen(question, items) {
  let best = null;
  let bestScore = -1;
  for (const item of items || []) {
    if (!isOpenPull(item) || !titleHasListenOrStt(item.title)) continue;
    const score = scorePull(question, item);
    if (!best || score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best ? { item: best, score: bestScore } : null;
}

async function searchPulls(question, { fetchImpl } = {}) {
  const q = pullSearchQuery(question);
  if (!q) return null;
  try {
    const items = await fetchIssueSearch(q, fetchImpl);
    if (!items) return null;
    let best = null;
    let bestScore = 0;
    let rareBest = null;
    let rareScore = -1;
    for (const item of items) {
      if (providerClash(question, item?.title)) continue;
      const score = scorePull(question, item);
      if (score > bestScore) {
        best = item;
        bestScore = score;
      }
      if (titleSharesRareToken(question, item) && score > rareScore) {
        rareBest = item;
        rareScore = score;
      }
    }
    const chosen = bestScore >= 4 ? best : rareBest;
    const accepted = chosen
      ? await finishPull(chosen, bestScore >= 4 ? bestScore : rareScore, fetchImpl)
      : null;
    if (accepted) return accepted;

    const fromBody = await recallOpenPullFromBody(question, fetchImpl);
    if (fromBody) return fromBody;

    if (!rareTokensIn(question).length || !questionWantsListenRecall(question)) return null;
    if (items.some((item) => isOpenPull(item) && titleSharesRareToken(question, item))) return null;

    const local = pickOpenListen(question, items);
    const recalled = local || pickOpenListen(question, await fetchIssueSearch(listenRecallQuery(), fetchImpl));
    if (!recalled || !isOpenPull(recalled.item)) return null;
    if (providerClash(question, recalled.item.title)) return null;
    const asked = namedProviders(question);
    if (asked.length && !namedProviders(recalled.item.title).some((name) => asked.includes(name))) return null;
    return toPullRef(recalled.item, recalled.score);
  } catch (err) {
    console.error('[GitHub] pull search failed:', err.message);
    return null;
  }
}

module.exports = {
  DEFAULT_REPO,
  repo,
  webhookRepoOk,
  isConfigured,
  isAppConfigured,
  searchQuery,
  draftFromQuestion,
  formatIssueCard,
  formatShopTicketCard,
  threadMarker,
  withThreadMarker,
  parseThreadIds,
  stashDraft,
  takeDraft,
  restoreDraft,
  peekDraft,
  linkIssueThread,
  threadsForIssue,
  resetGithubMemory,
  searchIssues,
  existingWork,
  checkedNote,
  linkedChanges,
  textFromEmbeds,
  lookupChange,
  stripShippedClaims,
  customerChangeSentence,
  keepMergedPull,
  scorePull,
  searchPulls,
  createIssue,
  verifyWebhook,
  describeWebhookEvent,
  issueUrl,
};
