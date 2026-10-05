function approvedReview(result) {
  return Boolean(result?.grounded && result?.relevant && String(result?.final_answer || '').trim());
}

async function reviewWithSecondLook(args, { review, log = console.log } = {}) {
  const first = await review(args);
  if (approvedReview(first) || first?.safeHandoff) return first;

  let approved = false;
  try {
    const second = await review({ ...args, reasoningEffort: null });
    approved = approvedReview(second);
    return approved ? second : first;
  } finally {
    log(`[Review] second look approved=${approved}`);
  }
}

module.exports = { approvedReview, reviewWithSecondLook };
