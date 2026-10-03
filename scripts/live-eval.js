#!/usr/bin/env node
// Run against this checkout or --root /path/to/another/checkout. No Discord
// login, writes, staff notifications, order lookups, or GitHub filing occur.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const currentRoot = path.resolve(__dirname, '..');
process.env.NODE_PATH = [path.join(currentRoot, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
require('dotenv').config({ path: path.join(currentRoot, '.env') });

// origin/main still reads OPENCODE_*; route it through the same CommandCode
// endpoint/model/key as the branch so the comparison changes only bot code.
if (process.env.CMD_API_KEY) {
  process.env.OPENCODE_API_KEY = process.env.CMD_API_KEY;
  process.env.OPENCODE_URL = process.env.CMD_API_URL || 'https://api.commandcode.ai/provider/v1/chat/completions';
  process.env.OPENCODE_MODEL = process.env.CMD_MODEL || 'deepseek/deepseek-v4.1-flash';
  process.env.OPENCODE_REVIEW_MODEL = process.env.CMD_REVIEW_MODEL || process.env.OPENCODE_MODEL;
}

const { scenarios: original, liveScenarios: priorLive } = require('./customer-eval');

const added = [
  { id: 'disconnecting', ask: 'omi keeps disconnecting from my phone every few minutes', first: 'person', must: [/background|battery|bluetooth/i, /(?:android|ios|phone os|operating system)/i, /app version/i] },
  { id: 'pairing-search', ask: "my omi won't pair, the app keeps searching forever", first: 'person', must: [/pair|bluetooth/i] },
  { id: 'android-conversation-crash', ask: 'app crashes every time i open a conversation on android', first: 'person', must: [/app version/i, /restart|permission|update/i] },
  { id: 'no-charge-light', ask: "omi not charging, light doesn't come on when plugged in", first: 'person', must: [/cable|adapter|charger/i, /reset|button/i] },
  { id: 'sync-stuck-offline', ask: "recorded offline all day, now it's stuck syncing at 12%", first: 'person', must: [/keep.{0,30}app.{0,20}open|(?:phone|device).{0,30}(?:near|close)|(?:near|close).{0,30}(?:phone|device)/i, /not (?:to )?reinstall|don.t reinstall/i, /log out|clear storage/i] },
  { id: 'mac-microphone', ask: "the desktop app on mac doesn't pick up my mic", first: 'person', must: [/microphone permission|microphone access/i] },
  { id: 'memories-sync-fixed', ask: 'is the memories sync problem between phone and desktop fixed yet?', first: 'person', must: [/not sure|can(?:not|'t) confirm|couldn.t verify|release/i] },
  { id: 'firmware-update-how', ask: 'how do i update the firmware on my omi', first: 'answer', must: [/settings|device/i, /firmware|update/i] },
  { id: 'blinking-red', ask: 'what does the blinking red light mean on my omi', first: 'answer', must: [/time|sync/i, /app/i] },
  { id: 'refund-broken', ask: "I want a refund, the device doesn't work", first: 'person', mustNot: [/refund (?:is|will be) approved|replacement (?:is|will be) approved/i] },
  { id: 'refund-spanish', ask: 'Quiero un reembolso, el dispositivo no funciona', first: 'person', must: [/reembolso|equipo|persona|ayuda/i], mustNot: [/refund approved/i] },
  { id: 'order-three-weeks', ask: 'where is my order? ordered 3 weeks ago', first: 'person', must: [/\/order|help@omi\.me/i], mustNot: [/shipped yesterday|(?:it|your order) will arrive (?:on|by|tomorrow|next|in)/i] },
  { id: 'delete-account', ask: 'please delete my account and all my data', first: 'person', must: [/delet|remov|privacy/i] },
  { id: 'thanks-fixed', ask: 'thanks!! that fixed it', first: 'none' },
  { id: 'arrived-broken', ask: 'my device arrived broken, need a replacement', first: 'person', mustNot: [/replacement (?:is|will be) approved|we will replace/i] },
  { id: 'empty-transcripts-followup', turns: ['my transcripts are empty today', 'same problem, I already restarted the app and phone'], first: 'person', must: [/app version/i, /device/i], mustNot: [/restart (?:the|your) app|restart (?:the|your) phone/i] },
  { id: 'windows-compatibility', ask: 'does the omi desktop app work on windows?', observeOnly: true },
  { id: 'apple-watch', ask: 'can I use omi with my apple watch?', observeOnly: true },
];

const cases = [...original, ...priorLive, ...added];
const actionWords = '(?:try|check|make sure|enable|allow|restart|reboot|reset|reconnect|pair|unpair|charge|plug|unplug|update|open|close|keep|hold|press|tap|turn on|turn off|switch|go to)';
const stepPattern = new RegExp(`(?:^|[.!?]\\s+|\\n)\\s*(?:[-*]\\s*|\\d+[.)]\\s*)?${actionWords}\\b|\\byou\\s+(?:can|should|could|may|need to)\\s+${actionWords}\\b`, 'i');

function selectCases(only = '') {
  const ids = String(only || '').split(',').map((id) => id.trim()).filter(Boolean);
  const selected = cases.filter((scene) => !ids.length || ids.includes(scene.id));
  if (!selected.length || ids.some((id) => !selected.some((scene) => scene.id === id))) {
    throw new Error(`Unknown case: ${only}`);
  }
  return selected;
}

function judge(scene, reply, handoff, lane = scene.lane) {
  if (scene.observeOnly) return [];
  const problems = [];
  if (scene.first === 'none') {
    if (reply.trim() || handoff) problems.push('should not reply');
    return problems;
  }
  if (!reply.trim()) problems.push('empty reply');
  if (/Something broke/i.test(reply)) problems.push('generic crash reply');
  if (scene.first === 'person' && !handoff) problems.push('missing handoff');
  if (scene.first === 'answer' && handoff) problems.push('unwanted handoff');
  const urls = [...reply.matchAll(/https:\/\/[^\s)>]+/g)].map((match) => match[0]);
  const withoutSources = reply
    .replace(/(?:^|\n)Sources?:[^\n]*/gi, '')
    .replace(/\n\n(?:A person on the team has this now\.|The problem is written in this thread\. Keep talking here — you do not need to ping anyone\.)\s*$/i, '');
  if (['tech', 'firmware', 'faq'].includes(lane) && stepPattern.test(withoutSources) && !urls.some((url) => /^https:\/\/(?:help|docs)\.omi\.me\//i.test(url))) {
    problems.push('step without official Help Center/docs URL');
  }
  for (const pattern of scene.must || []) if (!pattern.test(reply)) problems.push(`missing ${pattern}`);
  for (const pattern of scene.mustNot || []) if (pattern.test(reply)) problems.push(`said ${pattern}`);
  return problems;
}

let seq = 1n;
function nextId() { seq += 1n; return String(800000000000000000n + seq); }
function payloadText(payload) { return typeof payload === 'string' ? payload : String(payload?.content || ''); }

function makeChannel(parentId) {
  const history = [];
  const sent = [];
  const channel = {
    id: nextId(), parentId, name: 'Evaluation', sent,
    isThread: () => true, isTextBased: () => true,
    sendTyping: async () => {},
    send: async (payload) => {
      sent.push(payload);
      history.push({ id: nextId(), content: payloadText(payload), author: { id: '800000000000000001', username: 'Omi Support', bot: true } });
      return { id: nextId() };
    },
    messages: { fetch: async () => new Map(history.slice().reverse().map((item) => [item.id, item])) },
    setName: async (name) => { channel.name = name; },
  };
  return { channel, history };
}

function makeMessage(content, channel, history, authorId) {
  const replies = [];
  const message = {
    id: nextId(), content, channel, replies,
    author: { id: authorId, username: 'Customer', bot: false },
    attachments: new Map(), embeds: [], mentions: { has: () => false },
    reply: async (payload) => {
      replies.push(payload);
      history.push({ id: nextId(), content: payloadText(payload), author: { id: '800000000000000001', username: 'Omi Support', bot: true } });
      return { id: nextId(), content: payloadText(payload) };
    },
  };
  history.push(message);
  return message;
}

async function run(root, selected, onProgress = () => {}) {
  // These overrides make it impossible for the harness to contact actual
  // customers or staff. They are set before index.js captures env values.
  process.env.VECTOR_TEST_CHANNEL_ID = '899999999999999999';
  process.env.HELP_FORUM_CHANNEL_ID = '';
  process.env.STAFF_ALERT_CHANNEL_ID = '';
  process.env.TELEGRAM_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '';
  process.env.DATABASE_URL = '';
  process.env.SHOPIFY_STORE = '';
  process.env.SHOPIFY_ACCESS_TOKEN = '';
  process.env.HANDOFF_THREADS = '0';
  process.env.VECTOR_OCR = '0';
  if (!process.env.CMD_API_KEY && !process.env.OPENCODE_API_KEY) throw new Error('CMD_API_KEY is required for live evaluation');

  const inRoot = (name) => require(path.join(root, name));
  const retrieval = inRoot('retrieval.js');
  const docs = inRoot('docs.js');
  const helpcenter = inRoot('helpcenter.js');
  const website = inRoot('website.js');
  const helpPages = [];
  const loaded = await helpcenter.loadHelpCenter(fetch, { saveDocPage: async (page) => helpPages.push(page) });
  if (!loaded) throw new Error('Could not load official Help Center pages');
  const websitePages = [];
  const websiteLoaded = await website.loadOfficialWebsite(fetch, { saveDocPage: async (page) => websitePages.push(page) });
  const officialChunks = [...helpPages, ...websitePages].flatMap((page) => retrieval.chunkDocument(page));
  const realRelevantDocs = docs.relevantDocs;
  docs.relevantDocs = async (question, options = {}) => {
    const official = retrieval.formatEvidence(
      retrieval.rankLocalChunks(retrieval.supportQueries(question, options.queries), officialChunks, 7, {
        customerQuestion: options.customerQuestion || question,
      })
    );
    const officialDocs = await realRelevantDocs(question, options);
    return retrieval.combineEvidence(official, officialDocs);
  };
  const utils = inRoot('utils.js');
  utils.typingDelay = async () => {};
  const { client, handleMessage } = inRoot('index.js');
  const router = inRoot('router.js');
  const { User } = require('discord.js');
  client.user = new User(client, { id: '800000000000000001', username: 'Omi Support', bot: true });

  const rows = [];
  const originalError = console.error;
  let providerError = '';
  console.error = (...parts) => {
    const line = parts.map(String).join(' ');
    if (/\[Bot\] (?:search planning|model|review) failed/.test(line) && /\b(?:401|402|403|429)\b|usage limit exceeded|insufficient credits/i.test(line)) providerError = line.slice(0, 300);
    originalError(...parts);
  };
  for (const scene of selected) {
    providerError = '';
    const { channel, history } = makeChannel(process.env.VECTOR_TEST_CHANNEL_ID);
    const authorId = nextId();
    const start = performance.now();
    let reply = '';
    let handoff = false;
    let error = '';
    try {
      for (const turn of scene.turns || [scene.ask]) {
        const message = makeMessage(turn, channel, history, authorId);
        const before = channel.sent.length;
        await handleMessage(message);
        reply = message.replies.map(payloadText).join('\n');
        handoff = handoff || channel.sent.slice(before).some((payload) =>
          payload?.embeds?.some?.((embed) => embed.title === 'Needs a human')
        );
      }
    } catch (err) {
      error = err.message;
    }
    const urls = [...new Set([...reply.matchAll(/https:\/\/[^\s)>]+/g)].map((match) => match[0]))];
    const lane = router.classify((scene.turns || [scene.ask])[0]).lane;
    const problems = providerError ? [`Provider unavailable; result not scored: ${providerError}`] : [...judge(scene, reply, handoff, lane), ...(error ? [`error: ${error}`] : [])];
    const row = { id: scene.id, reply, handoff, urls, latencyMs: Math.round(performance.now() - start), pass: scene.observeOnly || Boolean(providerError) ? null : problems.length === 0, invalid: Boolean(providerError), problems };
    rows.push(row);
    onProgress({ root, helpPages: loaded, websitePages: websiteLoaded, incomplete: Boolean(providerError), rows });
    process.stdout.write(`${scene.id}: ${row.invalid ? 'INVALID' : row.pass === null ? 'OBSERVE' : row.pass ? 'PASS' : 'FAIL'} ${row.latencyMs}ms ${problems.join('; ')}\n`);
    if (providerError) break;
  }
  console.error = originalError;
  return { root, helpPages: loaded, websitePages: websiteLoaded, incomplete: Boolean(providerError), rows };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const root = args.includes('--root') ? path.resolve(value('--root')) : currentRoot;
  const only = args.includes('--cases') ? value('--cases') : args.includes('--case') ? value('--case') : '';
  const selected = selectCases(only);
  const outputPath = args.includes('--output') ? path.resolve(value('--output')) : '';
  const result = await run(root, selected, (partial) => {
    if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(partial, null, 2));
  });
  if (outputPath) fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  else process.stdout.write(`${JSON.stringify(result)}\n`);
  const passed = result.rows.filter((row) => row.pass === true).length;
  const scored = result.rows.filter((row) => row.pass !== null).length;
  process.stdout.write(`${passed}/${scored} scored cases passed\n`);
  if (result.incomplete) process.exitCode = 2;
  if (result.rows.some((row) => row.problems.some((problem) => /empty reply|generic crash reply|error:/.test(problem)))) process.exitCode = 1;
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });

module.exports = { cases, selectCases, judge, makeChannel, makeMessage, run };
