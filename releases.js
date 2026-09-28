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

function bestNote(question, notes) {
  const wanted = new Set(words(question));
  let best = null;
  let score = 0;
  for (const note of notes || []) {
    const shared = words(`${note.name} ${note.body}`).filter((word) => wanted.has(word)).length;
    if (shared > score) {
      best = note;
      score = shared;
    }
  }
  if (!best || score < 1) return '';
  return `${best.name} (${best.tag}). ${clip(best.body)}`.trim();
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
