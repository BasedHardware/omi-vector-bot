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

module.exports = {
  EMPTY_ANSWER_FALLBACK,
  ensureNonEmptyAnswer,
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
};
