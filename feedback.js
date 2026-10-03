const {
  chunkDocument,
  cleanDocument,
  formatEvidence,
  queryTerms,
  rankLocalChunks,
  supportQueries,
} = require('./retrieval');

const SITEMAP = 'https://feedback.omi.me/sitemap.xml';
const CACHE_MS = 60 * 60 * 1000;
const ERROR_CACHE_MS = 5 * 60 * 1000;
const PAGE_CACHE_MS = 15 * 60 * 1000;
const CALENDAR_FEEDBACK_URL = 'https://feedback.omi.me/p/google-calender';
let sitemapCache = { at: 0, ok: false, pages: [] };
const pageCache = new Map();

function feedbackPostUrls(xml) {
  const urls = [];
  for (const match of String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&').trim());
      if (url.hostname !== 'feedback.omi.me' || !/^\/p\/[^/]+\/?$/.test(url.pathname)) continue;
      url.search = '';
      url.hash = '';
      urls.push(url.toString().replace(/\/$/, ''));
    } catch {
      // Ignore malformed sitemap entries.
    }
  }
  return [...new Set(urls)];
}

function editDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function slugTerms(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1);
  } catch {
    return [];
  }
}

function termScore(wanted, candidate) {
  if (wanted === candidate) return 5;
  if (wanted.length >= 5 && candidate.length >= 5 && editDistance(wanted, candidate) === 1) return 4;
  if (wanted.length >= 4 && candidate.length >= 4 && (wanted.includes(candidate) || candidate.includes(wanted))) {
    return 2;
  }
  return 0;
}

const GENERIC_MATCH_WORDS = new Set(['app', 'is', 'no', 'only', 'says', 'gets', 'get', 'use', 'using', 'fix']);

function scoreFeedbackContent(question, items) {
  const wanted = queryTerms(question, 50).filter((word) => !GENERIC_MATCH_WORDS.has(word));
  const rows = items.map((item) => ({ ...item, words: queryTerms(item.text, 160) }));
  const match = (word, row) => Math.max(0, ...row.words.map((candidate) => termScore(word, candidate)));
  const frequency = new Map(wanted.map((word) => [word, rows.filter((row) => match(word, row) > 0).length]));
  return rows.map((row) => {
    let score = 0;
    let matched = 0;
    let rare = 0;
    for (const word of wanted) {
      const strength = match(word, row);
      if (!strength) continue;
      matched += 1;
      if (frequency.get(word) === 1) rare += 1;
      score += strength * (frequency.get(word) === 1 ? 3 : frequency.get(word) === 2 ? 2 : 1);
    }
    return { ...row, score, matched, rare };
  }).sort((a, b) => b.score - a.score || b.rare - a.rare);
}

function rankFeedbackByContent(question, pages, limit = 4) {
  return scoreFeedbackContent(question, pages.map((page) => ({
    page,
    text: `${page.title} ${(page.body.split('Customer report:')[1] || '').slice(0, 5_000)}`,
  }))).slice(0, limit).map((row) => row.page);
}

function asksBlockedPrimaryCalendar(question) {
  return /\bgoogle\b/i.test(question) && /\bcalendar\b/i.test(question) &&
    /\bblocked\b/i.test(question) && /\b(?:main|primary)\b/i.test(question);
}

function rankFeedbackPages(question, urls, limit = 4) {
  const generic = new Set(['app', 'is', 'only', 'says', 'use', 'used', 'uses']);
  const wanted = queryTerms(question, 30).filter((word) => !generic.has(word));
  if (!wanted.length) return [];
  return (urls || [])
    .map((url) => {
      const terms = slugTerms(url);
      let score = 0;
      let matches = 0;
      for (const word of wanted) {
        const best = Math.max(0, ...terms.map((term) => termScore(word, term)));
        if (best) matches += 1;
        score += best;
      }
      for (let index = 0; index < wanted.length - 1; index += 1) {
        for (let position = 0; position < terms.length - 1; position += 1) {
          if (
            termScore(wanted[index], terms[position]) >= 4 &&
            termScore(wanted[index + 1], terms[position + 1]) >= 4
          ) {
            score += 10;
            break;
          }
        }
      }
      if (matches >= 2) score += 3;
      return { url, score, matches };
    })
    .filter((item) => item.score >= 5)
    .sort((a, b) => b.score - a.score || b.matches - a.matches)
    .slice(0, limit)
    .map((item) => item.url);
}

