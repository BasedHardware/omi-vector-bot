const {
  sanitizeReply,
  stripFalseCertainty,
  stripPingNarration,
  formatDiscordReply,
  clipForDiscord,
} = require('./utils');
const { stripHowtoBleed, stripShopBleed, stripUnsupportedClaims } = require('./honesty');

const EMPTY_ANSWER_FALLBACK = 'I could not verify a safe answer here. A person needs to check this.';
const UNSYNCED_DATA_WARNING = 'Recordings may still be unsynced. Do not reinstall the app, log out, or clear Pending/All storage until a person checks; those actions could erase local recordings.';

function ensureNonEmptyAnswer(answer) {
  return String(answer || '').trim() || EMPTY_ANSWER_FALLBACK;
}

function dropDanglingFragments(answer) {
  return String(answer || '')
    .split('\n')
    .map((line) => {
      if (/^\s*(?:https?:\/\/|\[(?:https?:\/\/[^\]]+|[^\]]+)\]\(https?:\/\/)/i.test(line)) return '';
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((part) => !/^\s*(?:and|or)\b/i.test(part))
        .join(' ');
    })
    .filter((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Filter the draft, and separately show the reviewer the original sentences
// removed by those filters. Only the reviewer may restore supported details.
function prepareDraftForReviewWithAudit(answer, lane, question) {
  const original = String(answer || '').trim();
  const draft = dropDanglingFragments(stripFalseCertainty(
    stripUnsupportedClaims(
      stripShopBleed(stripHowtoBleed(sanitizeReply(answer), lane), lane),
      lane,
      question
    )
  ));
  const normalizedDraft = draft.replace(/\s+/g, ' ').toLowerCase();
  const removed = original
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((sentence) => !normalizedDraft.includes(sentence.replace(/\s+/g, ' ').toLowerCase()))
    .slice(0, 12);
  return { draft, removed };
}

function prepareDraftForReview(answer, lane, question) {
  return prepareDraftForReviewWithAudit(answer, lane, question).draft;
}

function presentReviewedAnswer(answer) {
  // The reviewer has already checked the claims. Only enforce the hard
  // no-false-ping rule and Discord's format/length constraints here.
  return ensureNonEmptyAnswer(clipForDiscord(formatDiscordReply(dropDanglingFragments(stripPingNarration(answer)))));
}

function stripUnverifiedOrderClaims(answer, { verifiedLookup = false } = {}) {
  if (verifiedLookup) return String(answer || '').trim();
  const assertedStatus = /\b(?:(?:your|this|the)\s+(?:order|package|parcel|shipment|delivery|omi|device|necklace|glasses)|it)\s+(?:(?:is|was|has|had|hasn['’]?t|will|would|should|may|might|appears?|seems?|expected|likely)\s+){1,3}(?:(?:been|be|to|have|not|already|currently|probably)\s+){0,3}(?:(?:(?:marked|showing|listed)\s+as\s+)?(?:deliver\w*|shipp\w*|dispatch\w*|arriv\w*|in\s+transit|out\s+for\s+delivery|on\s+its\s+way)|located|at\s+(?:the|a|your)\b|sitting\s+(?:at|with)\s+(?:the\s+)?(?:depot|carrier|customs)\b)/i;
  const pronounStatus = /\b(?:it(?:['’]s|\s+(?:is|has))|they(?:['’]re|\s+(?:are|have)))\s+(?:been\s+)?(?:on\s+its\s+way|out\s+for\s+delivery|delivered|in\s+transit|shipped)\b/i;
  const locationClaim = /\b(?:(?:your|this|the)\s+(?:order|package|parcel|shipment|delivery)|it|they)(?:['’](?:s|re)|\s+(?:is|are|was|were|has|have|had))\s+(?:been\s+)?(?:stuck|held|sitting)\s+(?:at|in|with)\s+(?:(?:a|the)\s+)?(?:customs|depot|sorting\s+facility|warehouse|carrier)\b/i;
  const carrierClaim = /\b(?:the|your|a)\s+carrier\s+(?:has\s+|had\s+)?(?:deliver\w*|shipp\w*|dispatch\w*)\s+(?:it|your\s+(?:order|package|parcel|shipment))\b/i;
  return String(answer || '')
    .split('\n')
    .map((line) => line.split(/(?<=[.!?])\s+/)
      .filter((sentence) => {
        if (/^\s*(?:source|fuente|quelle|fonte|источник|来源|출처)\s*:/i.test(sentence)) return true;
        const claim = assertedStatus.exec(sentence) || pronounStatus.exec(sentence) || locationClaim.exec(sentence) || carrierClaim.exec(sentence);
        if (!claim) return true;
        return /\b(?:if|when|in case)\b/i.test(sentence.slice(0, claim.index));
      })
      .join(' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function hasUnsyncedDataRisk(question) {
  const text = String(question || '');
  const data = /\b(?:sync\w*|record\w*|audio|meetings?|conversations?|memories?|transcri\w*|dictat\w*|voice)\b/i.test(text);
  const loss = /\b(?:gone|vanish\w*|disappear\w*|lost|losing|missing|nothing\s+sync\w*|never\s+showed\s+up|not\s+sync\w*|didn['’]?t\s+sync\w*|sync\w*\s+(?:is\s+)?(?:stuck|stall\w*|fail\w*)|(?:stuck|stall\w*|fail\w*)\s+sync\w*)\b/i.test(text);
  const emptyOutput = /\b(?:(?:no|zero|empty|blank)\s+(?:transcripts?|recordings?|audio)|(?:transcripts?|recordings?|audio)\s+(?:is|was|are|were|came(?:\s+back)?)?\s*(?:empty|blank|zero|missing)|nothing\s+(?:was\s+)?(?:recorded|transcribed|saved))\b/i.test(text);
  const happened = /\b(?:recorded|captured|finished|spoke|talked|said|dictated|yesterday|last\s+(?:night|week|meeting|call)|(?:\d+|an?|one|two|three|four|several)\s+(?:hours?|minutes?)|(?:a|the|my)\s+whole\s+(?:meeting|lecture|call|day)|all\s+day|during\s+(?:my|the|a)\s+(?:call|meeting|lecture)|(?:my|the)\s+(?:recording|audio|transcript))\b/i.test(text);
  return data && (loss || (emptyOutput && happened));
}

function addUnsyncedDataWarning(answer, question, { dataLossRisk = false, language = 'en' } = {}) {
  const current = String(answer || '').trim();
  if (!(dataLossRisk || hasUnsyncedDataRisk(question))) return current;
  if (String(language || 'en').toLowerCase().split('-')[0] !== 'en') return current;
  if (/do not reinstall/i.test(current) && /log out/i.test(current) && /clear Pending\/All/i.test(current)) return current;
  const warning = UNSYNCED_DATA_WARNING;
  const sourceAt = current.search(/\n(?:Sources?):\s*https:\/\//i);
  const sourceLine = sourceAt < 0 ? '' : current.slice(sourceAt).trim();
  const body = sourceAt < 0 ? current : current.slice(0, sourceAt).trim();
  const bodyBudget = Math.max(200, 1_750 - warning.length - sourceLine.length - 4);
  return [clipForDiscord(body, bodyBudget), warning, sourceLine].filter(Boolean).join('\n\n');
}

module.exports = {
  EMPTY_ANSWER_FALLBACK,
  UNSYNCED_DATA_WARNING,
  ensureNonEmptyAnswer,
  dropDanglingFragments,
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  stripUnverifiedOrderClaims,
  addUnsyncedDataWarning,
  hasUnsyncedDataRisk,
};
