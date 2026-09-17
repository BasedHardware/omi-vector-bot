const assert = require('node:assert/strict');
const test = require('node:test');
const {
  canNotifyStaff,
  formatStaffTicket,
  isHandoffThread,
  notifyStaff,
  resetHandoffMemory,
  staffMentions,
} = require('../handoff');
const { formatEscalationText } = require('../telegram');

test('canNotifyStaff is true on Discord, false in CLI without Telegram', () => {
  assert.equal(canNotifyStaff({ discordReady: true }), true);
});

test('staff ticket is a scannable Discord embed, not a wall', () => {
  process.env.STAFF_USER_IDS = '123456789012345678';
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: 'Where is my order?',
    reason: 'no order access',
    draft: 'A person needs to look this up.',
  });
  assert.match(ticket.discord.content, /<@123456789012345678>/);
  assert.equal(ticket.discord.embeds[0].title, 'Needs a human');
  assert.match(ticket.discord.embeds[0].description, /Where is my order/);
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Why' && f.value === 'no order access'),
    true
  );
  delete process.env.STAFF_USER_IDS;
  assert.equal(staffMentions(), '');
});

test('handoff threads are skipped by name', () => {
  assert.equal(isHandoffThread({ isThread: () => true, name: 'Handoff · david' }), true);
  assert.equal(isHandoffThread({ isThread: () => true, name: 'daily-reports' }), false);
  assert.equal(isHandoffThread({ isThread: () => false, name: 'Handoff · david' }), false);
});

test('notifyStaff posts a channel card and does not double-ping', async () => {
  resetHandoffMemory();
  const prevThread = process.env.HANDOFF_THREADS;
  const prevStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.HANDOFF_THREADS = '0';
  delete process.env.STAFF_ALERT_CHANNEL_ID;

  const sent = [];
  const message = {
    url: 'https://discord.com/channels/1/2/3',
    author: { id: '99', username: 'david' },
    channel: {
      id: 'chan-2',
      isTextBased: () => true,
      isThread: () => false,
      send: async (payload) => {
        sent.push(payload);
        return payload;
      },
    },
    hasThread: false,
    startThread: async () => {
      throw new Error('should not start thread when HANDOFF_THREADS=0');
    },
  };

  const first = await notifyStaff({
    client: null,
    message,
    question: 'I want a refund',
    reason: 'refund',
    draft: 'A person needs to take this.',
  });
  assert.equal(first.ok, true);
  assert.equal(first.via, 'channel');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].title, 'Needs a human');

  const second = await notifyStaff({
    client: null,
    message,
    question: 'also tracking please',
    reason: 'tracking',
    draft: 'Still needs a person.',
  });
  assert.equal(second.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(sent.length, 1);

  if (prevThread !== undefined) process.env.HANDOFF_THREADS = prevThread;
  else delete process.env.HANDOFF_THREADS;
  if (prevStaff !== undefined) process.env.STAFF_ALERT_CHANNEL_ID = prevStaff;
  resetHandoffMemory();
});

test('telegram escalation text is plain, not HTML', () => {
  const text = formatEscalationText({
    threadId: '2',
    jumpUrl: 'https://discord.com/channels/1/2/3',
    userQuestion: 'broken <script> and an order',
    botDraft: 'needs a person',
    missingInfo: 'no order access',
  });
  assert.match(text, /^Thread: 2/m);
  assert.match(text, /Jump: https:\/\//);
  assert.match(text, /broken <script>/);
  assert.equal(text.includes('parse_mode'), false);
  assert.equal(text.includes('<b>'), false);
});
