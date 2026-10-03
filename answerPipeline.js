const {
  sanitizeReply,
  stripFalseCertainty,
  stripPingNarration,
  formatDiscordReply,
  clipForDiscord,
} = require('./utils');
const { stripHowtoBleed, stripShopBleed, stripUnsupportedClaims } = require('./honesty');

// Apply the legacy claim filters to the draft, so the source reviewer sees
// exactly what they removed and can restore any supported, relevant details.
// Never run these sentence-deleting filters on the reviewed final answer.
function prepareDraftForReview(answer, lane, question) {
  return stripFalseCertainty(
    stripUnsupportedClaims(
      stripShopBleed(stripHowtoBleed(sanitizeReply(answer), lane), lane),
      lane,
      question
    )
  );
}

function presentReviewedAnswer(answer) {
  // The reviewer has already checked the claims. Only enforce the hard
  // no-false-ping rule and Discord's format/length constraints here.
  return clipForDiscord(formatDiscordReply(stripPingNarration(answer)));
}

module.exports = { prepareDraftForReview, presentReviewedAnswer };
