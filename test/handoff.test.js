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
const { ChannelType } = require('discord.js');

test('case acceptance buttons remain exclusively on staff-only cards', () => {
  const { publicHandoffDiscord } = require('../handoff');
  const caseId = '8df371b5-47c5-41b0-9931-39f35332bc33';
  const input = { caseId, fileIssueId: 'issue-draft', question: 'App loses recordings', area: 'app',
    message: { author: { id: '123456789012345678' }, channel: { id: 'general' } },
  };
  const staff = formatStaffTicket({ ...input, staffOnly: true }).discord;
  assert.equal(staff.components[0].components.some((button) => button.custom_id === `case:accept:${caseId}`), true);
  const publicPayload = publicHandoffDiscord(staff);
  assert.deepEqual(publicPayload.components[0].components.map((button) => button.custom_id), ['file:issue-draft']);
  assert.equal(JSON.stringify(publicPayload).includes(caseId), false);
  const publicCard = formatStaffTicket(input).discord;
  assert.equal(publicCard.components[0].components.some((button) => button.custom_id.startsWith('case:accept:')), false);
  const acceptOnly = formatStaffTicket({ ...input, fileIssueId: null, staffOnly: true }).discord;
  assert.equal(publicHandoffDiscord(acceptOnly).components, undefined);
});

