const assert = require('node:assert/strict');
const test = require('node:test');
const { queryAgent, reviewAnswer } = require('../commandcode');

test('answer instructions use the shared word target without a competing character budget', async t => {
  const previousKey = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previousKey;
  });
  let request;
  await queryAgent({
    question: 'Explain recording, language, sharing and deleting a conversation.',
    post: async (_url, body) => {
      request = body;
      return { data: { choices: [{ message: { content: '{"final_answer":"Use the app recording button.","confidence":0.9,"escalate":false}' } }] } };
    },
  });
  const system = request.messages.filter(item => item.role === 'system').map(item => item.content).join('\n');
  assert.match(system, /40.80 words/i);
  assert.doesNotMatch(system, /1,?500 characters/i);
  assert.match(system, /parts.*briefly.*order asked/i);
  assert.match(system, /sources support/i);
});

test('multipart review keeps coverage and source limits without a second length contract', async () => {
  let request;
  await reviewAnswer({ question: 'Explain four app tasks.', draft: 'Four short supported steps.',
    understanding: { subQuestions: ['record', 'language', 'share', 'delete'].map(question => ({ question, query: question })) },
    post: async (_url, body) => {
      request = body;
      return { data: { choices: [{ message: { content: JSON.stringify({ final_answer: 'Four short supported steps.', grounded: true, relevant: true, confidence: 0.9, escalate: false, sources_used: [] }) } }] } };
    },
  });
  const system = request.messages.filter(item => item.role === 'system').map(item => item.content).join('\n');
  assert.match(system, /40.80 words/i);
  assert.doesNotMatch(system, /1,?500 characters/i);
  assert.match(system, /at most four exact URLs/i);
  assert.match(system, /each supported part brief and in the order asked/i);
});
