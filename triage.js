const { classify, looksLikeCaptureFailure, looksLikeTranscription, looksLikeDocs, mentionsOrder } = require('./router');
const { clipForDiscord } = require('./utils');

const AREAS = ['shop', 'app', 'desktop', 'firmware', 'privacy'];
const LANES = ['shop', 'money', 'privacy', 'firmware', 'tech', 'faq', 'account', 'unknown'];
const LABELS = [
  'shop',
  'app',
  'desktop',
  'firmware',
  'privacy',
  'account',
  'money',
  'tech',
  'shipping',
  'faq',
];

function sanitizeTopic(text) {
  let s = String(text || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^handoff\s*·\s*/i, '')
    .replace(/["*_`#]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  s = s.replace(/^(hi|hello|hey)[,!.\s]+/i, '').trim();
  if (!s || s.length < 8) return '';
  if (/^(just got|i just got|i('m| am) getting this error|nintendo kid)\b/i.test(s)) return '';
  return clipForDiscord(s, 56);
}

function cleanLabels(list) {
  const out = [];
  for (const raw of list || []) {
    const label = String(raw || '')
      .toLowerCase()
      .replace(/^needs-human$/, '')
      .trim();
    if (LABELS.includes(label) && !out.includes(label)) out.push(label);
  }
  return out;
}

function fallbackTopic(question, route) {
  const { threadTopic } = require('./handoff');
  return threadTopic(question, route);
}

function merge(route, agent, question) {
  const classified = route || classify(question);
  const moneyLock = classified.lane === 'money' || classified.lane === 'privacy';
  const docsLock = classified.lane === 'faq' && looksLikeDocs(question);
  const bothCaptureAndTranscript =
    looksLikeCaptureFailure(question) && looksLikeTranscription(question);

  let area = classified.area || 'unknown';
  let lane = classified.lane || 'unknown';
  if (!moneyLock && !docsLock && !bothCaptureAndTranscript) {
    const weak = area === 'unknown' || lane === 'unknown' || lane === 'faq';
    if (weak && AREAS.includes(agent?.area)) area = agent.area;
    if (weak && LANES.includes(agent?.lane) && agent.lane !== 'unknown') lane = agent.lane;
    if (lane === 'account') area = 'shop';
  }

  const { ticketLabels } = require('./handoff');
  let labels = moneyLock
    ? ticketLabels({ area: classified.area, lane: classified.lane, question })
    : cleanLabels(agent?.labels);
  const inferred = ticketLabels({ area, lane, question });
  for (const label of inferred) {
    if (label !== 'needs-human' && !labels.includes(label)) labels.push(label);
  }
  if (/\b(shipping|tracking|customs)\b/i.test(String(question || '')) && !labels.includes('shipping')) {
    labels.push('shipping');
  }
  labels = labels.filter((label) => label !== 'needs-human');
  if (docsLock || (bothCaptureAndTranscript && lane === 'faq')) {
    labels = labels.filter((label) => label !== 'shop' && label !== 'account' && label !== 'money');
    if (!labels.includes('faq')) labels.unshift('faq');
  }
  if (!labels.length) labels.push('needs-human');

  const topic =
    sanitizeTopic(agent?.topic) ||
    fallbackTopic(question, { area, lane }) ||
    'needs a person';
  const resolvedTopic = bothCaptureAndTranscript
    ? 'Transcription unavailable, device not capturing'
    : topic;

  const techish =
    lane === 'tech' ||
    lane === 'firmware' ||
    area === 'app' ||
    area === 'desktop' ||
    area === 'firmware';
  const blocked =
    moneyLock || lane === 'shop' || lane === 'account' || area === 'shop' || area === 'privacy';
  const fileIssue = techish && !blocked && !mentionsOrder(question);

  return {
    area,
    lane,
    labels,
    topic: resolvedTopic,
    fileIssue,
    escalate: Boolean(classified.escalate || agent?.escalate || moneyLock),
  };
}

function wantsShopTicket(merged) {
  const lane = merged?.lane;
  const area = merged?.area;
  if (area === 'privacy' || lane === 'privacy') return false;
  return lane === 'shop' || lane === 'money';
}

module.exports = {
  AREAS,
  LABELS,
  sanitizeTopic,
  cleanLabels,
  merge,
  wantsShopTicket,
};
