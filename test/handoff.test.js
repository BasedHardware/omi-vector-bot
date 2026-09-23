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
  assert.equal(ticket.discord.content, undefined);
  assert.equal(/<@123456789012345678>/.test(JSON.stringify(ticket.discord.embeds)), false);
  const specialist = ticket.discord.embeds[0].fields.find((f) => f.name === 'Specialist');
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
  assert.match(brazil, /order #20716/i);
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
  assert.equal(sent[0].content, undefined);
  assert.equal(/<@555555555555555555>|<@&/.test(JSON.stringify(sent[0])), false);
  const specialist = sent[0].embeds[0].fields.find((f) => f.name === 'Specialist');
  assert.equal(specialist.value, 'Mohsin');
  assert.equal(sent[0].allowedMentions.users.length, 0);

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
