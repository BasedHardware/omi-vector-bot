const assert = require('node:assert/strict');
const test = require('node:test');
const {
  closeHandoff,
  closePayload,
  testCommand,
  isVectorTestParent,
  handleTest,
} = require('../commands');
const { canStaffAct, formatStaffTicket } = require('../handoff');

function closeText(payload) {
  if (typeof payload === 'string') return payload;
  return [payload?.embeds?.[0]?.title, payload?.embeds?.[0]?.description, payload?.content]
    .filter(Boolean)
    .join('\n');
}

function closureOptions(cases, extra = {}) {
  const deliveries = require('../supportDeliveries');
  const actions = require('../supportCaseActions');
  return { cases, client: { user: { id: 'test-bot' } },
    deliveries: deliveries.createDeliveryService(deliveries.createMemoryStore(), { log: () => {} }),
    actions: actions.createActionService(actions.createMemoryStore(), { log: () => {} }),
    sendNotice: async (client, channel, payload) => {
      const sent = await channel.send(payload);
      return sent?.id ? { ...sent, channelId: channel.id, author: { id: client.user.id, bot: true }, nonce: payload.nonce } : sent;
    },
    patchThread: async (_client, channel, changes) => {
      if ('appliedTags' in changes) await channel.setAppliedTags?.(changes.appliedTags);
      else if (channel.edit) await channel.edit(changes);
      else if ('archived' in changes) await channel.setArchived?.(changes.archived);
      return { id: channel.id, ...changes };
    }, ...extra };
}

test('/test is a guild slash command named test', () => {
  assert.equal(testCommand.name, 'test');
  const question = (testCommand.options || []).find((option) => option.name === 'question');
  assert.equal(Boolean(question), true);
  assert.equal(question.required, true);
});

