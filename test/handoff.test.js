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
    question:
      'Where is my order?\nWant: an orange Needs a human card, plus the line that a person on the team was actually pinged.',
    reason: 'no order access',
    draft:
      "I can't see orders, tracking, or shipping from here.\nI'm flagging this for a person on the Omi team. I'm not able to ping anyone myself, so I won't tell you I did.",
  });
  assert.match(ticket.discord.content, /<@123456789012345678>/);
  assert.equal(ticket.discord.embeds[0].title, 'Needs a human');
  assert.match(ticket.discord.embeds[0].description, /Where is my order/);
  assert.equal(ticket.discord.embeds[0].description.includes('Want:'), false);
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Jump' && /Open message/.test(f.value)),
    true
  );
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Vector told the user'),
    false
  );
  assert.equal(/not able to ping/i.test(ticket.plain.botDraft), false);
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Why' && f.value === 'no order access'),
    true
  );
  const staff = ticket.discord.embeds[0].fields.find((f) => f.name === 'Staff');
  assert.match(staff.value, /Reply in this thread/i);
  assert.match(staff.value, /faq:/i);
  assert.match(staff.value, /\/done/);
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Shopify'),
    false
  );
  const appTicket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: 'app crashed',
    area: 'app',
    lane: 'tech',
  });
  assert.equal(
    appTicket.discord.embeds[0].fields.some((f) => f.name === 'Area' && f.value === 'app'),
    true
  );
  assert.match(appTicket.discord.embeds[0].fields.find((f) => f.name === 'Labels').value, /`app`/);
  assert.match(appTicket.discord.embeds[0].fields.find((f) => f.name === 'Labels').value, /`tech`/);
  delete process.env.STAFF_USER_IDS;
  assert.equal(staffMentions(), '');
});

test('staff ticket can carry Shopify facts without street or email', () => {
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: 'Where is order #1042?',
    reason: 'Order lookup for staff check',
    shopify: '#1042 paid, shipped\nUPS 1Z999\nShip to: Berlin, Germany\nAddress looks complete: yes',
  });
  const field = ticket.discord.embeds[0].fields.find((f) => f.name === 'Shopify');
  assert.match(field.value, /Berlin/);
  assert.match(field.value, /1Z999/);
  assert.equal(/Secret St/i.test(field.value), false);
  assert.equal(/@/.test(field.value), false);
});

test('handoff threads are skipped by name', () => {
  const { handoffThreadName, isHandoffThread } = require('../handoff');
  assert.equal(isHandoffThread({ isThread: () => true, name: 'Handoff · david' }), true);
  assert.equal(isHandoffThread({ isThread: () => true, name: 'daily-reports' }), false);
  assert.equal(isHandoffThread({ isThread: () => false, name: 'Handoff · david' }), false);
  const named = handoffThreadName({
    question: 'Daily reports are not being produced.\nChatGPT:- dump',
    area: 'app',
    lane: 'tech',
  });
  assert.match(named, /^Handoff · /);
  assert.match(named, /app/);
  assert.match(named, /tech/);
  assert.match(named, /Daily reports are not being produced/i);
  assert.equal(/ChatGPT/i.test(named), false);
  assert.equal(named.length <= 100, true);
  assert.equal(isHandoffThread({ isThread: () => true, name: named }), true);
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

  const third = await notifyStaff({
    client: null,
    message,
    question: 'I want a refund again',
    reason: 'refund',
    draft: 'A person needs to take this.',
    skipDedupe: true,
  });
  assert.equal(third.ok, true);
  assert.equal(Boolean(third.duplicate), false);
  assert.equal(sent.length, 2);

  if (prevThread !== undefined) process.env.HANDOFF_THREADS = prevThread;
  else delete process.env.HANDOFF_THREADS;
  if (prevStaff !== undefined) process.env.STAFF_ALERT_CHANNEL_ID = prevStaff;
  resetHandoffMemory();
});

test('staff ticket pings the area owner when AREA_OWNERS is set', async () => {
  resetHandoffMemory();
  const prevThread = process.env.HANDOFF_THREADS;
  const prevStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  const prevOwners = process.env.AREA_OWNERS;
  process.env.HANDOFF_THREADS = '0';
  delete process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.AREA_OWNERS = 'shop:555555555555555555';

  const sent = [];
  const message = {
    url: 'https://discord.com/channels/1/2/3',
    author: { id: '99', username: 'david' },
    channel: {
      id: 'chan-owner',
      isTextBased: () => true,
      isThread: () => false,
      send: async (payload) => {
        sent.push(payload);
        return payload;
      },
    },
    hasThread: false,
  };
  await notifyStaff({
    client: null,
    message,
    question: 'I want a refund',
    reason: 'refund',
    area: 'shop',
    route: { area: 'shop', lane: 'money', escalate: true },
    skipDedupe: true,
  });
  assert.match(sent[0].content, /<@555555555555555555>/);
  assert.equal(sent[0].allowedMentions.users.includes('555555555555555555'), true);

  if (prevThread !== undefined) process.env.HANDOFF_THREADS = prevThread;
  else delete process.env.HANDOFF_THREADS;
  if (prevStaff !== undefined) process.env.STAFF_ALERT_CHANNEL_ID = prevStaff;
  else delete process.env.STAFF_ALERT_CHANNEL_ID;
  if (prevOwners !== undefined) process.env.AREA_OWNERS = prevOwners;
  else delete process.env.AREA_OWNERS;
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
