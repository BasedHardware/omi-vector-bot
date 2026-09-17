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

const INVENTED_LOOKUP = [
  /\bcheckout\b/i,
  /confirmation email/i,
  /email address you used/i,
  /email you used/i,
];

function looksLikeStaffLie(text) {
  if (!text) return false;
  return LIE_PATTERNS.some((re) => re.test(text));
}

function looksLikeInventedLookup(text) {
  return INVENTED_LOOKUP.some((re) => re.test(String(text || '')));
}

function stripInventedLookup(text) {
  const cleaned = String(text || '')
    .split('\n')
    .map((line) => {
      if (!looksLikeInventedLookup(line)) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !looksLikeInventedLookup(sentence))
        .join(' ');
    })
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return cleaned;
}

function stripStaffLies(text) {
  if (!text) return text;
  const lines = text.split('\n').filter((line) => !looksLikeStaffLie(line));
  const joined = lines.join('\n').trim();
  if (!joined || looksLikeStaffLie(joined)) {
    return 'I do not have a human on this yet. I have not messaged anyone. A person on the team needs to take this.';
  }
  return joined;
}

module.exports = { looksLikeStaffLie, stripStaffLies, stripInventedLookup, looksLikeInventedLookup };
