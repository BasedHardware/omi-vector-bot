const axios = require('axios');

const OPENCLAW_URL = process.env.OPENCLAW_URL;
const TIMEOUT_MS = 15_000;

async function queryAgent({ question, threadHistory, knowledgeSnippets }) {
  const url = `${OPENCLAW_URL}/agent`;

  const { data } = await axios.post(
    url,
    {
      question,
      thread_history: threadHistory,
      knowledge_snippets: knowledgeSnippets,
    },
    {
      timeout: TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    }
  );

  // Validate expected shape
  if (typeof data.final_answer !== 'string') {
    throw new Error('OpenClaw response missing final_answer');
  }
  if (typeof data.confidence !== 'number') {
    throw new Error('OpenClaw response missing confidence');
  }

  return {
    final_answer: data.final_answer,
    confidence: data.confidence,
    escalate: Boolean(data.escalate),
    escalation_question_for_aarav: data.escalation_question_for_aarav || '',
  };
}

module.exports = { queryAgent };