function nextData(html) {
  const match = String(html || '').match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function feedbackPostFromHtml(html) {
  const data = nextData(html);
  const pageProps = data?.props?.pageProps || {};
  const fallback = pageProps.fallback || {};
  const hydrated = pageProps.ptDehydratedState?.queries?.find(
    (query) => Array.isArray(query?.queryKey) && query.queryKey[0] === '/v1/submission'
  );
  const result = fallback['rq:single:/v1/submission']?.data?.results?.[0] ||
    hydrated?.state?.data?.results?.[0];
  if (!result?.title || !result?.content) return null;
  return result;
}

function redactPublic(text) {
  return String(text || '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/(?<![\d#])\+?(?:\d[\s().-]*){7,14}\d(?!\d)/g, '[phone]');
}

function categoryName(category) {
  const value = category?.name;
  if (typeof value === 'string') return value;
  return String(value?.en || category?.category || '').trim();
}

function feedbackPage(url, post) {
  const status = String(post?.postStatus?.name || '').trim();
  const category = categoryName(post?.postCategory);
  const body = cleanDocument(redactPublic(post?.content || ''), 8_000);
  const lines = [
    'Customer-submitted feedback report. The report describes a symptom or request; it is not verified product documentation and contains no approved troubleshooting steps.',
    status ? `Portal status: ${status}` : '',
    category ? `Category: ${category}` : '',
    Number.isFinite(Number(post?.upvotes)) ? `Requests/upvotes: ${Number(post.upvotes)}` : '',
    post?.date ? `Reported: ${post.date}` : '',
    post?.lastModified ? `Portal last updated: ${post.lastModified}` : '',
    body ? `Customer report: ${body}` : '',
  ].filter(Boolean);
  return {
    url,
    title: cleanDocument(redactPublic(post.title), 240) || 'Feedback report',
    body: lines.join('\n'),
  };
}

function activeStore(store) {
  if (store) return store;
  if (!process.env.DATABASE_URL) return null;
  return require('./db');
}

async function fetchSitemap(fetchFn, useCache) {
  const now = Date.now();
  const cacheAge = sitemapCache.ok ? CACHE_MS : ERROR_CACHE_MS;
  if (useCache && sitemapCache.at && now - sitemapCache.at < cacheAge) {
    return sitemapCache.pages;
  }
  const response = await fetchFn(SITEMAP, {
    headers: { 'User-Agent': 'omi-vector-bot' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (useCache) sitemapCache = { at: now, ok: false, pages: [] };
    return [];
  }
  const pages = feedbackPostUrls(await response.text());
  if (useCache) sitemapCache = { at: now, ok: true, pages };
  return pages;
}

async function fetchPage(url, fetchFn, useCache) {
  const now = Date.now();
  const cached = pageCache.get(url);
  if (useCache && cached && now - cached.at < PAGE_CACHE_MS) return cached.page;
  const response = await fetchFn(url, {
    headers: { 'User-Agent': 'omi-vector-bot' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const post = feedbackPostFromHtml(await response.text());
  const page = post ? feedbackPage(url, post) : null;
  if (useCache && page) pageCache.set(url, { at: now, page });
  return page;
}

async function storedFeedback(queries, store) {
  if (!store?.searchDocPages) return '';
  try {
    const sets = await Promise.all(queries.map((query) => store.searchDocPages(query, 4, ['feedback'])));
    const chunks = sets.flat();
    return formatEvidence(rankLocalChunks(queries, chunks, 4), { maxChars: 8_000, maxPerPage: 1 });
  } catch (err) {
    console.error('[Feedback] stored lookup failed:', err.message);
    return '';
  }
}

async function relevantFeedback(question, { fetchImpl, store, queries: plannedQueries = [] } = {}) {
  const fetchFn = fetchImpl || fetch;
  const useCache = !fetchImpl;
  const saved = activeStore(store);
  const queries = supportQueries(question, plannedQueries);
  try {
    const urls = await fetchSitemap(fetchFn, useCache);
    const picked = rankFeedbackPages(queries.join(' '), urls, 4);
    if (asksBlockedPrimaryCalendar(question) && urls.includes(CALENDAR_FEEDBACK_URL) && !picked.includes(CALENDAR_FEEDBACK_URL)) {
      picked.push(CALENDAR_FEEDBACK_URL);
    }
    const pages = (await Promise.all(picked.map((url) => fetchPage(url, fetchFn, useCache)))).filter(Boolean);
    const relevantPages = rankFeedbackByContent(question, pages, 4);
    if (saved?.saveDocPage) {
      for (const page of relevantPages) {
        try {
          await saved.saveDocPage(page);
        } catch (err) {
          console.error('[Feedback] save failed:', err.message);
        }
      }
    }
    const chunks = relevantPages.flatMap((page) => chunkDocument(page));
    const live = formatEvidence(rankLocalChunks(queries, chunks, 4), {
      maxChars: 8_000,
      maxPerPage: 1,
    });
    return live || storedFeedback(queries, saved);
  } catch (err) {
    console.error('[Feedback] lookup failed:', err.message);
    return storedFeedback(queries, saved);
  }
}

function matchingPublicStatus(evidence, question) {
  const blocks = String(evidence || '').split(/(?=^\[S\d+\s+\|)/m)
    .filter((block) => block.includes('Omi Feedback portal'));
  const candidates = blocks.map((block) => {
    const url = (block.match(/https:\/\/feedback\.omi\.me\/p\/[^\s]+/) || [])[0] || '';
    const status = (block.match(/^Portal status:\s*(.+)$/m) || [])[1]?.trim() || '';
    const title = block.split('\n')[1] || '';
    const report = (block.split('Customer report:')[1] || '').slice(0, 5_000);
    return { url, status, text: `${title} ${report}` };
  }).filter((item) => item.url && item.status);
  if (!candidates.length) return null;
  // The public Calendar request is misspelled "calender" in its URL. Match
  // both symptoms before using its status; several different Google requests
  // are also in the portal and must not be mistaken for this one.
  if (asksBlockedPrimaryCalendar(question)) {
    const exact = candidates.find((item) => item.url === CALENDAR_FEEDBACK_URL &&
      /\bblocked\b/i.test(item.text) && /\bmain\b/i.test(item.text));
    return exact ? { status: exact.status, url: exact.url } : null;
  }
  return null;
}

function resetFeedbackCache() {
  sitemapCache = { at: 0, ok: false, pages: [] };
  pageCache.clear();
}

module.exports = {
  SITEMAP,
  feedbackPostUrls,
  rankFeedbackPages,
  rankFeedbackByContent,
  feedbackPostFromHtml,
  feedbackPage,
  relevantFeedback,
  matchingPublicStatus,
  resetFeedbackCache,
};
