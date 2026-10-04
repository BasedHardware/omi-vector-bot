const assert = require('node:assert/strict');
const test = require('node:test');
const { ChannelType, Events, MessageFlags, MessageMentions, User } = require('discord.js');

const TEST_CHANNEL = '100000000000000100';
const HELP_FORUM = '100000000000000200';
const BOT_ID = '100000000000000300';

for (const key of [
  'DISCORD_TOKEN',
  'OPENCODE_API_KEY',
  'CMD_API_KEY',
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DATABASE_URL',
  'STAFF_ALERT_CHANNEL_ID',
  'STAFF_USER_IDS',
  'STAFF_ROLE_ID',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'HANDOFF_THREADS',
  'SHOPIFY_STORE',
  'SHOPIFY_ACCESS_TOKEN',
  'DATA_ENCRYPTION_KEY',
  'RESEND_API_KEY',
]) {
  process.env[key] = '';
}
process.env.VECTOR_TEST_CHANNEL_ID = TEST_CHANNEL;
process.env.HELP_FORUM_CHANNEL_ID = HELP_FORUM;

const utils = require('../utils');
utils.typingDelay = async () => {};

const commandcode = require('../commandcode');
const modelCalls = [];
let modelReply = {};
let modelDown = false;
let searchPlanQueries = [];
const plannerCalls = [];
let plannerSupportKind = 'other';
let plannerMessageKind = 'question';
let plannerStandaloneQuestion = '';
let plannerReplyLanguage = 'en';
let plannerHandoffAcknowledgment = '';
let plannerWantsPerson = false;
let plannerDataLossRisk = false;
let plannerBarrier = null;
let reviewerResponse = null;
const reviewCalls = [];
let emitTestUsage = false;
commandcode.queryAgent = async (args) => {
  modelCalls.push(args);
  if (modelDown) throw new Error('model unavailable');
  if (emitTestUsage) args.onUsage?.({ stage: 'answer', completionTokens: 40, reasoningTokens: 12 });
  return {
    final_answer: 'Hold the center button for ten seconds, then pair it again from the app.',
    confidence: 0.9,
    escalate: false,
    reason: '',
    topic: '',
    labels: [],
    area: '',
    lane: '',
    ...modelReply,
  };
};
commandcode.understandQuestion = async ({ question, onUsage }) => {
  plannerCalls.push(question);
  if (emitTestUsage) onUsage?.({ stage: 'planner', completionTokens: 20, reasoningTokens: 5 });
  if (plannerBarrier) await plannerBarrier;
  return {
    standaloneQuestion: plannerStandaloneQuestion || question,
    customerGoal: question,
    mustAnswer: [question],
    customerFacts: [],
    supportKind: plannerSupportKind,
    messageKind: plannerMessageKind,
    replyLanguage: plannerReplyLanguage,
    handoffAcknowledgment: plannerHandoffAcknowledgment,
    wantsPerson: plannerWantsPerson,
    dataLossRisk: plannerDataLossRisk,
    queries: searchPlanQueries,
  };
};
commandcode.reviewAnswer = async (args) => {
  reviewCalls.push(args);
  if (emitTestUsage) args.onUsage?.({ stage: 'review', completionTokens: 30, reasoningTokens: 7 });
  if (reviewerResponse) return reviewerResponse(args);
  const hasDraft = Boolean(String(args.draft || '').trim());
  return {
    final_answer: args.draft,
    grounded: hasDraft,
    relevant: hasDraft,
    confidence: hasDraft ? 0.9 : 0,
    escalate: !hasDraft,
  };
};

const githubCalls = [];
const files = new Map();
let pulls = [];
let issues = [];
let codeItems = [];
const codeContents = new Map();
const feedbackPages = new Map();
let pullState = { state: 'open', merged: false };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('docs.omi.me')) {
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  }
  if (files.has(u)) {
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(files.get(u)) };
  }
  if (u === 'https://feedback.omi.me/sitemap.xml') {
    return {
      ok: feedbackPages.size > 0,
      status: feedbackPages.size > 0 ? 200 : 404,
      text: async () =>
        [...feedbackPages.keys()].map((pageUrl) => `<loc>${pageUrl}</loc>`).join(''),
    };
  }
  if (feedbackPages.has(u)) {
    return { ok: true, status: 200, text: async () => feedbackPages.get(u) };
  }
  const method = opts.method || 'GET';
  githubCalls.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/search/issues')) {
    return { ok: true, status: 200, json: async () => ({ items: u.includes('is%3Apr') ? pulls : issues }) };
  }
  if (u.includes('/search/code')) {
    return { ok: true, status: 200, json: async () => ({ items: codeItems }) };
  }
  if (codeContents.has(u)) {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        encoding: 'base64',
        content: Buffer.from(codeContents.get(u)).toString('base64'),
      }),
    };
  }
  if (method === 'POST' && /\/issues\/\d+\/comments$/.test(u)) {
    return { ok: true, status: 201, json: async () => ({ id: 1 }) };
  }
  if (method === 'POST' && /\/issues$/.test(u)) {
    return {
      ok: true,
      status: 201,
      json: async () => ({ number: 901, html_url: 'https://github.com/BasedHardware/omi/issues/901' }),
    };
  }
  if (/\/pulls\/\d+$/.test(u)) {
    return { ok: true, status: 200, json: async () => pullState };
  }
  throw new Error(`unexpected fetch ${u}`);
};

const knowledge = require('../knowledge');
const docs = require('../docs');
const originalRelevantDocs = docs.relevantDocs;
let docsObserver = null;
docs.relevantDocs = (...args) => docsObserver ? docsObserver(...args) : originalRelevantDocs(...args);
const feedback = require('../feedback');
const github = require('../github');
const commands = require('../commands');
const { app, client, handleMessage, shouldHandle } = require('../index');
const router = require('../router');
const { unreadMediaSentence } = require('../attachments');

client.user = new User(client, { id: BOT_ID, username: 'vector', bot: true });

let seq = 0;
function nextId() {
  seq += 1;
  return String(700000000000000000n + BigInt(seq));
}

function makeChannel({ id = nextId(), name = 'general', thread = false, parentId = null, parent = null } = {}) {
  const channel = {
    id,
    name,
    parentId,
    parent,
    sent: [],
    isThread: () => thread,
    isTextBased: () => true,
    sendTyping: async () => {},
    send: async (payload) => {
      channel.sent.push(payload);
      return { id: nextId() };
    },
    setName: async (value) => {
      channel.name = value;
    },
    messages: { fetch: async () => new Map() },
  };
  return channel;
}

function testChannel() {
  return makeChannel({ id: TEST_CHANNEL, name: 'vector-test' });
}

function generalChannel() {
  const channel = makeChannel();
  const threads = new Map();
  channel.threads = { fetchActive: async () => ({ threads }) };
  return channel;
}

function advanceClock(t, ms) {
  const now = Date.now;
  Date.now = () => now() + ms;
  t.after(() => {
    Date.now = now;
  });
}

async function reportAgain(t, gapMs, between = async () => {}) {
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const thread = first.threads[0];
  await between(thread, channel, authorId);
  const sentBefore = thread.sent.length;
  advanceClock(t, gapMs);
  const again = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it, still.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(again);
  return { thread, sentBefore, again, reply: replyText(again) };
}

async function deleteThread(thread) {
  thread.send = async () => {
    throw new Error('Unknown Channel');
  };
}

async function doneWithArchiveRefused(thread, channel, authorId) {
  thread.members = { cache: new Map([[authorId, {}]]) };
  (await channel.threads.fetchActive()).threads.set(thread.id, thread);
  thread.edit = async () => {
    throw new Error('Missing Access');
  };
  await commands.closeHandoff(thread, { id: '900000000000000009' });
}

function makeMessage(
  content,
  { channel = testChannel(), attachments = [], mention = false, bot = false, authorId = nextId(), member = null } = {}
) {
  const message = {
    id: nextId(),
    content,
    channel,
    author: { id: authorId, username: 'customer', bot },
    member,
    attachments: new Map(attachments.map((a, i) => [String(i), a])),
    embeds: [],
    mentions: { has: () => mention },
    replies: [],
    botReplies: [],
    threads: [],
    reply: async (payload) => {
      message.replies.push(payload);
      const sent = {
        id: nextId(),
        content: textOf(payload),
        author: { id: BOT_ID, username: 'vector', bot: true },
        channel,
        reference: { messageId: message.id },
        fetchReference: async () => message,
      };
      message.botReplies.push(sent);
      return sent;
    },
    startThread: async ({ name }) => {
      const thread = makeChannel({ name, thread: true, parentId: channel.id });
      message.threads.push(thread);
      return thread;
    },
  };
  return message;
}

function textOf(payload) {
  if (typeof payload === 'string') return payload;
  const embeds = (payload?.embeds || []).map((e) =>
    [e.title, e.description, ...(e.fields || []).map((f) => `${f.name}: ${f.value}`)].join('\n')
  );
  return [payload?.content || '', ...embeds].join('\n');
}

function replyText(message) {
  return [...message.replies, ...message.channel.sent].map(textOf).join('\n');
}

function posts() {
  return githubCalls.filter((c) => c.method === 'POST');
}

function slashTest(question, channel = testChannel()) {
  const interaction = {
    id: nextId(),
    commandName: 'test',
    channel,
    user: { id: nextId(), username: 'staff', bot: false },
    options: { getString: (name) => (name === 'question' ? question : null) },
    replies: [],
    isChatInputCommand: () => true,
    reply: async (payload) => {
      interaction.replies.push(payload);
    },
  };
  return interaction;
}

async function emit(event, payload) {
  await client.listeners(event)[0](payload);
}

async function ask(content, options = {}) {
  const message = makeMessage(content, options);
  const models = modelCalls.length;
  const calls = githubCalls.length;
  await handleMessage(message);
  return {
    message,
    reply: replyText(message),
    thread: message.threads[0] || null,
    modelCalled: modelCalls.length > models,
    github: githubCalls.slice(calls),
  };
}

function enableStaffDelivery(t) {
  const originalFetch = client.channels.fetch;
  const previousStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  const delivered = [];
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  client.channels.fetch = async () => ({
    isTextBased: () => true,
    send: async (payload) => {
      delivered.push(payload);
      return payload;
    },
  });
  t.after(() => {
    client.channels.fetch = originalFetch;
    process.env.STAFF_ALERT_CHANNEL_ID = previousStaff;
  });
  return delivered;
}

