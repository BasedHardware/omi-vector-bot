#!/usr/bin/env node
// Run against this checkout or --root /path/to/another/checkout. No Discord
// login, writes, staff notifications, order lookups, or GitHub filing occur.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { AsyncLocalStorage } = require('node:async_hooks');
const { hasTroubleshootingStep } = require('../supportSteps');

const currentRoot = path.resolve(__dirname, '..');
process.env.NODE_PATH = [path.join(currentRoot, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
require('dotenv').config({ path: path.join(currentRoot, '.env') });

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
const caseContext = new AsyncLocalStorage();

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
  if (['tech', 'firmware', 'faq'].includes(lane) && hasTroubleshootingStep(withoutSources) && !urls.some((url) => /^https:\/\/(?:help|docs)\.omi\.me\//i.test(url))) {
    problems.push('step without official Help Center/docs URL');
  }
  if (!scene.heldout) {
    for (const pattern of scene.must || []) if (!pattern.test(reply)) problems.push(`missing ${pattern}`);
    for (const pattern of scene.mustNot || []) if (pattern.test(reply)) problems.push(`said ${pattern}`);
  }
  return problems;
}

function parseCaseLine(line) {
  const raw = JSON.parse(line);
  const scene = {
    id: String(raw.id || '').trim(),
    first: String(raw.first || '').trim(),
    heldout: true,
  };
  if (!scene.id || !['answer', 'person', 'none'].includes(scene.first)) throw new Error('Case requires id and first=answer|person|none');
  if (typeof raw.ask === 'string' && raw.ask.trim()) scene.ask = raw.ask.trim();
  else if (Array.isArray(raw.turns) && raw.turns.length && raw.turns.every((turn) => typeof turn === 'string' && turn.trim())) scene.turns = raw.turns.map((turn) => turn.trim());
  else throw new Error(`Case ${scene.id} requires ask or nonempty turns`);
  return scene;
}

function loadCasesFile(file, root) {
  const real = fs.realpathSync(path.resolve(file));
  for (const repo of [currentRoot, root]) {
    const relative = path.relative(repo, real);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      throw new Error('--cases-file must be outside the repository');
    }
  }
  const scenes = fs.readFileSync(real, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map(parseCaseLine);
  if (!scenes.length || new Set(scenes.map((scene) => scene.id)).size !== scenes.length) throw new Error('Cases file is empty or has duplicate ids');
  return scenes;
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1)];
}

function captureModelUsage(state, event) {
  if (!state || !event) return;
  if (!Array.isArray(state.modelCalls)) state.modelCalls = [];
  state.modelCalls.push({
    stage: event.stage,
    model: event.model,
    promptTokens: event.promptTokens,
    completionTokens: event.completionTokens,
    reasoningTokens: event.reasoningTokens,
  });
}

function summarize(rows, runs) {
  const byCase = new Map();
  for (const row of rows) {
    const list = byCase.get(row.id) || [];
    list.push(row);
    byCase.set(row.id, list);
  }
  const pass = [];
  const flaky = [];
  const fail = [];
  const observe = [];
  for (const [id, group] of byCase) {
    if (group.every((row) => row.pass === null && !row.invalid)) { observe.push(id); continue; }
    const passed = group.filter((row) => row.pass === true).length;
    if (passed >= Math.floor(runs / 2) + 1) pass.push(id);
    else fail.push(id);
    if (passed > 0 && passed < runs) flaky.push(id);
  }
  const stages = ['planner', 'retrieval', 'answer', 'review', 'total'];
  const latency = Object.fromEntries(stages.map((stage) => {
    const values = rows.filter((row) => !row.invalid).map((row) => row.timings?.[stage] ?? (stage === 'total' ? row.latencyMs : NaN));
    return [stage, { p50: percentile(values, 50), p95: percentile(values, 95) }];
  }));
  return { pass, flaky, fail, observe, latency };
}

let seq = 1n;
function nextId() { seq += 1n; return String(800000000000000000n + seq); }
function payloadText(payload) { return typeof payload === 'string' ? payload : String(payload?.content || ''); }

function makeChannel(parentId) {
  const history = [];
  const sent = [];
  const channel = {
    id: nextId(), parentId, name: 'Evaluation', sent,
    evalSourceMessages: new Map(),
    isThread: () => true, isTextBased: () => true,
    sendTyping: async () => {},
    send: async (payload) => {
      sent.push(payload);
      const receipt = { id: nextId(), content: payloadText(payload), channelId: channel.id, channel,
        nonce: payload?.nonce, reference: null, author: { id: '800000000000000001', username: 'Omi Support', bot: true } };
      history.push(receipt);
      return receipt;
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
      const receipt = { id: nextId(), content: payloadText(payload), channelId: channel.id, channel,
        nonce: payload?.nonce, reference: { messageId: message.id, channelId: channel.id },
        author: { id: '800000000000000001', username: 'Omi Support', bot: true } };
      history.push(receipt);
      return receipt;
    },
  };
  history.push(message);
  channel.evalSourceMessages.set(message.id, message);
  return message;
}

