const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSystemPrompt } = require('../prompt');

test('every answer lane has a short, non-technical, transparent support voice', () => {
  for (const lane of ['faq', 'tech', 'firmware', 'shop', 'money', 'privacy', 'account']) {
    const prompt = buildSystemPrompt({ lane });
    assert.match(prompt, /Mira/);
    assert.match(prompt, /AI support assistant/);
    assert.match(prompt, /40.80 words/);
    assert.match(prompt, /one or two sentences per paragraph/i);
    assert.match(prompt, /non-technical/i);
    assert.match(prompt, /never pretend to be a human/i);
    assert.match(prompt, /never shorten away.*warning/i);
    assert.match(prompt, /do not repeat.*introduction/i);
    assert.match(prompt, /before delivery is confirmed/i);
  }
});

test('reviewer uses the same writing contract without weakening its evidence gate', async () => {
  const { reviewAnswer } = require('../commandcode');
  let body;
  await reviewAnswer({
    question: 'Where are my saved notes?', draft: 'Open your saved Conversation.',
    sources: '[S1] Help Center\nhttps://help.omi.me/en/articles/123\nOpen your Conversation.',
    post: async (_url, value) => {
      body = value;
      return { data: { choices: [{ message: { content: JSON.stringify({
        final_answer: 'Open your saved Conversation.', grounded: true, relevant: true,
        confidence: 0.9, escalate: false, sources_used: ['S1'],
      }) } }] } };
    },
    env: { CMD_API_KEY: 'synthetic-test-key' },
  });
  const system = body.messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  assert.match(system, /40.80 words/);
  assert.match(system, /non-technical/i);
  assert.match(system, /Check every concrete claim/);
  assert.match(system, /Never authorize a step from static fallback/);
  assert.match(system, /calm, warm and practical/);
});

test('the support identity covers the help guild even without a test channel, without duplicate writes', async () => {
  const { ensureSupportIdentity, SUPPORT_DISPLAY_NAME } = require('../supportVoice');
  const changes = [];
  const me = { nickname: 'Old name', setNickname: async name => { me.nickname = name; changes.push(name); } };
  const client = { channels: { fetch: async () => ({ guild: { id: 'same-guild', members: { me } } }) } };
  await ensureSupportIdentity(client, ['help', 'test']);
  assert.deepEqual(changes, [SUPPORT_DISPLAY_NAME]);
  await ensureSupportIdentity(client, ['help']);
  assert.equal(changes.length, 1);
  assert.equal(SUPPORT_DISPLAY_NAME, 'Mira · Omi AI support'); assert.ok(SUPPORT_DISPLAY_NAME.length <= 32);
});

test('Mira keeps AI disclosure visible in the display name as well as profile and answer copy', () => {
  const { SUPPORT_DISPLAY_NAME, SUPPORT_PROFILE_DESCRIPTION, SUPPORT_VOICE } = require('../supportVoice');
  assert.equal(SUPPORT_DISPLAY_NAME, 'Mira · Omi AI support');
  assert.match(SUPPORT_PROFILE_DESCRIPTION, /Mira.*Omi.*AI support assistant/i);
  assert.match(SUPPORT_VOICE, /never pretend to be a human/i);
  assert.match(SUPPORT_VOICE, /if asked who you are.*AI support assistant/i);
});

test('one consistent Mira personality reaches every answer lane without fictional human claims', () => {
  const { SUPPORT_PERSONALITY } = require('../supportVoice');
  assert.equal(typeof SUPPORT_PERSONALITY, 'string');
  for (const lane of ['faq', 'tech', 'firmware', 'shop', 'money', 'privacy', 'account']) {
    const prompt = buildSystemPrompt({ lane });
    assert.ok(prompt.includes(SUPPORT_PERSONALITY));
    assert.match(prompt, /calm, warm and practical/);
    assert.match(prompt, /fictional feminine persona, not a human employee/);
    assert.match(prompt, /customer's language/i);
    assert.match(prompt, /never override.*safety.*privacy.*evidence/i);
  }
});

test('Mira stays considerate during serious problems rather than becoming flattery or flirtation', () => {
  const { SUPPORT_PERSONALITY } = require('../supportVoice');
  assert.match(SUPPORT_PERSONALITY, /anger, lost data, money or privacy.*calm and serious/i);
  assert.match(SUPPORT_PERSONALITY, /do not flirt.*pet names.*personal attachment/i);
  assert.match(SUPPORT_PERSONALITY, /specific attention.*useful next action/i);
  assert.match(SUPPORT_PERSONALITY, /not personality performance/i);
});

test('the shared persona is calm and practical without asking for elegance or charm', () => {
  const { SUPPORT_PERSONALITY } = require('../supportVoice');
  assert.match(SUPPORT_PERSONALITY, /calm, warm and practical/);
  assert.doesNotMatch(SUPPORT_PERSONALITY, /elegant|gently charming/i);
  assert.match(SUPPORT_PERSONALITY, /fictional feminine persona, not a human employee/);
  assert.match(SUPPORT_PERSONALITY, /never override safety, privacy, evidence, uncertainty or truthful capability limits/i);
});

test('startup leaves the already disclosed Mira nickname unchanged', async () => {
  const { ensureSupportIdentity } = require('../supportVoice');
  let writes = 0;
  const client = { channels: { fetch: async () => ({ guild: {
    id: 'synthetic-guild', members: { me: {
      nickname: 'Mira · Omi AI support', setNickname: async () => { writes++; },
    } },
  } }) } };
  await ensureSupportIdentity(client, ['synthetic-help']);
  assert.equal(writes, 0);
});