test.beforeEach(() => {
  modelCalls.length = 0;
  modelReply = {};
  modelDown = false;
  searchPlanQueries = [];
  plannerCalls.length = 0;
  plannerSupportKind = 'other';
  plannerMessageKind = 'question';
  plannerStandaloneQuestion = '';
  plannerReplyLanguage = 'en';
  plannerHandoffAcknowledgment = '';
  plannerWantsPerson = false;
  plannerDataLossRisk = false;
  reviewerResponse = null;
  reviewCalls.length = 0;
  pulls = [];
  issues = [];
  codeItems = [];
  codeContents.clear();
  feedbackPages.clear();
  feedback.resetFeedbackCache();
  pullState = { state: 'open', merged: false };
  githubCalls.length = 0;
  files.clear();
  process.env.GITHUB_TOKEN = '';
  process.env.STAFF_USER_IDS = '';
  process.env.VECTOR_TEST_CHANNEL_ID = TEST_CHANNEL;
  process.env.HELP_FORUM_CHANNEL_ID = HELP_FORUM;
  knowledge.resetKnowledge();
  github.resetGithubMemory();
});

test('/health reports missing staff delivery without revealing IDs', () => {
  const health = app._router.stack.find((layer) => layer.route?.path === '/health').route.stack[0].handle;
  let body;
  health({}, { json: (value) => { body = value; } });
  assert.equal(body.staffHandoff, 'missing');
  process.env.STAFF_ALERT_CHANNEL_ID = 'private-staff-room';
  health({}, { json: (value) => { body = value; } });
  assert.equal(body.staffHandoff, 'configured');
  assert.equal(JSON.stringify(body).includes('private-staff-room'), false);
  delete process.env.STAFF_ALERT_CHANNEL_ID;
});

test('answer path emits per-stage timing metrics without customer text', async () => {
  let metric;
  const timingLines = [];
  const originalLog = console.log;
  const previousKey = process.env.CMD_API_KEY;
  const onMetric = (value) => { metric = value; };
  process.on('omiSupportTimings', onMetric);
  try {
    process.env.CMD_API_KEY = 'test-only-key';
    emitTestUsage = true;
    console.log = (...parts) => {
      if (String(parts[0]).startsWith('[Timing]')) timingLines.push(String(parts[0]));
      else originalLog(...parts);
    };
    await ask('How do I pair my Omi?');
    assert.ok(metric);
    assert.deepEqual(Object.keys(metric.stages).sort(), ['answer', 'planner', 'retrieval', 'review', 'total']);
    assert.ok(metric.stages.total >= 0);
    assert.equal(JSON.stringify(metric).includes('How do I pair'), false);
    assert.equal(timingLines.length, 1);
    assert.match(timingLines[0], /planner_completion_tokens=20 planner_reasoning_tokens=5/);
    assert.match(timingLines[0], /answer_completion_tokens=40 answer_reasoning_tokens=12/);
    assert.match(timingLines[0], /review_completion_tokens=30 review_reasoning_tokens=7/);
    assert.doesNotMatch(timingLines[0], /How do I pair/);
    await ask('Perfect, thank you!');
    assert.equal(timingLines.length, 1, 'suppressed acknowledgments do not log a reply');
  } finally {
    console.log = originalLog;
    emitTestUsage = false;
    if (previousKey === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previousKey;
    process.off('omiSupportTimings', onMetric);
  }
});

test('official docs retrieval begins before the planner resolves and adds its new queries afterward', async () => {
  const previousKey = process.env.CMD_API_KEY;
  const previousQueries = searchPlanQueries;
  let releasePlanner;
  let signalFirstLookup;
  const firstLookup = new Promise((resolve) => { signalFirstLookup = resolve; });
  const calls = [];
  try {
    process.env.CMD_API_KEY = 'test-only-key';
    searchPlanQueries = ['Omi Bluetooth pairing guide'];
    plannerBarrier = new Promise((resolve) => { releasePlanner = resolve; });
    docsObserver = async (question, options) => {
      calls.push({ question, options });
      if (calls.length === 1) signalFirstLookup();
      return '';
    };
    const pending = ask('How do I pair my Omi?');
    await firstLookup;
    assert.equal(calls.length, 1);
    releasePlanner();
    await pending;
    assert.equal(calls.length, 2);
    assert.ok(calls[1].options.queries.includes('Omi Bluetooth pairing guide'));
    assert.equal(calls[0].options.lookupCache, calls[1].options.lookupCache);
  } finally {
    if (releasePlanner) releasePlanner();
    docsObserver = null;
    plannerBarrier = null;
    searchPlanQueries = previousQueries;
    if (previousKey === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previousKey;
  }
});

test('a how-to question in #vector-test gets the model answer and no Handoff', async () => {
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.modelCalled, true);
  assert.match(r.reply, /center button/);
  assert.equal(r.thread, null);
  assert.equal(r.github.length, 0);
});

test('missing delivery gets a grounded answer, no invented status, and a staff handoff', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  modelReply = {
    final_answer: 'Your order was delivered yesterday. Open the tracking link in the shipping email and contact the carrier about the missing parcel. Source: https://help.omi.me/en/articles/shipping',
    escalate: false,
  };
  const question = 'My tracking page says the parcel was delivered two days ago but nothing arrived.';
  const result = await ask(question);
  assert.equal(result.modelCalled, true);
  assert.ok(plannerCalls.includes(question));
  assert.match(result.reply, /^I can't see order status from here/i);
  assert.doesNotMatch(result.reply, /Your order was delivered yesterday/i);
  assert.match(result.reply, /tracking link in the shipping email/i);
  assert.match(result.reply, /contact the carrier/i);
  assert.equal(staff.length, 1);
});

test('a delivered Omi that never arrived gets grounded delivery handling without a package noun', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  modelReply = {
    final_answer: 'Your Omi was delivered yesterday. Open the tracking link from the shipping email and contact the carrier about the missing delivery.',
    escalate: false,
  };
  const result = await ask("UPS says my Omi was delivered yesterday but it isn't here");
  assert.equal(result.modelCalled, true);
  assert.match(result.reply, /^I can't see order status from here/i);
  assert.doesNotMatch(result.reply, /Your Omi was delivered yesterday/i);
  assert.match(result.reply, /tracking link from the shipping email/i);
  assert.equal(staff.length, 1);
});

test('the planner runs for a short first customer question', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  try {
    await ask('How do I pair Omi?');
    assert.deepEqual(plannerCalls, ['How do I pair Omi?']);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('planner-classified order, account and exception requests reach a person in any language', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  const cases = [
    ['Onde está meu pedido? Comprei há um mês', 'order_lookup', 'Where is my order? I bought it a month ago.'],
    ['Quiero un reembolso, el dispositivo no funciona', 'exception_request', 'I want a refund; the device does not work.'],
    ['Comment supprimer mes données ?', 'account_action', 'How do I delete my data?'],
    ['我的订单什么时候发货？', 'order_lookup', 'When will my order ship?'],
    ["is there any way to get my money back if I don't like it?", 'exception_request', 'I want to know whether a refund is possible.'],
    ['warranty claim, the button fell off', 'exception_request', 'The button fell off and I need a warranty claim.'],
    ['my device arrived broken, need a replacement', 'exception_request', 'My device arrived broken and I need a replacement.'],
  ];
  try {
    for (const [question, kind, standalone] of cases) {
      plannerSupportKind = kind;
      plannerStandaloneQuestion = standalone;
      const result = await ask(question);
      assert.ok(result.thread, question);
      assert.doesNotMatch(result.reply, /Hold the center button|will arrive (?:on|by|tomorrow|next)|refund approved|replacement approved|has shipped/i, question);
    }
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('planner-detected account action keeps a grounded answer and still reaches staff', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'account_action';
  plannerStandaloneQuestion = 'How can I delete my Omi account?';
  plannerReplyLanguage = 'fr';
  plannerHandoffAcknowledgment = "Une personne doit examiner votre demande en privé.";
  modelReply = {
    final_answer: "Dans l'application, ouvrez les paramètres de confidentialité pour demander la suppression. Source: https://help.omi.me/en/articles/13162549-omi-privacy-policy",
    escalate: false,
  };
  const result = await ask('Comment supprimer mon compte Omi ?');
  assert.equal(result.modelCalled, true);
  assert.match(result.reply, /paramètres de confidentialité/i);
  assert.equal(staff.length, 1);
  assert.doesNotMatch(result.reply, /I can't change your account|A person on the team/i);
});

test('person-kind policy question in #help keeps a reviewed answer and hands off', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'exception_request';
  modelReply = { final_answer: 'The return policy is described here. Source: https://help.omi.me/en/articles/returns', escalate: false };
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Return policy' });
  const result = await ask('What is the return policy for Omi?', { channel: post });
  assert.equal(result.modelCalled, true);
  assert.match(result.reply, /return policy is described here/i);
  assert.equal(staff.length, 1);
});

test('blank transcript after a completed recording warns and reaches staff', async (t) => {
  const staff = enableStaffDelivery(t);
  modelReply = { final_answer: 'I understand the recording happened but the transcript is blank.', escalate: false };
  for (const question of [
    'I recorded my whole lecture and the transcript is blank',
    "The app shows an empty transcript for yesterday's two hour call",
  ]) {
    const result = await ask(question);
    assert.match(result.reply, /Do not reinstall the app/i);
    assert.equal(staff.length, question.startsWith('I recorded') ? 1 : 2);
    const card = staff.at(-1).embeds[0];
    assert.match(card.fields.find((field) => field.name === 'Labels').value, /`data-loss`/);
    assert.match(card.fields.find((field) => field.name === 'Why').value, /^Possible data loss:/);
  }
});

test('handoff log records signal names without customer wording or order details', async (t) => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...items) => lines.push(items.map(String).join(' '));
  t.after(() => { console.log = originalLog; });
  await ask('Where is order #22777? My email is jane@example.com.');
  const line = lines.find((item) => item.startsWith('[Bot] Escalating'));
  assert.ok(line);
  assert.match(line, /signals=/);
  assert.doesNotMatch(line, /#22777|jane@example\.com|topic=|Where is order/i);
});

test('a multilingual planner data-loss signal hands off without an English warning', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerDataLossRisk = true;
  plannerReplyLanguage = 'es';
  modelReply = { final_answer: 'No se guardó el audio de la reunión.', escalate: false };
  const result = await ask('Hablé toda la reunión y no aparece ninguna transcripción');
  assert.equal(staff.length, 1);
  assert.doesNotMatch(result.reply, /Recordings may still be unsynced|Do not reinstall/i);
  assert.match(staff[0].embeds[0].fields.find((field) => field.name === 'Labels').value, /`data-loss`/);
});

test('person-kind request with private details in #help holds the public answer', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'exception_request';
  modelReply = { final_answer: 'The return policy is described here. Source: https://help.omi.me/en/articles/returns', escalate: false };
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Private return request' });
  const result = await ask('Can you return order #22777? My email is jane@example.com.', { channel: post });
  assert.equal(result.modelCalled, false);
  assert.doesNotMatch(result.reply, /jane@example\.com|#22777|return policy is described here/i);
  assert.equal(staff.length, 1);
});

test('order lookup with an approved sourced draft keeps that policy answer and hands off', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'order_lookup';
  modelReply = { final_answer: 'The delivery policy says to contact the shop team for a missing package. Source: https://help.omi.me/en/articles/delivery', escalate: false };
  const result = await ask('Tracking says delivered but I never got it');
  assert.equal(result.modelCalled, true);
  assert.match(result.reply, /delivery policy says/i);
  assert.doesNotMatch(result.reply, /Order lookup in chat is not live yet/i);
  assert.equal(staff.length, 1);
});

test('planner-detected billing request keeps the sourced answer instead of a data-removal line', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'money';
  plannerStandaloneQuestion = 'What does my invoice cover?';
  plannerReplyLanguage = 'es';
  modelReply = { final_answer: 'La factura muestra el cargo del plan. Fuente: https://help.omi.me/en/articles/billing', escalate: false };
  const result = await ask('¿Qué incluye el cargo de mi factura?');
  assert.equal(result.modelCalled, true);
  assert.equal(staff.length, 1);
  assert.match(result.reply, /factura muestra el cargo/i);
  assert.doesNotMatch(result.reply, /remove your data|replacement or warranty/i);
});

