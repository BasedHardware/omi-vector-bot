const assert = require('node:assert/strict');
const test = require('node:test');
const { parseAgentJson, queryAgent } = require('../opencode');

test('parseAgentJson reads a fenced reply and a broken one', () => {
  const ok = parseAgentJson('```json\n{"final_answer":"Hold the button.","escalate":false,"confidence":0.8}\n```');
  assert.match(ok.final_answer, /Hold the button/);
  assert.equal(ok.escalate, false);
  const broken = parseAgentJson('{"final_answer": }');
  assert.equal(broken.reason, 'model json failed');
  assert.equal(broken.escalate, true);
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
