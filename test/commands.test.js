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
  assert.equal((await closeHandoff(channel, { id: 'staff' }, { cases, db })).ok, true);
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
  }, { id: 'staff' }, { cases, db: { getPendingEscalation: async () => ({ id: 7 }), resolveEscalation: async () => resolved++ } });
  assert.equal(result.ok, false);
  assert.equal(resolved, 0);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
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
  assert.equal(sent[0], '#9 was closed.');
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

test('a File click that GitHub rejects can be pressed again', async () => {
  const github = require('../github');
  const { handleInteraction } = require('../commands');
  github.resetGithubMemory();
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevToken = process.env.GITHUB_TOKEN;
  const prevFetch = globalThis.fetch;
  process.env.STAFF_USER_IDS = '123456789012345678';
  process.env.GITHUB_TOKEN = 'ghs_test';
  const statuses = [502, 201];
  let posts = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/search/issues')) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) };
    }
    posts += 1;
    const status = statuses.shift();
    return {
      ok: status < 300,
      status,
      json: async () => ({ number: 42, html_url: 'https://github.com/BasedHardware/omi/issues/42' }),
    };
  };
  const id = github.stashDraft({ title: 'App crashes on open', body: 'It crashes.', labels: ['vector'] });
  const replies = [];
  const click = () => ({
    customId: `file:${id}`,
    channelId: '555555555555555555',
    user: { id: '123456789012345678' },
    isChatInputCommand: () => false,
    isButton: () => true,
    deferReply: async () => {},
    editReply: async (text) => {
      replies.push(text);
    },
    reply: async ({ content }) => {
      replies.push(content);
    },
    channel: { isTextBased: () => true, send: async (text) => text },
  });
  try {
    await handleInteraction(click());
    await handleInteraction(click());
    assert.equal(replies[0], 'GitHub did not accept the issue. I did not claim it was filed.');
    assert.equal(replies[1], 'Filed https://github.com/BasedHardware/omi/issues/42');
    assert.equal(posts, 2);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevToken;
    github.resetGithubMemory();
  }
});

test('a File click with no GitHub token keeps the draft', async () => {
  const github = require('../github');
  const { handleInteraction } = require('../commands');
  const { MessageFlags } = require('discord.js');
  github.resetGithubMemory();
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevConfigured = github.isConfigured;
  process.env.STAFF_USER_IDS = '123456789012345678';
  github.isConfigured = () => false;
  const draft = { title: 'App crashes on open', body: 'It crashes.', labels: ['vector'] };
  const id = github.stashDraft(draft);
  const stashed = github.peekDraft(id);
  const replies = [];
  const sent = [];
  try {
    assert.equal(github.isConfigured(), false);
    await handleInteraction({
      customId: `file:${id}`,
      channelId: '555555555555555555',
      user: { id: '123456789012345678' },
      isChatInputCommand: () => false,
      isButton: () => true,
      deferReply: async () => {
        throw new Error('must not defer without a token');
      },
      editReply: async (text) => {
        replies.push(text);
      },
      reply: async (payload) => {
        replies.push(payload);
      },
      channel: {
        isTextBased: () => true,
        send: async (text) => {
          sent.push(text);
          return text;
        },
      },
    });
    assert.equal(replies.length, 1);
    assert.match(replies[0].content, /No GitHub token/);
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
    assert.equal(sent.length, 0);
    assert.equal(github.peekDraft(id), stashed);
    assert.equal(stashed.title, draft.title);
    assert.equal(stashed.body, draft.body);
    assert.deepEqual(stashed.labels, draft.labels);
  } finally {
    github.isConfigured = prevConfigured;
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    github.resetGithubMemory();
  }
});

test('a File click does not claim a filing when GitHub returns no issue', async () => {
  const github = require('../github');
  const { handleInteraction } = require('../commands');
  github.resetGithubMemory();
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevToken = process.env.GITHUB_TOKEN;
  const prevAppId = process.env.GITHUB_APP_ID;
  const prevInstall = process.env.GITHUB_APP_INSTALLATION_ID;
  const prevKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const prevFetch = globalThis.fetch;
  process.env.STAFF_USER_IDS = '123456789012345678';
  process.env.GITHUB_TOKEN = 'ghs_test';
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_INSTALLATION_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  globalThis.fetch = async () => ({
    ok: true,
    status: 201,
    json: async () => ({}),
  });
  const draft = { title: 'App crashes on open', body: 'It crashes.', labels: ['vector'] };
  const id = github.stashDraft(draft);
  const stashed = github.peekDraft(id);
  const replies = [];
  const sent = [];
  try {
    await handleInteraction({
      customId: `file:${id}`,
      channelId: '555555555555555555',
      user: { id: '123456789012345678' },
      isChatInputCommand: () => false,
      isButton: () => true,
      deferReply: async () => {},
      editReply: async (text) => {
        replies.push(text);
      },
      reply: async ({ content }) => {
        replies.push(content);
      },
      channel: {
        isTextBased: () => true,
        send: async (text) => {
          sent.push(text);
          return text;
        },
      },
    });
    assert.equal(replies[0], 'GitHub did not accept the issue. I did not claim it was filed.');
    assert.equal(sent.length, 0);
    assert.equal(github.peekDraft(id), stashed);
    assert.equal(github.takeDraft(id).title, draft.title);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevToken;
    if (prevAppId == null) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = prevAppId;
    if (prevInstall == null) delete process.env.GITHUB_APP_INSTALLATION_ID;
    else process.env.GITHUB_APP_INSTALLATION_ID = prevInstall;
    if (prevKey == null) delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = prevKey;
    github.resetGithubMemory();
  }
});

