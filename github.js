const crypto = require('crypto');
const { clipForDiscord } = require('./utils');

const DEFAULT_REPO = 'BasedHardware/omi';
const TIMEOUT_MS = 8000;
const drafts = new Map();
const issueThreads = new Map();

function repo() {
  return String(process.env.GITHUB_REPO || DEFAULT_REPO).replace(/^https?:\/\/github.com\//i, '').replace(/\.git$/, '');
}

function isConfigured() {
  return Boolean(String(process.env.GITHUB_TOKEN || '').trim());
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

function draftFromQuestion(question, area) {
  const asked = clipForDiscord(String(question || '').trim(), 1500);
  const title = clipForDiscord(asked.split('\n')[0] || 'Discord report', 80);
  const labels = ['vector'];
  if (area && area !== 'unknown' && area !== 'shop' && area !== 'privacy') labels.push(area);
  return {
    title,
    body: `Reported in Discord.\n\n${asked || '(no text)'}\n\nFiled only after staff clicked File.`,
    labels,
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
}

async function githubFetch(url, { method = 'GET', body, fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
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

async function createIssue(draft, { fetchImpl } = {}) {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  const url = `https://api.github.com/repos/${repo()}/issues`;
  try {
    const res = await githubFetch(url, {
      method: 'POST',
      body: {
        title: draft.title,
        body: draft.body,
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
      line: extras[0] ? `#${extras[0]} was merged.` : `#${pr} was merged.`,
    };
  }
  if (payload?.issue && payload.action === 'closed') {
    const number = payload.issue.number;
    return {
      kind: 'closed',
      number,
      numbers: [number],
      line: `#${number} was closed.`,
    };
  }
  return null;
}

module.exports = {
  DEFAULT_REPO,
  repo,
  isConfigured,
  searchQuery,
  draftFromQuestion,
  stashDraft,
  takeDraft,
  peekDraft,
  linkIssueThread,
  threadsForIssue,
  resetGithubMemory,
  searchIssues,
  createIssue,
  verifyWebhook,
  describeWebhookEvent,
  issueUrl,
};
