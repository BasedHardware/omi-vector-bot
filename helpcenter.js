const SITEMAP = 'https://help.omi.me/sitemap.xml';
const HELP_FORUM = () => String(process.env.HELP_FORUM_CHANNEL_ID || '').trim();
const { cleanDocument } = require('./retrieval');
const { redactSensitive } = require('./privacy');

function articleUrls(xml) {
  return [...String(xml || '').matchAll(/<loc>(https:\/\/help\.omi\.me\/en\/articles\/[^<]+)<\/loc>/g)].map(
    (match) => match[1]
  );
}

function htmlToText(html) {
  const article = String(html || '').match(/<article[\s\S]*?<\/article>/i);
  const chunk = article ? article[0] : String(html || '');
  return cleanDocument(chunk);
}

// A stored copy of a Discord thread or a Feedback post is shown to the model and can be quoted to
// another customer. It passes the public issue boundary first, then loses any long digit run left.
function redactPublic(text) {
  return redactSensitive(text, { issue: true })
    .replace(/(?<![\d#])\+?(?:\d[\s().-]*){7,14}\d(?!\d)/g, '[phone]');
}

function titleFromHtml(html, url) {
  const title = (String(html || '').match(/<title>([^<]+)<\/title>/i) || [])[1] || url;
  return title.replace(/\s*\|\s*Omi Help Center\s*$/i, '').trim();
}

async function mapPool(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function loadHelpCenter(fetchImpl, db) {
  const fetchFn = fetchImpl || fetch;
  const index = await fetchFn(SITEMAP, { headers: { 'User-Agent': 'omi-vector-bot' } });
  if (!index.ok) return 0;
  const urls = articleUrls(await index.text());
  let saved = 0;
  await mapPool(urls, 4, async (url) => {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'omi-vector-bot' } });
      if (!res.ok) return;
      const html = await res.text();
      const body = htmlToText(html);
      if (!body) return;
      await db.saveDocPage({ url, title: titleFromHtml(html, url), body });
      saved += 1;
    } catch (err) {
      console.error('[Help] article failed:', err.message);
    }
  });
  return saved;
}

async function discordJson(fetchFn, token, url) {
  const res = await fetchFn(url, { headers: { Authorization: `Bot ${token}` } });
  if (res.status === 429) {
    const wait = Number(res.headers?.get?.('retry-after') || 1);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return discordJson(fetchFn, token, url);
  }
  if (!res.ok) return null;
  return res.json();
}

async function loadDiscordHelp(fetchImpl, db) {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  const forumId = HELP_FORUM();
  if (!token || !forumId || !db?.saveDocPage) return 0;
  const fetchFn = fetchImpl || fetch;
  const channel = await discordJson(fetchFn, token, `https://discord.com/api/v10/channels/${forumId}`);
  const guildId = channel?.guild_id;
  if (!guildId) return 0;
  const threads = [];
  let before = '';
  for (let page = 0; page < 4; page += 1) {
    const url = new URL(`https://discord.com/api/v10/channels/${forumId}/threads/archived/public`);
    url.searchParams.set('limit', '100');
    if (before) url.searchParams.set('before', before);
    const data = await discordJson(fetchFn, token, url);
    const list = data?.threads || [];
    threads.push(...list);
    if (!data?.has_more || !list.length) break;
    before = list[list.length - 1]?.thread_metadata?.archive_timestamp || '';
    if (!before) break;
  }
  const active = await discordJson(fetchFn, token, `https://discord.com/api/v10/guilds/${guildId}/threads/active`);
  for (const thread of active?.threads || []) {
    if (thread.parent_id === forumId) threads.push(thread);
  }
  let saved = 0;
  for (const thread of threads) {
    const messages = await discordJson(
      fetchFn,
      token,
      `https://discord.com/api/v10/channels/${thread.id}/messages?limit=50`
    );
    if (!Array.isArray(messages)) continue;
    const lines = messages
      .slice()
      .reverse()
      .filter((message) => message?.content && !message.author?.bot)
      .map((message) => redactPublic(message.content).trim())
      .filter(Boolean);
    if (!lines.length) continue;
    await db.saveDocPage({
      url: `https://discord.com/channels/${guildId}/${thread.id}`,
      title: thread.name || 'Help thread',
      body: lines.join('\n').slice(0, 8000),
    });
    saved += 1;
  }
  return saved;
}

module.exports = { articleUrls, htmlToText, redactPublic, loadHelpCenter, loadDiscordHelp };