test('English canned refund uses the router reply without a planner or model call', async (t) => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  const result = await ask('I want a refund for my order.');
  assert.equal(plannerCalls.length, 0);
  assert.equal(result.modelCalled, false);
  assert.match(result.reply, /refund/i);
  assert.ok(result.thread);
});

test('off-topic chatter stays silent but asking for a person still routes to staff', async (t) => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerMessageKind = 'off_topic';
  const chatter = await ask('What time is it where your team is based?');
  assert.equal(chatter.message.replies.length, 0);
  assert.equal(chatter.thread, null);
  assert.equal(modelCalls.length, 0);
  const human = await ask('Can I talk to a person?');
  assert.ok(human.message.replies.length > 0);
  assert.ok(human.thread);
});

test('a Spanish request to speak with a person uses the planner flag to hand off', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerWantsPerson = true;
  plannerReplyLanguage = 'es';
  plannerMessageKind = 'off_topic';
  modelReply = { final_answer: 'Necesito que una persona revise tu pregunta.', escalate: false };
  const result = await ask('Quiero hablar con una persona');
  assert.ok(result.message.replies.length);
  assert.equal(staff.length, 1);
});

test('a delivered Spanish handoff adds no English footer or extra email instruction', async (t) => {
  const staff = enableStaffDelivery(t);
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'exception_request';
  plannerStandaloneQuestion = 'I want a refund for a broken device.';
  plannerReplyLanguage = 'es';
  plannerHandoffAcknowledgment = 'Una persona debe revisar la solicitud en privado.';
  modelReply = { final_answer: 'Una persona debe revisar el reembolso. Fuente: https://help.omi.me/en/articles/13162549-omi-privacy-policy', escalate: false };
  const channel = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Consulta de reembolso' });
  const result = await ask('Quiero un reembolso, el dispositivo no funciona.', { channel });
  assert.equal(staff.length, 1);
  assert.match(result.reply, /responderá en este hilo/i);
  assert.doesNotMatch(result.reply, /A person on the team|Source:|Email help@omi\.me/i);
});

test('romanized Hindi handoff and failed Spanish delivery never append English templates', async (t) => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => { process.env.CMD_API_KEY = previous; });
  plannerSupportKind = 'exception_request';
  plannerReplyLanguage = 'hi';
  plannerHandoffAcknowledgment = 'टीम को यह देखना होगा।';
  modelReply = { final_answer: 'Team ko refund request dekhni hogi.', escalate: true };
  const hindi = await ask('Mujhe refund chahiye.');
  assert.doesNotMatch(hindi.reply, /\p{Script=Devanagari}/u);
  assert.doesNotMatch(hindi.reply, /A person on the team|I could not deliver/i);

  plannerReplyLanguage = 'es';
  plannerHandoffAcknowledgment = 'Una persona debe revisar esto.';
  modelReply = { final_answer: 'Una persona debe revisar el reembolso.', escalate: true };
  const spanish = await ask('Quiero un reembolso.');
  assert.match(spanish.reply, /help@omi\.me/);
  assert.doesNotMatch(spanish.reply, /I could not deliver|A person on the team/i);
});

test('planner acknowledgment stays silent, but a new symptom after thanks is answered', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  try {
    plannerMessageKind = 'acknowledgment';
    for (const question of ['Gracias, ya funciona', 'fixed it thanks']) {
      const result = await ask(question);
      assert.equal(result.message.replies.length, 0, question);
      assert.equal(result.thread, null, question);
    }
    plannerMessageKind = 'new_symptom';
    plannerSupportKind = 'technical_problem';
    plannerStandaloneQuestion = 'Battery drains fast after the earlier issue was fixed.';
    const followup = await ask('thanks that fixed it but now the battery drains fast');
    assert.ok(followup.message.replies.length > 0);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('an unpunctuated fix-status question and a new symptom survive acknowledgment misclassification', async (t) => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  });
  const delivered = enableStaffDelivery(t);
  plannerMessageKind = 'acknowledgment';
  plannerSupportKind = 'technical_problem';
  for (const question of [
    'Has the error been fixed in the new version',
    'Resolved the pairing, now transcripts are empty',
  ]) {
    const sentBefore = delivered.length;
    const result = await ask(question);
    assert.ok(result.message.replies.length > 0, question);
    assert.ok(delivered.length > sentBefore, `staff handoff: ${question}`);
  }
});

test('an acknowledgment in an existing order case stays silent without a planner call', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  plannerMessageKind = 'acknowledgment';
  try {
    const result = await ask('Order #12345 is resolved, merci');
    assert.equal(result.message.replies.length, 0);
    assert.equal(result.thread, null);
    assert.equal(plannerCalls.length, 0);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('an unknown route with technical planner classification gets the tech answer path', async () => {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  plannerSupportKind = 'technical_problem';
  plannerStandaloneQuestion = 'Omi keeps disconnecting from my phone every few minutes.';
  try {
    const result = await ask('omi keeps disconnecting from my phone every few minutes');
    assert.equal(modelCalls.at(-1)?.route?.lane, 'tech');
    assert.equal(reviewCalls.at(-1)?.lane, 'tech');
    assert.ok(result.thread);
  } finally {
    if (previous === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previous;
  }
});

test('a refund request skips the model and opens a money Handoff', async () => {
  const q = 'I want a refund for my Omi, it is not what I expected.';
  const r = await ask(q);
  assert.equal(r.modelCalled, false);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · /);
  assert.match(r.thread.name, /money/);
  assert.ok(r.reply);
});

test('delivered refund, order, and account tickets give one next step in the customer thread', async (t) => {
  const originalFetch = client.channels.fetch;
  const previousStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  client.channels.fetch = async () => ({ isTextBased: () => true, send: async (payload) => payload });
  t.after(() => {
    client.channels.fetch = originalFetch;
    process.env.STAFF_ALERT_CHANNEL_ID = previousStaff;
  });
  for (const question of [
    'I want a refund for my Omi.',
    'Where is my order? I have no tracking email.',
    'Please delete my account and all my data.',
  ]) {
    const channel = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Customer support case' });
    const result = await ask(question, { channel });
    assert.match(result.reply, /person.*will reply in this thread/i, question);
    assert.doesNotMatch(result.reply, /help@omi\.me/i, question);
    assert.doesNotMatch(result.reply, /use \/order|include (?:the )?order (?:number|#)/i, question);
    assert.equal(result.message.replies.length, 1, question);
  }
});

test('failed refund, order, and account delivery keeps the email fallback', async (t) => {
  const originalFetch = client.channels.fetch;
  const previousStaff = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  client.channels.fetch = async () => { throw new Error('staff channel unavailable'); };
  t.after(() => {
    client.channels.fetch = originalFetch;
    process.env.STAFF_ALERT_CHANNEL_ID = previousStaff;
  });
  for (const question of [
    'I want a refund for my Omi.',
    'Where is my order? I have no tracking email.',
    'Please delete my account and all my data.',
  ]) {
    const channel = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Customer support case' });
    const result = await ask(question, { channel });
    assert.match(result.reply, /could not deliver.*help@omi\.me/is, question);
    assert.doesNotMatch(result.reply, /will reply in this thread/i, question);
  }
});

test('a firmware report opens a firmware Handoff and does not file until staff approve', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('My Omi keeps turning itself off after 5 seconds.');
  assert.ok(r.thread);
  assert.match(r.thread.name, /firmware/);
  assert.equal(posts().length, 0);
});

test('bot messages and empty captions are not handled', () => {
  assert.equal(shouldHandle(makeMessage('How do I pair my Omi?', { bot: true })), false);
  assert.equal(shouldHandle(makeMessage('hi')), false);
  assert.equal(shouldHandle(makeMessage('How do I pair my Omi?')), true);
});

test('typed slash commands and bare role mentions are not treated as support questions', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Order shipping delay' });
  const command = makeMessage('/order', { channel: post });
  const supportMention = makeMessage('<@&900000000000000001>', { channel: post });
  assert.equal(shouldHandle(command), false);
  assert.equal(shouldHandle(supportMention), false);
  await handleMessage(command);
  await handleMessage(supportMention);
  assert.equal(command.replies.length + supportMention.replies.length + post.sent.length, 0);
});

test('an order follow-up asking for a human alerts staff and does not repeat /order', async () => {
  const parent = makeChannel({ id: HELP_FORUM, name: 'Help' });
  const post = makeChannel({
    thread: true,
    parentId: HELP_FORUM,
    parent,
    name: 'Omi Glass order has not shipped',
  });
  const authorId = nextId();
  const follow = makeMessage(
    'Then please help me get in touch with the Human who is responsible for shipping?',
    { channel: post, authorId }
  );
  post.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      ['2', { id: '2', author: { bot: true, username: 'omi' }, content: 'Use /order to check your own orders.' }],
      ['1', {
        id: '1',
        author: { bot: false, username: 'customer' },
        content: 'Order #22777 has not shipped and I have no tracking notice.',
      }],
    ]);

  await handleMessage(follow);

  const reply = follow.replies.map(textOf).join('\n');
  assert.match(reply, /person from the shop team/i);
  assert.match(reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.doesNotMatch(reply, /Use \/order|order status from here/i);
  assert.match(post.sent.map(textOf).join('\n'), /Needs a human/i);
});

test('an @here announcement is not a question for Vector, while a direct mention still is', async () => {
  const content = '@here Omi firmware 2.1 is rolling out today, your device will update overnight';
  const announcement = makeMessage(content, { channel: generalChannel() });
  announcement.mentions = new MessageMentions({ client, guild: null, content }, [], [], true);
  const direct = makeMessage(`<@${BOT_ID}> my Omi app keeps crashing on my Pixel`, { channel: generalChannel() });
  direct.mentions = new MessageMentions(
    { client, guild: null, content: direct.content },
    [{ id: BOT_ID, username: 'vector', bot: true }],
    [],
    false
  );
  const models = modelCalls.length;
  await handleMessage(announcement);
  assert.equal(modelCalls.length, models);
  assert.equal(replyText(announcement), '');
  assert.equal(announcement.threads.length, 0);
  assert.equal(shouldHandle(direct), true);
});

test('a Plaud 24-hour question is answered from the docs and does not file', async () => {
  const q = "I'd like to keep my new Omi device (not app) recording, just like Plaud does for 24 hours. Nothing has recorded yet.";
  const r = await ask(q);
  assert.equal(r.modelCalled, true);
  assert.equal(r.thread, null);
  assert.equal(r.github.length, 0);
});

test('an order status question checks sources, keeps email fallback when undelivered, and opens a shop Handoff', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('Where is my order? I still have no tracking email.');
  assert.equal(r.modelCalled, true);
  assert.match(r.reply, /^I can't see order status from here/i);
  assert.match(r.reply, /help@omi\.me/);
  assert.equal(/\/order/.test(r.reply), false);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · shop · /);
  assert.equal(r.github.length, 0);
});

