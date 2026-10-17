const RELEASES_URL = 'https://api.github.com/repos/BasedHardware/omi/releases?per_page=15';
let cache = { at: 0, notes: [] };

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function wantsReleaseNote(text) {
  const s = String(text || '');
  if (/\b(release notes?|what'?s new|latest version|new version|firmware update)\b/i.test(s)) return true;
  return /\bdesktop\b/i.test(s) && /\b(download|install|version)\b/i.test(s);
}

function clip(text) {
  const plain = String(text || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 280 ? `${plain.slice(0, 280)}…` : plain;
}

// Words a version question shares with every release note. They do not say which release is meant.
const GENERIC = new Set(
  ('the and for with from that this what whats which where when how are was can does did you your any there have has get ' +
    'new newest latest current version versions release releases note notes update updates fix fixed fixes bug bugs ' +
    'app apps omi download downloads install installer firmware desktop mac macos macbook windows computer phone ' +
    'mobile android ios iphone ipad testflight').split(' ')
);

// The one product a text names, or '' when it names none or more than one.
function productOf(text) {
  const s = String(text || '');
  const named = [];
  if (/\bfirmware\b/i.test(s)) named.push('firmware');
  if (/\b(?:desktop|mac(?!\s+address)|macos|macbook|windows|computer)\b/i.test(s)) named.push('desktop');
  if (/\b(?:phone|mobile|android|ios|iphone|ipad|testflight)\b/i.test(s)) named.push('phone');
  return named.length === 1 ? named[0] : '';
}

function publishedTime(note) {
  const time = Date.parse(note?.publishedAt || '');
  return Number.isFinite(time) ? time : 0;
}

function bestNote(question, notes) {
  const product = productOf(question);
  const eligible = (notes || []).filter((note) => !product || productOf(`${note.name} ${note.tag}`) === product);
  const wanted = new Set(words(question).filter((word) => !GENERIC.has(word)));
  let best = null;
  let score = -1;
  for (const note of eligible) {
    const shared = new Set(words(`${note.name} ${note.body}`).filter((word) => wanted.has(word))).size;
    // Lists arrive newest first, so on a tie the earlier note stays unless a later one is dated newer.
    if (shared > score || (shared === score && publishedTime(note) > publishedTime(best))) {
      best = note;
      score = shared;
    }
  }
  // A question about one change needs a note that mentions it. A plain "latest version" takes the newest.
  if (!best || (wanted.size && score < 1)) return '';
  const releaseUrl = best.tag
    ? `https://github.com/BasedHardware/omi/releases/tag/${encodeURIComponent(best.tag)}`
    : '';
  return `${best.name} (${best.tag}). ${clip(best.body)} ${releaseUrl}`.trim();
}

async function loadNotes(fetchImpl, store) {
  const now = Date.now();
  if (cache.notes.length && now - cache.at < 60 * 60 * 1000) return cache.notes;
  const fetchFn = fetchImpl || fetch;
  try {
    const res = await fetchFn(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'omi-vector-bot' },
    });
    if (!res.ok) return cache.notes;
    const data = await res.json();
    const notes = (Array.isArray(data) ? data : []).map((item) => ({
      tag: String(item.tag_name || ''),
      name: String(item.name || item.tag_name || ''),
      body: clip(item.body),
      publishedAt: item.published_at || null,
    }));
    cache = { at: now, notes };
    if (store?.saveRelease) {
      for (const note of notes) {
        try {
          await store.saveRelease(note);
        } catch (err) {
          console.error('[Releases] save failed:', err.message);
        }
      }
    }
    return notes;
  } catch (err) {
    console.error('[Releases] lookup failed:', err.message);
    return cache.notes;
  }
}

async function matchingRelease(question, { fetchImpl, store } = {}) {
  if (!wantsReleaseNote(question)) return '';
  const saved = store || (process.env.DATABASE_URL ? require('./db') : null);
  const notes = await loadNotes(fetchImpl, saved);
  const live = bestNote(question, notes);
  if (live) return live;
  if (!saved?.searchReleases) return '';
  try {
    const rows = await saved.searchReleases(question);
    return bestNote(question, rows);
  } catch (err) {
    console.error('[Releases] stored lookup failed:', err.message);
    return '';
  }
}

function resetReleaseCache() {
  cache = { at: 0, notes: [] };
}

module.exports = { wantsReleaseNote, matchingRelease, bestNote, resetReleaseCache };
