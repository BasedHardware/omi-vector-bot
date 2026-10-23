const crypto = require('node:crypto');
const {
  sanitizeReply,
  stripFalseCertainty,
  stripPingNarration,
  formatDiscordReply,
  DISCORD_REPLY_MAX,
} = require('./utils');
const { stripHowtoBleed, stripShopBleed, stripUnsupportedClaims } = require('./honesty');
const { SOURCE_LABEL_NAME, SOURCE_LABEL_SEPARATOR } = require('./supportSteps');

const EMPTY_ANSWER_FALLBACK = 'I could not verify a safe answer here. A person needs to check this.';
const UNSYNCED_DATA_WARNING = 'Recordings may still be unsynced. Do not reinstall the app, log out, or clear Pending/All storage until a person checks; those actions could erase local recordings.';

function ensureNonEmptyAnswer(answer) {
  return String(answer || '').trim() || EMPTY_ANSWER_FALLBACK;
}

// Filter the draft, and separately show the reviewer the original sentences
// removed by those filters. Only the reviewer may restore supported details.
function prepareDraftForReviewWithAudit(answer, lane, question) {
  const original = String(answer || '').trim();
  const draft = stripFalseCertainty(
    stripUnsupportedClaims(
      stripShopBleed(stripHowtoBleed(sanitizeReply(answer), lane), lane),
      lane,
      question
    )
  );
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

// The closing source line: a label, then at least one https link, up to the end of the answer.
const TRAILING_SOURCE = new RegExp(
  `\\n\\s*${SOURCE_LABEL_NAME}\\s*${SOURCE_LABEL_SEPARATOR}\\s*https:\\/\\/[^\\n]*$`,
  'iu'
);

// Reply items are atomic: a wrapped bullet is one item, not a series of lines.
// Prose can stop at a complete sentence; an oversized first list item cannot.
// Keep this separate from the raw question/title clipper used elsewhere.
function clipCompleteReplyUnits(answer, max) {
  const text = String(answer || '').trim();
  if (text.length <= max) return text;
  const bodyBudget = Math.max(0, max - 2); // newline plus the truncation marker
  const units = [];
  let current;
  let offset = 0;
  const finish = () => {
    if (current) units.push(current);
    current = undefined;
  };
  for (const line of text.split('\n')) {
    const listItem = /^\s*(?:[-*+•]|\d+[.)])\s+\S/u.test(line);
    if (!line.trim()) {
      finish();
    } else if (listItem || !current) {
      finish();
      current = { start: offset, end: offset + line.length, listItem };
    } else {
      current.end = offset + line.length;
    }
    offset += line.length + 1;
  }
  finish();

  let end = 0;
  for (const unit of units) {
    if (unit.end <= bodyBudget) {
      end = unit.end;
      continue;
    }
    if (!unit.listItem) {
      const prefix = text.slice(unit.start, bodyBudget);
      for (const sentenceEnd of prefix.matchAll(/[.!?。！？]["'”’\])]*(?=\s|$)/gu)) {
        const candidate = unit.start + sentenceEnd.index + sentenceEnd[0].length;
        // The prefix boundary itself is not a sentence boundary if the next
        // original character continues a URL, word or punctuation group.
        if (!text[candidate] || /\s/u.test(text[candidate])) end = candidate;
      }
    }
    break;
  }
  const body = text.slice(0, end).trim();
  if (body) return `${body}\n…`;
  const note = 'This reply was too long to display in full.';
  return note.length <= max ? note : '';
}

// Clip at a complete reply item and keep the source line whole. A link cut
// short opens nothing, including on multi-part answers with several sources.
function clipKeepingSource(answer, max = DISCORD_REPLY_MAX) {
  const text = String(answer || '').trim();
  if (text.length <= max) return text;
  const sourceAt = text.search(TRAILING_SOURCE);
  if (sourceAt < 0) return clipCompleteReplyUnits(text, max);
  const tail = text.slice(sourceAt);
  const gap = /^\n\s*\n/.test(tail) ? '\n\n' : '\n';
  const sourceLine = tail.trim();
  const bodyBudget = max - sourceLine.length - gap.length;
  if (bodyBudget < 0) return EMPTY_ANSWER_FALLBACK; // never publish a severed source URL
  const body = clipCompleteReplyUnits(text.slice(0, sourceAt), bodyBudget);
  return body ? `${body}${gap}${sourceLine}` : sourceLine;
}

function presentReviewedAnswer(answer) {
  // The reviewer has already checked the claims. Only enforce the hard
  // no-false-ping rule and Discord's format/length constraints here.
  return ensureNonEmptyAnswer(clipKeepingSource(formatDiscordReply(stripPingNarration(answer))));
}

// Evaluation-only evidence: the shape of a text at one stage, never the text.
// A short hash lets two stages be compared for equality without exposing content.
function stageFingerprint(stage, text) {
  const value = String(text || '');
  return {
    stage,
    length: value.length,
    lines: value ? value.split('\n').length : 0,
    hash: crypto.createHash('sha256').update(value).digest('hex').slice(0, 12),
    hasLink: /https?:\/\//i.test(value),
    hasSourceLine: TRAILING_SOURCE.test(value),
  };
}

// Same transitions as presentReviewedAnswer, with a fingerprint per stage so a
// short final reply can be traced to the stage that shortened it.
function presentReviewedAnswerWithEvidence(answer) {
  const stages = [stageFingerprint('input', answer)];
  const narration = stripPingNarration(answer);
  stages.push({ ...stageFingerprint('narration_filter', narration), changed: narration !== String(answer || '').trim() });
  const formatted = formatDiscordReply(narration);
  stages.push(stageFingerprint('format', formatted));
  const clipped = clipKeepingSource(formatted);
  stages.push({ ...stageFingerprint('clip', clipped), clipped: clipped !== formatted });
  const final = ensureNonEmptyAnswer(clipped);
  stages.push({ ...stageFingerprint('final', final), fallback: final === EMPTY_ANSWER_FALLBACK && !clipped });
  return { answer: final, stages };
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
  return [clipCompleteReplyUnits(body, bodyBudget), warning, sourceLine].filter(Boolean).join('\n\n');
}

module.exports = {
  EMPTY_ANSWER_FALLBACK,
  UNSYNCED_DATA_WARNING,
  ensureNonEmptyAnswer,
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  presentReviewedAnswerWithEvidence,
  stageFingerprint,
  stripUnverifiedOrderClaims,
  addUnsyncedDataWarning,
  hasUnsyncedDataRisk,
};