test('private handoff invites the customer but never exposes the staff-only card', async () => {
  const previous = {
    threads: process.env.HANDOFF_THREADS,
    staff: process.env.STAFF_ALERT_CHANNEL_ID,
    users: process.env.STAFF_USER_IDS,
  };
  process.env.HANDOFF_THREADS = '1';
  delete process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_USER_IDS = '123456789012345678';
  const invited = [];
  const sent = [];
  let createOptions;
  const thread = {
    id: 'private-handoff-1',
    members: { add: async (id) => invited.push(id) },
    send: async (payload) => sent.push(payload),
  };
  try {
    const result = await notifyStaff({
      client: null,
      message: {
        author: { id: '998877665544332211' },
        channel: {
          id: 'general-private-test',
          isThread: () => false,
          threads: { create: async (options) => { createOptions = options; return thread; } },
          isTextBased: () => true,
          send: async () => { throw new Error('must use private thread'); },
        },
        startThread: async () => { throw new Error('must not create public thread'); },
      },
      question: 'Order #22777 for ada@example.com',
      reason: 'Needs shipping check',
      shopify: 'SECRET_SHOPIFY_FACT',
      area: 'shop',
      route: { area: 'shop', lane: 'shop' },
      skipDedupe: true,
    });
    assert.equal(result.via, 'thread');
    assert.equal(result.ok, false);
    assert.equal(createOptions.type, ChannelType.PrivateThread);
    assert.deepEqual(invited, ['998877665544332211', '123456789012345678']);
    assert.equal(sent.length, 1);
    const blob = JSON.stringify(sent[0]);
    assert.doesNotMatch(blob, /22777|ada@example\.com|SECRET_SHOPIFY_FACT|Needs shipping check/);
    assert.match(blob, /does not repeat it/);
    assert.doesNotMatch(blob, /customer's message is above/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      const name = key === 'threads' ? 'HANDOFF_THREADS' : key === 'staff' ? 'STAFF_ALERT_CHANNEL_ID' : 'STAFF_USER_IDS';
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    resetHandoffMemory();
  }
});

test('canNotifyStaff requires a configured staff-only destination', () => {
  const previous = process.env.STAFF_ALERT_CHANNEL_ID;
  delete process.env.STAFF_ALERT_CHANNEL_ID;
  assert.equal(canNotifyStaff({ discordReady: true }), false);
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  assert.equal(canNotifyStaff({ discordReady: true }), true);
  if (previous === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID;
  else process.env.STAFF_ALERT_CHANNEL_ID = previous;
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
  assert.equal(ticket.discord.content, undefined);
  assert.equal(/<@123456789012345678>/.test(JSON.stringify(ticket.discord.embeds)), false);
  const specialist = ticket.discord.embeds[0].fields.find((f) => f.name === 'Owner');
  assert.equal(specialist.value, 'Mohsin');
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
  assert.match(staff.value, /Reply here/i);
  assert.match(staff.value, /faq:/i);
  assert.match(staff.value, /\/done/);
  const staffChannelTicket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: 'Where is my order?',
    area: 'shop',
    staffOnly: true,
  });
  const staffChannelInstructions = staffChannelTicket.discord.embeds[0].fields.find((f) => f.name === 'Staff').value;
  assert.match(staffChannelInstructions, /Jump link/i);
  assert.match(staffChannelInstructions, /repl(?:y|ies) in #vector-staff do not reach the customer/i);
  assert.match(staffChannelInstructions, /\/done.*(?:customer|Handoff|help).*thread/i);
  assert.match(staffChannelInstructions, /faq:.*Handoff thread/i);
  assert.doesNotMatch(staffChannelInstructions, /Reply here/i);
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

test('staff card names the customer in From without notifying or retaining untrusted mentions', () => {
  const card = formatStaffTicket({
    message: { url: 'https://discord.com/channels/1/2/3', author: { id: '123456789012345678' }, channel: { id: '2' } },
    question: 'Please ask <@123456789012345678> about this',
    reason: 'Check with <@&987654321098765432>',
    area: 'unknown', lane: 'faq', staffOnly: true,
  }).discord;
  assert.equal(card.content, undefined);
  assert.deepEqual(card.allowedMentions, { parse: [], users: [], roles: [] });
  assert.equal(card.embeds[0].fields.find((field) => field.name === 'From')?.value, '<@123456789012345678> · <#2>');
  assert.doesNotMatch(card.embeds[0].description, /<@(?:&|!)?\d+>/);
  for (const field of card.embeds[0].fields.filter((field) => field.name !== 'From')) {
    assert.doesNotMatch(field.value, /<@(?:&|!)?\d+>/);
  }
  assert.ok(card.embeds[0].fields.find((field) => field.name === 'Owner')?.value);
});

test('staff cards request details appropriate to the ticket and flag possible data loss', () => {
  const base = { message: { url: 'https://discord.com/channels/1/2/3', author: { id: '99' }, channel: { id: '2' } }, staffOnly: true };
  const cases = [
    [{ area: 'shop', lane: 'shop', question: 'Tracking says delivered but nothing arrived' }, /order number and the delivery date tracking shows/i],
    [{ area: 'shop', lane: 'money', question: 'I was charged twice' }, /purchase email/i],
    [{ area: 'shop', lane: 'shop', question: 'Ordering 50 units for our company' }, /company and quantity/i],
    [{ area: 'app', lane: 'tech', question: 'My app crashes' }, /device and the app version/i],
    [{ area: 'privacy', lane: 'privacy', question: 'Delete my data' }, /account email.*privately/i],
    [{ area: 'unknown', lane: 'faq', question: 'Get me a person' }, /what they need help with/i],
  ];
  for (const [route, details] of cases) {
    const card = formatStaffTicket({ ...base, ...route }).discord.embeds[0];
    assert.match(card.fields.find((field) => field.name === 'Staff').value, details, route.question);
  }
  const loss = formatStaffTicket({ ...base, area: 'app', lane: 'tech', question: 'The completed meeting recording is missing', dataLossRisk: true }).discord.embeds[0];
  assert.match(loss.fields.find((field) => field.name === 'Labels').value, /`data-loss`/);
  assert.match(loss.fields.find((field) => field.name === 'Why').value, /^Possible data loss: they should not reinstall, log out or clear storage\./);
});

test('staff ticket infers shop/account labels from fair-use text', () => {
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question:
      'Just got omi in the mail. FAIR USE WARNING. FILLED the memory. What are all these plans?',
    reason: 'Fair use, memory limit, or plan question',
  });
  assert.match(ticket.discord.embeds[0].fields.find((f) => f.name === 'Labels').value, /`shop`/);
  assert.match(ticket.discord.embeds[0].fields.find((f) => f.name === 'Labels').value, /`account`/);
  assert.equal(
    /needs-human/i.test(ticket.discord.embeds[0].fields.find((f) => f.name === 'Labels').value),
    false
  );
  assert.equal(
    ticket.discord.embeds[0].fields.some((f) => f.name === 'Area' && f.value === 'shop'),
    true
  );
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

test('staff card quote redacts email, phone, and street address', () => {
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question:
      'Please reach ada@example.com or 415-555-0199 about order #20716 at 12 King Street.',
  });
  const description = ticket.discord.embeds[0].description;
  assert.match(description, /\[email\]/);
  assert.match(description, /\[phone\]/);
  assert.match(description, /\[address\]/);
  assert.equal(description.includes('ada@example.com'), false);
  assert.equal(description.includes('415-555-0199'), false);
  assert.equal(description.includes('12 King Street'), false);
  assert.match(description, /#20716/);
  const specialist = ticket.discord.embeds[0].fields.find((field) => field.name === 'Owner');
  assert.equal(specialist.value.includes('@'), false);
});

test('staff card quote drops leftover discord chrome', () => {
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: [
      'gregory',
      'OP:',
      '- 15/09/2026, 05:26',
      'OMI — AUGUST 11:',
      'BRAZIL — SEPTEMBER 14:',
      'E embaixo:',
      'Please take ownership of Order #20716.',
      'On August 11, Omi confirmed the duties were prepaid.',
      'My gmail is gregory.brazil and hotmail: ada.lane.',
      'I use gmail for the receipt. Email me on hotmail if the site is down. See gmail: the receipt.',
    ].join('\n'),
    area: 'shop',
    lane: 'shop',
  });
  const description = ticket.discord.embeds[0].description;
  assert.match(description, /Order #20716/);
  assert.match(description, /On August 11, Omi confirmed/i);
  assert.match(description, /I use gmail for the receipt/);
  assert.match(description, /on hotmail/i);
  assert.match(description, /gmail: the receipt/);
  assert.match(description, /\[email\]/);
  assert.equal(/\bgregory\b/i.test(description), false);
  assert.equal(/gregory\.brazil/i.test(description), false);
  assert.equal(/ada\.lane/i.test(description), false);
  assert.equal(/\bOP\b/.test(description), false);
  assert.equal(/15\/09\/2026/.test(description), false);
  assert.equal(/SEPTEMBER 14/i.test(description), false);
  assert.equal(/AUGUST 11:/i.test(description), false);
  assert.equal(/embaixo/i.test(description), false);
  const specialist = ticket.discord.embeds[0].fields.find((field) => field.name === 'Owner');
  assert.equal(specialist.value.includes('@'), false);
});

test('handoff threads are skipped by name', () => {
  const { handoffThreadName, isHandoffThread } = require('../handoff');
  assert.equal(isHandoffThread({ isThread: () => true, name: 'Handoff · david' }), true);
  assert.equal(isHandoffThread({ isThread: () => true, name: 'daily-reports' }), false);
  assert.equal(isHandoffThread({ isThread: () => false, name: 'Handoff · david' }), false);
  const { isHelpForumThread, isCloseableThread } = require('../handoff');
  assert.equal(
    isHelpForumThread({ isThread: () => true, parentId: 'forum', name: 'App offline' }),
    false
  );
  process.env.HELP_FORUM_CHANNEL_ID = 'forum';
  try {
    assert.equal(
      isHelpForumThread({ isThread: () => true, parentId: 'forum', name: 'App offline' }),
      true
    );
    assert.equal(
      isCloseableThread({ isThread: () => true, parentId: 'forum', name: 'App offline' }),
      true
    );
  } finally {
    delete process.env.HELP_FORUM_CHANNEL_ID;
  }
  assert.equal(
    isCloseableThread({
      isThread: () => true,
      name: 'App offline',
      parent: { type: 15 },
    }),
    true
  );
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
  const brazil = handoffThreadName({
    question: [
      'OMI — AUGUST 11:',
      '"Duties and import taxes are prepaid."',
      'BRAZIL — SEPTEMBER 14',
      'AWAITING PAYMENT OF TAXES/SERVICES',
      'Omi, can someone please explain this and take ownership of Order #20716?',
    ].join('\n'),
    area: 'shop',
    lane: 'shop',
  });
  assert.match(brazil, /\[order number\]/i);
  assert.doesNotMatch(brazil, /20716/);
  assert.match(brazil, /import tax/i);
  assert.equal(/AUGUST 11/i.test(brazil), false);
  assert.match(brazil, /shop/);
  assert.match(brazil, /money/);
  const win = handoffThreadName({
    question: "I'm getting this error\nnpm error ERESOLVE\nWhile resolving: omi-windows@1.0.35",
    area: 'desktop',
    lane: 'tech',
  });
  assert.match(win, /omi-windows/i);
  assert.match(win, /ERESOLVE/);
  assert.match(win, /desktop/);
  const autoOff = handoffThreadName({
    question:
      'Hi, I just got my omi and paired it with the omi app, however the device keeps turning itself off after 5 seconds? Video attached',
    area: 'firmware',
    lane: 'firmware',
  });
  assert.match(autoOff, /firmware/);
  assert.match(autoOff, /device off after 5s/);
  assert.equal(/Hi, I just got/i.test(autoOff), false);
  assert.equal(/needs-human/i.test(autoOff), false);
  const fair = handoffThreadName({
    question: [
      'Just got omi in the mail on Wed and was like nintendo kid excited to set it up.',
      'A) a "FAIR USE WARNING"',
      'B) FILLED the memory. What are all these plans?',
    ].join('\n'),
    area: 'shop',
    lane: 'account',
  });
  assert.match(fair, /shop/);
  assert.match(fair, /account/);
  assert.match(fair, /fair use and plans/i);
  assert.equal(/nintendo/i.test(fair), false);
  assert.equal(/needs-human/i.test(fair), false);
  const inferredFair = handoffThreadName({
    question: [
      'Just got omi in the mail on Wed and was like nintendo kid excited to set it up.',
      'A) a "FAIR USE WARNING"',
      'B) FILLED the memory. What are all these plans?',
    ].join('\n'),
    topic: 'fair use warning and plans',
    labels: ['shop', 'account'],
  });
  assert.equal(/needs-human/i.test(inferredFair), false);
  assert.equal(/nintendo/i.test(inferredFair), false);
  assert.match(inferredFair, /shop/);
  assert.match(inferredFair, /account/);
  assert.match(inferredFair, /fair use warning and plans/i);
  const { ticketLabels } = require('../handoff');
  assert.deepEqual(ticketLabels({ area: 'unknown', lane: 'faq' }), ['faq']);
  assert.equal(ticketLabels({ question: 'How do I pair my Omi?' }).includes('faq'), true);
});

test('a customer-visible channel card is not a delivered handoff', async () => {
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
  assert.equal(first.ok, false);
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
  assert.equal(second.ok, false);
  assert.equal(second.duplicate, undefined);
  assert.equal(sent.length, 2);

  const other = await notifyStaff({
    client: null,
    message: { ...message, author: { id: '100', username: 'other' } },
    question: 'My order has not shipped',
    reason: 'shipping',
    draft: 'A different customer.',
  });
  assert.equal(other.duplicate, undefined);
  assert.equal(sent.length, 3);

  const third = await notifyStaff({
    client: null,
    message,
    question: 'I want a refund again',
    reason: 'refund',
    draft: 'A person needs to take this.',
    skipDedupe: true,
  });
  assert.equal(third.ok, false);
  assert.equal(Boolean(third.duplicate), false);
  assert.equal(sent.length, 4);

  if (prevThread !== undefined) process.env.HANDOFF_THREADS = prevThread;
  else delete process.env.HANDOFF_THREADS;
  if (prevStaff !== undefined) process.env.STAFF_ALERT_CHANNEL_ID = prevStaff;
  resetHandoffMemory();
});

test('staff-only cards show plain owners and identify the customer only in the From embed', async () => {
  resetHandoffMemory();
  const prevThread = process.env.HANDOFF_THREADS;
  const prevStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.HANDOFF_THREADS = '0';
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';

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
  const client = { channels: { fetch: async () => ({
    isTextBased: () => true,
    send: async (payload) => { sent.push(payload); return payload; },
  }) } };
  const userResult = await notifyStaff({
    client,
    message,
    question: 'I want a refund',
    reason: 'refund',
    area: 'shop',
    route: { area: 'shop', lane: 'money', escalate: true },
    skipDedupe: true,
  });
  assert.equal(userResult.via, 'staff-channel');
  assert.equal(sent[0].content, undefined);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [], roles: [] });
  const specialist = sent[0].embeds[0].fields.find((f) => f.name === 'Owner');
  assert.equal(specialist.value, 'Mohsin');
  const roleResult = await notifyStaff({
    client,
    message,
    question: 'Please delete my account data',
    reason: 'privacy',
    area: 'privacy',
    route: { area: 'privacy', lane: 'privacy', escalate: true },
    skipDedupe: true,
  });
  assert.equal(roleResult.via, 'staff-channel');
  assert.equal(sent[1].content, undefined);
  assert.deepEqual(sent[1].allowedMentions, { parse: [], users: [], roles: [] });
  const defaultResult = await notifyStaff({
    client,
    message,
    question: 'Can someone look into this unusual case?',
    reason: 'Needs review',
    area: 'unknown',
    route: { area: 'unknown', lane: 'unknown', escalate: true },
    skipDedupe: true,
  });
  assert.equal(defaultResult.via, 'staff-channel');
  assert.equal(sent[2].content, undefined);
  assert.deepEqual(sent[2].allowedMentions, { parse: [], users: [], roles: [] });
  const faqResult = await notifyStaff({
    client, message, question: 'Get me a real human please', reason: 'Human requested',
    area: 'unknown', route: { area: 'unknown', lane: 'faq', escalate: true }, skipDedupe: true,
  });
  assert.equal(faqResult.via, 'staff-channel');
  assert.equal(sent[3].embeds[0].fields.find((f) => f.name === 'Owner').value, 'Aryan, David, undivisible');
  for (const card of sent) {
    assert.equal(card.embeds[0].fields.find((f) => f.name === 'From')?.value, '<@99> · <#chan-owner>');
    assert.doesNotMatch(card.embeds[0].description, /<@(?:&|!)?\d+>/);
    for (const field of card.embeds[0].fields.filter((field) => field.name !== 'From')) {
      assert.doesNotMatch(field.value, /<@(?:&|!)?\d+>/);
    }
    assert.deepEqual(card.allowedMentions, { parse: [], users: [], roles: [] });
    assert.ok(card.embeds[0].fields.find((f) => f.name === 'Owner')?.value);
  }

  if (prevThread !== undefined) process.env.HANDOFF_THREADS = prevThread;
  else delete process.env.HANDOFF_THREADS;
  if (prevStaff !== undefined) process.env.STAFF_ALERT_CHANNEL_ID = prevStaff;
  else delete process.env.STAFF_ALERT_CHANNEL_ID;
  resetHandoffMemory();
});