test('a high checkout shipping quote reaches shop staff without suggesting order lookup', async () => {
  const q =
    'I live on Reunion island and shipping at cashout is 145 euros. Can someone arrange normal-cost shipping from Europe or Asia?';
  modelReply = {
    final_answer:
      "I can't override the €145 checkout shipping rate or confirm another route from chat.",
    topic: 'checkout shipping quote',
    labels: ['shop', 'shipping'],
    area: 'shop',
    lane: 'shop',
    escalate: true,
  };
  const r = await ask(q);
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).understanding.customerGoal, /Reunion island/i);
  assert.match(modelCalls.at(-1).toolFacts, /not an existing-order lookup/i);
  assert.match(modelCalls.at(-1).toolFacts, /Do not suggest \/order/i);
  assert.match(r.reply, /checkout shipping (quote|rate)/i);
  assert.match(r.reply, /another route/i);
  assert.equal(/order status from here|where that order is|\/order\b/i.test(r.reply), false);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · shop · /);
  assert.match(r.thread.name, /checkout shipping quote/i);
  assert.equal(r.github.length, 0);
});

test('an import tax question gets the tax reply and a money Handoff without the model', async () => {
  const q = 'Will I have to pay import tax or duties when the Omi arrives in Germany?';
  const r = await ask(q);
  assert.equal(r.modelCalled, false);
  assert.ok(r.reply.includes(router.cannedReply({ lane: 'money' }, q)));
  assert.ok(r.thread);
  assert.match(r.thread.name, /money/);
  assert.match(r.thread.name, /tax/);
});

test('a request to delete my data gets the privacy reply and a privacy Handoff without the model', async () => {
  const q = 'Please delete my data and close my account.';
  const r = await ask(q);
  assert.equal(r.modelCalled, false);
  assert.ok(r.reply.includes(router.cannedReply({ lane: 'privacy' }, q)));
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · privacy · /);
});

test('a privacy request that also names an app crash is never sent to GitHub', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('Please delete my data, the Android app keeps crashing and I am done with it.');
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · privacy\b/);
  assert.equal(r.github.length, 0);
  assert.equal(r.thread.sent[0].components, undefined);
});

test('a desktop app bug opens a desktop Handoff and files a desktop issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The Omi desktop app on my Mac freezes when I open the chat window.');
  const filed = r.github.filter((c) => c.method === 'POST');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · desktop · tech · /);
  assert.equal(filed.length, 0);
});

test('a phone app crash opens an app Handoff and files an app issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The Android app crashes every time I open a conversation.');
  const filed = r.github.filter((c) => c.method === 'POST');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · app · tech · /);
  assert.equal(filed.length, 0);
});

test('an undelivered tech Handoff gives one help email fallback', async () => {
  modelReply = {
    final_answer:
      "I can't see why the iPhone app is crashing. Please contact help@omi.me so the team can investigate.",
    escalate: true,
  };
  const r = await ask('The iPhone app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.match(r.reply, /can['’]?t see why the iPhone app is crashing/i);
  assert.equal((r.reply.match(/help@omi\.me/gi) || []).length, 1);
  assert.match(r.reply, /could not deliver this to the support team/i);
});

test('a delivered Handoff keeps details without directing the customer to another channel', async (t) => {
  const staff = enableStaffDelivery(t);
  modelReply = {
    final_answer: 'The app crashes when you open a memory. Use the contact form on help.omi.me. Join discord.omi.me and look for #help. Please include the app version.',
    escalate: true,
  };
  const result = await ask('The iPhone app crashes every time I open a memory.');
  assert.equal(staff.length, 1);
  assert.match(result.reply, /Please include the app version/i);
  assert.doesNotMatch(result.reply, /contact form|discord\.omi\.me|#help|help@omi\.me/i);
  assert.match(result.reply, /person.*(?:team|thread)/i);
});

test('a transcribed device-button question searches official app source before the model answers', async () => {
  const q = [
    'I received my Omi yesterday. I press it, get the vibration, ask my question, and press again.',
    'I see the transcription of my question in the app, but I never get any answers.',
    'Disconnecting and reconnecting changed nothing, and I even deleted my account.',
    'iPhone 15 Pro, iOS 27, Omi CV1 fw 3.0.21, app 1.0.552 (1246).',
  ].join(' ');
  process.env.GITHUB_TOKEN = 'ghs_test';
  searchPlanQueries = ['device button voice question response', 'transcription AI response Chat'];
  const path = 'app/lib/providers/message_provider.dart';
  const apiUrl = `https://api.github.com/repos/BasedHardware/omi/contents/${path}`;
  codeItems = [
    {
      path,
      url: apiUrl,
      html_url: `https://github.com/BasedHardware/omi/blob/main/${path}`,
    },
  ];
  codeContents.set(
    apiUrl,
    '// Device-button voice questions add an AI response message to Chat. Reply audio plays when voiceResponseEnabled is true.'
  );
  modelReply = {
    final_answer:
      'The transcript means Omi captured your question; the missing part is the AI reply. The answer should appear as an AI message in Chat, and Voice Responses can also play it aloud.',
    escalate: true,
  };
  const r = await ask(q);
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).toolFacts, /Official GitHub \| authoritative/);
  assert.match(modelCalls.at(-1).toolFacts, /AI response message to Chat/i);
  assert.match(r.reply, /transcript means Omi captured your question/i);
  assert.match(r.reply, /AI message in Chat/i);
  assert.match(r.reply, /Voice Responses/i);
  assert.doesNotMatch(r.reply, /check.*notifications? permission/i);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · app · tech · /);
});

test('a blocked Google Calendar integration receives the matching Feedback status as a non-authoritative signal', async () => {
  const url = 'https://feedback.omi.me/p/google-calender';
  const payload = {
    props: {
      pageProps: {
        fallback: {
          'rq:single:/v1/submission': {
            data: {
              results: [
                {
                  title: 'Google calender',
                  content:
                    '<p>The extension says this app is blocked and the built-in integration only gets the main calendar.</p>',
                  postStatus: { name: 'In Progress' },
                  postCategory: { name: { en: 'Bugs & Errors' } },
                  upvotes: 8,
                  comments: [{ content: 'Use Advanced and continue anyway.' }],
                },
              ],
            },
          },
        },
      },
    },
  };
  feedbackPages.set(
    url,
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`
  );
  modelReply = {
    final_answer:
      'The public Omi Feedback post for this report is In Progress. I cannot verify a customer-side bypass from that report.',
    escalate: true,
  };

  const r = await ask(
    'Google Calendar says this app is blocked, and the Omi integration only gets my main calendar.'
  );
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).toolFacts, /Omi Feedback portal \| issue\/status signal only/);
  assert.match(modelCalls.at(-1).toolFacts, /Portal status: In Progress/);
  assert.doesNotMatch(modelCalls.at(-1).toolFacts, /Advanced and continue/);
});

test('a later no-chat follow-up does not repeat notification advice or restart the diagnosis', async () => {
  modelReply = {
    final_answer:
      'That rules out this being only a notification-permission problem. The transcription arrives, but no AI message appears in Chat, so the reply stage still needs the app team.',
    escalate: true,
  };
  const post = makeChannel({
    thread: true,
    parentId: HELP_FORUM,
    name: "Push to ask doesn't work",
  });
  const follow = makeMessage(
    'Notification is enabled, but I see nothing in the chat or in the notification.',
    { channel: post }
  );
  post.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      [
        '1',
        {
          id: '1',
          author: { bot: false, username: 'customer' },
          content:
            'I press the Omi button, ask a question, see the transcription in the app, but never get an answer.',
        },
      ],
    ]);

  const models = modelCalls.length;
  await handleMessage(follow);
  const reply = replyText(follow);
  assert.equal(modelCalls.length, models + 1);
  assert.match(reply, /rules out.*notification-permission/i);
  assert.match(reply, /no AI message appears in Chat/i);
  assert.doesNotMatch(reply, /check.*notifications?|help@omi\.me|try.*reconnect/i);
  assert.equal(follow.threads.length, 0);
});

test('two quick copies of one report from a customer open one Handoff and file one issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it.`, {
    channel,
    mention: true,
    authorId,
  });
  const second = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it. Please help.`, {
    channel,
    mention: true,
    authorId,
  });
  await Promise.all([handleMessage(first), handleMessage(second)]);
  assert.equal(first.threads.length + second.threads.length, 1);
  assert.equal(posts().filter((c) => /\/issues$/.test(c.url)).length, 0);
});

test('a different report from the same customer after the dedupe window opens its own Handoff', async (t) => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  modelReply = { escalate: true };
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> My Android app stopped working after the update`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  advanceClock(t, 16 * 60_000);
  const second = makeMessage(`<@${BOT_ID}> Android battery drain is huge after the latest update`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(second);
  assert.equal(second.threads.length, 1);
  assert.match(first.threads[0].name, /stopped working/);
  assert.equal(posts().filter((c) => /\/issues$/.test(c.url)).length, 0);
});

test('two customers asking at once in one channel both get an answer', async () => {
  const channel = generalChannel();
  const first = makeMessage(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, { channel, mention: true });
  const second = makeMessage(`<@${BOT_ID}> How do I pair my Omi with my tablet?`, { channel, mention: true });
  await Promise.all([handleMessage(first), handleMessage(second)]);
  assert.match(textOf(first.replies[0]), /center button/);
  assert.match(textOf(second.replies[0]), /center button/);
});

test('after a failed answer the customer can ask again right away', async () => {
  const channel = generalChannel();
  const authorId = nextId();
  channel.sendTyping = async () => {
    throw new Error('Discord is down');
  };
  const failed = makeMessage(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, { channel, mention: true, authorId });
  await handleMessage(failed);
  assert.match(replyText(failed), /Something broke/);
  channel.sendTyping = async () => {};
  const retry = makeMessage(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, { channel, mention: true, authorId });
  await handleMessage(retry);
  assert.match(textOf(retry.replies[0]), /center button/);
});

test('#vector-test still answers two quick questions from one person', async () => {
  const authorId = nextId();
  const first = makeMessage('How do I pair my Omi with a new phone?', { authorId });
  const second = makeMessage('How do I pair my Omi with my tablet?', { authorId });
  await Promise.all([handleMessage(first), handleMessage(second)]);
  assert.equal(first.replies.length, 1);
  assert.equal(second.replies.length, 1);
});

test('same author repeating normalized text in one thread is quiet for ten minutes after an answer', async (t) => {
  const channel = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Pairing question' });
  const authorId = nextId();
  const first = makeMessage('How do I pair my Omi with a new phone?', { channel, authorId });
  await handleMessage(first);
  assert.equal(first.replies.length, 1);
  const answeredCalls = modelCalls.length;

  const duplicate = makeMessage('  HOW do I pair my Omi with a new phone?  ', { channel, authorId });
  await handleMessage(duplicate);
  assert.equal(duplicate.replies.length, 0);
  assert.equal(modelCalls.length, answeredCalls);

  const otherAuthor = makeMessage('How do I pair my Omi with a new phone?', { channel });
  await handleMessage(otherAuthor);
  assert.equal(otherAuthor.replies.length, 1);
  const otherThread = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Another pairing question' });
  const elsewhere = makeMessage('How do I pair my Omi with a new phone?', { channel: otherThread, authorId });
  await handleMessage(elsewhere);
  assert.equal(elsewhere.replies.length, 1);

  advanceClock(t, 11 * 60_000);
  const later = makeMessage('How do I pair my Omi with a new phone?', { channel, authorId });
  await handleMessage(later);
  assert.equal(later.replies.length, 1);
});

test('asking to talk to a human opens a Handoff even when the model says not to escalate', async () => {
  modelReply = { escalate: false, confidence: 0.95 };
  const r = await ask('How do I pair my Omi with a new phone? I want to talk to a human.');
  assert.equal(r.modelCalled, true);
  assert.match(r.reply, /center button/);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · /);
});

