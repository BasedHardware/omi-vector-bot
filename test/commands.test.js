const assert = require('node:assert/strict');
const test = require('node:test');
const { closeHandoff, closePayload } = require('../commands');
const { canStaffAct, formatStaffTicket } = require('../handoff');

function closeText(payload) {
  if (typeof payload === 'string') return payload;
  return [payload?.embeds?.[0]?.title, payload?.embeds?.[0]?.description, payload?.content]
    .filter(Boolean)
    .join('\n');
}

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
  assert.equal(sent[0].embeds[0].title, 'This ticket is closed');
  assert.equal(sent[0].embeds[0].thumbnail.url, 'attachment://omi-logo.png');
  assert.equal(sent[0].files[0].name, 'omi-logo.png');
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
  assert.match(closeText(sent[0]), /This ticket is closed/);
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

test('GitHub webhook notify uses vector-thread ids after a restart', async () => {
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
  const n = await notifyLinkedThreads(client, {
    number: 9,
    numbers: [9],
    threadIds: ['1550182642874589194'],
    line: 'A note was added on #9.',
  });
  assert.equal(n, 1);
  assert.equal(sent[0].id, '1550182642874589194');
  assert.equal(sent[0].text, 'A note was added on #9.');
});
