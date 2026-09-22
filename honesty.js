const LIE_PATTERNS = [
  /i('ve| have) (already )?(spoken|talked|reached out|messaged|emailed|pinged|informed|notified|escalated)/i,
  /conveyed your (message|issue|problem)/i,
  /higher[- ]ups/i,
  /the (upper )?team has been (notified|informed)/i,
  /i (will|I'll) (make sure|ensure) (the team|staff|someone)/i,
  /ticket has been (created|opened|filed)/i,
  /i (just )?contacted (support|staff|aarav|the team)/i,
  /passing this along/i,
  /passing it along/i,
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
  const cleaned = String(text)
    .split('\n')
    .flatMap((line) => {
      if (!line.trim()) return [line];
      if (!looksLikeStaffLie(line)) return [line];
      const kept = line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !looksLikeStaffLie(sentence))
        .join(' ')
        .trim();
      return kept ? [kept] : [];
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned || looksLikeStaffLie(cleaned)) {
    return 'I do not have a human on this yet. I have not messaged anyone. A person on the team needs to take this.';
  }
  return cleaned;
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

const SHOP_DEVICE_BLEED = [
  /\bon the necklace\b/i,
  /\bblue light\b/i,
  /\bteal led\b/i,
  /\brecordings? from today\b/i,
  /\bapp says disconnected\b/i,
  /\bapp saying disconnected\b/i,
  /\biphone app\b/i,
];

function looksLikeHowtoBleed(text) {
  return HOWTO_BLEED.some((re) => re.test(String(text || '')));
}

function looksLikeShopDeviceBleed(text) {
  return SHOP_DEVICE_BLEED.some((re) => re.test(String(text || '')));
}

function stripHowtoBleed(text, lane) {
  const raw = String(text || '');
  if (lane === 'faq') return raw;
  const shopLane = lane === 'shop' || lane === 'money';
  const cleaned = raw
    .split('\n')
    .map((line) => {
      const drop = looksLikeHowtoBleed(line) || (shopLane && looksLikeShopDeviceBleed(line));
      if (!drop) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          if (looksLikeHowtoBleed(sentence)) return false;
          if (shopLane && looksLikeShopDeviceBleed(sentence)) return false;
          return true;
        })
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

function askedWhereRecordingsWent(question) {
  const s = String(question || '');
  return (
    /\b(recordings?|clips?).{0,60}\b(gone|deleted|lost|missing|disappeared)\b/i.test(s) ||
    /\b(where|what happened to).{0,40}\b(recordings?|clips?)\b/i.test(s) ||
    /\b(delete|deleted|gone|lost).{0,40}\b(recordings?|clips?)\b/i.test(s)
  );
}

const CAUSE_CLAIM = [/\bapp-side\b/i, /\bfirmware bug\b/i, /\bknown cause\b/i, /\bapp bug\b/i];

const RECORDINGS_PLACE = [
  /\bwatch or phone\b/i,
  /\brecordings?.{0,50}\b(on|in) the (watch|phone)\b/i,
  /\b(on|in) the (watch|phone).{0,50}\brecordings?\b/i,
];

function sentenceKeepsLightFact(sentence) {
  return (
    /\bapp bug\b/i.test(sentence) &&
    /\b(blue|red|teal|orange)\b/i.test(sentence) &&
    /\b(light|led|dot)\b/i.test(sentence)
  );
}

function looksLikeCauseClaim(sentence) {
  if (sentenceKeepsLightFact(sentence)) return false;
  return CAUSE_CLAIM.some((re) => re.test(String(sentence || '')));
}

function looksLikeRecordingsPlace(sentence) {
  return RECORDINGS_PLACE.some((re) => re.test(String(sentence || '')));
}

function stripUnsupportedClaims(text, lane, question) {
  if (!['tech', 'firmware', 'faq'].includes(lane)) return String(text || '');
  const allowPlace = askedWhereRecordingsWent(question);
  const cleaned = String(text || '')
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      const drop =
        looksLikeCauseClaim(line) || (!allowPlace && looksLikeRecordingsPlace(line));
      if (!drop) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          if (looksLikeCauseClaim(sentence)) return false;
          if (!allowPlace && looksLikeRecordingsPlace(sentence)) return false;
          return true;
        })
        .join(' ')
        .trim();
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned) return cleaned;
  return "I can't see the app or the device from here, so I won't guess a fix.";
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
  stripUnsupportedClaims,
  askedWhereRecordingsWent,
};
