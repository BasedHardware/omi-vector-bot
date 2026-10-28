const { recordStage } = require('./answerStageEvidence');
const { getRemovalAudit, mergeRemovalAudits } = require('./answerFilterAudit');

function approvedReview(result) {
  const audit = getRemovalAudit(result);
  return Boolean(!audit.truncated && !audit.removed.length && result?.grounded && result?.relevant && String(result?.final_answer || '').trim());
}

async function reviewWithSecondLook(args, { review, log = console.log } = {}) {
  const first = await review(args);
  recordStage('review_returned', first?.final_answer);
  const firstAudit = getRemovalAudit(first);
  if (approvedReview(first) || (first?.safeHandoff && !firstAudit.removed.length && !firstAudit.truncated)) return first;

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

module.exports = { approvedReview, reviewWithSecondLook };
