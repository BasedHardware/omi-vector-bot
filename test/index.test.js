const assert = require('node:assert/strict');
const test = require('node:test');
const { Events, MessageFlags } = require('discord.js');

const TEST_CHANNEL = '100000000000000100';
const HELP_FORUM = '100000000000000200';
const BOT_ID = '100000000000000300';

for (const key of [
  'DISCORD_TOKEN',
  'OPENCODE_API_KEY',
  'TELEGRAM_TOKEN',
  'TELEGRAM_CHAT_ID',
  'DATABASE_URL',
  'STAFF_ALERT_CHANNEL_ID',
  'STAFF_USER_IDS',
  'STAFF_ROLE_ID',
  'AREA_OWNERS',
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

const opencode = require('../opencode');
const modelCalls = [];
let modelReply = {};
let modelDown = false;
opencode.queryAgent = async (args) => {
  modelCalls.push(args);
  if (modelDown) throw new Error('model unavailable');
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

const githubCalls = [];
const files = new Map();
let pulls = [];
let issues = [];
let pullState = { state: 'open', merged: false };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (files.has(u)) {
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(files.get(u)) };
  }
  const method = opts.method || 'GET';
  githubCalls.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null });
  if (u.includes('/search/issues')) {
    return { ok: true, status: 200, json: async () => ({ items: u.includes('is%3Apr') ? pulls : issues }) };
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
const github = require('../github');
const commands = require('../commands');
const { client, handleMessage, shouldHandle } = require('../index');
const router = require('../router');
const { unreadMediaSentence } = require('../attachments');

client.user = { id: BOT_ID };

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

function makeMessage(
  content,
  { channel = testChannel(), attachments = [], mention = false, bot = false, authorId = nextId() } = {}
) {
  const message = {
    id: nextId(),
    content,
    channel,
    author: { id: authorId, username: 'customer', bot },
    attachments: new Map(attachments.map((a, i) => [String(i), a])),
    embeds: [],
    mentions: { has: () => mention },
    replies: [],
    threads: [],
    reply: async (payload) => {
      message.replies.push(payload);
      return { id: nextId() };
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

test.beforeEach(() => {
  modelCalls.length = 0;
  modelReply = {};
  modelDown = false;
  pulls = [];
  issues = [];
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

test('a how-to question in #vector-test gets the model answer and no Handoff', async () => {
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.modelCalled, true);
  assert.match(r.reply, /center button/);
  assert.equal(r.thread, null);
  assert.equal(r.github.length, 0);
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

test('a firmware report opens a firmware Handoff and files one GitHub issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('My Omi keeps turning itself off after 5 seconds.');
  assert.ok(r.thread);
  assert.match(r.thread.name, /firmware/);
  assert.equal(posts().length, 1);
  assert.match(posts()[0].body.body, /turning itself off/);
  assert.deepEqual(posts()[0].body.labels.slice(0, 2), ['vector', 'firmware']);
});

test('bot messages and empty captions are not handled', () => {
  assert.equal(shouldHandle(makeMessage('How do I pair my Omi?', { bot: true })), false);
  assert.equal(shouldHandle(makeMessage('hi')), false);
  assert.equal(shouldHandle(makeMessage('How do I pair my Omi?')), true);
});

test('an order status question points to /order, skips the model and opens a shop Handoff', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('Where is my order? I still have no tracking email.');
  assert.equal(r.modelCalled, false);
  assert.match(r.reply, /\/order/);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · shop · /);
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
  assert.match(r.thread.name, /^Handoff · privacy · /);
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
  assert.equal(filed.length, 1);
  assert.deepEqual(filed[0].body.labels.slice(0, 2), ['vector', 'desktop']);
});

test('a phone app crash opens an app Handoff and files an app issue', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The Android app crashes every time I open a conversation.');
  const filed = r.github.filter((c) => c.method === 'POST');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · app · tech · /);
  assert.equal(filed.length, 1);
  assert.deepEqual(filed[0].body.labels.slice(0, 2), ['vector', 'app']);
});

test('asking to talk to a human opens a Handoff even when the model says not to escalate', async () => {
  modelReply = { escalate: false, confidence: 0.95 };
  const r = await ask('How do I pair my Omi with a new phone? I want to talk to a human.');
  assert.equal(r.modelCalled, true);
  assert.match(r.reply, /center button/);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · /);
});

test('an open pull request that matches the report is cited as unshipped with no Handoff and no model', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  pulls = [
    {
      number: 4321,
      state: 'open',
      title: 'Fix Android crash when opening memories',
      html_url: 'https://github.com/BasedHardware/omi/pull/4321',
    },
  ];
  const r = await ask('The Android app crashes when I open the memories tab.');
  assert.match(r.reply, /#4321/);
  assert.match(r.reply, /omi\/pull\/4321/);
  assert.ok(r.github.some((c) => /\/pulls\/4321$/.test(c.url)));
  assert.equal(/has been merged|has shipped|is fixed/i.test(r.reply), false);
  assert.equal(r.thread, null);
  assert.equal(r.modelCalled, false);
  assert.equal(posts().length, 0);
});

test('a merged pull request that matches the report is described as merged', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
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
  assert.match(r.reply, /#4400/);
  assert.match(r.reply, /merged/);
  assert.equal(r.thread, null);
  assert.equal(r.modelCalled, false);
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
  assert.match(r.thread.sent[0].embeds[0].fields.find((f) => f.name === 'GitHub')?.value || '', /issues\/777/);
  assert.equal(r.thread.sent[0].components, undefined);
  assert.match(textOf(r.thread.sent[1]), /issues\/777/);
  assert.equal(posts().length, 0);
  assert.deepEqual(github.threadsForIssue(777), [r.thread.id]);
});

test('a filed issue quotes the customer and carries the Handoff thread marker', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The iPhone app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.equal(posts().length, 1);
  assert.match(posts()[0].body.body, /crashes every time I open a memory/);
  assert.ok(posts()[0].body.body.includes(`<!-- vector-thread:${r.thread.id} -->`));
  assert.deepEqual(posts()[0].body.labels.slice(0, 2), ['vector', 'app']);
  assert.match(textOf(r.thread.sent[1]), /issues\/901/);
  assert.deepEqual(github.threadsForIssue(901), [r.thread.id]);
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
  assert.equal(filed.length, 1);
  assert.deepEqual(filed[0].body.labels.slice(0, 2), ['vector', 'app']);
  assert.equal(/model unavailable|opencode|deepseek/i.test(r.reply), false);
});