test('/test only runs in the #vector-test parent channel', async () => {
  const prev = process.env.VECTOR_TEST_CHANNEL_ID;
  process.env.VECTOR_TEST_CHANNEL_ID = '1550182642874589194';
  const replies = [];
  try {
    assert.equal(isVectorTestParent({ id: '1550182642874589194' }), true);
    assert.equal(isVectorTestParent({ id: 'other' }), false);
    assert.equal(
      isVectorTestParent({
        id: 'post1',
        parentId: '1550182642874589194',
        name: 'Deleting Convos and Memories',
        isThread: () => true,
      }),
      true
    );
    assert.equal(
      isVectorTestParent({
        id: 'handoff1',
        parentId: '1550182642874589194',
        name: 'Handoff · desktop · deletion',
        isThread: () => true,
      }),
      false
    );
    await handleTest({
      channel: { id: 'other' },
      options: { getString: () => 'What triggers the Omi window to come to the front?' },
      reply: async (payload) => {
        replies.push(payload);
      },
    });
    assert.match(String(replies[0]?.content || ''), /#vector-test/);
  } finally {
    if (prev === undefined) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prev;
  }
});

test('/done refuses non-handoff channels', async () => {
  const result = await closeHandoff(
    { isThread: () => true, name: 'daily-reports' },
    { id: '1' }
  );
  assert.equal(result.ok, false);
});

test('/done still archives if the later Discord ack would fail', async () => {
  const sent = [];
  const channel = {
    isThread: () => true,
    name: 'Handoff · astar6969',
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
    setLocked: async () => {},
    setArchived: async () => {
      channel.archived = true;
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.equal(channel.archived, true);
  assert.equal(sent.some((t) => /That command failed/i.test(closeText(t))), false);
});

test('/done still resolves when Discord refuses archive after lock', async () => {
  const sent = [];
  const channel = {
    isThread: () => true,
    name: 'Handoff · astar6969',
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
    edit: async () => {
      throw new Error('Missing Access');
    },
    setLocked: async () => {},
    setArchived: async () => {
      throw new Error('Missing Access');
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0], closePayload({ id: '99' }));
  assert.equal(sent[0].embeds[0].title, 'How did we do?');
  assert.match(sent[0].embeds[0].thumbnail.url, /app_launcher_icon\.png/);
  assert.equal(sent[0].files, undefined);
});

test('/done interaction does not say the command failed after a close', async () => {
  const { handleInteraction } = require('../commands');
  const prevStaff = process.env.STAFF_USER_IDS;
  process.env.STAFF_USER_IDS = '123456789012345678';
  const replies = [];
  const interaction = {
    commandName: 'done',
    user: { id: '123456789012345678' },
    isChatInputCommand: () => true,
    deferReply: async () => {
      interaction.deferred = true;
    },
    editReply: async (text) => {
      replies.push(text);
    },
    followUp: async ({ content }) => {
      replies.push(content);
    },
    reply: async ({ content }) => {
      replies.push(content);
    },
    channel: {
      isThread: () => true,
      name: 'Handoff · astar6969',
      send: async (text) => text,
      edit: async () => {
        throw new Error('Missing Access');
      },
    },
  };
  try {
    await handleInteraction(interaction);
    assert.equal(replies.some((t) => /command failed/i.test(String(t))), false);
    assert.equal(replies[0], 'Marked resolved.');
  } finally {
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
  }
});

test('/done archives a Handoff thread and does not file GitHub', async () => {
  const sent = [];
  const channel = {
    isThread: () => true,
    name: 'Handoff · astar6969',
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
    setLocked: async () => {},
    setArchived: async () => {
      channel.archived = true;
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0], closePayload({ id: '99' }));
  assert.match(closeText(sent[0]), /How did we do/);
  assert.match(closeText(sent[0]), /open a new post in Help/);
  assert.equal(channel.archived, true);
});

test('/done archives a public help-forum post', async () => {
  const sent = [];
  const channel = {
    isThread: () => true,
    name: 'App goes offline',
    parentId: 'help-forum',
    parent: { type: 15 },
    send: async (payload) => {
      sent.push(payload);
      return payload;
    },
    setLocked: async () => {},
    setArchived: async () => {
      channel.archived = true;
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.deepEqual(sent[0], closePayload({ id: '99' }));
  assert.equal(channel.archived, true);
});

test('/done on a help post still works when only HELP_FORUM_CHANNEL_ID is set', async () => {
  const prev = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = 'help-forum';
  try {
    const channel = {
      isThread: () => true,
      name: 'Already fixed on main',
      parentId: 'help-forum',
      send: async (text) => text,
      setLocked: async () => {},
      setArchived: async () => {
        channel.archived = true;
      },
    };
    const result = await closeHandoff(channel, { id: '99' });
    assert.equal(result.ok, true);
    assert.equal(channel.archived, true);
  } finally {
    if (prev == null) delete process.env.HELP_FORUM_CHANNEL_ID;
    else process.env.HELP_FORUM_CHANNEL_ID = prev;
  }
});

test('/done applies the forum Resolved tag even if archive is denied', async () => {
  const tags = [];
  const channel = {
    isThread: () => true,
    name: 'App goes offline',
    parentId: 'help-forum',
    parent: {
      type: 15,
      availableTags: [
        { id: 'tag-android', name: 'Android' },
        { id: 'tag-resolved', name: 'Resolved' },
      ],
    },
    appliedTags: ['tag-android'],
    send: async (payload) => payload,
    setAppliedTags: async (ids) => {
      tags.push(ids);
      channel.appliedTags = ids;
    },
    edit: async () => {
      throw new Error('Missing Access');
    },
    setArchived: async () => {
      throw new Error('Missing Access');
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.deepEqual(tags[0], ['tag-android', 'tag-resolved']);
});

test('canStaffAct is named staff, or anyone in #vector-test when the list is empty', () => {
  process.env.STAFF_USER_IDS = '123456789012345678';
  assert.equal(canStaffAct({ user: { id: '123456789012345678' }, channel: {} }), true);
  assert.equal(canStaffAct({ user: { id: '222' }, channel: {} }), false);
  delete process.env.STAFF_USER_IDS;
  process.env.VECTOR_TEST_CHANNEL_ID = 'testchan';
  assert.equal(
    canStaffAct({
      user: { id: '222' },
      channel: { id: 't', parentId: 'testchan', isThread: () => true },
    }),
    true
  );
  delete process.env.VECTOR_TEST_CHANNEL_ID;
});

test('canStaffAct never uses the empty-list bypass on a public help post', () => {
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevRole = process.env.STAFF_ROLE_ID;
  const prevTest = process.env.VECTOR_TEST_CHANNEL_ID;
  const forum = {
    id: 'thread',
    parentId: 'help-forum',
    parent: { type: 15 },
    isThread: () => true,
  };
  try {
    delete process.env.STAFF_USER_IDS;
    delete process.env.STAFF_ROLE_ID;
    process.env.VECTOR_TEST_CHANNEL_ID = 'testchan';
    assert.equal(canStaffAct({ user: { id: '222' }, channel: forum }), false);
    process.env.STAFF_USER_IDS = '123456789012345678';
    assert.equal(canStaffAct({ user: { id: '123456789012345678' }, channel: forum }), true);
    assert.equal(canStaffAct({ user: { id: '333' }, channel: forum }), false);
  } finally {
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevRole == null) delete process.env.STAFF_ROLE_ID;
    else process.env.STAFF_ROLE_ID = prevRole;
    if (prevTest == null) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prevTest;
  }
});

test('canStaffAct allows Manage Threads on a public help post', () => {
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevRole = process.env.STAFF_ROLE_ID;
  const prevTest = process.env.VECTOR_TEST_CHANNEL_ID;
  const forum = {
    id: 'thread',
    parentId: 'help-forum',
    parent: { type: 15 },
    isThread: () => true,
  };
  try {
    delete process.env.STAFF_USER_IDS;
    delete process.env.STAFF_ROLE_ID;
    delete process.env.VECTOR_TEST_CHANNEL_ID;
    assert.equal(
      canStaffAct({
        user: { id: '222' },
        channel: forum,
        memberPermissions: { has: (flag) => flag === 'ManageThreads' },
      }),
      true
    );
    assert.equal(canStaffAct({ user: { id: '222' }, channel: forum }), false);
  } finally {
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevRole == null) delete process.env.STAFF_ROLE_ID;
    else process.env.STAFF_ROLE_ID = prevRole;
    if (prevTest == null) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prevTest;
  }
});

test('canStaffAct still allows anyone in a #vector-test forum thread when the list is empty', () => {
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevRole = process.env.STAFF_ROLE_ID;
  const prevTest = process.env.VECTOR_TEST_CHANNEL_ID;
  try {
    delete process.env.STAFF_USER_IDS;
    delete process.env.STAFF_ROLE_ID;
    process.env.VECTOR_TEST_CHANNEL_ID = 'testchan';
    assert.equal(
      canStaffAct({
        user: { id: '222' },
        channel: {
          id: 'thread',
          parentId: 'testchan',
          parent: { type: 15 },
          isThread: () => true,
        },
      }),
      true
    );
  } finally {
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevRole == null) delete process.env.STAFF_ROLE_ID;
    else process.env.STAFF_ROLE_ID = prevRole;
    if (prevTest == null) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prevTest;
  }
});

test('File issue button is only added when a draft id is passed', () => {
  const withBtn = formatStaffTicket({
    message: { author: { id: '1' }, channel: { id: '2' } },
    question: 'app crashed',
    area: 'app',
    fileIssueId: 'abcd1234',
  });
  assert.equal(withBtn.discord.components[0].components[0].custom_id, 'file:abcd1234');
  const none = formatStaffTicket({
    message: { author: { id: '1' }, channel: { id: '2' } },
    question: 'Where is my order?',
    area: 'shop',
  });
  assert.equal(none.discord.components, undefined);
});

test('/done closes the linked durable case and exact escalation after sending the notice', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  await cases.linkHandoff(value.id, { handoffThreadId: 'handoff-alice', escalationId: 42 });
  const events = [];
  const channel = { id: 'handoff-alice', name: 'Handoff · app', isThread: () => true,
    send: async () => { events.push('send'); return { id: 'notice' }; },
    setArchived: async () => { events.push('archive'); },
  };
  const db = { getPendingEscalation: async () => ({ id: 99 }), resolveEscalation: async (id) => events.push(`resolve:${id}`) };
  assert.equal((await closeHandoff(channel, { id: 'staff' }, closureOptions(cases, { db }))).ok, true);
  assert.deepEqual(events, ['send', 'resolve:42', 'archive']);
  assert.equal((await cases.getCaseByThread(channel.id)).status, 'closed');
});

test('/done leaves case and escalation pending when customer notice delivery fails', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help', customerId: 'alice', customerThreadId: 'help' });
  let resolved = 0;
  const result = await closeHandoff({ id: 'help', name: 'Handoff · app', isThread: () => true,
    send: async () => { throw new Error('Missing Access'); },
    setArchived: async () => assert.fail('must not archive failed delivery'),
  }, { id: 'staff' }, closureOptions(cases, { db: { getPendingEscalation: async () => ({ id: 7 }), resolveEscalation: async () => resolved++ } }));
  assert.equal(result.ok, false);
  assert.equal(resolved, 0);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
});

async function closedReceiptFixture(extra = {}) {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'feedback-thread', customerId: 'alice', customerThreadId: 'feedback-thread' });
  const posts = [];
  const channel = { id: 'feedback-thread', name: 'Handoff · app', ownerId: 'test-bot', isThread: () => true,
    send: async (payload) => { posts.push(payload); return { id: `closing-notice-${posts.length}` }; },
    setArchived: async () => { channel.archived = true; },
    edit: async (payload) => { channel.archived = payload.archived; channel.locked = payload.locked; },
  };
  const options = closureOptions(cases, extra);
  const result = await closeHandoff(channel, { id: 'staff' }, options);
  const payload = posts[0];
  const message = payload ? { id: 'closing-notice-1', channelId: channel.id,
    author: { id: options.client.user.id, bot: true }, components: payload.components } : null;
  return { cases, value, channel, options, result, posts, message };
}

