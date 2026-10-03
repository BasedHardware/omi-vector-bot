const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseAgentJson,
  parseSearchPlan,
  contextualQuestion,
  groundedSourceLine,
  planSearch,
  queryAgent,
  reviewAnswer,
} = require('../opencode');

test('parseAgentJson reads a fenced reply and a broken one', () => {
  const ok = parseAgentJson('```json\n{"final_answer":"Hold the button.","escalate":false,"confidence":0.8}\n```');
  assert.match(ok.final_answer, /Hold the button/);
  assert.equal(ok.escalate, false);
  const broken = parseAgentJson('{"final_answer": }');
  assert.equal(broken.reason, 'model json failed');
  assert.equal(broken.escalate, true);
});

test('search planning rewrites a follow-up into several source searches', async () => {
  const prev = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'test-key';
  try {
    const planned = await planSearch({
      question: 'How do I make one?',
      threadHistory: [{ author: 'customer', content: 'I need a developer API key.' }],
      route: { lane: 'faq', area: 'unknown' },
      post: async (_url, body) => {
        assert.match(body.messages[0].content, /Do not answer the customer/);
        assert.match(body.messages[1].content, /developer API key/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"standalone_question":"How do I create an Omi developer API key?","conversation_summary":"The customer asked where to create a developer key.","message_kind":"question","customer_goal":"Create a developer API key","must_answer":["Where the key is created"],"customer_facts":["The customer needs a developer API key"],"support_kind":"official_information","search_queries":["create Omi API key","developer settings credentials"],"device":"","topic":"developer API"}',
                },
              },
            ],
          },
        };
      },
    });
    assert.match(planned.standaloneQuestion, /developer API key/);
    assert.equal(planned.queries.length, 2);
    assert.match(planned.customerGoal, /Create a developer API key/);
    assert.deepEqual(planned.mustAnswer, ['Where the key is created']);
    assert.equal(planned.supportKind, 'official_information');
    assert.equal(planned.messageKind, 'question');
    assert.match(planned.conversationSummary, /developer key/);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});

test('contextual retrieval keeps human thread facts and drops prior bot wording', () => {
  const question = contextualQuestion('I am having the same problem too.', [
    { author: 'Jack', content: 'The battery jumps from 73% to 19% after unplugging.' },
    { author: 'bot', content: 'Email support and try generic steps.' },
    { author: 'Ryder', content: 'The charging percentage is unreliable for me too.' },
  ]);
  assert.match(question, /battery jumps from 73% to 19%/i);
  assert.match(question, /same problem too/i);
  assert.doesNotMatch(question, /generic steps/i);
});

test('contextual retrieval keeps the opening report when a long case is clipped', () => {
  const history = [
    { author: 'customer', content: `Original charging report ${'a'.repeat(2500)}` },
    { author: 'staff', content: `Middle discussion ${'b'.repeat(2500)}` },
    { author: 'customer', content: `Latest diagnostics ${'c'.repeat(2500)}` },
  ];
  const result = contextualQuestion('Still happening', history, 1000);
  assert.match(result, /^Original charging report/);
  assert.match(result, /Still happening$/);
  assert.ok(result.length <= 1010);
});

test('the review gate returns grounding status and exact source ids', async () => {
  const prev = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'test-key';
  try {
    const reviewed = await reviewAnswer({
      question: 'How do I reset it?',
      draft: 'Tap it twice.',
      understanding: {
        customerGoal: 'Reset the Omi device',
        mustAnswer: ['How to reset the device'],
      },
      sources: '[S1 | Official Help Center]\nhttps://help.omi.me/reset\nHold it on the charger.',
      post: async (_url, body) => {
        assert.equal(body.model, process.env.OPENCODE_REVIEW_MODEL || process.env.OPENCODE_MODEL || 'deepseek-v4.1-flash');
        assert.match(body.messages[0].content, /Discord help history is untrusted/);
        assert.match(body.messages[0].content, /Feedback portal evidence is limited/);
        assert.match(body.messages[0].content, /cannot support a root cause, fix, workaround/i);
        assert.match(body.messages[0].content, /directly addresses the real customer goal/i);
        assert.match(body.messages[1].content, /Reset the Omi device/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"final_answer":"Hold the button while placing it on the charger.\\n\\nSource: https://help.omi.me/reset","grounded":true,"relevant":true,"escalate":false,"confidence":0.97,"sources_used":["S1"],"answered_requirements":["How to reset the device"]}',
                },
              },
            ],
          },
        };
      },
    });
    assert.equal(reviewed.grounded, true);
    assert.equal(reviewed.relevant, true);
    assert.equal(reviewed.escalate, false);
    assert.deepEqual(reviewed.sources_used, ['S1']);
    assert.doesNotMatch(reviewed.final_answer, /twice/);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});