test('when the model is down a how-to question opens a Handoff instead of going quiet', async () => {
  modelDown = true;
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.equal(r.modelCalled, true);
  assert.ok(r.thread);
  assert.match(r.thread.name, /^Handoff · faq · /);
  assert.ok(r.reply.includes(utils.PINGED_FOOTER));
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

test('an escalated how-to says a person has it once the Handoff opens', async () => {
  modelReply = { escalate: true };
  const r = await ask('How do I pair my Omi with a new phone?');
  assert.ok(r.thread);
  assert.ok(r.reply.includes(utils.PINGED_FOOTER));
  assert.equal(r.reply.includes(utils.ESCALATE_FOOTER), false);
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
  assert.ok(reply.includes(utils.ESCALATE_FOOTER));
  assert.equal(reply.includes(utils.PINGED_FOOTER), false);
});

test('a saved staff fact is prepended to a related answer and left off an unrelated one', async () => {
  const fact = 'The magnetic charging cable takes about two hours to fill the battery.';
  knowledge.addSnippet(fact);
  modelReply = { final_answer: 'Most people leave it plugged in overnight.' };
  const related = await ask('How long does charging take with the magnetic cable?');
  assert.deepEqual(modelCalls.at(-1).knowledgeSnippets, [fact]);
  assert.equal(related.reply.startsWith(fact), true);
  assert.match(related.reply, /overnight/);
  const unrelated = await ask('How do I pair my Omi with a new phone?');
  assert.equal(unrelated.reply.includes('magnetic'), false);
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
  const first = await ask(`<@${BOT_ID}> How do I pair my Omi with a new phone?`, { channel, mention: true });
  const second = await ask(`<@${BOT_ID}> Can I use Omi with two phones at once?`, { channel, mention: true });
  assert.equal(first.modelCalled, true);
  assert.equal(second.modelCalled, false);
  assert.equal(second.message.replies.length, 0);
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
  assert.ok(reply.includes(utils.ESCALATE_FOOTER));
  assert.equal(reply.includes(utils.ISSUE_FOOTER), false);
  assert.equal(posts().length, 0);
});

test('a tech ticket with a Handoff thread is still told it is written in that thread', async () => {
  process.env.GITHUB_TOKEN = 'ghs_test';
  const r = await ask('The Android app crashes every time I open a memory.');
  assert.ok(r.thread);
  assert.ok(r.reply.includes(utils.ISSUE_FOOTER));
});

test('/test posts its ticket card in the channel and does not claim a thread', async () => {
  const interaction = slashTest('I want a refund for my Omi, it is not what I expected.');
  await commands.handleInteraction(interaction);
  const reply = interaction.channel.sent.map(textOf).join('\n');
  assert.ok(reply.includes(utils.PINGED_FOOTER));
  assert.equal(reply.includes(utils.ISSUE_FOOTER), false);
});

test('a later report from the same customer goes into their open Handoff', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-23T10:00:00Z') });
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const thread = first.threads[0];
  const before = thread.sent.length;
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  const again = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it, still.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(again);
  assert.equal(again.threads.length, 0);
  assert.equal(thread.sent.length, before + 1);
  assert.ok(replyText(again).includes(utils.DUPLICATE_FOOTER));
  assert.ok(replyText(again).includes(`<#${thread.id}>`));
});

test('a later report opens a new Handoff when the old thread was deleted', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-23T10:00:00Z') });
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const thread = first.threads[0];
  thread.send = async () => {
    throw new Error('Unknown Channel');
  };
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  const again = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it, still.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(again);
  assert.equal(again.threads.length, 1);
  assert.equal(replyText(again).includes(utils.DUPLICATE_FOOTER), false);
  assert.equal(replyText(again).includes(`<#${thread.id}>`), false);
});

test('a later report opens a new Handoff after /done even when the archive was refused', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-23T10:00:00Z') });
  const channel = generalChannel();
  const authorId = nextId();
  const first = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(first);
  const thread = first.threads[0];
  thread.edit = async () => {
    throw new Error('Missing Access');
  };
  const closed = await commands.closeHandoff(thread, { id: '900000000000000009' });
  const after = thread.sent.length;
  t.mock.timers.tick(2 * 60 * 60 * 1000);
  const again = makeMessage(`<@${BOT_ID}> The Android app crashes every time I open it, again.`, {
    channel,
    mention: true,
    authorId,
  });
  await handleMessage(again);
  assert.equal(closed.ok, true);
  assert.equal(again.threads.length, 1);
  assert.equal(thread.sent.length, after);
});
