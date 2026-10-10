const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRowBuilder, MessageFlags } = require('discord.js');
const { closePayload, closeHandoff, handleRating } = require('../commands');
const { APP_STORE_REVIEW_URL, GOOGLE_PLAY_URL } = require('../appReviews');
const { createCaseService, createMemoryStore } = require('../supportCases');
const ratings = require('../ratings');

test('closing card separates issue feedback from optional honest store reviews', () => {
  const payload = closePayload({ id: 'staff-1' });
  assert.equal(payload.embeds[0].title, 'How did we do?');
  const text = JSON.stringify(payload.embeds);
  assert.match(text, /Did we help solve your problem/);
  assert.match(text, /honest rating or review/);
  assert.match(text, /optional and does not affect your support/);
  assert.match(text, /Write a review/);
  assert.doesNotMatch(text, /five[- ]star|5[- ]star|positive review|reward|discount|We won't see replies/i);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  assert.deepEqual(payload.components[0].components.map((button) => button.custom_id), ['rate:yes', 'rate:no']);
  assert.equal(payload.components[1].components.length, 2);
  for (const row of payload.components) assert.doesNotThrow(() => new ActionRowBuilder(row).toJSON());
});

test('store buttons use the verified Omi IDs and cannot be counted as dashboard votes', () => {
  const buttons = closePayload({ id: 'staff' }).components[1].components;
  assert.equal(buttons[0].url, APP_STORE_REVIEW_URL);
  assert.equal(new URL(buttons[0].url).hostname, 'apps.apple.com');
  assert.equal(new URL(buttons[0].url).searchParams.get('action'), 'write-review');
  assert.match(new URL(buttons[0].url).pathname, /id6502156163$/);
  assert.equal(buttons[1].url, GOOGLE_PLAY_URL);
  assert.equal(new URL(buttons[1].url).searchParams.get('id'), 'com.friend.ios');
  assert.equal(buttons[1].label, 'Open Google Play');
  for (const button of buttons) {
    assert.equal(button.style, 5);
    assert.equal(button.custom_id, undefined);
    assert.doesNotMatch(button.url, /customer|thread|discord|support_case|referrer/);
  }
});

test('/done publishes both store links before any helpful choice, without changing feedback counts', async (t) => {
  const previousDb = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  t.after(() => { if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb; });
  ratings.resetRatings();
  const sent = [];
  const cases = createCaseService(createMemoryStore());
  const result = await closeHandoff({
    id: 'thread-review', name: 'Handoff · app', isThread: () => true,
    send: async (payload) => { sent.push(payload); return { id: 'notice' }; },
    edit: async () => {},
  }, { id: 'staff' }, { cases });
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0].components[1].components.map((button) => button.url), [APP_STORE_REVIEW_URL, GOOGLE_PLAY_URL]);
  assert.deepEqual(await ratings.ratingCounts(), { yes: 0, no: 0 });
});

test('support feedback still updates the existing dashboard for either choice', async (t) => {
  const previous = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  t.after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  ratings.resetRatings();
  const cases = createCaseService(createMemoryStore());
  const replies = [];
  for (const customId of ['rate:yes', 'rate:no']) {
    await handleRating({ customId, channelId: 'same-thread', channel: { ownerId: 'customer' },
      user: { id: 'customer' }, reply: async (payload) => replies.push(payload) }, { cases, notifyStaff: async () => true });
  }
  assert.deepEqual(await ratings.ratingCounts(), { yes: 0, no: 1 });
  assert.equal(replies.length, 2);
  assert.ok(replies.every((reply) => reply.flags === MessageFlags.Ephemeral));
  // Both links were already presented, never conditionally unlocked by rate:yes.
  assert.equal(closePayload({ id: 'staff' }).components[1].components.length, 2);
});

test('a failed feedback write does not claim it was recorded or invent zero totals', async () => {
  const replies = []; const staff = []; const logs = [];
  const oldError = console.error; console.error = (...args) => logs.push(args.join(' '));
  try {
    await handleRating({ customId: 'rate:yes', channelId: 'thread', channel: { ownerId: 'customer' }, user: { id: 'customer' },
      reply: async (payload) => replies.push(payload) }, {
      cases: createCaseService(createMemoryStore()),
      recordRating: async () => { throw new Error('private fixture email/customer@example.test'); },
      notifyStaff: async (_client, payload) => staff.push(payload),
    });
  } finally { console.error = oldError; }
  assert.match(replies[0].content, /could not save.*try the feedback button/is);
  assert.doesNotMatch(replies[0].content, /recorded|Glad it helped/);
  assert.match(staff[0].content, /totals are temporarily unavailable/);
  assert.doesNotMatch(staff[0].content, /Helpful: 0|Still need help: 0/);
  assert.doesNotMatch(logs.join(' '), /customer@example\.test/);
});

test('an already reopened case stays open on repeated still-help feedback', async () => {
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'post', customerId: 'customer', customerThreadId: 'post' });
  await cases.resolveCase(value.id, { confirmed: true, close: true });
  const channel = { id: 'post', archived: true, locked: true,
    edit: async () => { channel.archived = false; channel.locked = false; } };
  const replies = [];
  for (let count = 0; count < 2; count++) await handleRating({
    customId: 'rate:no', channelId: 'post', channel, user: { id: 'customer' }, reply: async (payload) => replies.push(payload),
  }, { cases, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true });
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  assert.ok(replies.every((reply) => /case is reopened/i.test(reply.content)));
});

test('a made-up store callback never records support feedback', async () => {
  let calls = 0; const replies = [];
  await handleRating({ customId: 'rate:app-store', reply: async (payload) => replies.push(payload) }, {
    recordRating: async () => { calls++; },
  });
  assert.equal(calls, 0);
  assert.match(replies[0].content, /not a support feedback/);
});

test('stored feedback is acknowledged even if aggregate counts are unavailable', async (t) => {
  const db = require('../db'); const previous = process.env.DATABASE_URL;
  const oldSave = db.saveRating; const oldCounts = db.ratingCounts;
  process.env.DATABASE_URL = 'test-only';
  db.saveRating = async () => {}; db.ratingCounts = async () => { throw new Error('totals unavailable'); };
  t.after(() => { db.saveRating = oldSave; db.ratingCounts = oldCounts; if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  assert.deepEqual(await ratings.recordRating('thread', 'customer', true), { yes: null, no: null });
  await assert.rejects(ratings.ratingCounts(), /totals unavailable/);
});