test('tracked closing cards bind both feedback choices to one opaque nonce without revealing case identifiers', async () => {
  const f = await closedReceiptFixture();
  assert.equal(f.result.ok, true);
  const ids = f.posts[0].components[0].components.map((button) => button.custom_id);
  assert.match(ids[0], /^rate:yes:[a-f0-9]{24}$/);
  assert.equal(ids[1], ids[0].replace('yes', 'no'));
  assert.equal(JSON.stringify(f.posts[0]).includes(f.value.id), false);
  assert.equal(f.posts[0].components[1].components.length, 2);
});

test('retrying a failed case save reuses the accepted closing notice', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'retry-thread', customerId: 'alice', customerThreadId: 'retry-thread' });
  let fail = true; let posts = 0; let archived = 0;
  const channel = { id: 'retry-thread', name: 'Handoff · app', isThread: () => true,
    send: async () => { posts++; return { id: 'notice' }; }, setArchived: async () => { archived++; } };
  const options = closureOptions({ ...cases, resolveCase: async (...args) => {
    if (fail) throw new Error('PRIVATE_CASE_FAILURE'); return cases.resolveCase(...args);
  } });
  const first = await closeHandoff(channel, { id: 'staff' }, options);
  assert.equal(first.ok, false); assert.match(first.reason, /reuse that notice/);
  assert.equal(archived, 0);
  fail = false;
  assert.equal((await closeHandoff(channel, { id: 'other-staff' }, options)).ok, true);
  assert.equal(posts, 1); assert.equal(archived, 1);
  assert.equal((await cases.getCaseById(value.id)).status, 'closed');
});

test('only the exact case customer can use the verified closing notice', async () => {
  const { handleRating } = require('../commands');
  const f = await closedReceiptFixture(); let saves = 0; const replies = [];
  const id = f.posts[0].components[0].components[1].custom_id;
  await handleRating({ customId: id, channelId: f.channel.id, channel: f.channel, client: f.options.client,
    message: f.message, user: { id: 'bob' }, reply: async (payload) => replies.push(payload.content) },
  { ...f.options, recordRating: async () => { saves++; }, notifyStaff: async () => true });
  assert.equal(saves, 0); assert.equal((await f.cases.getCaseById(f.value.id)).status, 'closed');
  assert.match(replies[0], /Only the customer/);
});

test('a scoped still-help click reopens once and stale repeats cannot change the next cycle', async () => {
  const { handleRating } = require('../commands');
  const f = await closedReceiptFixture(); let saves = 0; let edits = 0; const notes = [];
  f.channel.edit = async (payload) => { edits++; f.channel.archived = payload.archived; };
  const interaction = { customId: f.posts[0].components[0].components[1].custom_id,
    channelId: f.channel.id, channel: f.channel, client: f.options.client, message: f.message,
    user: { id: 'alice' }, reply: async (payload) => notes.push(payload.content) };
  const options = { ...f.options, recordRating: async () => { saves++; return { yes: 0, no: 1 }; }, notifyStaff: async () => true };
  await handleRating(interaction, options);
  assert.equal((await f.cases.getCaseById(f.value.id)).generation, 1);
  assert.equal((await f.cases.getCaseById(f.value.id)).status, 'queued');
  await handleRating(interaction, options);
  assert.equal(saves, 1); assert.equal(edits, 1);
  assert.match(notes[0], /case is reopened/i); assert.match(notes[1], /earlier support cycle/);
});

test('a customer cancels an accepted pending close before a delayed receipt repair', async () => {
  const { handleRating, repairClosureReceipt } = require('../commands');
  const f = await closedReceiptFixture();
  // Simulate a receipt persisted while the first local close update failed.
  const reopened = await f.cases.reopenByThread(f.channel.id, 'alice');
  const generation = reopened.generation;
  // Make a new accepted notice, with local resolve temporarily failing.
  const options = { ...f.options, cases: { ...f.cases, resolveCase: async () => { throw new Error('save unavailable'); } } };
  const failed = await closeHandoff(f.channel, { id: 'staff' }, options);
  assert.equal(failed.ok, false);
  const payload = f.posts.at(-1);
  const key = `closure:${f.value.id}:${generation}:${f.channel.id}`;
  const row = await f.options.deliveries.get(key);
  let note;
  await handleRating({ customId: payload.components[0].components[1].custom_id,
    channelId: f.channel.id, channel: f.channel, client: f.options.client,
    message: { ...f.message, id: row.messageId, components: payload.components }, user: { id: 'alice' },
    reply: async (payload) => { note = payload.content; } },
  { ...f.options, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true });
  assert.match(note, /case is reopened/i);
  assert.equal((await f.cases.getCaseById(f.value.id)).generation, generation + 1);
  assert.equal(await repairClosureReceipt(row, f.options), true);
  assert.equal((await f.cases.getCaseById(f.value.id)).status, 'queued');
});