test('customer-visible card has no mentions', async () => {
  resetHandoffMemory();
  const before = {
    staff: process.env.STAFF_ALERT_CHANNEL_ID,
    threads: process.env.HANDOFF_THREADS,
  };
  delete process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.HANDOFF_THREADS = '0';
  const sent = [];
  try {
    const result = await notifyStaff({
      client: null,
      message: {
        url: 'https://discord.com/channels/1/2/3',
        author: { id: '99' },
        channel: {
          id: 'customer-thread', isThread: () => true, isTextBased: () => true,
          send: async (payload) => { sent.push(payload); return payload; },
        },
      },
      question: 'Can someone look into this unusual case?', area: 'unknown',
      route: { area: 'unknown', lane: 'unknown', escalate: true },
      skipDedupe: true,
    });
    assert.equal(result.via, 'channel');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].content, undefined);
    assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [], roles: [] });
    assert.doesNotMatch(JSON.stringify(sent[0]), /<@(?:&|!)?\d+>/);
  } finally {
    for (const [key, name] of [['staff', 'STAFF_ALERT_CHANNEL_ID'], ['threads', 'HANDOFF_THREADS']]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
    resetHandoffMemory();
  }
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

test('clipUserQuestion drops ping-me placeholders', () => {
  const { clipUserQuestion } = require('../handoff');
  const out = clipUserQuestion(
    'Apple Watch recordings still missing. Ping me as @yourDiscordName so I know you got this.'
  );
  assert.match(out, /Apple Watch recordings still missing/);
  assert.equal(/ping me/i.test(out), false);
  assert.equal(/yourDiscordName/i.test(out), false);
});

test('clipUserQuestion drops Discord OP chrome from a pasted help post', () => {
  const { clipUserQuestion } = require('../handoff');
  const out = clipUserQuestion(
    [
      'ThatGuySi_TGS [DAWN],',
      'OP',
      '— Yesterday at 09:33',
      'The floating bubble used to be something I could type in when looking at a different window on my computer.',
      'Image',
    ].join('\n')
  );
  assert.match(out, /floating bubble/i);
  assert.equal(/ThatGuySi_TGS|DAWN|\bOP\b|Yesterday at/i.test(out), false);
  assert.equal(/^Image$/m.test(out), false);
});

test('clipUserQuestion drops a one-word display name and a trailing backslash', () => {
  const { clipUserQuestion } = require('../handoff');
  const out = clipUserQuestion(
    [
      'Vidal',
      'OP',
      '— 20/09/2026, 04:55',
      'Are there any instructions or documentation on this feature? How it works and how it\'s different from paying for a paid plan?\\',
    ].join('\n')
  );
  assert.match(out, /instructions or documentation/i);
  assert.equal(/\bVidal\b|\bOP\b|20\/09\/2026/.test(out), false);
  assert.equal(out.includes('\\'), false);
  assert.equal(clipUserQuestion('Vidal'), 'Vidal');
});

test('clipUserQuestion keeps the customer bug and drops a staff follow-up on a pasted help post', () => {
  const { clipUserQuestion } = require('../handoff');
  const out = clipUserQuestion(
    [
      'Omi window appears randomly',
      'Charles Clogston',
      'OP',
      '— 20/09/2026, 16:56',
      'What triggers the Omi app to come to the front? In the middle of working on an app, Omi window will open and come to the front and has to be hidden.',
      'Aryan Gupta [FDRM], ⭐ — Yesterday at 12:04',
      '@Charles Clogston Likely an alert when Omi hits a mic or transcription error in the background, it pulls the window forward to show it. When it jumps up, is there a dialog on it or just the normal UI? Also, do you use Ctrl+Option+R in the app you\'re working in?',
    ].join('\n')
  );
  assert.match(out, /come to the front/i);
  assert.equal(/Charles Clogston|20\/09\/2026|FDRM|Ctrl\+Option\+R|transcription error/i.test(out), false);
});

test('#vector-test parent messages do not reuse an old Handoff', () => {
  const { shouldReuseOpenHandoff } = require('../handoff');
  const prev = process.env.VECTOR_TEST_CHANNEL_ID;
  process.env.VECTOR_TEST_CHANNEL_ID = '1550182642874589194';
  try {
    assert.equal(shouldReuseOpenHandoff({ id: '1550182642874589194' }), false);
    assert.equal(
      shouldReuseOpenHandoff({ id: 'post1', parentId: '1550182642874589194', isThread: () => true }),
      false
    );
    assert.equal(shouldReuseOpenHandoff({ id: '999888777' }), true);
  } finally {
    if (prev === undefined) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prev;
  }
});

test('a different report on the same platform is not glued onto the open Handoff', () => {
  const { isSameHandoff } = require('../handoff');
  assert.equal(
    isSameHandoff('Handoff · app · tech · Android app stopped working after update', {
      question: 'Android battery drain is huge after the latest update',
      topic: 'Android battery drain after update',
    }),
    false
  );
  assert.equal(
    isSameHandoff('Handoff · desktop · tech · Mac desktop app will not start after update', {
      question: 'The desktop app on my Mac shows the wrong transcription language after the update',
      topic: 'wrong transcription language on Mac',
    }),
    false
  );
  assert.equal(
    isSameHandoff('Handoff · app · tech · iPhone app will not open', {
      question: 'The iPhone app will not show my memories',
      topic: 'iPhone app memories',
    }),
    false
  );
  assert.equal(
    isSameHandoff('Handoff · app · tech · Android app stopped working after update', {
      question: 'My Android app stopped working after the update and it still is not working',
      topic: 'Android app stopped working after update',
    }),
    true
  );
  assert.equal(
    isSameHandoff('Handoff · app · tech · Android app crashing', { question: 'android app is still crashing', topic: '' }),
    true
  );
});

test('open Handoff threads match the same Watch ticket, not a refund', async () => {
  const { isSameHandoff, findOpenHandoff } = require('../handoff');
  const watch = 'Handoff · app · tech · Apple Watch recordings missing from app';
  assert.equal(
    isSameHandoff(watch, {
      question: 'Apple Watch recordings still missing.',
      topic: 'Apple Watch recordings missing from app',
    }),
    true
  );
  assert.equal(
    isSameHandoff(watch, {
      question: 'I want a refund for order #20716',
      topic: 'Order #20716',
    }),
    false
  );
  const iphoneBlue =
    'The Omi app on iPhone says disconnected even though the necklace has a blue light. Recordings from today are missing.';
  assert.equal(
    isSameHandoff(watch, {
      question: iphoneBlue,
      topic: 'phone app',
    }),
    false
  );
  const blue = 'Handoff · app · tech · App offline while device light blue';
  assert.equal(
    isSameHandoff(blue, {
      question: iphoneBlue,
      topic: 'app offline while blue light on',
    }),
    true
  );
  const { threadTopic, isWeakerHandoffName, applyThreadName } = require('../handoff');
  assert.match(threadTopic(iphoneBlue, { area: 'app', lane: 'tech' }), /offline|disconnected|blue/i);
  assert.equal(
    isWeakerHandoffName('Handoff · app · tech · phone app', watch),
    true
  );
  let renamed = '';
  const kept = await applyThreadName(
    {
      name: watch,
      setName: async (name) => {
        renamed = name;
      },
    },
    {
      question: iphoneBlue,
      area: 'app',
      lane: 'tech',
      topic: 'phone app',
      labels: ['app', 'tech'],
    }
  );
  assert.equal(kept, false);
  assert.equal(renamed, '');
  const thread = {
    id: 'old',
    name: watch,
    archived: false,
    members: {
      cache: { has: (id) => id === '99' },
      fetch: async () => ({ has: (id) => id === '99' }),
    },
  };
  const found = await findOpenHandoff(
    {
      threads: {
        fetchActive: async () => ({ threads: new Map([['old', thread]]) }),
      },
    },
    {
      userId: '99',
      question: 'Apple Watch recordings still missing.',
      topic: 'Apple Watch recordings missing from app',
    }
  );
  assert.equal(found?.id, 'old');
  const byStarter = await findOpenHandoff(
    {
      threads: {
        fetchActive: async () => ({
          threads: new Map([
            [
              'starter',
              {
                id: 'starter',
                name: watch,
                archived: false,
                fetchStarterMessage: async () => ({ author: { id: '99' } }),
              },
            ],
          ]),
        }),
      },
    },
    {
      userId: '99',
      question: 'Apple Watch recordings still missing.',
      topic: 'Apple Watch recordings missing from app',
    }
  );
  assert.equal(byStarter?.id, 'starter');
});

test('staff card drops a cause-shaped why line', () => {
  const ticket = formatStaffTicket({
    message: {
      url: 'https://discord.com/channels/1/2/3',
      author: { id: '99' },
      channel: { id: '2' },
    },
    question: 'Keep getting transcription unavailable',
    reason: 'Phone app reports transcription unavailable repeatedly; app bug needs investigation',
    area: 'app',
    lane: 'tech',
  });
  const why = ticket.discord.embeds[0].fields.find((field) => field.name === 'Why').value;
  assert.equal(/app bug/i.test(why), false);
  assert.match(why, /cannot see the phone app/i);
  assert.match(ticket.discord.embeds[0].description, /transcription unavailable/i);
});

test('forum starter title and tags are included once', () => {
  const { forumStarterPrefix, threadHasKnownIssueTag } = require('../handoff');
  const prev = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = 'help';
  const channel = {
    isThread: () => true,
    parentId: 'help',
    id: 'thread1',
    name: "Have pro sub and device doesn't capture anything",
    appliedTags: ['android', 'known'],
    parent: {
      type: 15,
      availableTags: [
        { id: 'android', name: 'Android' },
        { id: 'trans', name: 'Transcription' },
        { id: 'known', name: 'Known issue' },
        { id: 'cv', name: 'Omi (CV1)' },
      ],
    },
  };
  try {
    const prefix = forumStarterPrefix({ id: 'thread1', channel });
    assert.match(prefix, /Post: Have pro sub and device doesn't capture anything/);
    assert.match(prefix, /Tags: Android, Known issue/);
    assert.equal(forumStarterPrefix({ id: 'later-message', channel }), '');
    assert.equal(threadHasKnownIssueTag(channel), true);
    channel.appliedTags = ['android'];
    assert.equal(threadHasKnownIssueTag(channel), false);
  } finally {
    if (prev == null) delete process.env.HELP_FORUM_CHANNEL_ID;
    else process.env.HELP_FORUM_CHANNEL_ID = prev;
  }
});

test('help forum card does not repeat the customer post', async () => {
  resetHandoffMemory();
  const prev = {
    help: process.env.HELP_FORUM_CHANNEL_ID,
    vector: process.env.VECTOR_TEST_CHANNEL_ID,
    staff: process.env.STAFF_ALERT_CHANNEL_ID,
    threads: process.env.HANDOFF_THREADS,
    users: process.env.STAFF_USER_IDS,
    role: process.env.STAFF_ROLE_ID,
  };
  const HELP = 'help-forum-id';
  const VECTOR = 'vector-test-id';
  const STAFF_USER = '123456789012345678';
  const STAFF_ROLE = '222222222222222222';
  const question =
    'Please reach ada@example.com or 415-555-0199 about the pendant stuck in customs at 12 King Street.';
  const draft = 'UNIQUE_DRAFT would repeat ada@example.com and 12 King Street.';
  const shopify = 'UNIQUE_SHOPIFY Ship to: Berlin, Germany ada@example.com 415-555-0199';
  const publicDescription = 'Details are in the original support message. This card does not repeat it.';
  process.env.HELP_FORUM_CHANNEL_ID = HELP;
  process.env.VECTOR_TEST_CHANNEL_ID = VECTOR;
  process.env.HANDOFF_THREADS = '1';
  process.env.STAFF_USER_IDS = STAFF_USER;
  process.env.STAFF_ROLE_ID = STAFF_ROLE;
  delete process.env.STAFF_ALERT_CHANNEL_ID;

  const telegram = require('../telegram');
  const originalSend = telegram.sendEscalation;
  const escalations = [];
  telegram.sendEscalation = async (payload) => {
    escalations.push(payload);
    return true;
  };

  function helpMessage(id) {
    const sent = [];
    let started = 0;
    const message = {
      url: 'https://discord.com/channels/1/help-thread/3',
      author: { id: '99', username: 'ada' },
      channel: {
        id,
        parentId: HELP,
        isTextBased: () => true,
        isThread: () => true,
        send: async (payload) => {
          sent.push(payload);
          return payload;
        },
      },
      hasThread: false,
      startThread: async () => {
        started += 1;
        throw new Error('should not start a thread inside a help post');
      },
    };
    return { message, sent, started: () => started };
  }

  try {
    const help = helpMessage('help-thread-1');
    const posted = await notifyStaff({
      client: null,
      message: help.message,
      question,
      reason: 'Order or shipping',
      draft,
      shopify,
      area: 'shop',
      route: { area: 'shop', lane: 'shop', escalate: true },
      skipDedupe: true,
    });
    assert.equal(posted.ok, true);
    assert.equal(posted.via, 'channel');
    assert.equal(help.started(), 0);
    assert.equal(help.sent.length, 1);
    const card = help.sent[0];
    const embed = card.embeds[0];
    const blob = JSON.stringify(card);
    assert.equal(embed.description, publicDescription);
    assert.equal(embed.title, 'Needs a human');
    assert.equal(blob.includes('pendant stuck in customs'), false);
    assert.equal(blob.includes('ada@example.com'), false);
    assert.equal(blob.includes('415-555-0199'), false);
    assert.equal(blob.includes('12 King Street'), false);
    assert.equal(blob.includes('UNIQUE_DRAFT'), false);
    assert.equal(blob.includes('UNIQUE_SHOPIFY'), false);
    assert.equal(blob.includes('Berlin'), false);
    assert.equal(blob.includes('@'), false);
    assert.equal(blob.includes(STAFF_USER), false);
    assert.equal(blob.includes(STAFF_ROLE), false);
    assert.equal(card.content, undefined);
    assert.deepEqual(card.allowedMentions.users, []);
    assert.deepEqual(card.allowedMentions.roles, []);
    assert.equal(
      embed.fields.some((field) => field.name === 'Shopify' || field.name === 'GitHub'),
      false
    );
    const area = embed.fields.find((field) => field.name === 'Area');
    const specialist = embed.fields.find((field) => field.name === 'Owner');
    const labels = embed.fields.find((field) => field.name === 'Labels');
    assert.equal(area.value, 'shop');
    assert.equal(specialist.value, 'Mohsin');
    assert.equal(specialist.value.includes('@'), false);
    assert.match(labels.value, /`shop`/);
    assert.equal(escalations.length, 1);
    assert.match(escalations[0].userQuestion, /pendant stuck in customs/);
    assert.match(escalations[0].botDraft, /UNIQUE_DRAFT/);
    assert.equal(escalations[0].userQuestion.includes(publicDescription), false);

    const staffSent = [];
    const quiet = helpMessage('help-thread-2');
    process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
    const staffResult = await notifyStaff({
      client: {
        channels: {
          fetch: async () => ({
            isTextBased: () => true,
            send: async (payload) => {
              staffSent.push(payload);
              return payload;
            },
          }),
        },
      },
      message: quiet.message,
      question,
      reason: 'Order or shipping',
      draft,
      shopify,
      area: 'shop',
      route: { area: 'shop', lane: 'shop', escalate: true },
      skipDedupe: true,
    });
    assert.equal(staffResult.ok, true);
    assert.equal(staffResult.via, 'staff-channel');
    assert.equal(quiet.sent.length, 0);
    assert.equal(staffSent.length, 1);
    const staffEmbed = staffSent[0].embeds[0];
    assert.match(staffEmbed.description, /pendant stuck in customs/);
    assert.match(staffEmbed.description, /\[email\]/);
    assert.match(staffEmbed.description, /\[phone\]/);
    assert.match(staffEmbed.description, /\[address\]/);
    assert.equal(staffEmbed.description.includes('ada@example.com'), false);
    assert.equal(staffEmbed.description.includes('415-555-0199'), false);
    assert.equal(staffEmbed.description.includes('12 King Street'), false);
    assert.equal(staffEmbed.description.includes(publicDescription), false);
    assert.match(staffEmbed.fields.find((field) => field.name === 'Shopify').value, /UNIQUE_SHOPIFY/);
    assert.match(escalations[1].userQuestion, /pendant stuck in customs/);
    assert.match(escalations[1].botDraft, /UNIQUE_DRAFT/);
    assert.deepEqual(staffSent[0].allowedMentions.users, []);
    assert.deepEqual(staffSent[0].allowedMentions.roles, []);
    assert.equal(staffSent[0].content, undefined);
    delete process.env.STAFF_ALERT_CHANNEL_ID;

    const vectorSent = [];
    let vectorStarted = 0;
    const vector = await notifyStaff({
      client: null,
      message: {
        url: 'https://discord.com/channels/1/vector/3',
        author: { id: '99' },
        channel: {
          id: 'vector-thread',
          parentId: VECTOR,
          isTextBased: () => true,
          isThread: () => true,
          send: async (payload) => {
            vectorSent.push(payload);
            return payload;
          },
        },
        hasThread: false,
        startThread: async () => {
          vectorStarted += 1;
          throw new Error('vector-test is already a thread');
        },
      },
      question: 'Where is my order #20716?',
      reason: 'Order or shipping',
      draft: 'UNIQUE_DRAFT for vector-test',
      area: 'shop',
      route: { area: 'shop', lane: 'shop' },
      skipDedupe: true,
    });
    assert.equal(vector.via, 'channel');
    assert.equal(vectorStarted, 0);
    assert.equal(vectorSent[0].embeds[0].description, publicDescription);
    assert.equal(JSON.stringify(vectorSent[0]).includes('20716'), false);

    const normalSent = [];
    process.env.HANDOFF_THREADS = '0';
    const normal = await notifyStaff({
      client: null,
      message: {
        url: 'https://discord.com/channels/1/general/3',
        author: { id: '99' },
        channel: {
          id: 'general',
          isTextBased: () => true,
          isThread: () => false,
          send: async (payload) => {
            normalSent.push(payload);
            return payload;
          },
        },
        hasThread: false,
      },
      question: 'Where is my order #20716?',
      reason: 'Order or shipping',
      area: 'shop',
      route: { area: 'shop', lane: 'shop' },
      skipDedupe: true,
    });
    assert.equal(normal.via, 'channel');
    assert.equal(normalSent[0].embeds[0].description, publicDescription);
    assert.equal(JSON.stringify(normalSent[0]).includes('20716'), false);
  } finally {
    telegram.sendEscalation = originalSend;
    if (prev.help === undefined) delete process.env.HELP_FORUM_CHANNEL_ID;
    else process.env.HELP_FORUM_CHANNEL_ID = prev.help;
    if (prev.vector === undefined) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = prev.vector;
    if (prev.staff === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID;
    else process.env.STAFF_ALERT_CHANNEL_ID = prev.staff;
    if (prev.threads === undefined) delete process.env.HANDOFF_THREADS;
    else process.env.HANDOFF_THREADS = prev.threads;
    if (prev.users === undefined) delete process.env.STAFF_USER_IDS;
    else process.env.STAFF_USER_IDS = prev.users;
    if (prev.role === undefined) delete process.env.STAFF_ROLE_ID;
    else process.env.STAFF_ROLE_ID = prev.role;
    resetHandoffMemory();
  }
});

test('a locked Handoff thread is not reused for a new report', async () => {
  const { findOpenHandoff } = require('../handoff');
  const thread = {
    id: 'locked',
    name: 'Handoff · app · tech · Apple Watch recordings missing from app',
    archived: false,
    locked: true,
    members: { cache: { has: (id) => id === '99' } },
  };
  const found = await findOpenHandoff(
    { threads: { fetchActive: async () => ({ threads: new Map([['locked', thread]]) }) } },
    {
      userId: '99',
      question: 'Apple Watch recordings still missing.',
      topic: 'Apple Watch recordings missing from app',
    }
  );
  assert.equal(found, null);
});

test('an unclassified follow-up does not rename a Handoff that already has an area', () => {
  const { isWeakerHandoffName } = require('../handoff');
  const named = 'Handoff · app · tech · iPhone app disconnected';
  assert.equal(isWeakerHandoffName('Handoff · needs-human · It happened again this morning.', named), true);
  assert.equal(isWeakerHandoffName(named, 'Handoff · needs-human · It happened again this morning.'), false);
});

test('a long privacy request does not repeat privacy in the Handoff name', () => {
  const { handoffThreadName } = require('../handoff');
  const q = 'Please delete my data, the Android app keeps crashing and I am done with it.';
  const route = require('../router').classify(q);
  const name = handoffThreadName({ question: q, area: route.area, lane: route.lane });
  assert.equal(name, 'Handoff · privacy');
});
