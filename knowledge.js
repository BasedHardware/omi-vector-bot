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

const STOP = new Set([
  'order',
  'orders',
  'tracking',
  'lookups',
  'lookup',
  'person',
  'cannot',
  'vector',
  'need',
  'needs',
  'and',
  'the',
  'from',
  'here',
  'status',
  'shipping',
]);

function factAlreadyUsed(body, fact) {
  const b = String(body || '').toLowerCase();
  const f = String(fact || '').trim();
  if (!f) return true;
  if (b.includes(f.toLowerCase().slice(0, Math.min(48, f.length)))) return true;
  const tokens = f
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((w) => w.length > 5 && !STOP.has(w.toLowerCase()));
  return tokens.some((w) => b.includes(w.toLowerCase()));
}

function applyStaffFacts(answer, factsIn) {
  const facts = (factsIn || []).map((s) => String(s || '').trim()).filter(Boolean);
  if (!facts.length) return String(answer || '').trim();
  const body = String(answer || '').trim();
  const unused = facts.filter((fact) => !factAlreadyUsed(body, fact));
  if (!unused.length) return body;
  return [unused[0], body].filter(Boolean).join('\n\n');
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

function collectFaqFromMessages(messages) {
  const found = [];
  for (const m of messages || []) {
    if (m?.author?.bot) continue;
    const snippet = parseFaqCommand(m.content);
    if (snippet) found.push(snippet);
  }
  return found;
}

async function hydrateFromDiscord(client) {
  const channelId = process.env.VECTOR_TEST_CHANNEL_ID;
  if (!channelId || !client?.channels?.fetch) return 0;
  const channel = await client.channels.fetch(channelId);
  if (!channel?.threads?.fetchActive) return 0;

  const threads = [];
  const active = await channel.threads.fetchActive();
  if (active?.threads) threads.push(...active.threads.values());
  try {
    const archived = await channel.threads.fetchArchived({ limit: 20 });
    if (archived?.threads) threads.push(...archived.threads.values());
  } catch (err) {
    console.error('[Knowledge] archived threads:', err.message);
  }

  let added = 0;
  const seen = new Set();
  for (const thread of threads) {
    if (!/^Handoff\b/i.test(thread.name || '')) continue;
    if (seen.has(thread.id)) continue;
    seen.add(thread.id);
    const fetched = await thread.messages.fetch({ limit: 50 });
    for (const snippet of collectFaqFromMessages([...fetched.values()].reverse())) {
      const saved = addSnippet(snippet);
      if (saved.ok && !saved.duplicate) added += 1;
    }
  }
  return added;
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
  applyStaffFacts,
  collectFaqFromMessages,
  hydrateFromDiscord,
};