test('a File click does not file when GitHub already has a matching issue', async () => {
  const github = require('../github');
  const { handleInteraction } = require('../commands');
  github.resetGithubMemory();
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevToken = process.env.GITHUB_TOKEN;
  const prevFetch = globalThis.fetch;
  process.env.STAFF_USER_IDS = '123456789012345678';
  process.env.GITHUB_TOKEN = 'ghs_test';
  let posts = 0;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('/search/issues')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ number: 2850, title: 'mac recording stops randomly', html_url: 'https://github.com/BasedHardware/omi/issues/2850' }],
        }),
      };
    }
    if (init && init.method === 'POST') posts += 1;
    return { ok: true, status: 201, json: async () => ({ number: 1, html_url: 'https://github.com/BasedHardware/omi/issues/1' }) };
  };
  const id = github.stashDraft({ title: 'mac recording stops', body: 'It stops.', labels: ['vector'] });
  const replies = [];
  try {
    await handleInteraction({
      customId: `file:${id}`,
      channelId: '555555555555555555',
      user: { id: '123456789012345678' },
      isChatInputCommand: () => false,
      isButton: () => true,
      deferReply: async () => {},
      editReply: async (text) => { replies.push(text); },
      reply: async ({ content }) => { replies.push(content); },
      channel: { isTextBased: () => true, send: async () => {} },
    });
    assert.equal(posts, 0);
    assert.match(replies[0], /Already on GitHub: https:\/\/github.com\/BasedHardware\/omi\/issues\/2850/);
    assert.match(replies[0], /did not file another/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevToken;
    github.resetGithubMemory();
  }
});

test('a File click keeps the draft when Discord rejects the defer', async () => {
  const github = require('../github');
  const { handleInteraction } = require('../commands');
  github.resetGithubMemory();
  const prevStaff = process.env.STAFF_USER_IDS;
  const prevToken = process.env.GITHUB_TOKEN;
  process.env.STAFF_USER_IDS = '123456789012345678';
  process.env.GITHUB_TOKEN = 'ghs_test';
  const draft = { title: 'App crashes on open', body: 'It crashes.', labels: ['vector'] };
  const id = github.stashDraft(draft);
  const stashed = github.peekDraft(id);
  const replies = [];
  try {
    await handleInteraction({
      customId: `file:${id}`,
      channelId: '555555555555555555',
      user: { id: '123456789012345678' },
      isChatInputCommand: () => false,
      isButton: () => true,
      deferReply: async () => {
        throw new Error('already acknowledged');
      },
      editReply: async (text) => {
        replies.push(text);
      },
      reply: async ({ content }) => {
        replies.push(content);
      },
      followUp: async ({ content }) => {
        replies.push(content);
      },
      channel: {
        isTextBased: () => true,
        send: async () => {
          throw new Error('must not announce a filing');
        },
      },
    });
    assert.equal(replies.some((text) => /Filed/i.test(String(text))), false);
    assert.equal(github.peekDraft(id), stashed);
  } finally {
    if (prevStaff == null) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prevStaff;
    if (prevToken == null) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = prevToken;
    github.resetGithubMemory();
  }
});

test('a rating button tells staff without pinging anyone', async () => {
  const { handleInteraction } = require('../commands');
  const { resetRatings } = require('../ratings');
  resetRatings();
  const prevDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const prev = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = '1554155306504814633';
  const sent = [];
  try {
    await handleInteraction({
      customId: 'rate:no',
      isButton: () => true,
      isChatInputCommand: () => false,
      channelId: '700000000000000369',
      user: { id: 'customer-1' },
      channel: { ownerId: 'customer-1' },
      client: {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async (payload) => {
              sent.push(payload);
              return payload;
            },
          }),
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
