const LIE_PATTERNS = [
  /i('ve| have) (already )?(spoken|talked|reached out|messaged|emailed|pinged|informed|notified|escalated)/i,
  /conveyed your (message|issue|problem)/i,
  /higher[- ]ups/i,
  /the (upper )?team has been (notified|informed)/i,
  /i (will|I'll) (make sure|ensure) (the team|staff|someone)/i,
  /ticket has been (created|opened|filed)/i,
  /i (just )?contacted (support|staff|aarav|the team)/i,
  /passing this along/i,
  /passed this along/i,
  /someone will follow up/i,
];

const DROP_SENTENCE = [
  /\bcheckout\b/i,
  /confirmation email/i,
  /email address you used/i,
  /email you used/i,
  /repeating the question/i,
  /nothing new i can add/i,
  /nothing now i can add/i,
  /nothing in what i can access has changed/i,
  /has changed since your last (message|question)/i,
  /won'?t change what i (have|can) access/i,
  /won'?t change what i have access to/i,
  /--legacy-peer-deps/i,
  /retry this command with --force/i,
];

function looksLikeStaffLie(text) {
  if (!text) return false;
  return LIE_PATTERNS.some((re) => re.test(text));
}

function looksLikeInventedLookup(text) {
  return DROP_SENTENCE.some((re) => re.test(String(text || '')));
}

function stripInventedLookup(text) {
  const cleaned = String(text || '')
    .split('\n')
    .map((line) => {
      if (!looksLikeInventedLookup(line)) return line;
      return line
        .split(/(?<=[.!?])\s+|\s+[—–]\s+/)
        .filter((sentence) => !looksLikeInventedLookup(sentence))
        .join(' ');
    })
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\bin plain words\b/gi, '')
    .replace(/[^\S\n]{2,}/g, ' ')
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

const HOWTO_BLEED = [
  /\bbluetooth\b/i,
  /\bre-?pair/i,
  /\bpair(ing)? (it|the|from|with|your|again)\b/i,
  /\bunpair\b/i,
  /center button/i,
  /swiped away/i,
  /keep the (omi )?app open/i,
  /app is open on your phone/i,
];

function looksLikeHowtoBleed(text) {
  return HOWTO_BLEED.some((re) => re.test(String(text || '')));
}

function stripHowtoBleed(text, lane) {
  const raw = String(text || '');
  if (lane === 'faq') return raw;
  const cleaned = raw
    .split('\n')
    .map((line) => {
      if (!looksLikeHowtoBleed(line)) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !looksLikeHowtoBleed(sentence))
        .join(' ');
    })
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (cleaned) return cleaned;
  return "I can't see the app or the device from here, so I won't guess a fix.";
}

const SHOP_BLEED = [
  /keep your order number/i,
  /keep (the|your) order number if you have one/i,
  /\border number if you have one\b/i,
];

function looksLikeShopBleed(text) {
  return SHOP_BLEED.some((re) => re.test(String(text || '')));
}

function stripShopBleed(text, lane) {
  const raw = String(text || '');
  if (lane === 'shop' || lane === 'money') return raw;
  const cleaned = raw
    .replace(/\s*,?\s*and keep your order number if you have one\.?/gi, '.')
    .replace(/\s*keep your order number if you have one\.?/gi, '')
    .split('\n')
    .map((line) => {
      if (!looksLikeShopBleed(line)) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !looksLikeShopBleed(sentence))
        .join(' ');
    })
    .map((line) => line.replace(/\s{2,}/g, ' ').replace(/\s+\./g, '.').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return cleaned || raw;
}

module.exports = {
  looksLikeStaffLie,
  stripStaffLies,
  stripInventedLookup,
  looksLikeInventedLookup,
  stripHowtoBleed,
  stripShopBleed,
};