test('scoped reopening saves new intent before a failed thread unarchive and reports both states honestly', async () => {
  const { handleRating } = require('../commands');
  const f = await closedReceiptFixture(); let note;
  f.channel.edit = async () => { throw new Error('permission unavailable'); };
  await handleRating({ customId: f.posts[0].components[0].components[1].custom_id,
    channelId: f.channel.id, channel: f.channel, client: f.options.client, message: f.message,
    user: { id: 'alice' }, reply: async (payload) => { note = payload.content; } },
  { ...f.options, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true });
  assert.equal((await f.cases.getCaseById(f.value.id)).generation, 1);
  assert.equal((await f.cases.getCaseById(f.value.id)).status, 'queued');
  assert.match(note, /case is reopened.*could not reopen this thread.*new Help post/i);
});

test('ambiguous customer cases never use legacy closure or archive fallback', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  for (const customerId of ['alice', 'bob']) await cases.getOrCreateCase({ channelId: 'shared', customerId, customerThreadId: 'shared' });
  const result = await closeHandoff({ id: 'shared', name: 'Handoff · app', isThread: () => true,
    send: async () => assert.fail('must not send'), setArchived: async () => assert.fail('must not archive') },
  { id: 'staff' }, closureOptions(cases, { db: { getPendingEscalation: async () => assert.fail('must not choose legacy escalation') } }));
  assert.equal(result.ok, false); assert.match(result.reason, /multiple customer cases/);
});

test('unbound legacy feedback cannot mutate a newer same-customer case with generation zero', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  const cases = createCaseService(createMemoryStore());
  const old = await cases.getOrCreateCase({ channelId: 'history', customerId: 'alice', customerThreadId: 'history' });
  await cases.resolveCase(old.id, { close: true, confirmed: true });
  const newer = await cases.getOrCreateCase({ channelId: 'history', customerId: 'alice', customerThreadId: 'history' });
  let note;
  await handleRating({ customId: 'rate:no', channelId: 'history', channel: { id: 'history', ownerId: 'alice',
    edit: async () => assert.fail('must not unlock newer case from old button') }, user: { id: 'alice' },
    reply: async (payload) => { note = payload.content; } },
  { cases, recordRating: async () => assert.fail('must not save old feedback as current'), notifyStaff: async () => assert.fail('must not notify') });
  assert.equal((await cases.getCaseById(newer.id)).generation, 0);
  assert.equal((await cases.getCaseById(newer.id)).status, 'queued');
  assert.match(note, /older feedback button cannot identify/);
});

test('closing requires real staff authority, not the empty-list test-channel bypass', () => {
  const { canCloseCase } = require('../commands');
  const names = ['STAFF_USER_IDS', 'STAFF_ROLE_ID', 'VECTOR_TEST_CHANNEL_ID'];
  const old = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.STAFF_USER_IDS; delete process.env.STAFF_ROLE_ID; process.env.VECTOR_TEST_CHANNEL_ID = 'test';
    const base = { user: { id: '123456789012345678' }, channel: { id: 'thread', parentId: 'test', isThread: () => true } };
    assert.equal(canCloseCase(base), false);
    assert.equal(canCloseCase({ ...base, memberPermissions: { has: (flag) => flag === 'ManageThreads' } }), true);
    process.env.STAFF_USER_IDS = base.user.id;
    assert.equal(canCloseCase(base), true);
  } finally { for (const name of names) if (old[name] == null) delete process.env[name]; else process.env[name] = old[name]; }
});

test('a tracked close stops after one uncertain thread PATCH and reports a confirmed notice separately', async () => {
  let patches = 0;
  const f = await closedReceiptFixture({ patchThread: async () => { patches++; throw Object.assign(new Error('uncertain PATCH'), { status: 503 }); } });
  assert.equal(patches, 1);
  assert.equal(f.posts.length, 1);
  assert.equal((await f.cases.getCaseById(f.value.id)).status, 'closed');
  assert.equal(f.result.ok, true);
  assert.match(f.result.reason, /resolution update was saved.*could not confirm.*archive/i);
});

test('a definite lock denial permits exactly one guarded archive-only attempt', async () => {
  const changes = [];
  const f = await closedReceiptFixture({ patchThread: async (_client, channel, payload) => {
    changes.push(payload);
    if (payload.locked) throw Object.assign(new Error('lock denied'), { code: 50013, status: 403 });
    return { id: channel.id, ...payload };
  } });
  assert.equal(f.result.ok, true);
  assert.deepEqual(changes, [{ archived: true, locked: true }, { archived: true }]);
});

test('a reopened generation between known-denial attempts prevents the archive fallback', async () => {
  let patches = 0;
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'archive-fence', customerId: 'alice', customerThreadId: 'archive-fence' });
  const channel = { id: 'archive-fence', name: 'Handoff · app', isThread: () => true, send: async () => ({ id: 'notice' }) };
  const options = closureOptions(cases, { patchThread: async () => {
    patches++;
    await cases.reopenByThread(channel.id, 'alice');
    throw Object.assign(new Error('lock denied'), { code: 50013, status: 403 });
  } });
  const result = await closeHandoff(channel, { id: 'staff' }, options);
  assert.equal(patches, 1);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  assert.equal(result.ok, false);
  assert.match(result.reason, /case changed/);
});

test('a failed legacy feedback receipt lookup still finishes the deferred interaction privately', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  const cases = createCaseService(createMemoryStore());
  await cases.getOrCreateCase({ channelId: 'lookup-thread', customerId: 'alice', customerThreadId: 'lookup-thread' });
  const events = [];
  await handleRating({ customId: 'rate:yes', channelId: 'lookup-thread', channel: { id: 'lookup-thread' }, user: { id: 'alice' },
    deferReply: async () => events.push('defer'), editReply: async (payload) => { events.push('edit'); assert.match(payload.content, /feedback has not been saved/); },
    reply: async () => assert.fail('must edit the deferred response') },
  { cases, deliveries: { get: async () => { throw new Error('PRIVATE_CONNECTION_VALUE'); } },
    recordRating: async () => assert.fail('must not save an unverified vote') });
  assert.deepEqual(events, ['defer', 'edit']);
});