test('an open pull request match still gets a reviewed answer and a Handoff', async (t) => {
  const staff = enableStaffDelivery(t);
  process.env.GITHUB_TOKEN = 'ghs_test';
  modelReply = { final_answer: 'Please share your Android version and Omi app version so a person can investigate the crash.', escalate: false };
  pulls = [
    {
      number: 4321,
      state: 'open',
      title: 'Fix Android crash when opening memories',
      html_url: 'https://github.com/BasedHardware/omi/pull/4321',
    },
  ];
  const r = await ask('The Android app crashes when I open the memories tab.');
  assert.match(r.reply, /Android version and Omi app version/);
  assert.ok(r.github.some((c) => /\/pulls\/4321$/.test(c.url)));
  assert.equal(r.reply.includes('omi/pull/4321'), false);
  assert.equal(staff.length, 1);
  assert.equal(r.modelCalled, true);
  assert.match(reviewCalls.at(-1).sources, /Related GitHub pull request.*lower priority/i);
  assert.match(reviewCalls.at(-1).sources, /omi\/pull\/4321/);
  assert.equal(posts().length, 0);
});

test('a merged pull request match still gets a reviewed answer and a Handoff', async (t) => {
  const staff = enableStaffDelivery(t);
  process.env.GITHUB_TOKEN = 'ghs_test';
  modelReply = { final_answer: 'Please share your Android version and Omi app version so a person can investigate the crash.', escalate: false };
  pullState = { state: 'closed', merged: true };
  pulls = [
    {
      number: 4400,
      state: 'closed',
      title: 'Fix Android crash when opening memories',
      html_url: 'https://github.com/BasedHardware/omi/pull/4400',
    },
  ];
  const r = await ask('The Android app crashes when I open the memories tab.');
  assert.match(r.reply, /Android version and Omi app version/);
  assert.equal(r.reply.includes('omi/pull/4400'), false);
  assert.equal(staff.length, 1);
  assert.equal(r.modelCalled, true);
  assert.match(reviewCalls.at(-1).sources, /Related GitHub pull request.*lower priority/i);
  assert.match(reviewCalls.at(-1).sources, /omi\/pull\/4400/);
});

test('a related pull is mentioned cautiously only when the reviewer cites it', async (t) => {
  const staff = enableStaffDelivery(t);
  process.env.GITHUB_TOKEN = 'ghs_test';
  modelReply = { final_answer: 'Please share your Android version and Omi app version so a person can investigate the crash.', escalate: false };
  pulls = [{
    number: 4500,
    state: 'open',
    title: 'Fix Android crash when opening memories',
    html_url: 'https://github.com/BasedHardware/omi/pull/4500',
  }];
  reviewerResponse = ({ draft }) => ({
    final_answer: `${draft} Pull request #4500 fixes this. https://github.com/BasedHardware/omi/pull/4500`,
    grounded: true,
    relevant: true,
    confidence: 0.9,
    escalate: true,
  });
  const r = await ask('The Android app crashes when I open the memories tab.');
  assert.equal(staff.length, 1);
  assert.match(r.reply, /Android version and Omi app version/);
  assert.match(r.reply, /related change on GitHub; I can't confirm it fixes your case/i);
  assert.equal((r.reply.match(/omi\/pull\/4500/g) || []).length, 1);
  assert.doesNotMatch(r.reply, /Pull request #4500 fixes this/i);
});

test('an open issue found by the duplicate search is linked on the Handoff and no new issue is filed', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  issues = [
    {
      number: 777,
      title: 'Omi keeps turning itself off after a few seconds',
      html_url: 'https://github.com/BasedHardware/omi/issues/777',
    },
  ];
  const r = await ask('My Omi keeps turning itself off after 5 seconds.');
  assert.ok(r.thread);
  assert.match(r.thread.name, /firmware/);
  assert.equal(r.thread.sent[0].embeds[0].fields.some((f) => f.name === 'GitHub'), false);
  assert.equal(r.thread.sent[0].components, undefined);
  assert.match(textOf(r.thread.sent[1]), /issues\/777/);
  assert.equal(posts().length, 0);
  assert.deepEqual(github.threadsForIssue(777), [r.thread.id]);
});

test('a tech ticket does not file a public issue until staff press File', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The iPhone app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.equal(posts().length, 0);
});

test('without a GitHub token a tech ticket gets no issue search, no filing, and no File button', async () => {
  const r = await ask('The iPhone app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.match(r.thread.name, /app/);
  assert.equal(r.github.some((c) => c.url.includes('is%3Aissue')), false);
  assert.equal(posts().length, 0);
  assert.equal(r.thread.sent[0].components, undefined);
  assert.ok(r.thread.sent[1]);
  assert.equal(/github\.com/.test(textOf(r.thread.sent[1])), false);
});

test('shop and money tickets never reach GitHub even with a token', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const shop = await ask('Where is my order? The tracking page has not moved in a week.');
  const money = await ask('I was charged twice for my Omi and want a refund.');
  assert.match(shop.thread.name, /shop/);
  assert.match(money.thread.name, /money/);
  assert.equal(shop.github.length, 0);
  assert.equal(money.github.length, 0);
  assert.equal(posts().length, 0);
});

test('when the model is down a phone app crash still opens a Handoff and files one issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  modelDown = true;
  const r = await ask('The Android app crashes every time I open it.');
  const filed = r.github.filter((c) => c.method === 'POST');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · app · /);
  assert.equal(filed.length, 0);
  assert.equal(/model unavailable|opencode|deepseek/i.test(r.reply), false);
});

test('when the model is down a how-to question opens a Handoff instead of going quiet', async () => {
  modelDown = true;
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · faq · /);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.equal(/model unavailable|opencode|deepseek/i.test(r.reply), false);
});

test('a how-to answer that says a person has it loses that line when no Handoff opened', async () => {
  modelReply = {
    final_answer:
      'Hold the center button for ten seconds, then pair it again from the app.\n\n' +
      'A person on the team has this now.',
  };
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.thread, null);
  assert.match(r.reply, /center button/);
  assert.equal(/has this now/i.test(r.reply), false);
});

test('staff-lie wording in a model answer is stripped before the customer sees it', async () => {
  modelReply = {
    final_answer:
      'Hold the center button for ten seconds, then pair it again from the app. ' +
      'I have passed this along to the team. Someone will follow up by email.',
  };
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.thread, null);
  assert.match(r.reply, /center button/);
  assert.equal(/passed this along/i.test(r.reply), false);
  assert.equal(/follow up/i.test(r.reply), false);
});

test('an escalated how-to does not claim a person has it from a customer-visible Handoff alone', async () => {
  modelReply = { escalate: true };
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.ok(r.thread);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.equal(r.reply.includes(utils.ESCALATE_FOOTER), false);
});

test('review may clear a grounded self-serve FAQ handoff but not a tech handoff', async () => {
  modelReply = { escalate: true };
  reviewerResponse = ({ draft }) => ({
    final_answer: draft,
    grounded: true,
    relevant: true,
    confidence: 0.95,
    escalate: false,
  });
  const faq = await ask('Where is the documentation for pairing my Omi with a new phone?');
  assert.equal(faq.thread, null);
  const tech = await ask('The Android app crashes every time I open a conversation.');
  assert.ok(tech.thread);
});

test('review failure with a cited FAQ still delivers one staff handoff and a thread next step', async (t) => {
  const staff = enableStaffDelivery(t);
  const db = require('../db');
  const previousSearch = db.searchDocPages;
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'test-only-database';
  db.searchDocPages = async (_query, _limit, sources) =>
    sources && !sources.includes('help') ? [] : [{
      url: 'https://help.omi.me/en/articles/123-update-omi',
      title: 'Conversations in the app',
      body: 'Conversations and memories can be managed in the app.',
      source: 'help',
      chunk_index: 0,
    }];
  t.after(() => {
    db.searchDocPages = previousSearch;
    process.env.DATABASE_URL = previousUrl;
  });
  reviewerResponse = () => { throw new Error('test reviewer unavailable'); };
  modelReply = { final_answer: 'Open the app to review the stored conversation.', confidence: 0.95, escalate: false };
  const channel = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'storage question' });
  const result = await ask('why does omi save two copies of my conversation?', { channel });
  assert.equal(staff.length, 1);
  assert.match(result.reply, /couldn't verify a safe answer/i);
  assert.match(result.reply.trim(), /will reply in this thread\.$/i);
});

