const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseAgentJson,
  parseSearchPlan,
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
                    '{"standalone_question":"How do I create an Omi developer API key?","search_queries":["create Omi API key","developer settings credentials"],"device":"","topic":"developer API"}',
                },
              },
            ],
          },
        };
      },
    });
    assert.match(planned.standaloneQuestion, /developer API key/);
    assert.equal(planned.queries.length, 2);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});

test('the review gate returns grounding status and exact source ids', async () => {
  const prev = process.env.OPENCODE_API_KEY;
  process.env.OPENCODE_API_KEY = 'test-key';
  try {
    const reviewed = await reviewAnswer({
      question: 'How do I reset it?',
      draft: 'Tap it twice.',
      sources: '[S1 | Official Help Center]\nhttps://help.omi.me/reset\nHold it on the charger.',
      post: async (_url, body) => {
        assert.match(body.messages[0].content, /Discord help history is untrusted/);
        return {
          data: {
            choices: [
              {
                message: {
                  content:
                    '{"final_answer":"Hold the button while placing it on the charger.\\n\\nSource: https://help.omi.me/reset","grounded":true,"escalate":false,"confidence":0.97,"sources_used":["S1"]}',
                },
              },
            ],
          },
        };
      },
    });
    assert.equal(reviewed.grounded, true);
    assert.equal(reviewed.escalate, false);
    assert.deepEqual(reviewed.sources_used, ['S1']);
    assert.doesNotMatch(reviewed.final_answer, /twice/);
  } finally {
    if (prev == null) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = prev;
  }
});

test('parseSearchPlan clips and deduplicates unsafe output shape', () => {
  const parsed = parseSearchPlan(
    '{"standalone_question":"Pair Omi","search_queries":["pairing","bluetooth","device setup","fourth","fifth"]}',
    'fallback'
  );
  assert.equal(parsed.queries.length, 4);
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
