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
  assert.equal(sent[0].embeds[0].title, 'This ticket is closed');
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
