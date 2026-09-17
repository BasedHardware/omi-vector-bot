require('dotenv').config();
const { queryAgent } = require('./opencode');
const { shouldEscalate } = require('./utils');

async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (!question) {
    console.error('Usage: npm run ask -- "how do I pair my Omi?"');
    process.exit(1);
  }

  const ai = await queryAgent({
    question,
    threadHistory: [],
    knowledgeSnippets: [],
    sessionId: 'vector-ask',
  });
  const escalate = shouldEscalate(ai, question);

  console.log(escalate ? 'ESCALATE' : 'ANSWER');
  console.log(`confidence ${ai.confidence}`);
  if (ai.reason) console.log(`reason ${ai.reason}`);
  console.log('');
  console.log(ai.final_answer);
  if (escalate) {
    console.log('');
    console.log('(CLI: no Discord staff ping from here.)');
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
