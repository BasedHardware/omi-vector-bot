// Synthetic integration fixture. Receives the verifier's isolated SQL pool;
// it never reads credentials, opens a Discord connection or calls a provider.
const assert = require('node:assert/strict');
const { createSupportMemory } = require('../supportMemory');
const { createPostgresStore } = require('../supportMemoryStore');
const { createObserver } = require('../supportLearning');

async function verifyMemoryContext(pool, prefix, { observerFactory = createObserver } = {}) {
  const checks = [], posts = new Map(), messages = new Map(), reads = [];
  let now = Date.now();
  const policy = { enabled: true, contextEnabled: true, forumIds: ['rehearsal-help', 'rehearsal-other'],
    deleteForumIds: ['rehearsal-help', 'rehearsal-other'], staffIds: ['rehearsal-staff'], botId: 'rehearsal-bot' };
  const ownerId = `${prefix}-owner`, guildId = `${prefix}-guild`;
  const client = { channels: { fetch: async (id, flags) => {
    assert.deepEqual(flags, { force: true, cache: false });
    reads.push({ type: 'post', id });
    if (!posts.has(id)) throw Object.assign(Error('Synthetic missing post'), { code: 10003 });
    return posts.get(id);
  } } };
  const post = (name, owner = ownerId, forum = 'rehearsal-help', guild = guildId) => {
    const channel = { id: `${prefix}-${name}`, ownerId: owner, parentId: forum, guildId: guild, client,
      name: 'Synthetic earlier support', isThread: () => true };
    channel.messages = { fetch: async flags => {
      assert.deepEqual(flags, { message: flags.message, force: true, cache: false });
      reads.push({ type: 'message', id: flags.message });
      if (!messages.has(flags.message)) throw Object.assign(Error('Synthetic missing message'), { code: 10008 });
      return messages.get(flags.message);
    } };
    posts.set(channel.id, channel); return channel;
  };
  const service = () => createSupportMemory({ store: createPostgresStore(pool), policy: () => policy, now: () => now });
  async function assertMetadataOnly() {
    for (const table of ['support_memory_messages', 'support_quality_signals', 'support_memory_scopes', 'support_memory_deletions', 'support_memory_opt_outs']) {
      const columns = await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [table]);
      assert.ok(columns.rows.every(row => !/^(?:text|content|ciphertext|iv|tag|title|embedding|attachment)/i.test(row.column_name)));
      const stored = await pool.query(`SELECT * FROM ${table}`);
      assert.doesNotMatch(JSON.stringify(stored.rows), /CANARY_|Earlier synthetic|Edited live|Current synthetic/);
    }
  }
  const memory = service();
  const current = post('current'), first = post('first'), second = post('second'), older = post('older');
  const stranger = post('stranger', `${prefix}-another-owner`);
  const otherForum = post('other-forum', ownerId, 'rehearsal-other');
  const otherGuild = post('other-guild', ownerId, 'rehearsal-help', `${prefix}-other-guild`);
  async function save(name, channel, text, author = channel.ownerId, at = now - 10000) {
    const message = { id: `${prefix}-${name}`, channel, guildId: channel.guildId,
      author: { id: author, bot: author === policy.botId }, content: text, createdTimestamp: at };
    messages.set(message.id, message);
    assert.equal(await memory.capture(message), true);
    return message;
  }
  const scope = memory.scopeFor(current);
  const live = [{ id: `${prefix}-current-message`, channel: current, guildId,
    author: { id: ownerId, bot: false }, content: 'Current synthetic post detail.', createdTimestamp: now - 1 }];
  await save('older-owner', older, 'CANARY_OLDER_POST', ownerId, now - 20000);
  await save('second-owner', second, 'Earlier synthetic cable check.', ownerId, now - 15000);
  await save('second-bot', second, 'Earlier synthetic answer.', policy.botId, now - 14000);
  for (let i = 0; i < 4; i++) await save(`first-owner-${i}`, first, i === 0 ? 'CANARY_OLDEST_OWNER' : `Earlier synthetic attempt ${i}.`, ownerId, now - 9000 + i);
  const lastOwner = messages.get(`${prefix}-first-owner-3`);
  await save('first-old-bot', first, 'CANARY_OLD_BOT', policy.botId, now - 8000);
  const lastBot = await save('first-last-bot', first, 'Current synthetic bot suggestion.', policy.botId, now - 7000);
  for (let i = 0; i < 55; i++) await save(`staff-${i}`, first, 'CANARY_STAFF_CHAT', policy.staffIds[0], now - 6000 + i);
  for (const channel of [stranger, otherForum, otherGuild]) await save(`excluded-${channel.id.slice(prefix.length + 1)}`, channel, 'CANARY_OTHER_SCOPE', channel.ownerId, now - 1000);
  await memory.signal({ ...memory.scopeFor(first), eventId: `${prefix}-outcome`, kind: 'resolved', area: 'app' });
  let observer = observerFactory(memory);
  const read = () => observer.history(current, `${prefix}-newest`, live, ownerId);
  const previous = rows => rows.filter(row => row.source === 'previous_post');
  const rows = await read(), notes = previous(rows);
  assert.deepEqual(notes.map(row => row.id).sort(), [first, second].map(channel => 'previous-' + channel.id).sort());
  assert.ok(notes.every(row => row.trust === 'conversation_only'));
  assert.ok(rows.some(row => row.content === live[0].content));
  assert.match(notes.find(row => row.id === 'previous-' + first.id).content, /attempt 1[\s\S]*attempt 2[\s\S]*attempt 3/);
  assert.match(notes.find(row => row.id === 'previous-' + first.id).content, /Current synthetic bot suggestion/);
  assert.match(notes.find(row => row.id === 'previous-' + first.id).content, /Stored outcome: resolved/);
  assert.doesNotMatch(JSON.stringify(rows), /CANARY_/);
  assert.equal(reads.filter(row => row.type === 'message').length, 6);
  await assertMetadataOnly(); // Check retained rows before erasure, not just an empty table.
  checks.push('SQL-backed two-post lookup, role ranking, scope exclusion and context-only markers');

  lastOwner.content = 'Edited live attempt; CANARY_FRESH_EDIT.';
  observer = observerFactory(service()); // New reader/service, same durable SQL database.
  assert.match(JSON.stringify(previous(await read())), /CANARY_FRESH_EDIT/);
  await assertMetadataOnly();
  checks.push('reader restart and uncached live edits, not persisted message copies');

  const beforeStranger = reads.length;
  assert.deepEqual(await observer.history(current, `${prefix}-newest`, live, stranger.ownerId), []);
  assert.equal(reads.length, beforeStranger);
  first.ownerId = stranger.ownerId;
  const changed = previous(await read());
  assert.equal(changed.length, 1); assert.equal(changed[0].id, 'previous-' + second.id);
  first.ownerId = ownerId;
  checks.push('current participant and live prior-post ownership are revalidated');

  messages.delete(lastBot.id);
  const withoutDeleted = previous(await read()).find(row => row.id === 'previous-' + first.id);
  assert.match(withoutDeleted.content, /Stored outcome: unknown/);
  assert.doesNotMatch(withoutDeleted.content, /Current synthetic bot suggestion/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM support_memory_messages WHERE message_id=$1', [lastBot.id])).rows[0].n, 0);
  checks.push('confirmed live deletion removes the SQL reference and invalidates its outcome');

  policy.contextEnabled = false;
  const beforeOff = reads.length;
  assert.deepEqual((await read()).map(row => row.content), [live[0].content]);
  assert.equal(reads.length, beforeOff);
  policy.enabled = false;
  await memory.forgetCustomer(scope);
  checks.push('context switch stops live reads; forum erasure still works with capture off');

  for (const table of ['support_memory_messages', 'support_quality_signals', 'support_memory_scopes', 'support_memory_deletions']) {
    const result = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE guild_id=$1 AND forum_id=$2 AND customer_id=$3`, [guildId, scope.forumId, ownerId]);
    assert.equal(result.rows[0].n, 0);
  }
  policy.enabled = true; policy.contextEnabled = true;
  const restarted = service(); observer = observerFactory(restarted);
  assert.deepEqual(previous(await read()), []);
  assert.equal(await restarted.capture({ ...live[0], id: `${prefix}-new-post-message`, channel: post('after-forget') }), false);
  for (const channel of [stranger, otherForum, otherGuild]) {
    assert.equal((await restarted.history(restarted.scopeFor(channel))).length, 1);
  }
  checks.push('forum-wide opt-out survives service restart without erasing other scopes');

  now += 31 * 86400000;
  policy.enabled = false; policy.contextEnabled = false;
  const guilds = [guildId, `${prefix}-other-guild`];
  assert.ok((await pool.query('SELECT count(*)::int AS n FROM support_memory_messages WHERE guild_id IN ($1,$2) AND expires_at<=$3', [...guilds, now])).rows[0].n > 0);
  await restarted.prune();
  for (const table of ['support_memory_messages', 'support_quality_signals', 'support_memory_scopes', 'support_memory_deletions']) {
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE guild_id IN ($1,$2) AND expires_at<=$3`, [...guilds, now])).rows[0].n, 0);
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM support_memory_opt_outs WHERE guild_id=$1 AND forum_id=$2 AND customer_id=$3', [guildId, scope.forumId, ownerId])).rows[0].n, 1);
  policy.enabled = true;
  assert.equal(await restarted.capture({ ...live[0], id: `${prefix}-after-expiry`, channel: post('after-expiry'), createdTimestamp: now }), false);
  checks.push('expiry cleanup runs while off without silently expiring opt-out');

  await assertMetadataOnly();
  checks.push('memory SQL schemas and stored rows contain no fixture text or encryption fields');
  return checks;
}

module.exports = { verifyMemoryContext };