test('late lifecycle ownership loss does not falsely say saved feedback or reopening never happened', async () => {
  const { handleRating } = require('../commands');
  const f = await closedReceiptFixture(); let note;
  await handleRating({ customId: f.posts[0].components[0].components[1].custom_id,
    channelId: f.channel.id, channel: f.channel, client: f.options.client, message: f.message,
    user: { id: 'alice' }, reply: async (payload) => { note = payload.content; } },
  { ...f.options, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true,
    actions: { run: async (_id, work) => { await work(async () => {}); throw new Error('ownership lost after work'); } } });
  assert.equal((await f.cases.getCaseById(f.value.id)).generation, 1);
  assert.equal((await f.cases.getCaseById(f.value.id)).status, 'queued');
  assert.match(note, /feedback was saved.*could not confirm the final case\/thread state/);
  assert.doesNotMatch(note, /no new feedback or case change was saved/);
});

test('still-help rating after service recreation reopens only the durable customer case', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  const store = createMemoryStore();
  let cases = createCaseService(store);
  const value = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  await cases.linkHandoff(value.id, { handoffThreadId: 'alice-thread' });
  await cases.resolveCase(value.id, { close: true, confirmed: true });
  cases = createCaseService(createMemoryStore(store.state));
  const replies = [];
  let edits = 0;
  const channel = { id: 'alice-thread', name: 'Handoff · app', ownerId: 'bot',
    edit: async (payload) => { assert.equal(payload.archived, false); assert.equal(payload.locked, false); edits++; },
  };
  const options = { cases, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true };
  await handleRating({ customId: 'rate:no', channelId: channel.id, channel, user: { id: 'bob' }, reply: async (payload) => replies.push(payload.content) }, options);
  assert.equal(edits, 0);
  await handleRating({ customId: 'rate:no', channelId: channel.id, channel, user: { id: 'alice' }, reply: async (payload) => replies.push(payload.content) }, options);
  assert.equal(edits, 1);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  assert.match(replies[1], /reopened/);
});

test('still-help rating does not promise a reopened thread when Discord rejects it', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help-fail', customerId: 'alice', customerThreadId: 'help-fail' });
  await cases.resolveCase(value.id, { close: true, confirmed: true });
  let note;
  await handleRating({ customId: 'rate:no', channelId: 'help-fail', channel: { id: 'help-fail', edit: async () => { throw new Error('Missing Access'); } },
    user: { id: 'alice' }, reply: async (payload) => { note = payload.content; },
  }, { cases, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true });
  assert.equal((await cases.getCaseById(value.id)).status, 'closed');
  assert.match(note, /has not been reopened/);
  assert.doesNotMatch(note, /person can still see/);
});

test('still-help reopening restores only its linked escalation after the thread can reopen', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help-reopen', customerId: 'alice', customerThreadId: 'help-reopen' });
  await cases.linkHandoff(value.id, { escalationId: 17 });
  await cases.resolveCase(value.id, { close: true, confirmed: true });
  const events = [];
  await handleRating({ customId: 'rate:no', channelId: 'help-reopen', channel: { id: 'help-reopen', edit: async () => events.push('unarchive') },
    user: { id: 'alice' }, reply: async () => {},
  }, { cases, recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true,
    db: { reopenEscalation: async (id) => events.push(`reopen:${id}`) },
  });
  assert.deepEqual(events, ['unarchive', 'reopen:17']);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
});

test('rating acknowledges privately before a held case lookup and edits its deferred reply', async () => {
  const { handleRating } = require('../commands');
  const { MessageFlags } = require('discord.js');
  let releaseLookup;
  let lookupStarted;
  const lookup = new Promise((resolve) => { releaseLookup = resolve; });
  const started = new Promise((resolve) => { lookupStarted = resolve; });
  const events = [];
  const pending = handleRating({ customId: 'rate:yes', channelId: 'held-case', channel: { id: 'held-case' }, user: { id: 'alice' },
    deferReply: async (payload) => { assert.equal(payload.flags, MessageFlags.Ephemeral); events.push('defer'); },
    editReply: async (payload) => { events.push('edit'); assert.match(payload.content, /Thank you/); },
    reply: async () => assert.fail('a deferred interaction must use editReply'),
  }, { cases: { getCaseByThread: async () => { events.push('lookup'); lookupStarted(); return lookup; } },
    recordRating: async () => { events.push('vote'); return { yes: 1, no: 0 }; }, notifyStaff: async () => true,
  });
  await started;
  assert.deepEqual(events, ['defer', 'lookup']);
  releaseLookup({ customerId: 'alice' });
  await pending;
  assert.deepEqual(events, ['defer', 'lookup', 'vote', 'edit']);
});

test('an unauthorized deferred rating remains private and never writes a vote or case', async () => {
  const { handleRating } = require('../commands');
  const { MessageFlags } = require('discord.js');
  let deferred = false;
  await handleRating({ customId: 'rate:no', channelId: 'private-case', channel: { id: 'private-case' }, user: { id: 'other' },
    deferReply: async (payload) => { assert.equal(payload.flags, MessageFlags.Ephemeral); deferred = true; },
    editReply: async (payload) => { assert.equal(deferred, true); assert.match(payload.content, /Only the customer/); assert.deepEqual(payload.allowedMentions, { parse: [] }); },
    reply: async () => assert.fail('must edit the private deferred reply'),
  }, { cases: { getCaseByThread: async () => ({ customerId: 'alice' }), reopenByThread: async () => assert.fail('must not write case') },
    recordRating: async () => assert.fail('must not write vote'), notifyStaff: async () => assert.fail('must not notify for unauthorized vote'),
  });
});

test('a reopened Discord thread is reported honestly when a later tag or case update fails', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleRating } = require('../commands');
  for (const stage of ['tag', 'case']) {
    const cases = createCaseService(createMemoryStore());
    const threadId = `partial-${stage}`;
    const value = await cases.getOrCreateCase({ channelId: threadId, customerId: 'alice', customerThreadId: threadId });
    await cases.resolveCase(value.id, { close: true, confirmed: true });
    const channel = { id: threadId, archived: true, locked: true,
      edit: async () => { channel.archived = false; channel.locked = false; },
      parent: { availableTags: [{ id: 'resolved', name: 'Resolved' }] }, appliedTags: ['resolved'],
      setAppliedTags: async () => { if (stage === 'tag') throw new Error('Tag update failed'); },
    };
    let note;
    await handleRating({ customId: 'rate:no', channelId: threadId, channel, user: { id: 'alice' },
      deferReply: async () => {}, editReply: async (payload) => { note = payload.content; },
      reply: async () => assert.fail('must edit deferred reply'),
    }, { cases: stage === 'case' ? { ...cases, reopenByThread: async () => { throw new Error('Case update failed'); } } : cases,
      recordRating: async () => ({ yes: 0, no: 1 }), notifyStaff: async () => true,
    });
    assert.equal(channel.archived, false);
    assert.equal((await cases.getCaseById(value.id)).status, 'closed');
    assert.match(note, /thread is reopened/);
    assert.match(note, /could not finish updating the case/);
    assert.doesNotMatch(note, /thread has not been reopened|case is reopened|open a new Help/);
  }
});

