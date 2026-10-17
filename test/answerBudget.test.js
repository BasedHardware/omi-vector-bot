const assert = require('node:assert/strict');
const test = require('node:test');
const { queryAgent } = require('../commandcode');

test('answer instructions budget the reply and prioritize brief supported multipart answers', async t => {
  const previousKey = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'test-only-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.CMD_API_KEY;
    else process.env.CMD_API_KEY = previousKey;
  });
  await queryAgent({
    question: 'Explain recording, language, sharing and deleting a conversation.',
    post: async (_url, body) => {
      assert.match(body.messages[0].content, /hard budget of 1,500 characters/i);
      assert.match(body.messages[0].content, /parts.*briefly.*order asked/i);
      assert.match(body.messages[0].content, /sources support/i);
      return { data: { choices: [{ message: { content: '{"final_answer":"Use the app recording button.","confidence":0.9,"escalate":false}' } }] } };
    },
  });
});