test('an escalated how-to whose Handoff cannot be posted says nobody was pinged', async () => {
  modelReply = { escalate: true };
  const message = makeMessage('How do I pair my Omi with a new phone?');
  let tried = 0;
  message.startThread = async () => {
    tried += 1;
    throw new Error('Missing Permissions');
  };
  message.channel.send = async () => {
    throw new Error('Missing Permissions');
  };
  await handleMessage(message);
  const reply = replyText(message);
  assert.equal(tried, 1);
  assert.match(reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.equal(reply.includes(utils.PINGED_FOOTER), false);
});

test('a saved staff note reaches the draft but is never pasted into the final answer', async () => {
  const fact = 'The magnetic charging cable takes about two hours to fill the battery.';
  knowledge.addSnippet(fact);
  modelReply = { final_answer: 'Most people leave it plugged in overnight.' };
  const related = await ask('How long does charging take with the magnetic cable?');
  assert.deepEqual(modelCalls.at(-1).knowledgeSnippets, [fact]);
  assert.equal(related.reply.startsWith(fact), false);
  assert.match(related.reply, /overnight/);
  const unrelated = await ask('How do I pair my Omi with a new phone?');
  assert.equal(unrelated.reply.includes('magnetic'), false);
});

test('an erased fixed claim produces a nonempty reply and reaches the reviewer as removed text', async () => {
  modelReply = { final_answer: 'Yes, this has been fixed in the latest release.' };
  reviewerResponse = () => ({
    final_answer: 'I cannot confirm a release that fixed phone-to-desktop memories sync.',
    grounded: true,
    relevant: true,
    confidence: 0.8,
    escalate: false,
  });
  const result = await ask('is the memories sync problem between phone and desktop fixed yet?');
  assert.match(reviewCalls.at(-1).removedBySafetyFilters.join(' '), /fixed in the latest release/);
  assert.match(result.reply, /cannot confirm a release/);
  assert.doesNotMatch(result.reply, /Something broke/);
  assert.ok(result.reply.trim());
});

test('model output with @everyone, a role, or another user cannot ping anyone', async () => {
  modelReply = {
    final_answer: '@everyone <@&123456789012345678> <@999999999999999999> Hold the center button for ten seconds.',
  };
  const r = await ask('How do I pair my Omi with a new phone?');
  const allowed = r.message.replies[0].allowedMentions;
  assert.deepEqual(allowed.parse, []);
  assert.deepEqual(allowed.roles, []);
  assert.deepEqual(allowed.users, []);
  assert.equal(r.reply.includes('<@999999999999999999>'), false);
});

test('a log attachment reaches the model question next to the caption', async () => {
  const log = 'https://cdn.discordapp.com/attachments/1/2/omi_debug.log';
  files.set(log, 'ble link lost reason 0x08 at 12:04:17');
  const r = await ask('My Omi stops recording after a few minutes, what should I try?', {
    attachments: [{ name: 'omi_debug.log', url: log }],
  });
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).question, /stops recording after a few minutes/);
  assert.match(modelCalls.at(-1).question, /omi_debug\.log/);
  assert.match(modelCalls.at(-1).question, /ble link lost reason 0x08/);
});

test('a screenshot sent with a readable log is not asked for the error line', async () => {
  const log = 'https://cdn.discordapp.com/attachments/1/2/omi_debug.log';
  files.set(log, 'ble link lost reason 0x08 at 12:04:17');
  const r = await ask('My Omi stops recording after a few minutes, what should I try?', {
    attachments: [
      { name: 'shot.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png' },
      { name: 'omi_debug.log', url: log },
    ],
  });
  assert.match(modelCalls.at(-1).question, /ble link lost/);
  assert.equal(r.message.replies.length, 1);
  assert.equal(r.reply.includes(unreadMediaSentence()), false);
});

test('a voice memo sent with a log is still asked for the error line', async () => {
  const log = 'https://cdn.discordapp.com/attachments/1/2/omi_debug.log';
  files.set(log, 'ble link lost reason 0x08 at 12:04:17');
  const r = await ask('My Omi stops recording after a few minutes, what should I try?', {
    attachments: [
      { name: 'voice.m4a', contentType: 'audio/mp4', url: 'https://cdn.discordapp.com/attachments/1/2/voice.m4a' },
      { name: 'omi_debug.log', url: log },
    ],
  });
  assert.match(modelCalls.at(-1).question, /ble link lost/);
  assert.ok(r.reply.includes(unreadMediaSentence()));
});

test('a photo of a device that will not charge is not asked for a screen error', async () => {
  const r = await ask('My OMI is not charging when placed on the charger. What should I do?', {
    attachments: [
      { name: 'photo.jpg', contentType: 'image/jpeg', url: 'https://cdn.discordapp.com/attachments/1/2/photo.jpg' },
    ],
  });
  assert.equal(r.reply.includes('Type the error line shown on the screen.'), false);
  assert.match(r.reply, /did not use the photo/i);
});

test('a screenshot with a caption and no log is asked for the error line', async () => {
  const r = await ask('My Omi stops recording after a few minutes, what should I try?', {
    attachments: [
      { name: 'shot.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png' },
    ],
  });
  assert.equal(r.modelCalled, true);
  assert.equal(r.message.replies.length, 1);
  assert.ok(r.reply.includes(unreadMediaSentence()));
});

test('a log attachment with no caption is still answered', async () => {
  const log = 'https://cdn.discordapp.com/attachments/1/2/omi_debug.log';
  files.set(log, 'ble link lost reason 0x08 at 12:04:17');
  const r = await ask('', { attachments: [{ name: 'omi_debug.log', url: log }] });
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).question, /ble link lost reason 0x08/);
  assert.equal(r.message.replies.length, 1);
});

test('a log that fails to download still gets the caption answered', async () => {
  const r = await ask('My Omi stops recording after a few minutes, what should I try?', {
    attachments: [{ name: 'omi_debug.log', url: 'https://cdn.discordapp.com/attachments/1/2/omi_debug.log' }],
  });
  assert.equal(r.modelCalled, true);
  assert.match(modelCalls.at(-1).question, /stops recording after a few minutes/);
  assert.ok(r.github.some((c) => c.url.endsWith('omi_debug.log')));
  assert.equal(r.message.replies.length, 1);
});

test('a public-safe how-to in a help-forum post gets the model answer and no staff card', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Pairing a new phone' });
  const r = await ask('How do I pair my Omi with a new phone?', { channel: post });
  assert.equal(r.modelCalled, true);
  assert.equal(modelCalls.at(-1).question, 'How do I pair my Omi with a new phone?');
  assert.match(textOf(r.message.replies[0]), /center button/);
  assert.equal(post.sent.length, 0);
  assert.equal(r.thread, null);
});

test('a help-forum post with an email address gets a canned reply and a staff card showing [email]', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Pairing help' });
  const r = await ask('How do I pair my Omi? My account email is jane.doe@example.com', { channel: post });
  const reply = textOf(r.message.replies[0]);
  const card = textOf(post.sent[0]);
  assert.ok(reply);
  assert.equal(r.modelCalled, false);
  assert.doesNotMatch(reply, /center button/);
  assert.equal(reply.includes('jane.doe@example.com'), false);
  assert.match(card, /does not repeat it/);
  assert.equal(card.includes('jane.doe@example.com'), false);
  assert.equal(card.includes('[email]'), false);
  assert.equal(r.thread, null);
  assert.equal(post.name, 'Pairing help');
});

test('filing the issue from a held help-forum post sends [email] to GitHub, never the address', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  process.env.STAFF_USER_IDS = '123456789012345678';
  modelReply = { topic: 'Omi off for jane.doe@example.com' };
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Omi shuts down' });
  const r = await ask('My Omi keeps turning itself off after 5 seconds. Reach me at jane.doe@example.com', {
    channel: post,
  });
  assert.equal(r.github.filter((c) => c.method === 'POST').length, 0);
  const button = post.sent[0].components[0].components[0];
  assert.match(button.custom_id, /^file:/);
  const filed = posts().length;
  await commands.handleInteraction({
    isButton: () => true,
    customId: button.custom_id,
    user: { id: '123456789012345678' },
    channelId: post.id,
    channel: post,
    reply: async () => {},
    deferReply: async () => {},
    editReply: async () => {},
  });
  const sent = posts().slice(filed);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.title.includes('jane.doe@example.com'), false);
  assert.match(sent[0].body.body, /\[email\]/);
  assert.equal(JSON.stringify(sent).includes('jane.doe@example.com'), false);
});

test('a new help-forum post puts its title and tags in front of the model question', async () => {
  const post = makeChannel({
    thread: true,
    parentId: HELP_FORUM,
    name: 'Omi will not pair',
    parent: { availableTags: [{ id: '41', name: 'Setup' }] },
  });
  post.appliedTags = ['41'];
  const starter = makeMessage('How do I pair my Omi with a new phone?', { channel: post });
  starter.id = post.id;
  post.fetchStarterMessage = async () => starter;
  const models = modelCalls.length;
  await emit(Events.ThreadCreate, post);
  assert.equal(modelCalls.length, models + 1);
  assert.equal(
    modelCalls.at(-1).question,
    'Post: Omi will not pair\nTags: Setup\nHow do I pair my Omi with a new phone?'
  );
  assert.match(replyText(starter), /center button/);
});

test('a new help-forum post with only a screenshot is answered from its title', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Omi app crashes every time I open it' });
  const starter = makeMessage('', {
    channel: post,
    attachments: [
      { name: 'shot.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png' },
    ],
  });
  starter.id = post.id;
  post.fetchStarterMessage = async () => starter;
  const models = modelCalls.length;
  await emit(Events.ThreadCreate, post);
  assert.equal(modelCalls.length, models + 1);
  assert.equal(modelCalls.at(-1).question, 'Post: Omi app crashes every time I open it');
  assert.ok(replyText(starter).includes(unreadMediaSentence()));
});

test('a bare screenshot inside an existing help-forum post is still left alone', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'Omi app crashes every time I open it' });
  const r = await ask('', {
    channel: post,
    attachments: [
      { name: 'shot.png', contentType: 'image/png', url: 'https://cdn.discordapp.com/attachments/1/2/shot.png' },
    ],
  });
  assert.equal(r.modelCalled, false);
  assert.equal(r.reply, '');
});

test('a help-forum post tagged Known issue gets the known-issue reply instead of a new diagnosis', async () => {
  modelReply = { final_answer: 'This happens because the settings screen loads every memory at once.' };
  const post = makeChannel({
    thread: true,
    parentId: HELP_FORUM,
    name: 'Settings crash',
    parent: { availableTags: [{ id: '51', name: 'Known issue' }] },
  });
  post.appliedTags = ['51'];
  const r = await ask('The Android app crashes every time I open settings.', { channel: post });
  assert.equal(r.modelCalled, true);
  assert.ok(textOf(r.message.replies[0]).includes(router.knownIssueReply()));
  assert.doesNotMatch(r.reply, /every memory/);
});

test('a later customer message is not copied onto the public GitHub issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const post = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'not charging' });
  github.linkIssueThread(18537, post.id);
  const before = githubCalls.length;
  const follow = makeMessage('It charged fine on Monday and the light never comes on now.', {
    channel: post,
    attachments: [{ name: 'photo.jpg', contentType: 'image/jpeg', url: 'https://cdn.discordapp.com/attachments/1/2/photo.jpg' }],
  });
  post.messages.fetch = async () => new Map([
    ['1', { id: '1', author: { bot: false, username: 'customer' }, content: 'My OMI is not charging.' }],
  ]);
  await handleMessage(follow);
  const comment = githubCalls.slice(before).find((call) => call.method === 'POST' && /\/comments$/.test(call.url));
  assert.equal(comment, undefined);
  process.env.GITHUB_TOKEN = '';
  github.resetGithubMemory();
});

