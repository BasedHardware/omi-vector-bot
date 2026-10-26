const { recordStage } = require('./answerStageEvidence');
const { getRemovalAudit, mergeRemovalAudits } = require('./answerFilterAudit');
const router = require('./router');
const { reviewRejectionReply } = require('./supportReplyCopy');

function approvedReview(result) {
  const audit = getRemovalAudit(result);
  return Boolean(!audit.truncated && !audit.removed.length && result?.grounded && result?.relevant && String(result?.final_answer || '').trim());
}

function safeHandoffReview(result) {
  const audit = getRemovalAudit(result);
  return Boolean(result?.safeHandoff && !audit.removed.length && !audit.truncated);
}

// Shared selection only. Presentation, protected/planned actions, privacy,
// dispatch and application-confirmed receipt copy remain in their actual owners.
function selectReviewedAnswer({ agent = {}, checked, route = {}, question = '', language = 'en' }) {
  const approved = approvedReview(checked);
  const selected = {
    ...agent,
    final_answer: approved || safeHandoffReview(checked)
      ? checked.final_answer : reviewRejectionReply(language, question),
    confidence: Math.min(Number(agent.confidence) || 0.4, Number(checked?.confidence) || 0.4),
  };
  if (checked?.escalate || !approved) {
    selected.escalate = true;
    selected.reason = selected.reason || (checked?.relevant
      ? 'The answer was not fully supported by official pages.'
      : 'The drafted reply did not answer the customer question.');
  } else if (route.lane === 'faq' && !route.wantHuman && !route.escalate &&
      (router.looksLikeDocs(question) || router.looksLikeRecordingHow(question) || router.looksLikeDeviceReset(question))) {
    selected.escalate = false;
  }
  return { approved, agent: selected };
}

async function reviewWithSecondLook(args, { review, log = console.log } = {}) {
  const first = await review(args);
  recordStage('review_returned', first?.final_answer);
  const firstAudit = getRemovalAudit(first);
  if (approvedReview(first) || safeHandoffReview(first)) return first;

  let approved = false;
  try {
    const audit = mergeRemovalAudits({ removed: args.removedBySafetyFilters, truncated: args.safetyAuditTruncated }, firstAudit);
    const auditArgs = audit.removed.length || audit.truncated
      ? { removedBySafetyFilters: audit.removed, safetyAuditTruncated: audit.truncated } : {};
    const second = await review({ ...args, ...auditArgs, reasoningEffort: null });
    recordStage('review_returned', second?.final_answer);
    approved = approvedReview(second);
    return approved ? second : first;
  } finally {
    log(`[Review] second look approved=${approved}`);
  }
}

module.exports = { approvedReview, reviewWithSecondLook, selectReviewedAnswer };
