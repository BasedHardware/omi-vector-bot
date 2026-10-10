const assert = require('node:assert/strict');
const test = require('node:test');

process.env.EVAL_NO_MODEL = '1';
const router = require('../router');
const { buildSystemPrompt } = require('../prompt');
const { escalateReply } = require('../utils');
const { scenarios, judge, replyFor } = require('../scripts/customer-eval');

test('the model prompt has one support policy', () => {
  const prompt = buildSystemPrompt({ lane: 'faq' });
  assert.equal(prompt.split('Support policy:').length - 1, 1);
  assert.match(prompt, /Money, orders, refunds/);
});

test('the golden set scores every saved question on the rules path', async () => {
  let ok = 0;
  const misses = [];
  for (const scene of scenarios) {
    const route = router.classify(scene.ask);
    const result = await replyFor(scene, route);
    const problems = judge(scene, route, result.answer);
    if (problems.length) misses.push(`${scene.id}: ${problems.join('; ')}`);
    else ok += 1;
  }
  assert.deepEqual(misses, []);
  assert.equal(ok, scenarios.length);
});

test('golden person-path drafts get one next step only after staff delivery is known', async () => {
  for (const scene of scenarios.filter((item) => item.first === 'person')) {
    const route = router.classify(scene.ask);
    const { answer } = await replyFor(scene, route);
    assert.ok(answer.trim(), scene.id);
    const delivered = escalateReply(answer, { pinged: true, replyInThread: true });
    assert.equal((delivered.match(/will reply in this thread/gi) || []).length, 1, scene.id);
    assert.doesNotMatch(delivered, /help@omi\.me|Use \/order|approved|has shipped|will arrive/i, scene.id);
    const failed = escalateReply(answer, { deliveryFailed: true });
    assert.equal((failed.match(/help@omi\.me/gi) || []).length, 1, scene.id);
    assert.doesNotMatch(failed, /has this now|will reply|Use \/order/i, scene.id);
  }
});
