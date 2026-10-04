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
  const syncFailed = /\bsync(?:ing)?\b.{0,45}\b(?:stuck|stall\w*|fail\w*|not\s+(?:working|complet\w*|finish\w*))\b|\b(?:stuck|stall\w*|fail\w*)\b.{0,45}\bsync(?:ing)?\b/i.test(context);
  const missingRecordings = /\b(?:recordings?|conversations?|transcripts?|memories?)\b.{0,45}\b(?:missing|gone|lost|disappear\w*)\b|\b(?:missing|gone|lost|disappear\w*)\b.{0,45}\b(?:recordings?|conversations?|transcripts?|memories?)\b/i.test(context);
  const current = String(answer || '').trim();
  if (!syncFailed && !missingRecordings) return current;
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
  prepareDraftForReview,
  prepareDraftForReviewWithAudit,
  presentReviewedAnswer,
  addUnsyncedDataWarning,
};
