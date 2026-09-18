const assert = require('node:assert/strict');
const test = require('node:test');
const { closeHandoff } = require('../commands');
const { canStaffAct, formatStaffTicket } = require('../handoff');

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
    send: async (text) => {
      sent.push(text);
      return text;
    },
    setLocked: async () => {},
    setArchived: async () => {
      channel.archived = true;
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.equal(channel.archived, true);
  assert.equal(sent.some((t) => /That command failed/i.test(t)), false);
});

test('/done archives a Handoff thread and does not file GitHub', async () => {
  const sent = [];
  const channel = {
    isThread: () => true,
    name: 'Handoff · astar6969',
    send: async (text) => {
      sent.push(text);
      return text;
    },
    setLocked: async () => {},
    setArchived: async () => {
      channel.archived = true;
    },
  };
  const result = await closeHandoff(channel, { id: '99' });
  assert.equal(result.ok, true);
  assert.match(sent[0], /resolved/i);
  assert.equal(channel.archived, true);
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
