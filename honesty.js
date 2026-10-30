// The same promise in the future tense: "I'll let the team know", "I will flag this to support".
const WILL = "\\bi(?: will|['’]ll| am going to|['’]m going to) (?:also |just |now |go ahead and )?";
const TEAM = '(?:the |our |a |an )?(?:omi )?(?:team|staff|support|engineers?|developers?|devs|person|human|someone)\\b';

const LIE_PATTERNS = [
  /i(['’]ve| have) (already )?(spoken|talked|reached out|messaged|emailed|pinged|informed|notified|escalated)/i,
  new RegExp(`${WILL}(?:let|tell|notify|inform|ping|alert|message|email|contact) ${TEAM}`, 'i'),
  new RegExp(
    `${WILL}(?:flag|forward|escalate|pass|send|raise|report|hand) (?:this|it|that|(?:your|the) \\w+)(?: (?:on|along|over|up))? (?:to|with|for) ${TEAM}`,
    'i'
  ),
  new RegExp(`${WILL}escalate\\b`, 'i'),
  /conveyed your (message|issue|problem)/i,
  /higher[- ]ups/i,
  /the (upper )?team has been (notified|informed)/i,
  /\bi(?: will|['’]ll) (make sure|ensure) (the team|staff|someone)/i,
  /ticket has been (created|opened|filed)/i,
  /i (just )?contacted (support|staff|aarav|the team)/i,
  /passing this along/i,
  /passing it along/i,
  /passed this along/i,
  /someone will follow up/i,
  new RegExp(`\\bi(?:['’]ve| have| had)?\\s+(?:(?:just|already|now)\\s+)?(?:flagged|forwarded|sent|raised|reported|handed|passed|filed)\\s+(?:this|it|that|(?:your|the)\\s+[\\w -]+?)(?:\\s+(?:on|along|over|up))?\\s+(?:to|with|for)\\s+${TEAM}`, 'i'),
];

const DROP_SENTENCE = [
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
  return LIE_PATTERNS.some((re) => re.test(String(text).replace(/[*_~`]/g, '')));
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

function looksLikeHowtoInstruction(text) {
  const s = String(text || '');
  if (!looksLikeHowtoBleed(s)) return false;
  return /\b(make sure|needs to|stay open|turn |keep |try |pair (it|the|from|with|your|again)|unpair|swipe|swiped|don't|do not)\b/i.test(
    s
  );
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
      const drop = looksLikeHowtoInstruction(line) || (shopLane && looksLikeShopDeviceBleed(line));
      if (!drop) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => {
          if (looksLikeHowtoInstruction(sentence)) return false;
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
    /\b(delete|deleted|remove|removed|clear|cleared|erase|erased|gone|lost).{0,40}\b(recordings?|clips?)\b/i.test(
      s
    ) ||
    (/\b(?:delete|remove|clear|erase)\w*\b/i.test(s) &&
      /\b(?:phone|local|device)\b/i.test(s) &&
      /\b(?:conversation|transcript|recording|clip)s?\b/i.test(s))
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

// Fixes the model invents on tech, firmware, and faq. The bot cannot see the app,
// the phone, or the device, so these sentences are dropped.
const INVENTED_FIX = [
  /\bre-?install(?:ing)?\s+(?:the\s+|your\s+)?app\b/i,
  /\bclear(?:ing)?\s+(?:(?:the|your)\s+app(?:'s)?\s+|(?:the|your|its|app)\s+)?cache\b/i,
  /\btoggle\s+(?:your\s+|the\s+)?bluetooth\b/i,
  /\brestart(?:ing)?\s+(?:your\s+|the\s+)?phone\b/i,
  /\bupdat(?:e|ing)\s+(?:the\s+|your\s+)?app\b/i,
  /\bcheck(?:ing)?\s+(?:your\s+|the\s+)?wi-?fi\b/i,
  /\bprobably\s+(?:just\s+)?(?:the\s+|a\s+|your\s+)?battery\b/i,
  /\btry(?:ing)?\s+(?:using\s+|with\s+)?a\s+different\s+cable\b/i,
  /\breinstale\b/i,
  /\blimpe\s+o\s+cache\b/i,
  /\breinstala\b/i,
  /\bborra\s+la\s+cach(?:e\b|é)/i,
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

function isKeptSymptom(bit) {
  const s = String(bit || '');
  if (matchesAny(ALREADY_DID_STEP, s)) return true;
  if (/\b(?:after|when)\s+you\s+(?:re-?install|clear|toggle|update|check|restart|try)\b/i.test(s)) return true;
  if (/\btried\s+a different cable\b/i.test(s)) return true;
  return false;
}

function clauseIsInventedFix(bit) {
  const s = String(bit || '').trim();
  if (!s || isKeptSymptom(s)) return false;
  return matchesAny(INVENTED_FIX, s);
}

function looksLikeInventedFix(sentence) {
  return String(sentence || '')
    .split(/,\s+|\s+[—–]\s+/)
    .some((part) => clauseIsInventedFix(part));
}

function lineHasInventedFix(line) {
  return String(line || '')
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => looksLikeInventedFix(sentence));
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
  const kept = parts
    .filter((part) => {
      const bit = part.trim();
      if (!bit || looksLikeDeviceStep(bit) || clauseIsInventedFix(bit)) return false;
      if (/^(?:bis|until|so that)\b/i.test(bit)) return false;
      return true;
    })
    .join(', ');
  return kept
    .replace(/^(?:and|then|but)\s+/i, '')
    .replace(/^(\p{Ll})/u, (letter) => letter.toLocaleUpperCase());
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
      const dropAccount = lane === 'faq' && /\b(account access|someone with account)\b/i.test(line);
      const drop =
        looksLikeCauseClaim(line) ||
        (!allowPlace && looksLikeRecordingsPlace(line)) ||
        lineHasInventedFix(line) ||
        dropAccount ||
        (dropSteps && lineHasDeviceStep(line));
      if (!drop) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => {
          if (looksLikeCauseClaim(sentence)) return '';
          if (!allowPlace && looksLikeRecordingsPlace(sentence)) return '';
          if (looksLikeInventedFix(sentence)) {
            const peeled = dropDeviceStepClauses(sentence);
            if (peeled) return peeled;
            if (sentenceIsRealLightFact(sentence) || sentenceKeepsLightFact(sentence)) return sentence;
            return '';
          }
          if (dropSteps && looksLikeDeviceStep(sentence)) return dropDeviceStepClauses(sentence);
          if (lane === 'faq' && /\b(account access|someone with account)\b/i.test(sentence)) return '';
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


// Public replies have no authoritative refund/replacement outcome facts.
// The private order lookup proves neither an approval nor a promised date.
// Never accept a model field or the unrelated verifiedLookup boolean as proof.
const FINANCIAL_SUBJECT = /refund[\p{L}\p{M}]*|reimburs[\p{L}\p{M}]*|replacement[\p{L}\p{M}]*|returns?|credits?|warranty\s+claims?|rückerstatt[\p{L}\p{M}]*|erstatt[\p{L}\p{M}]*|gutschrift[\p{L}\p{M}]*|ersatz(?:gerät|lieferung)?[\p{L}\p{M}]*|rückgabe[\p{L}\p{M}]*|garantie(?:antrag|anspruch)[\p{L}\p{M}]*|remboursement[\p{L}\p{M}]*|remplacement[\p{L}\p{M}]*|retours?|avoirs?|demande\s+de\s+garantie|reembolso[\p{L}\p{M}]*|reemplazo[\p{L}\p{M}]*|devoluci[oó]n[\p{L}\p{M}]*|cr[eé]dito[\p{L}\p{M}]*|reclama(?:ci[oó]n|[cç][aã]o)\s+de\s+garant[ií]a|substitui[cç][aã]o|devolu[cç][aã]o|rimborso|sostituzione|reso|credito|garanzia|iade[\p{L}\p{M}]*|değişim[\p{L}\p{M}]*|kredi[\p{L}\p{M}]*|garanti\s+taleb[\p{L}\p{M}]*|pengembalian\s+dana|penggantian|retur|kredit|klaim\s+garansi|退款|退货|退貨|换货|換貨|替换|替換|保修申请|返金|返品|交換|保証請求|환불|교환|반품|보증\s*청구|возврат[\p{L}\p{M}]*|возмещение[\p{L}\p{M}]*|замен[\p{L}\p{M}]*|кредит[\p{L}\p{M}]*|гарантийн[\p{L}\p{M}]*\s+заявк[\p{L}\p{M}]*|रिफंड|धनवापसी|प्रतिस्थापन|वापसी|क्रेडिट|वारंटी|refund|replacement|vaapsi|wapsi/iu;
const FINANCIAL_OUTCOME = /(?<![\p{L}\p{M}])(?:approv(?:ed|ing)|issu(?:ed|ing)|process(?:ed|ing)|schedul[\p{L}\p{M}]*|authori[sz][\p{L}\p{M}]*|grant(?:ed|ing)|accept(?:ed|ing)|paid|refunded|dispatch[\p{L}\p{M}]*|shipp[\p{L}\p{M}]*|arriv[\p{L}\p{M}]*|deliver[\p{L}\p{M}]*|receiv[\p{L}\p{M}]*|credited|confirmed|complete|completed|sent|successful|on\s+(?:its|the)\s+way|in\s+transit|genehmigt|bestätigt|abgeschlossen|bewilligt|ausgestellt|bearbeitet|verarbeitet|geplant|unterwegs|angekommen|approuv[\p{L}\p{M}]*|confirmé[\p{L}\p{M}]*|effectué[\p{L}\p{M}]*|[eé]mis[\p{L}\p{M}]*|trait[eé][\p{L}\p{M}]*|programm[eé][\p{L}\p{M}]*|en\s+route|arriver[\p{L}\p{M}]*|aprob[\p{L}\p{M}]*|confirmad[\p{L}\p{M}]*|completad[\p{L}\p{M}]*|emitid[\p{L}\p{M}]*|procesad[\p{L}\p{M}]*|programad[\p{L}\p{M}]*|en\s+camino|llegar[\p{L}\p{M}]*|aprovad[\p{L}\p{M}]*|processad[\p{L}\p{M}]*|agendad[\p{L}\p{M}]*|a\s+caminho|chegar[\p{L}\p{M}]*|approvat[\p{L}\p{M}]*|emess[\p{L}\p{M}]*|elaborat[\p{L}\p{M}]*|programmat[\p{L}\p{M}]*|in\s+arrivo|onayland[\p{L}\p{M}]*|düzenlend[\p{L}\p{M}]*|işlend[\p{L}\p{M}]*|planland[\p{L}\p{M}]*|yolda|disetujui|diterbitkan|diproses|dijadwalkan|dikirim|akan\s+tiba|выпущен[\p{L}\p{M}]*|одобрен[\p{L}\p{M}]*|обработан[\p{L}\p{M}]*|запланирован[\p{L}\p{M}]*|отправлен[\p{L}\p{M}]*|в\s+пути|прибуд[\p{L}\p{M}]*|approve|issue|process|schedule)(?![\p{L}\p{M}])|退款成功|退貨成功|退货成功|返金完了|환불\s*완료|已?(?:获|獲)?(?:批准|核准|发放|發放|处理|處理|安排|寄出|発送)|(?:将|將)会?(?:到账|到賬|到达|到達)|承認(?:され|済)|発行(?:され|済)|処理(?:され|済)|予定(?:され|です)|発送(?:され|済)|届きます|승인(?:되|됐)|처리(?:되|됐)|발급(?:되|됐)|예정|배송\s*중|도착할|स्वीकृत|जारी|संसाधित|प्रक्रिया\s*में|निर्धारित|रास्ते\s*में|पहुंचेगा|हो\s*गया/iu;
const FINANCIAL_UNCERTAINTY = /^(?:[-*•]\s*)?(?:I\s+(?:cannot|can['’]t|could\s+not|can\s+not|do\s+not|don['’]t|am\s+not|['’]m\s+not)\s+(?:confirm|verify|know|guarantee|promise|sure|approve|issue|process|schedule|authorize|refund)|we\s+(?:cannot|can['’]t|do\s+not)\s+(?:confirm|verify|guarantee|promise|approve|issue|process|schedule|authorize|refund)|ich\s+kann\b.*\bnicht\s+(?:bestätigen|garantieren)|je\b.*\b(?:ne|n['’])[^.!?]*\b(?:confirmer|garantir)|no\s+(?:puedo|podemos)\s+(?:confirmar|garantizar)|n[aã]o\s+(?:posso|podemos)\s+(?:confirmar|garantir)|non\s+posso\s+(?:confermare|garantire)|(?:bunu\s+)?doğrulayam|saya\s+(?:tidak|belum)\s+(?:dapat|bisa)\s+(?:memastikan|mengonfirmasi)|я\s+не\s+могу\s+(?:подтвердить|гарантировать)|我(?:无法|無法|不能|不能夠)确认|確認できません|확인할\s*수\s*없|मैं\s+.*(?:पुष्टि|गारंटी).*नहीं|main\s+.*(?:confirm|guarantee).*nahi)/iu;
const GENERIC_FINANCIAL_POLICY = /^(?:[-*•]\s*)?(?:refunds|reimbursements|returns|replacements|credits|warranty\s+claims|rückerstattungen|erstattungen|gutschriften|rückgaben|remboursements|remplacements|retours|reembolsos|reemplazos|devoluciones|cr[eé]ditos|rimborsi|sostituzioni|iadeler|pengembalian\s+dana)\b/iu;
const POLICY_CONDITION = /\b(?:after|once|only|typically|usually|generally|policy|review|nach|erst|prüf|après|uniquement|examen|después|solo|revisi[oó]n|ap[oó]s|somente|an[aá]lise|dopo|solo|inceleme|sonra|setelah|peninjauan)\b/iu;
const CASE_POSSESSION = /\b(?:your|this|our|dein[\p{L}\p{M}]*|ihr[\p{L}\p{M}]*|votre|ton|ta|vos|tus?|su|seu|sua|tuo|tua|sizin|anda|ваш[\p{L}\p{M}]*|твой[\p{L}\p{M}]*|aapka|tumhara)\b|您的?|你的?|お客様|あなた|고객|귀하|आपका|आपकी/iu;
const ANAPHOR = /\b(?:it|they|this|that|es|sie|das|il|elle|cela|esto|eso|ele|ela|isso|questo|bunun|ini|itu|он|она|это|это|यह|yeh)\b/iu;

function stripUnverifiedOutcomeClaims(answer, { question = '', financialContext = false } = {}) {
  const { SOURCE_LABEL_NAME, SOURCE_LABEL_SEPARATOR }=require('./supportSteps');
  const sourceLine=new RegExp(`^\\s*${SOURCE_LABEL_NAME}\\s*${SOURCE_LABEL_SEPARATOR}`,'iu');
  let pending=financialContext===true || FINANCIAL_SUBJECT.test(String(question));
  let changed=false;
  const urls=[];
  const text=String(answer||'').replace(/[\uE110\uE111]/g,'')
    .replace(/https?:\/\/[^\s<>]+/giu,url=>`\uE110${urls.push(url)-1}\uE111`);
  const result=text.split('\n').map(line=>{
    if(sourceLine.test(line) && !line.replace(sourceLine,'').replace(/\uE110\d+\uE111|[\s,<>]/g,''))return line;
    const kept=[];
    for(const unit of line.split(/(?<=[.!?。！？।])\s+|(?<=[。！？।])/u)) {
      const shown=unit.normalize('NFKC').replace(/\u0130/g,'i').replace(/[*_~`]/g,'').trim();
      const mention=FINANCIAL_SUBJECT.exec(shown);
      // "returns" in a code description is a verb, not a customer return.
      const technicalReturn=/^(?:(?:(?:the|this|a)\s+)?(?:function|method|handler|query)\s+returns?|return)\s+(?:the|a)\s+(?:processed\s+)?(?:transcript|value|result|object|response)[.!]?$/iu.test(shown);
      const subject=Boolean(mention) && !technicalReturn;
      const outcome=FINANCIAL_OUTCOME.test(shown);
      const count=[...shown.matchAll(new RegExp(FINANCIAL_OUTCOME.source,'giu'))].length;
      const claim=outcome && !technicalReturn && (subject || pending);
      const before=mention?shown.slice(0,mention.index).trim():'';
      // Exempt only a single uncertainty/prerequisite, not a prefix that can
      // authorize an affirmative clause later in the same sentence.
      const uncertainty=Boolean(mention) && FINANCIAL_UNCERTAINTY.test(shown) && count<=1 && !/[,;:，；：]|\b(?:and|but|which|because|since|as|et|y|und|mais|pero|aber|car|parce|porque|denn|weil)\b/iu.test(shown) &&
        !/[,;:，；：]|\b(?:and|but|et|y|und|mais|pero|aber|date|datum|fecha|data|because|since|car|parce|porque|denn|weil)\b/iu.test(before);
      const leadingCondition=shown.match(/^(?:if|when|falls|wenn|si|se|eğer|jika|only\s+after|after)\b[^,]{1,240},\s*/iu);
      const hypothetical=Boolean(leadingCondition) && !/[;；]/u.test(leadingCondition[0]) && !(/^(?:only\s+after|after|when)\b/iu.test(shown) && /\b(?:was|were|has|had|wurde|wurden|a\s+été|ha\s+sido)\b/iu.test(leadingCondition[0])) && !FINANCIAL_OUTCOME.test(shown.slice(leadingCondition[0].length));
      const custodyCondition=shown.match(/^(?:do\s+not|don['’]t|never|avoid)\b[^.!?]{0,160}\b(?:until|unless|before)\b/iu);
      const protective=Boolean(custodyCondition) && count===1 && !/[;；]/u.test(shown) && !FINANCIAL_OUTCOME.test(custodyCondition[0]);
      const prospective=/^(?:your|the)\s+(?:refund|replacement|return|credit|warranty claim)\s+(?:must|needs? to|has to|can only)\s+(?:first )?be approved(?: by the team)?(?: first)?[.!]?$/iu.test(shown);
      const requiredAction=/^(?:a person|the team|staff) (?:needs? to|must|has to) (?:review|process|approve|issue) your (?:refund|replacement|return|credit|warranty claim)(?: request)?[.!]?$/iu.test(shown);
      const attributed=/^you reported seeing an? ['‘’"“”](?:approved|issued|processed)['‘’"“”] label for your (?:refund|return|replacement|credit)(?:; a person needs to verify that status)?[.!]?$/iu.test(shown);
      const generic=GENERIC_FINANCIAL_POLICY.test(shown) && count===1 && !CASE_POSSESSION.test(shown) && !/[,;；]|\b(?:and|but|et|und|y|mais|pero|aber)\b/iu.test(shown) &&
        !/\b(?:have\s+been|were|will\s+be|already|today|tomorrow|gestern|heute|demain|mañana)\b/iu.test(shown) &&
        (POLICY_CONDITION.test(shown) || /^returns\s+are\s+accepted\b/iu.test(shown) || /^refunds\s+are\s+processed\s+to\s+(?:the\s+)?original\s+payment\s+method[.!]?$/iu.test(shown));
      const statusQuestion=/^(?:has|have|is|was|were|ist|wurde)\b[^;；]*[?？]$/iu.test(shown) && count===1;
      if(claim && !uncertainty && !hypothetical && !protective && !prospective && !attributed && !generic && !statusQuestion && !requiredAction) {
        pending=true;changed=true;
        const links=unit.match(/\uE110\d+\uE111/g)||[];
        if(links.length)kept.push('Source: '+links.join(' '));
        continue;
      }
      pending ||= subject;
      kept.push(unit);
    }
    return kept.join(' ').trim();
  }).filter(Boolean).join('\n').trim();
  if(!changed)return String(answer||'').trim();
  return result.replace(/\uE110(\d+)\uE111/g,(_,index)=>urls[Number(index)]);
}

module.exports = {
  stripUnverifiedOutcomeClaims,
  looksLikeStaffLie,
  stripStaffLies,
  stripInventedLookup,
  looksLikeInventedLookup,
  stripHowtoBleed,
  stripShopBleed,
  stripUnsupportedClaims,
  askedWhereRecordingsWent,
};
