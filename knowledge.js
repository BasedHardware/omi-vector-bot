const { looksLikeStaffLie } = require('./honesty');
const { clipForDiscord } = require('./utils');

const MAX_SNIPPET = 500;
const MAX_STORED = 50;
const SEARCH_LIMIT = 5;

const snippets = [];

function learnFromStaff(text) {
  const raw = String(text || '').replace(/<@!?\d+>/g, '').trim();
  if (!raw || raw.length < 24 || raw.length > 280) return null;
  if (/[?]/.test(raw) || /^(faq:|\/)/i.test(raw)) return null;
  if (/\b(i'll|i will|let me|i'm|i am|i think|maybe|not sure|might|probably|i guess)\b/i.test(raw)) return null;
  if (!/\b(is|are|means|works|uses|stores|deletes)\b/i.test(raw)) return null;
  if (looksLikeStaffLie(raw)) return null;
  return clipForDiscord(raw, MAX_SNIPPET);
}

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
  try {
    const shopify = require('./shopify');
    if (shopify.isConfigured() && /cannot see shopify/i.test(snippet)) {
      return { ok: false, reason: 'stale' };
    }
  } catch {
    /* shopify optional */
  }
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

function searchWords(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5);
}

const HOWTO_FACT = /\b(pair|pairing|bluetooth|led\b|teal|orange =|dev kit|cv1|center button)\b/i;
const DEVICE_FACT = /\b(necklace|blue light|teal|pairing|bluetooth|recording|disconnected)\b/i;
const SHOP_FACT = /\b(shopify|order lookups?|order and tracking|order status|tracking number|where is (?:my|the) order|\/order)\b/i;

function isHowtoFact(text) {
  return HOWTO_FACT.test(String(text || ''));
}

function isShopFact(text) {
  return SHOP_FACT.test(String(text || ''));
}

function filterSnippetsForLane(snippets, lane) {
  const list = (snippets || []).map((s) => String(s || '').trim()).filter(Boolean);
  const keepShop = lane === 'shop' || lane === 'money';
  if (!lane || lane === 'faq' || lane === 'unknown') {
    return keepShop ? list : list.filter((s) => !isShopFact(s));
  }
  let filtered = list.filter((s) => !isHowtoFact(s));
  if (lane === 'shop' || lane === 'money' || lane === 'privacy') {
    filtered = filtered.filter((s) => !DEVICE_FACT.test(s));
  }
  if (!keepShop) filtered = filtered.filter((s) => !isShopFact(s));
  return filtered;
}

function search(query, limit = SEARCH_LIMIT) {
  const words = searchWords(query);
  if (!words.length) return [];

  const pool = snippets.filter((s) => {
    const lower = s.toLowerCase();
    return words.some((w) => lower.includes(w));
  });

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
  if (!searchWords(query).length) return [];
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
  learnFromStaff,
  resetKnowledge,
  listSnippets,
  addSnippet,
  persistSnippet,
  search,
  searchAll,
  applyStaffFacts,
  collectFaqFromMessages,
  hydrateFromDiscord,
  filterSnippetsForLane,
  isHowtoFact,
};