test('a private staff acceptance records its owner and repeated clicks retain the first acceptor', async () => {
  const { createCaseService, createMemoryStore } = require('../supportCases');
  const { handleAcceptCase } = require('../commands');
  const previous = { channel: process.env.STAFF_ALERT_CHANNEL_ID, users: process.env.STAFF_USER_IDS };
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-channel';
  process.env.STAFF_USER_IDS = '123456789012345678,223456789012345678';
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'general', customerId: 'customer' });
  await cases.markDelivered(value.id, { confirmed: true, destination: 'staff-channel' });
  const replies = [];
  const interaction = (staffId) => ({ customId: `case:accept:${value.id}`, channelId: 'staff-channel', channel: { id: 'staff-channel' },
    user: { id: staffId }, client: { user: { id: 'bot-id' } },
    message: { author: { id: 'bot-id' }, embeds: [{ fields: [{ name: 'Case', value: value.id }] }] },
    deferReply: async () => {}, editReply: async (payload) => replies.push(payload),
    reply: async () => assert.fail('authorized card should be accepted'),
  });
  try {
    await handleAcceptCase(interaction('123456789012345678'), { cases });
    const first = await cases.getCaseById(value.id);
    await handleAcceptCase(interaction('223456789012345678'), { cases });
    const repeated = await cases.getCaseById(value.id);
    assert.equal(first.status, 'accepted');
    assert.equal(repeated.acceptedBy, '123456789012345678');
    assert.equal(repeated.acceptedAt, first.acceptedAt);
    assert.match(replies[1].content, /123456789012345678/);
    assert.deepEqual(replies[0].allowedMentions, { parse: [] });
  } finally {
    for (const [key, env] of [['channel', 'STAFF_ALERT_CHANNEL_ID'], ['users', 'STAFF_USER_IDS']]) {
      if (previous[key] === undefined) delete process.env[env]; else process.env[env] = previous[key];
    }
  }
});

test('case acceptance rejects customers, other channels, and forged cards without reading case data', async () => {
  const { handleAcceptCase } = require('../commands');
  const previous = { channel: process.env.STAFF_ALERT_CHANNEL_ID, users: process.env.STAFF_USER_IDS };
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-channel';
  process.env.STAFF_USER_IDS = '123456789012345678';
  const caseId = '8df371b5-47c5-41b0-9931-39f35332bc33';
  const base = { customId: `case:accept:${caseId}`, channelId: 'staff-channel', channel: { id: 'staff-channel' },
    user: { id: '123456789012345678' }, client: { user: { id: 'bot-id' } },
    message: { author: { id: 'bot-id' }, embeds: [{ fields: [{ name: 'Case', value: caseId }] }] },
    deferReply: async () => assert.fail('invalid interaction must fail before defer'),
  };
  const forbidden = [
    { ...base, user: { id: 'customer' } },
    { ...base, channelId: 'general', channel: { id: 'general' } },
    { ...base, channel: { id: 'general' } },
    { ...base, message: { ...base.message, author: { id: 'other-user' } } },
    { ...base, message: { ...base.message, embeds: [{ fields: [{ name: 'Case', value: 'another-case' }] }] } },
  ];
  try {
    for (const interaction of forbidden) {
      let denied = false;
      await handleAcceptCase({ ...interaction, reply: async (payload) => { denied = true; assert.ok(payload.flags); } },
        { cases: { markAccepted: async () => assert.fail('unauthorized interactions must not touch a case') } });
      assert.equal(denied, true);
    }
  } finally {
    for (const [key, env] of [['channel', 'STAFF_ALERT_CHANNEL_ID'], ['users', 'STAFF_USER_IDS']]) {
      if (previous[key] === undefined) delete process.env[env]; else process.env[env] = previous[key];
    }
  }
});

test('case acceptance allows staff role or moderation permission but never the test-channel bypass', () => {
  const { canAcceptCase } = require('../commands');
  const names = ['STAFF_ALERT_CHANNEL_ID', 'STAFF_USER_IDS', 'STAFF_ROLE_ID', 'VECTOR_TEST_CHANNEL_ID'];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-channel';
  process.env.VECTOR_TEST_CHANNEL_ID = 'staff-channel';
  delete process.env.STAFF_USER_IDS;
  delete process.env.STAFF_ROLE_ID;
  const base = { channelId: 'staff-channel', channel: { id: 'staff-channel' }, user: { id: '123456789012345678' } };
  try {
    assert.equal(canAcceptCase(base), false);
    assert.equal(canAcceptCase({ ...base, memberPermissions: { has: (permission) => permission === 'ManageThreads' } }), true);
    process.env.STAFF_ROLE_ID = '998877665544332211';
    assert.equal(canAcceptCase({ ...base, member: { roles: { cache: new Map([['998877665544332211', {}]]) } } }), true);
  } finally {
    for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
  }
});

test('GitHub webhook notify posts one line and never archives', async () => {
  const github = require('../github');
  const { notifyLinkedThreads } = require('../commands');
  github.resetGithubMemory();
  github.linkIssueThread(9, 'thread-9');
  const sent = [];
  const client = {
    channels: {
      fetch: async (id) => ({
        id,
        isThread: () => true,
        isTextBased: () => true,
        send: async (text) => {
          sent.push(text);
          return text;
        },
        setArchived: async () => {
          throw new Error('must not auto /done');
        },
      }),
    },
  };
  const n = await notifyLinkedThreads(client, { number: 9, numbers: [9], line: '#9 was closed.' });
  assert.equal(n, 1);
  assert.equal(sent[0].content, '#9 was closed.');
  assert.deepEqual(sent[0].allowedMentions.parse, []);
  github.resetGithubMemory();
});