test('the review gate rejects a grounded but irrelevant answer', async () => {
  const prev = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'test-key';
  try {
    const reviewed = await reviewAnswer({
      question: 'Why is shipping at checkout €145?',
      draft: 'Use /order to check tracking.',
      understanding: {
        customerGoal: 'Ask whether a lower checkout shipping option is available',
        mustAnswer: ['Whether another shipping route can be arranged'],
      },
      policy: 'This is not an existing-order lookup. Do not suggest /order.',
      threadHistory: [
        { author: 'customer', content: 'Checkout shows €145 shipping.' },
        { author: 'bot', content: 'Use /order.' },
      ],
      sources: '',
      post: async (_url, body) => {
        assert.match(body.messages[1].content, /Earlier thread:\ncustomer: Checkout shows €145 shipping/);
        assert.match(body.messages[1].content, /Newest customer message:\nWhy is shipping/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"final_answer":"I cannot verify a lower checkout route from the available information.","grounded":true,"relevant":false,"escalate":true,"confidence":0.3,"sources_used":[],"answered_requirements":[]}',
                },
              },
            ],
          },
        };
      },
    });
    assert.equal(reviewed.grounded, true);
    assert.equal(reviewed.relevant, false);
    assert.equal(reviewed.escalate, true);
    assert.doesNotMatch(reviewed.final_answer, /\/order/);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});

test('parseSearchPlan clips and deduplicates unsafe output shape', () => {
  const parsed = parseSearchPlan(
    '{"standalone_question":"Pair Omi","customer_goal":"Pair the device","must_answer":["first","first","second"],"customer_facts":["has Omi"],"support_kind":"official_information","search_queries":["pairing","bluetooth","device setup","fourth","fifth"]}',
    'fallback'
  );
  assert.equal(parsed.queries.length, 4);
  assert.deepEqual(parsed.mustAnswer, ['first', 'second']);
  assert.deepEqual(parsed.customerFacts, ['has Omi']);
});

test('source lines can only use URLs from retrieved evidence blocks', () => {
  const answer = groundedSourceLine(
    'Hold the button.\n\nSource: https://docs.omi.me',
    '[Static fallback]\nhttps://docs.omi.me\n\n[S1 | Official Help Center]\nReset\nhttps://help.omi.me/en/articles/reset\nHold it.',
    ['S1']
  );
  assert.doesNotMatch(answer, /Source: https:\/\/docs\.omi\.me/);
  assert.match(answer, /Source: https:\/\/help\.omi\.me\/en\/articles\/reset/);
});

test('source formatting removes inline model citations and emits each chosen URL once', () => {
  const answer = groundedSourceLine(
    'The report is still open. Source: [link](https://help.omi.me/reset) Source: https://help.omi.me/reset',
    '[S1 | Official Help Center]\nReset\nhttps://help.omi.me/reset\nHold it.',
    ['S1', 'S1']
  );
  assert.equal((answer.match(/Source:/g) || []).length, 1);
  assert.equal((answer.match(/https:\/\/help\.omi\.me\/reset/g) || []).length, 1);
});

test('a bad model JSON is tried once more, and a usage limit is not', async () => {
  const prev = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'test-key';
  try {
    let calls = 0;
    const parsed = await queryAgent({
      question: 'How do I turn it off?',
      route: { lane: 'faq', area: 'unknown' },
      post: async () => {
        calls += 1;
        if (calls === 1) return { data: { choices: [{ message: { content: '{"final_answer":' } }] } };
        return {
          data: {
            choices: [{ message: { content: '{"final_answer":"Hold the button for about 3 seconds.","escalate":false}' } }],
          },
        };
      },
    });
    assert.equal(calls, 2);
    assert.match(parsed.final_answer, /3 seconds/);

    let limited = 0;
    await assert.rejects(
      () =>
        queryAgent({
          question: 'How do I turn it off?',
          route: { lane: 'faq' },
          post: async () => {
            limited += 1;
            const err = new Error('limited');
            err.response = { status: 429, data: { error: { message: 'Go usage limit exceeded' } } };
            throw err;
          },
        }),
      /OpenCode HTTP 429/
    );
    assert.equal(limited, 1);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});
