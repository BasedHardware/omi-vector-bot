const LIE_PATTERNS = [
  /i('ve| have) (already )?(spoken|talked|reached out|messaged|emailed|pinged|informed|notified|escalated)/i,
  /conveyed your (message|issue|problem)/i,
  /higher[- ]ups/i,
  /the (upper )?team has been (notified|informed)/i,
  /i (will|I'll) (make sure|ensure) (the team|staff|someone)/i,
  /ticket has been (created|opened|filed)/i,
  /i (just )?contacted (support|staff|aarav|the team)/i,
  /passing this along/i,
  /someone will follow up/i,
];

function looksLikeStaffLie(text) {
  if (!text) return false;
  return LIE_PATTERNS.some((re) => re.test(text));
}

function stripStaffLies(text) {
  if (!text) return text;
  const lines = text.split('\n').filter((line) => !looksLikeStaffLie(line));
  const joined = lines.join('\n').trim();
  if (!joined || looksLikeStaffLie(joined)) {
    return 'I do not have a human on this yet. I can help with product/how-to questions. For refunds, shipping, or account issues, a person on the team needs to reply — I have not messaged anyone.';
  }
  return joined;
}

module.exports = { looksLikeStaffLie, stripStaffLies };
