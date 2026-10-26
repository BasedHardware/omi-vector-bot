const test = require('node:test');
const assert = require('node:assert/strict');
const prompt = require('../prompt');
const { queryAgent, reviewAnswer } = require('../commandcode');

test('the same unresolved-answer policy replaces conflicting email and FAQ-only defaults', () => {
  assert.doesNotMatch(prompt.STATIC_FAQ, /help@omi\.me|team@basedhardware\.com/);
  assert.equal(typeof prompt.UNRESOLVED_ANSWER_POLICY, 'string');
  for (const lane of ['faq', 'tech', 'shop']) {
    const system = prompt.buildSystemPrompt({ lane });
    const tools = prompt.buildToolFacts({ route: { lane }, docsText: '[S1 | Help Center]\nhttps://help.omi.me/en/articles/synthetic-reminder-guide\nA reminder guide.' });
    assert.ok(system.includes(prompt.UNRESOLVED_ANSWER_POLICY));
    assert.ok(tools.includes(prompt.UNRESOLVED_ANSWER_POLICY));
    assert.doesNotMatch(tools, /say you are not sure and give help@omi\.me/);
    assert.doesNotMatch(system, /Escalate only if they asked for a person, or they already did/);
    assert.doesNotMatch(system, /Returns and warranty claims go to help@omi\.me|If it still does not recover, email help@omi\.me/);
  }
});

test('real answer and normal/compact review requests carry the shared policy without another model stage', async t => {
  const old = process.env.CMD_API_KEY; process.env.CMD_API_KEY = 'synthetic-offline-key';
  t.after(() => { if (old === undefined) delete process.env.CMD_API_KEY; else process.env.CMD_API_KEY = old; });
  t.mock.method(console, 'error', () => {});
  const bodies = [];
  const question = 'Can a repeating reminder use a custom interval?';
  const sources = '[S1 | Help Center]\nhttps://help.omi.me/en/articles/synthetic-reminder-guide\nThis guide does not establish custom intervals.';
  const post = async (_url, body) => {
    bodies.push(body);
    if (bodies.length === 2) return { data: { choices: [] } };
    return { data: { choices: [{ message: { content: JSON.stringify({
      final_answer: 'The guide does not establish that option. A person needs to check this.',
      grounded: true, relevant: true, escalate: true, confidence: 0.7, sources_used: ['S1'],
    }) } }] } };
  };
  const policy = prompt.buildToolFacts({ route: { lane: 'faq' }, docsText: sources });
  await queryAgent({ question, route: { lane: 'faq' }, toolFacts: policy, post });
  await reviewAnswer({ question, draft: 'The option needs clarification.', lane: 'faq', sources, policy, post });
  assert.equal(bodies.length, 3);
  for (const body of bodies) {
    const systems = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
    assert.match(systems, /Grounding and useful completion are separate/);
    assert.ok(systems.includes(prompt.UNRESOLVED_ANSWER_POLICY));
    assert.match(systems, /set escalate=true/);
    assert.match(systems, /Fully answered how-tos and hypothetical future requests/);
    assert.doesNotMatch(JSON.stringify(body.messages), /say you are not sure and give help@omi\.me/);
  }
});