test('a follow-up in a Handoff thread sends the earlier thread messages to the model, oldest first', async () => {
  modelReply = { final_answer: 'Thanks. Does it also drop when the phone is on wifi?' };
  const handoff = makeChannel({
    thread: true,
    parentId: TEST_CHANNEL,
    name: 'Handoff · app · tech · iPhone app disconnected',
  });
  const follow = makeMessage('It happened again this morning after the update.', { channel: handoff });
  handoff.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      ['3', { id: '3', author: { bot: false, username: 'staff' }, content: 'Which iOS version are you on?' }],
      ['2', { id: '2', author: { bot: true, username: 'omi' }, content: 'A person has this now.' }],
      ['1', { id: '1', author: { bot: false, username: 'customer' }, content: 'My iPhone app disconnects daily.' }],
    ]);
  await handleMessage(follow);
  assert.deepEqual(modelCalls.at(-1).threadHistory, [
    { author: 'customer', content: 'My iPhone app disconnects daily.' },
    { author: 'bot', content: 'A person has this now.' },
    { author: 'staff', content: 'Which iOS version are you on?' },
  ]);
  assert.equal(modelCalls.at(-1).question, 'It happened again this morning after the update.');
  assert.match(replyText(follow), /wifi/);
  assert.equal(follow.threads.length, 0);
});

test('a follow-up in a vector-test post sees the report and does not open a second card', async () => {
  modelReply = { final_answer: 'The paid-plan problem above still needs a person. I cannot change the account from chat.' };
  const post = makeChannel({
    thread: true,
    parentId: TEST_CHANNEL,
    name: 'Bug: Upgrade to Unlimited downgraded my paid account',
  });
  const follow = makeMessage(
    "I get it's a startup, but you've got to at least reply to the customers who paid to support you.",
    { channel: post }
  );
  post.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      ['1', { id: '1', author: { bot: false, username: 'customer' }, content: 'Upgrade to Unlimited downgraded my paid account to Free.' }],
    ]);
  await handleMessage(follow);
  assert.deepEqual(modelCalls.at(-1).threadHistory, [
    { author: 'customer', content: 'Upgrade to Unlimited downgraded my paid account to Free.' },
  ]);
  assert.equal(post.sent.length, 0);
  assert.equal(follow.threads.length, 0);
  assert.doesNotMatch(replyText(follow), /have not pinged/i);
});

test('a staff faq line in a Handoff thread is saved for later questions and not answered as a ticket', async () => {
  const handoff = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Handoff · faq · LED colours' });
  const line = makeMessage('faq: The Omi LED turns solid green when the battery is full.', { channel: handoff });
  process.env.STAFF_USER_IDS = line.author.id;
  const models = modelCalls.length;
  await emit(Events.MessageCreate, line);
  assert.equal(modelCalls.length, models);
  assert.equal(handoff.name, 'Handoff · faq · LED colours');
  assert.equal(line.replies.length, 1);
  assert.deepEqual(knowledge.listSnippets(), ['The Omi LED turns solid green when the battery is full.']);
  await ask('What does the green LED on my Omi mean?');
  assert.deepEqual(modelCalls.at(-1).knowledgeSnippets, ['The Omi LED turns solid green when the battery is full.']);
});

test('a faq line from someone off the staff list is refused and not saved', async () => {
  process.env.STAFF_USER_IDS = '123456789012345678';
  const handoff = makeChannel({ thread: true, parentId: TEST_CHANNEL, name: 'Handoff · faq · LED colours' });
  const line = makeMessage('faq: Omi sends a free second device to anyone who asks.', { channel: handoff });
  const models = modelCalls.length;
  await emit(Events.MessageCreate, line);
  assert.equal(modelCalls.length, models);
  assert.equal(line.replies.length, 1);
  assert.deepEqual(knowledge.listSnippets(), []);
});

test('/test in #vector-test acks privately and each question posts its own money ticket', async () => {
  const models = modelCalls.length;
  const q = 'I want a refund for my Omi, it is not what I expected.';
  const first = slashTest(q);
  const second = slashTest('I was charged twice for my Omi, please refund one of the payments.');
  await commands.handleInteraction(first);
  await commands.handleInteraction(second);
  assert.equal(first.replies.length, 1);
  assert.equal(first.replies[0].flags, MessageFlags.Ephemeral);
  assert.equal(modelCalls.length, models);
  assert.equal(first.channel.sent.length, 2);
  assert.match(textOf(first.channel.sent[0]), /`money`/);
  assert.ok(first.channel.sent[1].content);
  assert.match(textOf(second.channel.sent[0]), /`money`/);
});

test('outside #vector-test and the help forum only a message that mentions the bot is handled', async () => {
  const q = 'How do I pair my Omi with a new phone?';
  const post = makeChannel({ name: 'Pairing trouble', thread: true, parentId: HELP_FORUM });
  assert.equal(shouldHandle(makeMessage(q, { channel: makeChannel() })), false);
  assert.equal(shouldHandle(makeMessage(q, { channel: post })), true);
  const quiet = await ask(q, { channel: makeChannel() });
  const mentioned = await ask(`<@${BOT_ID}> ${q}`, { channel: makeChannel(), mention: true });
  assert.equal(quiet.modelCalled, false);
  assert.equal(quiet.reply, '');
  assert.equal(mentioned.modelCalled, true);
  assert.match(mentioned.reply, /center button/);
});

test('a same-customer direct reply continues a mentioned support exchange without reading the channel', async () => {
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> How do I pair Omi with my phone?`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const botReply = first.botReplies[0];
  assert.ok(botReply);

  const follow = makeMessage('Does that work the same way on Android?', { channel, authorId });
  follow.reference = { messageId: botReply.id };
  follow.fetchReference = async () => botReply;
  const before = modelCalls.length;
  await handleMessage(follow);

  assert.equal(modelCalls.length, before + 1);
  assert.deepEqual(modelCalls.at(-1).threadHistory, [
    { author: 'customer', content: 'How do I pair Omi with my phone?' },
    { author: 'bot', content: 'Hold the center button for ten seconds, then pair it again from the app.' },
  ]);
  assert.equal(follow.replies.length, 1);
});

test('ambient messages and another customer replying to a support answer do not trigger the bot', async () => {
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> How do I pair Omi with my phone?`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const botReply = first.botReplies[0];
  const before = modelCalls.length;

  const ambient = makeMessage('I am having the same problem today.', { channel, authorId });
  await handleMessage(ambient);

  const otherCustomer = makeMessage('Can you also help me?', { channel, authorId: nextId() });
  otherCustomer.reference = { messageId: botReply.id };
  otherCustomer.fetchReference = async () => botReply;
  await handleMessage(otherCustomer);

  assert.equal(modelCalls.length, before);
  assert.equal(ambient.replies.length + otherCustomer.replies.length, 0);
});

test('a user-created thread named Handoff cannot enable ambient bot replies', async () => {
  const spoof = makeChannel({
    thread: true,
    parentId: nextId(),
    name: 'Handoff · app · fake support thread',
  });
  spoof.ownerId = nextId();
  const ambient = makeMessage('The Android app crashes when I open it.', { channel: spoof });
  assert.equal(shouldHandle(ambient), false);
  await handleMessage(ambient);
  assert.equal(ambient.replies.length + spoof.sent.length, 0);

  const mentioned = makeMessage(`<@${BOT_ID}> The Android app crashes when I open it.`, {
    channel: spoof,
    mention: true,
  });
  assert.equal(shouldHandle(mentioned), true);
});

test('staff and moderators are not answered in live support threads', async () => {
  const post = makeChannel({ name: 'Continue restarts the answer', thread: true, parentId: HELP_FORUM });
  const namedStaff = makeMessage(
    'We confirmed the history is preserved and opened a fix. We will verify it in production.',
    { channel: post }
  );
  process.env.STAFF_USER_IDS = namedStaff.author.id;
  assert.equal(shouldHandle(namedStaff), false);
  const models = modelCalls.length;
  await emit(Events.MessageCreate, namedStaff);

  const moderator = makeMessage('Can you share the conversation ID so I can check this?', {
    channel: post,
    member: { permissions: { has: (flag) => flag === 'ManageThreads' } },
  });
  process.env.STAFF_USER_IDS = '';
  assert.equal(shouldHandle(moderator), false);

  const handoff = makeChannel({ name: 'Handoff · tech · Continue repeats', thread: true, parentId: TEST_CHANNEL });
  const handoffModerator = makeMessage('PR #20139 is open for this.', {
    channel: handoff,
    member: { permissions: { has: (flag) => flag === 'ManageMessages' } },
  });
  assert.equal(shouldHandle(handoffModerator), false);

  await emit(Events.MessageCreate, moderator);
  await emit(Events.MessageCreate, handoffModerator);
  assert.equal(modelCalls.length, models);
  assert.equal(namedStaff.replies.length + moderator.replies.length + handoffModerator.replies.length, 0);

  const customer = makeMessage('Does Continue preserve the unfinished answer?', { channel: post });
  assert.equal(shouldHandle(customer), true);

  process.env.STAFF_USER_IDS = namedStaff.author.id;
  const staffTest = makeMessage('How do I pair my Omi?', {
    channel: testChannel(),
    authorId: namedStaff.author.id,
  });
  assert.equal(shouldHandle(staffTest), true);
});

test('a customer reply aimed at staff stays between the customer and staff', async () => {
  const post = makeChannel({ name: 'Keeps stopping and starting audio', thread: true, parentId: HELP_FORUM });
  const staff = {
    id: nextId(),
    content: 'The fix is included in version 0.12.413 and newer.',
    author: { id: nextId(), username: 'staff', bot: false },
    channel: post,
  };
  const customer = makeMessage('It is still happening for me on the latest stable build.', {
    channel: post,
  });
  customer.reference = { messageId: staff.id };
  customer.fetchReference = async () => staff;
  const before = modelCalls.length;

  await handleMessage(customer);

  assert.equal(modelCalls.length, before);
  assert.equal(customer.replies.length + post.sent.length, 0);
});

test('an explicit bot mention can opt back in while replying to staff', async () => {
  const post = makeChannel({ name: 'Keeps stopping and starting audio', thread: true, parentId: HELP_FORUM });
  const staff = {
    id: nextId(),
    content: 'The fix is included in version 0.12.413 and newer.',
    author: { id: nextId(), username: 'staff', bot: false },
    channel: post,
  };
  const customer = makeMessage(`<@${BOT_ID}> Is that newer than version 0.12.402?`, {
    channel: post,
    mention: true,
  });
  customer.reference = { messageId: staff.id };
  customer.fetchReference = async () => staff;
  const before = modelCalls.length;

  await handleMessage(customer);

  assert.equal(modelCalls.length, before + 1);
  assert.equal(customer.replies.length, 1);
});

