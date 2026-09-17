const { looksLikeStaffLie } = require('./honesty');
const { clipForDiscord } = require('./utils');

const MAX_SNIPPET = 500;
const MAX_STORED = 50;
const SEARCH_LIMIT = 5;

const snippets = [];

function parseFaqCommand(text) {
  const raw = String(text || '').replace(/<@!?\d+>/g, '').trim();
  const match = raw.match(/^faq:\s*([\s\S]*)$/i);
  if (!match) return null;
  return clipForDiscord(match[1].trim(), MAX_SNIPPET);
}

function resetKnowledge() {
  snippets.length = 0;
}

function listSnippets() {
  return [...snippets];
}

function addSnippet(text) {
  const snippet = clipForDiscord(String(text || '').trim(), MAX_SNIPPET);
  if (!snippet) return { ok: false, reason: 'empty' };
  if (looksLikeStaffLie(snippet)) return { ok: false, reason: 'lie' };
  if (snippets[0] === snippet) return { ok: true, snippet, duplicate: true };
  snippets.unshift(snippet);
  if (snippets.length > MAX_STORED) snippets.length = MAX_STORED;
  return { ok: true, snippet };
}

async function persistSnippet(snippet) {
  if (!process.env.DATABASE_URL) return;
  try {
    const db = require('./db');
    await db.addKnowledge(snippet);
  } catch (err) {
    console.error('[Knowledge] db save failed:', err.message);
  }
}

function search(query, limit = SEARCH_LIMIT) {
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);

  const pool = words.length
    ? snippets.filter((s) => {
        const lower = s.toLowerCase();
        return words.some((w) => lower.includes(w));
      })
    : snippets;

  return pool.slice(0, limit);
}

async function searchAll(query, limit = SEARCH_LIMIT) {
  const local = search(query, limit);
  if (!process.env.DATABASE_URL) return local;
  try {
    const db = require('./db');
    const remote = await db.searchKnowledge(query, limit);
    const seen = new Set(local.map((s) => s.toLowerCase()));
    const merged = [...local];
    for (const item of remote) {
      const key = String(item || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
      if (merged.length >= limit) break;
    }
    return merged.slice(0, limit);
  } catch (err) {
    console.error('[Knowledge] db search failed:', err.message);
    return local;
  }
}

module.exports = {
  MAX_SNIPPET,
  parseFaqCommand,
  resetKnowledge,
  listSnippets,
  addSnippet,
  persistSnippet,
  search,
  searchAll,
};