async function evalDiscordSender(_client, channel, payload, { replyToMessageId = null } = {}) {
  if (replyToMessageId == null) return channel.send(payload);
  const source = channel.evalSourceMessages?.get(replyToMessageId);
  if (!source) throw Object.assign(new Error('Evaluation source unavailable'), { status: 400, code: 10008, referenceMissing: true });
  return source.reply(payload);
}

async function run(root, selected, { runs = 3, concurrency = 1, onProgress = () => {} } = {}) {
  // These overrides make it impossible for the harness to contact actual
  // customers or staff. They are set before index.js captures env values.
  process.env.VECTOR_TEST_CHANNEL_ID = '899999999999999999';
  process.env.HELP_FORUM_CHANNEL_ID = '';
  process.env.STAFF_ALERT_CHANNEL_ID = 'stub-staff-channel';
  process.env.TELEGRAM_TOKEN = '';
  process.env.TELEGRAM_CHAT_ID = '';
  process.env.DATABASE_URL = '';
  process.env.SHOPIFY_STORE = '';
  process.env.SHOPIFY_ACCESS_TOKEN = '';
  process.env.HANDOFF_THREADS = '0';
  process.env.VECTOR_OCR = '0';
  if (!process.env.CMD_API_KEY) throw new Error('CMD_API_KEY is required for live evaluation');
  // The checked-out main baseline still reads the old variable names. Adapt
  // only that local baseline to the CommandCode endpoint for a fair comparison.
  if (fs.existsSync(path.join(root, 'opencode.js')) && !fs.existsSync(path.join(root, 'commandcode.js'))) {
    process.env.OPENCODE_API_KEY = process.env.CMD_API_KEY;
    process.env.OPENCODE_URL = process.env.CMD_API_URL || 'https://api.commandcode.ai/provider/v1/chat/completions';
    process.env.OPENCODE_MODEL = process.env.CMD_MODEL || 'deepseek/deepseek-v4.1-flash';
    process.env.OPENCODE_REVIEW_MODEL = process.env.CMD_REVIEW_MODEL || process.env.OPENCODE_MODEL;
  }

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
    // The live harness has no Postgres index, so it loads Help Center and docs
    // separately. Put the directly matched docs chunks before the broad local
    // Help Center matches so the answer/reviewer context limits retain both.
    // Source authority is still carried by each block and enforced by policy.
    return retrieval.combineEvidence(officialDocs, official);
  };
  const utils = inRoot('utils.js');
  utils.typingDelay = async () => {};
  const handoffModule = inRoot('handoff.js');
  // Simulate a successful private staff delivery, but never contact Discord or Telegram.
  handoffModule.notifyStaff = async () => {
    const state = caseContext.getStore();
    if (!state) throw new Error('Live eval handoff escaped its case context');
    state.handoff = true;
    return { ok: true, via: 'staff-channel' };
  };
  // New checkouts use a receipt-backed REST adapter. Stub that boundary too;
  // never let a model evaluation use the real bot token to send a message.
  let deliveryTransport;
  if (fs.existsSync(path.join(root, 'supportDiscordTransport.js'))) {
    deliveryTransport = inRoot('supportDiscordTransport.js');
    deliveryTransport.setTransportForTests(evalDiscordSender);
    const deliveries = inRoot('supportDeliveries.js');
    deliveries.setStoreForTests(deliveries.createMemoryStore(), { log: () => {} });
  }
  const { client, handleMessage } = inRoot('index.js');
  const router = inRoot('router.js');
  const { User } = require('discord.js');
  client.user = new User(client, { id: '800000000000000001', username: 'Omi Support', bot: true });

  const rows = [];
  const originalError = console.error;
  console.error = (...parts) => {
    const line = parts.map(String).join(' ');
    const state = caseContext.getStore();
    if (state && /\[Bot\] (?:search planning|model|review) failed/.test(line) && /\b(?:401|402|403|429)\b|usage limit exceeded|insufficient credits/i.test(line)) {
      state.providerError = 'Provider authorization, quota, or billing error';
      originalError('[LiveEval] Provider unavailable; details suppressed.');
      return;
    }
    originalError(...parts);
  };
  const onTiming = ({ stages }) => {
    const state = caseContext.getStore();
    if (!state) return;
    for (const [key, value] of Object.entries(stages)) state.timings[key] = (state.timings[key] || 0) + value;
  };
  const onModelUsage = (event) => {
    const state = caseContext.getStore();
    if (state) captureModelUsage(state, event);
  };
  process.on('omiSupportTimings', onTiming);
  process.on('omiSupportModelUsage', onModelUsage);
  const tasks = Array.from({ length: runs }, (_, index) => selected.map((scene) => ({ scene, runIndex: index + 1 }))).flat();
  let next = 0;
  let incomplete = false;
  async function runOne({ scene, runIndex }) {
    const state = { handoff: false, providerError: '', timings: {}, modelCalls: [] };
    return caseContext.run(state, async () => {
      const { channel, history } = makeChannel(process.env.VECTOR_TEST_CHANNEL_ID);
      const authorId = nextId();
      const start = performance.now();
      let reply = '';
      let error = '';
      try {
        for (const turn of scene.turns || [scene.ask]) {
          const message = makeMessage(turn, channel, history, authorId);
          await handleMessage(message);
          reply = message.replies.map(payloadText).join('\n');
        }
      } catch (err) {
        error = String(err.message || 'evaluation error').slice(0, 200);
      }
      const urls = [...new Set([...reply.matchAll(/https:\/\/[^\s)>]+/g)].map((match) => match[0]))];
      const lane = router.classify((scene.turns || [scene.ask])[0]).lane;
      const problems = state.providerError
        ? ['Provider unavailable; result not scored']
        : [...judge(scene, reply, state.handoff, lane), ...(error ? [`error: ${error}`] : [])];
      return {
        id: scene.id, run: runIndex, reply, handoff: state.handoff, urls,
        timings: state.timings, modelCalls: state.modelCalls, latencyMs: Math.round(performance.now() - start),
        pass: scene.observeOnly || Boolean(state.providerError) ? null : problems.length === 0,
        invalid: Boolean(state.providerError), problems,
      };
    });
  }
  async function worker() {
    while (!incomplete && next < tasks.length) {
      const task = tasks[next++];
      const row = await runOne(task);
      rows.push(row);
      if (row.invalid) incomplete = true;
      onProgress({ root, runs, concurrency, helpPages: loaded, websitePages: websiteLoaded, incomplete, rows });
      process.stdout.write(`${row.id} [${row.run}/${runs}]: ${row.invalid ? 'INVALID' : row.pass === null ? 'OBSERVE' : row.pass ? 'PASS' : 'FAIL'} ${row.latencyMs}ms ${row.problems.join('; ')}\n`);
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  } finally {
    console.error = originalError;
    process.off('omiSupportTimings', onTiming);
    process.off('omiSupportModelUsage', onModelUsage);
    deliveryTransport?.setTransportForTests(null);
  }
  rows.sort((a, b) => a.run - b.run || selected.findIndex((scene) => scene.id === a.id) - selected.findIndex((scene) => scene.id === b.id));
  return {
    root, runs, concurrency, helpPages: loaded, websitePages: websiteLoaded,
    retrievalMode: 'in-memory official chunks using production chunkDocument/rankLocalChunks; local Postgres unavailable',
    incomplete, rows, summary: summarize(rows, runs),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const root = args.includes('--root') ? path.resolve(value('--root')) : currentRoot;
  const only = args.includes('--cases') ? value('--cases') : args.includes('--case') ? value('--case') : '';
  const sourceCases = args.includes('--cases-file') ? loadCasesFile(value('--cases-file'), root) : cases;
  const ids = String(only || '').split(',').map((id) => id.trim()).filter(Boolean);
  const selected = ids.length ? sourceCases.filter((scene) => ids.includes(scene.id)) : sourceCases;
  if (!selected.length || ids.some((id) => !selected.some((scene) => scene.id === id))) throw new Error(`Unknown case: ${only}`);
  const runs = args.includes('--runs') ? Number(value('--runs')) : 3;
  const concurrency = args.includes('--concurrency') ? Number(value('--concurrency')) : 1;
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('--runs must be an integer from 1 to 10');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('--concurrency must be an integer from 1 to 8');
  const outputPath = args.includes('--output')
    ? path.resolve(value('--output'))
    : path.join(currentRoot, 'eval', 'results', `live-${path.basename(root)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const result = await run(root, selected, { runs, concurrency, onProgress: (partial) => {
    fs.writeFileSync(outputPath, JSON.stringify(partial, null, 2));
  } });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  process.stdout.write(`Results: ${outputPath}\n`);
  process.stdout.write(`Cases pass/flaky/fail: ${result.summary.pass.length}/${result.summary.flaky.length}/${result.summary.fail.length}\n`);
  if (result.incomplete) process.exitCode = 2;
  else if (result.summary.fail.length || result.rows.some((row) => row.problems.some((problem) => /empty reply|generic crash reply|error:/.test(problem)))) process.exitCode = 1;
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });

module.exports = { cases, selectCases, parseCaseLine, loadCasesFile, judge, summarize, captureModelUsage, makeChannel, makeMessage, evalDiscordSender, run };
