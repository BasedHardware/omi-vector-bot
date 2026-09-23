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

// Steps and handoffs the bot cannot know on a tech or firmware ticket.
// Symptom restatements ("powers off", "after you restart", "when you try again") stay.
// HARD steps still drop inside a sentence that also restates something they already did.
const HARD_DEVICE_STEP = [
  /\baccount access\b/i,
  /\bkontozugriff\b/i,
  /\bset (it|the device|the omi|this|that) aside\b/i,
  /\bset aside\b/i,
  /\bbeiseite/i,
  /\b(don'?t|do not|stop)\s+(keep\s+)?turning\b/i,
  /\bnicht (immer wieder|weiter|ständig) ein(schalten)?\b/i,
  /\bschalt(?:e|et|en)?(?:\s+sie)?\s+(?:ihn|es|den(?:\s+omi)?|das(?:\s+ger(?:ä|ae)t)?)\s+nicht\b/i,
  /\blass(?:e|t|en)?(?:\s+sie)?\s+den\s+omi\b/i,
  /\blass(?:e)?\s+ihn\s+(?:aus|in\s+ruhe|liegen|eingesteckt|so|erst(?:mal| einmal))\b/i,
  /\bleg(?:e|t|en)?(?:\s+sie)?\s+(?:den\s+omi|ihn|es)\b/i,
  /\b(?:do not|don['’]?t|never|avoid)\s+(?:keep\s+)?charg(?:e|ing)\b/i,
  /\bbitte\s+nicht\s+(?:mehr\s+|weiter\s+|weiterhin\s+)?(?:auf)?laden\b/i,
  /\bnicht\s+(?:mehr|weiter|weiterhin)\s+(?:auf)?laden\b/i,
  /^(?:bitte\s+)?nicht\s+(?:auf)?laden\b/i,
  /\b(?:ihn|den\s+omi|das\s+ger(?:ä|ae)t)\s+nicht\s+(?:auf)?laden\b/i,
  /\blad(?:e|et)?\s+(?:ihn|es|den(?:\s+omi)?|das(?:\s+ger(?:ä|ae)t)?)\s+nicht\b/i,
  /\b(?:leave|keep|put|take)\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?)\s+(?:on|off)\s+the\s+charger\b/i,
  /\bkeep\s+charg(?:e|ing)\b/i,
  /\blet\s+it\s+sit\b/i,
  /\b(?:please\s+|just\s+)?(?:leave|keep)\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?)\s+plugged\s+in\b/i,
  /\b(?:please\s+|just\s+)?(?:leave|keep)\s+(?:it|the\s+(?:device|omi|necklace)|your\s+(?:device|omi|necklace))\s+(?:off|alone)\b/i,
  /\beingesteckt\s+lassen\b/i,
  /^(?:please\s+|just\s+)?charge\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?)\b/i,
];

const DEVICE_STEP = [
  /\b(restart|reboot|reinstall|reset|unpair)(ing)?\b/i,
  /\b(neu starten|zurücksetzen|neu installieren|entkoppeln)\b/i,
  /\bpower\s+cycle\b/i,
  /^(?:please\s+|just\s+|try\s+(?:to\s+)?)?power\s+(?:it|the|your|this|that)\b/i,
  /\b(?:don'?t|do not|stop|avoid|try(?:\s+to)?|please|just)\s+power(?:ing)?\b/i,
  /\btry(?:\s+(?:it|that|this))?\s+again\b/i,
  /\bversuch(?:e|t|en)?(?:\s+sie)?\s+es\s+(?:noch\s*mal|nochmal|erneut|noch einmal|wieder)\b/i,
  /\bnoch(?:\s*mal|mal| einmal)\s+versuchen\b/i,
  /\b(?:turn|switch|turning)\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?|this|that)\s+off\b/i,
  /\bturning\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?)\s+on\b/i,
  /\b(?:schalt|mach)(?:e|et|en)?(?:\s+sie)?\s+(?:ihn|es|den(?:\s+omi)?)\s+aus\s+und\s+(?:wieder\s+)?(?:ein|an)\b/i,
  /\baus-\s*und\s+(?:wieder\s+)?einschalten\b/i,
  /\b(?:unplug|plug)\s+(?:it|the(?:\s+\w+)?|your(?:\s+\w+)?|this|that)\b/i,
];

const ALREADY_DID_STEP = [
  /\b(after you|when you)\s+(restart|reset|unpair|reinstall|power)/i,
  /\balready\s+(restarted|reset|unpaired|reinstalled|powered)\b/i,
  /\b(you|they|i)\s+(restarted|reset|unpaired|reinstalled|powered)\b/i,
  /\b(?:after|when)\s+you\s+try(?:\s+(?:it|that|this))?\s+again\b/i,
  /\b(?:after|when)\s+you\s+(?:turn|switch)\b/i,
  /\bafter\s+turning\b/i,
  /\bwhen\s+you\s+(?:keep\s+)?turning\b/i,
  /\b(?:after|when)\s+you\s+(?:un)?plug\b/i,
];

function sentenceIsRealLightFact(sentence) {
  const s = String(sentence || '');
  if (sentenceKeepsLightFact(s)) return true;
  return (
    /\b(blue|red|teal|orange)\b/i.test(s) &&
    /\b(light|led|dot)\b/i.test(s) &&
    /\bmeans\b/i.test(s)
  );
}

function matchesAny(patterns, sentence) {
  return patterns.some((re) => re.test(String(sentence || '')));
}

function looksLikeDeviceStep(sentence) {
  const s = String(sentence || '');
  if (sentenceIsRealLightFact(s)) return false;
  if (matchesAny(HARD_DEVICE_STEP, s)) return true;
  if (matchesAny(ALREADY_DID_STEP, s)) return false;
  return matchesAny(DEVICE_STEP, s);
}

function dropDeviceStepClauses(sentence) {
  const parts = String(sentence || '').split(/,\s+|\s+[—–]\s+/);
  if (parts.length < 2) return '';
  return parts
    .filter((part) => {
      const bit = part.trim();
      if (!bit || looksLikeDeviceStep(bit)) return false;
      if (/^(?:bis|until|so that)\b/i.test(bit)) return false;
      return true;
    })
    .join(', ');
}

function lineHasDeviceStep(line) {
  return String(line || '')
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => looksLikeDeviceStep(sentence));
}

function stripUnsupportedClaims(text, lane, question) {
  if (!['tech', 'firmware', 'faq'].includes(lane)) return String(text || '');
  const allowPlace = askedWhereRecordingsWent(question);
  const dropSteps = lane === 'tech' || lane === 'firmware';
  const cleaned = String(text || '')
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      const drop =
        looksLikeCauseClaim(line) ||
        (!allowPlace && looksLikeRecordingsPlace(line)) ||
        (dropSteps && lineHasDeviceStep(line));
      if (!drop) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => {
          if (looksLikeCauseClaim(sentence)) return '';
          if (!allowPlace && looksLikeRecordingsPlace(sentence)) return '';
          if (dropSteps && looksLikeDeviceStep(sentence)) return dropDeviceStepClauses(sentence);
          return sentence;
        })
        .filter(Boolean)
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
