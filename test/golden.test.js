const assert = require('node:assert/strict');
const test = require('node:test');

process.env.EVAL_NO_MODEL = '1';
const router = require('../router');
const { buildSystemPrompt } = require('../prompt');
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
