const {
  sanitizeReply,
  stripFalseCertainty,
  stripPingNarration,
  formatDiscordReply,
  clipForDiscord,
} = require('./utils');
const { stripHowtoBleed, stripShopBleed, stripUnsupportedClaims } = require('./honesty');

const EMPTY_ANSWER_FALLBACK = 'I could not verify a safe answer here. A person needs to check this.';

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

function presentReviewedAnswer(answer) {
  // The reviewer has already checked the claims. Only enforce the hard
  // no-false-ping rule and Discord's format/length constraints here.
  return ensureNonEmptyAnswer(clipForDiscord(formatDiscordReply(stripPingNarration(answer))));
}

function addUnsyncedDataWarning(answer, question) {
  const context = String(question || '');
  const risk = /\boffline\b/i.test(context) &&
    /\b(?:stuck|stall\w*|fail\w*|missing|gone|lost|disappear\w*)\b/i.test(context) &&
    /\b(?:sync\w*|recording\w*|conversation\w*|transcript\w*)\b/i.test(context);
  const current = String(answer || '').trim();
  if (!risk || (/\breinstall\b/i.test(current) && /\blog\s*out\b/i.test(current) && /\bclear\b/i.test(current))) {
    return current;
  }
  const warning = 'While offline recordings may still be unsynced, do not reinstall the app, log out, or clear Pending/All storage; that could erase unsynced recordings.';
  const sourceAt = current.search(/\n(?:Sources?):\s*https:\/\//i);
  const sourceLine = sourceAt < 0 ? '' : current.slice(sourceAt).trim();
  const body = sourceAt < 0 ? current : current.slice(0, sourceAt).trim();
  // Reserve room for the warning, citations and the later Discord handoff footer.
  const bodyBudget = Math.max(200, 1_750 - warning.length - sourceLine.length - 4);
  return [clipForDiscord(body, bodyBudget), warning, sourceLine].filter(Boolean).join('\n\n');
}

module.exports = {
  EMPTY_ANSWER_FALLBACK,
  ensureNonEmptyAnswer,
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  addUnsyncedDataWarning,
};