test('a forged vector-thread marker does not notify; a thread the bot linked does', async () => {
  const { notifyLinkedThreads } = require('../commands');
  const github = require('../github');
  github.resetGithubMemory();
  const sent = [];
  const client = {
    channels: {
      fetch: async (id) => ({
        id,
        isThread: () => true,
        isTextBased: () => true,
        send: async (text) => {
          sent.push({ id, text });
          return text;
        },
        setArchived: async () => {
          throw new Error('must not auto /done');
        },
      }),
    },
  };
  const forged = await notifyLinkedThreads(client, {
    number: 9,
    numbers: [9],
    threadIds: ['1550182642874589194'],
    line: 'A note was added on #9.',
  });
  assert.equal(forged, 0);
  github.linkIssueThread(9, '1550182642874589194');
  const linked = await notifyLinkedThreads(client, {
    number: 9,
    numbers: [9],
    threadIds: ['999'],
    line: 'A note was added on #9.',
  });
  assert.equal(linked, 1);
  assert.equal(sent[0].id, '1550182642874589194');
  github.resetGithubMemory();
});

test('case-linked webhook notices address distinct source messages in a shared channel without broadcasts', async () => {
  const { notifyLinkedThreads } = require('../commands');
  const records = ['alice', 'bob'].map((customerId) => ({ repo: 'basedhardware/omi', issueNumber: 42, caseId: `case-${customerId}`,
    customerId, channelId: 'general', threadId: 'general', sourceMessageId: `source-${customerId}` }));
  const replies = [];
  const client = { channels: { fetch: async () => ({ id: 'general', isTextBased: () => true, isThread: () => false,
    messages: { fetch: async (id) => ({ id, author: { id: id.replace('source-', '') }, reply: async (payload) => replies.push({ id, payload }) }) },
    send: async () => assert.fail('shared channel must not broadcast'),
  }) } };
  const count = await notifyLinkedThreads(client, { number: 42, line: 'An engineering update is available.' }, {
    issueLinks: { listForIssue: async () => [...records, records[0]] },
    cases: { getCaseById: async (id) => ({ channelId: 'general', customerId: id.replace('case-', '') }) },
  });
  assert.equal(count, 2);
  assert.deepEqual(replies.map((value) => value.id), ['source-alice', 'source-bob']);
  for (const { payload } of replies) assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
});

test('missing or wrong-author sources never produce shared-channel notices or bypasses through legacy links', async () => {
  const { notifyLinkedThreads } = require('../commands');
  const github = require('../github');
  github.resetGithubMemory();
  github.linkIssueThread(42, 'general', { persist: false });
  const record = { repo: 'basedhardware/omi', issueNumber: 42, caseId: 'case-alice', customerId: 'alice', channelId: 'general', threadId: 'general', sourceMessageId: 'source' };
  try {
    for (const original of [null,
      { id: 'source', author: { id: 'bob' }, reply: async () => assert.fail('wrong customer') },
      { id: 'another-source', author: { id: 'alice' }, reply: async () => assert.fail('wrong source') }]) {
      const count = await notifyLinkedThreads({ channels: { fetch: async () => ({ id: 'general', isTextBased: () => true, isThread: () => false,
        messages: { fetch: async () => original }, send: async () => assert.fail('must not broadcast'),
      }) } }, { number: 42, line: 'Issue updated.' }, { issueLinks: { listForIssue: async () => [record] },
        cases: { getCaseById: async () => ({ channelId: 'general', customerId: 'alice' }) },
      });
      assert.equal(count, 0);
    }
  } finally { github.resetGithubMemory(); }
});

test('missing source fallback requires a case-bound dedicated customer or handoff thread', async () => {
  const { notifyLinkedThreads } = require('../commands');
  const record = { repo: 'basedhardware/omi', issueNumber: 42, caseId: 'case-alice', customerId: 'alice', channelId: 'general', threadId: 'dedicated', sourceMessageId: 'missing' };
  let sends = 0;
  const client = { channels: { fetch: async () => ({ id: 'dedicated', ownerId: 'alice', isThread: () => true, isTextBased: () => true,
    messages: { fetch: async () => null }, send: async () => sends++,
  }) } };
  const count = await notifyLinkedThreads(client, { number: 42, line: 'Issue updated.' }, { issueLinks: { listForIssue: async () => [record] },
    cases: { getCaseById: async () => ({ channelId: 'general', customerId: 'alice', customerThreadId: 'dedicated' }) },
  });
  assert.equal(count, 1); assert.equal(sends, 1);
});

test('legacy status notices keep dedicated threads but skip ordinary general channels', async () => {
  const { notifyLinkedThreads } = require('../commands');
  const github = require('../github');
  github.resetGithubMemory();
  github.linkIssueThread(42, 'general', { persist: false });
  github.linkIssueThread(42, 'legacy-thread', { persist: false });
  const sent = [];
  try {
    const count = await notifyLinkedThreads({ channels: { fetch: async (id) => ({ id, isTextBased: () => true, isThread: () => id === 'legacy-thread',
      send: async (payload) => sent.push({ id, payload }),
    }) } }, { number: 42, line: 'Issue updated.' }, { issueLinks: { listForIssue: async () => [] } });
    assert.equal(count, 1);
    assert.equal(sent[0].id, 'legacy-thread');
    assert.deepEqual(sent[0].payload.allowedMentions.parse, []);
  } finally { github.resetGithubMemory(); }
});

function fileGuardEnvironment(t) {
  const names = ['STAFF_ALERT_CHANNEL_ID', 'STAFF_USER_IDS', 'VECTOR_TEST_CHANNEL_ID'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  process.env.STAFF_USER_IDS = 'staff-user';
  process.env.VECTOR_TEST_CHANNEL_ID = 'vector-test';
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error('Refused File buttons must not reach GitHub'); };
  t.after(() => {
    globalThis.fetch = previousFetch;
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  });
  return () => fetches;
}