test('short gratitude such as Sweet thanks does not trigger support', async () => {
  const post = makeChannel({ name: 'Keeps stopping and starting audio', thread: true, parentId: HELP_FORUM });
  const customer = makeMessage('Sweet thanks!', { channel: post });
  assert.equal(shouldHandle(customer), false);
  const before = modelCalls.length;
  await handleMessage(customer);
  assert.equal(modelCalls.length, before);
  assert.equal(customer.replies.length + post.sent.length, 0);
});

test('delivery acknowledgments and identifier-only updates stay silent in a help thread', async () => {
  const post = makeChannel({ name: 'Battery percentage jumps', thread: true, parentId: HELP_FORUM });
  const screenshots = makeMessage(
    "I'll send them screenshots of the device; the device sent diagnostics too.",
    { channel: post }
  );
  const identifiers = makeMessage('#138637367 ticket number Order #18063', { channel: post });
  assert.equal(shouldHandle(screenshots), false);
  assert.equal(shouldHandle(identifiers), false);
  const before = modelCalls.length;
  await handleMessage(screenshots);
  await handleMessage(identifiers);
  assert.equal(modelCalls.length, before);
  assert.equal(screenshots.replies.length + identifiers.replies.length + post.sent.length, 0);
});

test('same-problem follow-up retrieves from the full thread and keeps completed actions', async () => {
  const url = 'https://feedback.omi.me/p/battery-charging-percentage-jumps';
  const payload = {
    props: {
      pageProps: {
        fallback: {
          'rq:single:/v1/submission': {
            data: {
              results: [
                {
                  title: 'Battery charging percentage jumps',
                  content:
                    '<p>Customers report battery readings changing sharply while charging and after unplugging.</p>',
                  postStatus: { name: 'In Progress' },
                  postCategory: { name: { en: 'Bugs & Errors' } },
                  upvotes: 3,
                },
              ],
            },
          },
        },
      },
    },
  };
  feedbackPages.set(
    url,
    `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`
  );
  modelReply = {
    final_answer:
      'You are seeing the same sharp battery-percentage changes while charging. Flashing green and blue means the consumer necklace is charging while connected. The diagnostics you already sent are part of the existing case.',
    escalate: true,
  };
  const post = makeChannel({ name: 'Charging and battery readings', thread: true, parentId: HELP_FORUM });
  const earlier = {
    id: nextId(),
    author: { id: nextId(), username: 'Jack', bot: false },
    content:
      'The battery jumped from 9% to 73%, then fell to 19% after unplugging. It flashes blue and green while charging.',
  };
  const diagnostics = {
    id: nextId(),
    author: { id: nextId(), username: 'Ryder', bot: false },
    content: 'I already emailed support and sent diagnostics.',
  };
  const follow = makeMessage("I'm having the same problem too.", { channel: post });
  post.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      [diagnostics.id, diagnostics],
      [earlier.id, earlier],
    ]);

  await handleMessage(follow);

  assert.match(modelCalls.at(-1).toolFacts, /Omi Feedback portal \| issue\/status signal only/);
  assert.match(modelCalls.at(-1).toolFacts, /Portal status: In Progress/);
  assert.ok(modelCalls.at(-1).threadHistory.some((item) => /battery jumped/i.test(item.content)));
  assert.ok(modelCalls.at(-1).threadHistory.some((item) => /sent diagnostics/i.test(item.content)));
  assert.match(replyText(follow), /same sharp battery-percentage changes/i);
  assert.doesNotMatch(replyText(follow), /send them again/i);
});

test('a model-down storage follow-up answers app versus phone versus device from the thread', async () => {
  modelDown = true;
  const post = makeChannel({
    name: 'Remove stored conversations and recordings',
    thread: true,
    parentId: HELP_FORUM,
  });
  const opening = {
    id: nextId(),
    author: { id: nextId(), username: 'ARVL', bot: false },
    content: 'I want to remove past conversations from the app and the stored recording copies.',
  };
  const priorBot = {
    id: nextId(),
    author: { id: BOT_ID, username: 'vector', bot: true },
    content:
      'Pull request #20172 has been merged. https://github.com/BasedHardware/omi/pull/20172',
  };
  const follow = makeMessage('Does that remove from APP, PHONE, or DEVICE?', { channel: post });
  post.messages.fetch = async () =>
    new Map([
      [follow.id, follow],
      [priorBot.id, priorBot],
      [opening.id, opening],
    ]);

  await handleMessage(follow);

  const reply = replyText(follow);
  assert.match(reply, /Delete conversation/i);
  assert.match(reply, /Offline Sync/i);
  assert.match(reply, /phone storage/i);
  assert.match(reply, /does not erase the pendant\/device storage/i);
  assert.equal((reply.match(/github\.com\/BasedHardware\/omi\/pull\/20172/g) || []).length, 1);
  assert.equal(follow.threads.length, 0);
  assert.equal(post.sent.length, 0);
});

test('a bare mention is not handled and the mention never reaches the model', async () => {
  const channel = makeChannel();
  assert.equal(shouldHandle(makeMessage(`<@${BOT_ID}> hi`, { channel, mention: true })), false);
  assert.equal(shouldHandle(makeMessage(`<@!${BOT_ID}> hey`, { channel, mention: true })), false);
  const r = await ask(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, { channel, mention: true });
  assert.equal(r.modelCalled, true);
  assert.equal(modelCalls.at(-1).question.includes(BOT_ID), false);
});

test('a second question in a normal channel within the cooldown is skipped', async () => {
  const channel = makeChannel();
  const authorId = nextId();
  const first = await ask(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, {
    channel,
    mention: true,
    authorId,
  });
  const second = await ask(`<@${BOT_ID}> Can I use Omi with two phones at once?`, {
    channel,
    mention: true,
    authorId,
  });
  assert.equal(first.modelCalled, true);
  assert.equal(second.modelCalled, false);
  assert.equal(second.message.replies.length, 0);
});

test('one customer cannot put another customer direct mention on cooldown', async () => {
  const channel = makeChannel();
  const first = await ask(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, {
    channel,
    mention: true,
    authorId: nextId(),
  });
  const second = await ask(`<@${BOT_ID}> Can I use Omi with two phones at once?`, {
    channel,
    mention: true,
    authorId: nextId(),
  });
  assert.equal(first.modelCalled, true);
  assert.equal(second.modelCalled, true);
  assert.equal(second.message.replies.length, 1);
});

test('#vector-test answers back-to-back questions despite the cooldown', async () => {
  const channel = testChannel();
  const first = await ask('How do I pair my Omi with a new phone?', { channel });
  const second = await ask('Can I use Omi with two phones at once?', { channel });
  assert.equal(first.modelCalled, true);
  assert.equal(second.modelCalled, true);
  assert.equal(second.message.replies.length, 1);
});

test('a message delivered twice is answered once and opens one Handoff', async () => {
  const message = makeMessage('I want a refund for my Omi, it is not what I expected.');
  await Promise.all([handleMessage(message), handleMessage(message)]);
  assert.equal(message.threads.length, 1);
  assert.equal(message.replies.length, 1);
});

test('a ticket whose Handoff thread cannot be opened is told nobody was pinged yet', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const message = makeMessage('The Android app crashes every time I open it.');
  message.startThread = async () => {
    throw new Error('Missing Permissions');
  };
  message.channel.send = async () => {
    throw new Error('Missing Permissions');
  };
  await handleMessage(message);
  const reply = replyText(message);
  assert.match(reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.equal(reply.includes(utils.ISSUE_FOOTER), false);
  assert.equal(posts().length, 0);
});

test('a tech ticket with only a customer-visible Handoff is given the email fallback', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The Android app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
});

test('a new private handoff thread is linked in the customer reply', async () => {
  const channel = generalChannel();
  let created;
  channel.threads.create = async (options) => {
    assert.equal(options.type, ChannelType.PrivateThread);
    created = makeChannel({ thread: true, parentId: channel.id, name: options.name });
    created.members = { add: async () => {} };
    return created;
  };
  const message = makeMessage(`<@${BOT_ID}> The Android app crashes when I open a conversation.`, {
    channel,
    mention: true,
  });
  await handleMessage(message);
  assert.ok(created);
  assert.match(replyText(message), new RegExp(`<#${created.id}>`));
  assert.doesNotMatch(replyText(message), /Keep talking here/i);
});

test('/test posts its ticket card in the channel and does not claim a thread', async () => {
  const interaction = slashTest('I want a refund for my Omi, it is not what I expected.');
  await commands.handleInteraction(interaction);
  const reply = interaction.channel.sent.map(textOf).join('\n');
  assert.match(reply, /could not deliver this to the support team.*help@omi\.me/is);
  assert.equal(reply.includes(utils.ISSUE_FOOTER), false);
});

test('a help-forum post does not count its public card as staff delivery', async () => {
  const post = makeChannel({ thread: true, parentId: HELP_FORUM, name: 'App crash' });
  const r = await ask('The Android app crashes every time I open a memory.', { channel: post });
  assert.equal(r.thread, null);
  assert.ok(post.sent.length >= 1);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
});

test('an undelivered Handoff is not reused as though staff had received it', async (t) => {
  const r = await reportAgain(t, 2 * 60 * 60 * 1000);
  assert.equal(r.again.threads.length, 1);
  assert.equal(r.thread.sent.length, r.sentBefore);
  assert.match(r.reply, /could not deliver this to the support team.*help@omi\.me/is);
});

test('a later report opens a new Handoff when the old thread was deleted', async (t) => {
  const r = await reportAgain(t, 2 * 60 * 60 * 1000, deleteThread);
  assert.equal(r.again.threads.length, 1);
  assert.equal(r.reply.includes(utils.DUPLICATE_FOOTER), false);
  assert.equal(r.reply.includes(`<#${r.thread.id}>`), false);
});

test('a report five minutes after its Handoff was deleted still opens a new one', async (t) => {
  const r = await reportAgain(t, 5 * 60 * 1000, deleteThread);
  assert.equal(r.again.threads.length, 1);
  assert.equal(r.reply.includes(utils.DUPLICATE_FOOTER), false);
});

test('a later report opens a new Handoff after /done even when the archive was refused', async (t) => {
  const r = await reportAgain(t, 2 * 60 * 60 * 1000, doneWithArchiveRefused);
  assert.equal(r.again.threads.length, 1);
  assert.equal(r.thread.sent.length, r.sentBefore);
});

test('a report five minutes after /done still opens a new Handoff', async (t) => {
  const r = await reportAgain(t, 5 * 60 * 1000, doneWithArchiveRefused);
  assert.equal(r.again.threads.length, 1);
  assert.equal(r.thread.sent.length, r.sentBefore);
});
