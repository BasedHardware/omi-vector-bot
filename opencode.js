const crypto = require('node:crypto');
const axios = require('axios');
const { buildSystemPrompt, buildUserPrompt } = require('./prompt');
const { stripStaffLies } = require('./honesty');

const OPENCODE_URL =
  process.env.OPENCODE_URL || 'https://opencode.ai/zen/go/v1/chat/completions';
const OPENCODE_MODEL = process.env.OPENCODE_MODEL || 'deepseek-v4.1-flash';
const TIMEOUT_MS = Number(process.env.OPENCODE_TIMEOUT_MS || 60_000);

function parseAgentJson(raw) {
  const trimmed = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('OpenCode reply was not JSON');
  }
  let data;
  try {
    data = JSON.parse(trimmed.slice(start, end + 1));
  } catch (err) {
    console.error('[OpenCode] json parse failed:', err.message);
    return {
      final_answer: 'I am not sure. A person on the team needs to take this.',
      confidence: 0.2,
      escalate: true,
      reason: 'model json failed',
      topic: '',
      labels: [],
      area: '',
      lane: '',
      file_issue: false,
    };
  }
  if (typeof data.final_answer !== 'string' || !data.final_answer.trim()) {
    throw new Error('OpenCode JSON missing final_answer');
  }
  const confidence = Number(data.confidence);
  const labels = Array.isArray(data.labels) ? data.labels.map((x) => String(x)) : [];
  return {
    final_answer: stripStaffLies(data.final_answer.trim()),
    confidence: Number.isFinite(confidence) ? confidence : 0.4,
    escalate: Boolean(data.escalate),
    reason: String(data.reason || data.escalation_question_for_aarav || '').trim(),
    topic: String(data.topic || '').trim(),
    labels,
    area: String(data.area || '').trim(),
    lane: String(data.lane || '').trim(),
    file_issue: Boolean(data.file_issue),
  };
}

async function queryAgent({
  question,
  threadHistory,
  knowledgeSnippets,
  route,
  toolFacts,
  sessionId,
  post,
}) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key) {
    throw new Error('Missing OPENCODE_API_KEY');
  }

  const session = sessionId || process.env.OPENCODE_SESSION || crypto.randomUUID();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const send = post || axios.post.bind(axios);
      const { data } = await send(
        OPENCODE_URL,
        {
          model: OPENCODE_MODEL,
          temperature: 0.4,
          messages: [
            { role: 'system', content: buildSystemPrompt(route) },
            {
              role: 'user',
              content: buildUserPrompt({
                question,
                threadHistory,
                knowledgeSnippets,
                route,
                toolFacts,
              }),
            },
          ],
        },
        {
          timeout: TIMEOUT_MS,
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            'User-Agent': 'omi-vector-bot/1.0',
            'x-opencode-session': session,
          },
        }
      );

      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error('OpenCode response empty');
      const parsed = parseAgentJson(content);
      if (parsed.reason === 'model json failed' && attempt === 0) continue;
      return parsed;
    } catch (err) {
      const apiErr = err.response?.data?.error;
      const kind = apiErr?.type || '';
      if (kind === 'CreditsError' || /insufficient balance/i.test(apiErr?.message || '')) {
        throw new Error(
          'OpenCode wallet is empty. Ask David to add credits on this test key, then retry npm run ask.'
        );
      }
      if (kind === 'MissingSessionID') {
        throw new Error(
          'OpenCode Go needs x-opencode-session. This is a bot bug — retry after a fix.'
        );
      }
      if (err.response?.status) {
        throw new Error(`OpenCode HTTP ${err.response.status}: ${apiErr?.message || err.message}`);
      }
      if (attempt === 1) throw err;
    }
  }
  throw new Error('OpenCode response empty');
}

const REVIEW_MODEL = process.env.OPENCODE_REVIEW_MODEL || 'deepseek/deepseek-v4-pro';

async function reviewAnswer({ question, draft, sources, sessionId, post }) {
  const key = process.env.OPENCODE_API_KEY;
  if (!key || !draft) return draft;
  const send = post || axios.post.bind(axios);
  const session = sessionId || crypto.randomUUID();
  const { data } = await send(
    OPENCODE_URL,
    {
      model: REVIEW_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You check a support reply against the source pages. Reply with JSON only: {"final_answer":"string","escalate":false,"confidence":0.8}. Keep a step only when the pages state it. Delete any step, time, or button the pages do not state. If the pages do not cover the question, say you are not sure and give help@omi.me. Do not add a second topic. Do not claim you pinged or emailed anyone. Everyday words.',
        },
        {
          role: 'user',
          content: `Question:\n${question}\n\nDraft reply:\n${draft}\n\nSource pages:\n${String(sources || '').slice(0, 14000)}`,
        },
      ],
    },
    {
      timeout: TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'User-Agent': 'omi-vector-bot/1.0',
        'x-opencode-session': session,
      },
    }
  );
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return draft;
  const parsed = parseAgentJson(content);
  return parsed.final_answer || draft;
}

module.exports = { queryAgent, reviewAnswer, parseAgentJson };