function fileClick(customId, { channel = { id: 'staff-room', isThread: () => false }, user = 'staff-user' } = {}) {
  const replies = [];
  const click = {
    customId, channel, channelId: channel.id, user: { id: user }, replies,
    client: { user: { id: 'bot-user' } },
    memberPermissions: { has: (permission) => user === 'staff-user' && ['Administrator', 'ManageThreads'].includes(permission) },
    isChatInputCommand: () => false, isButton: () => true,
    deferReply: async () => { click.deferred = true; },
    reply: async (payload) => replies.push(payload),
    editReply: async (payload) => replies.push(payload),
    followUp: async (payload) => replies.push(payload),
  };
  return click;
}

const SCOPED_FILE_ID = 'file:92e47649-f9aa-499d-b8b4-216b8b9b1c97';

test('legacy process-local File buttons are refused instead of publishing an unverifiable draft', async (t) => {
  const countFetches = fileGuardEnvironment(t);
  const { handleInteraction } = require('../commands');
  const { MessageFlags } = require('discord.js');
  for (const id of ['file:1', 'file:lost-local-draft']) {
    const click = fileClick(id);
    await handleInteraction(click);
    assert.match(click.replies[0].content, /older File button cannot be verified/i);
    assert.equal(click.replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(click.deferred, undefined);
    assert.equal(click.replies.length, 1);
    assert.doesNotMatch(click.replies[0].content, /Filed https|already on GitHub/i);
  }
  assert.equal(countFetches(), 0);
});

test('a staff File click in the customer thread cannot bypass the private staff workflow', async (t) => {
  const countFetches = fileGuardEnvironment(t);
  const { handleInteraction } = require('../commands');
  const { MessageFlags } = require('discord.js');
  const click = fileClick(SCOPED_FILE_ID, { channel: { id: 'customer-thread', isThread: () => true } });
  await handleInteraction(click);
  assert.match(click.replies[0].content, /configured staff channel/i);
  assert.equal(click.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(click.deferred, undefined);
  assert.equal(countFetches(), 0);
});

test('a customer File click in the test channel has no public publication privilege', async (t) => {
  const countFetches = fileGuardEnvironment(t);
  const { handleInteraction } = require('../commands');
  const click = fileClick(SCOPED_FILE_ID, { channel: { id: 'vector-test', isThread: () => false }, user: 'customer' });
  await handleInteraction(click);
  assert.match(click.replies[0].content, /Only authorized staff/i);
  assert.equal(click.deferred, undefined);
  assert.equal(countFetches(), 0);
});

test('staff administrator permissions do not turn the test channel into an approval destination', async (t) => {
  const countFetches = fileGuardEnvironment(t);
  const { handleInteraction } = require('../commands');
  const click = fileClick(SCOPED_FILE_ID, { channel: { id: 'vector-test', isThread: () => false } });
  await handleInteraction(click);
  assert.match(click.replies[0].content, /configured staff channel/i);
  assert.equal(click.deferred, undefined);
  assert.equal(countFetches(), 0);
});

test('a configured staff destination that is public is rejected before approval or publication', async (t) => {
  const countFetches = fileGuardEnvironment(t);
  const { handleInteraction } = require('../commands');
  const { PermissionFlagsBits } = require('discord.js');
  const { makeStaffChannel } = require('./fixtures/discord-staff-channel');
  const fixture = makeStaffChannel();
  fixture.channel.permissionOverwrites.cache.set(fixture.guild.id,
    fixture.overwrite(fixture.guild.id, 0, [PermissionFlagsBits.ViewChannel]));
  const click = fileClick(SCOPED_FILE_ID, { channel: fixture.channel });
  await handleInteraction(click);
  assert.equal(click.deferred, true);
  assert.match(click.replies[0].content, /not verified as staff-only/i);
  assert.equal(click.replies.length, 1);
  assert.equal(countFetches(), 0);
});

test('a rating button tells staff without pinging anyone', async () => {
  const { handleInteraction } = require('../commands');
  const { resetRatings } = require('../ratings');
  const { makeStaffChannel } = require('./fixtures/discord-staff-channel');
  resetRatings();
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const prev = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = '1554155306504814633';
  const sent = [];
  const staffChannel = makeStaffChannel({ id: process.env.STAFF_ALERT_CHANNEL_ID,
    send: async (payload) => { sent.push(payload); return payload; } }).channel;
  try {
    await handleInteraction({
      customId: 'rate:no',
      isButton: () => true,
      isChatInputCommand: () => false,
      channelId: '700000000000000369',
      user: { id: 'customer-1' },
      channel: { ownerId: 'customer-1' },
      client: {
        user: { id: 'bot-user' },
        channels: {
          fetch: async () => staffChannel,
        },
      },
      reply: async (payload) => {
        sent.push(payload);
      },
    });
    const staff = sent.find((item) => /still needs help/i.test(String(item.content || '')));
    assert.ok(staff);
    assert.match(staff.content, /Helpful: 0/);
    assert.match(staff.content, /Still need help: 1/);
    assert.deepEqual(staff.allowedMentions, { parse: [] });
    assert.equal(JSON.stringify(staff).includes('@'), false);
  } finally {
    if (prev == null) delete process.env.STAFF_ALERT_CHANNEL_ID;
    else process.env.STAFF_ALERT_CHANNEL_ID = prev;
    if (prevDb == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
  }
});

test('staff cannot answer the helpful question', async () => {
  const { handleInteraction } = require('../commands');
  const replies = [];
  await handleInteraction({
    customId: 'rate:yes',
    isButton: () => true,
    isChatInputCommand: () => false,
    channelId: '700000000000000369',
    user: { id: 'staff-1' },
    channel: { ownerId: 'customer-1' },
    reply: async (payload) => {
      replies.push(payload);
    },
  });
  assert.match(replies[0].content, /Only the customer/i);
});

test('the customer can rate a bot-owned Handoff thread', async () => {
  const { handleInteraction } = require('../commands');
  const { resetRatings } = require('../ratings');
  resetRatings();
  const replies = [];
  await handleInteraction({
    customId: 'rate:yes',
    isButton: () => true,
    isChatInputCommand: () => false,
    channelId: '700000000000000370',
    user: { id: 'customer-2' },
    channel: {
      id: '700000000000000370',
      name: 'Handoff · charging',
      ownerId: 'bot-1',
      fetchStarterMessage: async () => ({ author: { id: 'customer-2', bot: false } }),
    },
    client: { channels: { fetch: async () => null } },
    reply: async (payload) => replies.push(payload),
  });
  assert.match(replies.at(-1).content, /Glad it helped/);
});
