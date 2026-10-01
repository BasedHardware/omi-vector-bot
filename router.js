const AREAS = ['shop', 'app', 'desktop', 'firmware', 'privacy', 'unknown'];

// Refunds and charges always beat a product bug. "billing reasons" in a
// desktop 402 report is not a Shopify refund.
const STRONG_MONEY = [
  /\brefunds?\b/i,
  /\bcharged\b/i,
  /\binvoice\b/i,
  /\btax(es)?\b/i,
  /\bduties\b/i,
  /\bwrong address\b/i,
  /\bchange (my )?(the )?(shipping )?address\b/i,
  /\bcancel (my )?(the )?(order|purchase)\b/i,
  /\bsubscription\b/i,
  /\bredemption code\b/i,
  /\bunlimited yearly\b/i,
  /\bplus plan\b/i,
  /\bno active plan\b/i,
  /\bstuck on free\b/i,
  /\bdowngraded to free\b/i,
  /\bbilling bug\b/i,
];

const WEAK_MONEY = [
  /\bmy billing\b/i,
  /\bbilling (issue|question|problem|for|bug)\b/i,
  /\bapp\/billing\b/i,
  /\bpayment\b/i,
];

const PRIVACY = [/\bprivacy\b/i, /\bgdpr\b/i, /\bdelete my (account|data)\b/i];

// Where-is-it, status, tracking, shipping, and customs stay above firmware.
// A bare order number stays below firmware, desktop, and app.
// "got my order" / "received my order" is not a lookup.
const STRONG_SHOP = [
  /\bwhere\s+is\s+my\s+order\b/i,
  /\border\s*status\b/i,
  /\bstatus\s+of\s+(?:my\s+|the\s+)?order\b/i,
  /\btracking\b/i,
  /\bshipping\b/i,
  /\bcustoms\b/i,
  /\bexpress delivery\b/i,
  /\bstill in ["']?preparing\b/i,
  /\B#\d{3,}\b[^\n]{0,48}\b(?:never|not|hasn'?t|has not)\s+arrived\b/i,
  /\b(?:never|not|hasn'?t|has not)\s+arrived\b[^\n]{0,48}\B#\d{3,}\b/i,
];

const WEAK_SHOP = [/\border\s*(#|number|id|num)\b/i, /\border\s*no\.?\s*#?\d{3,}/i];

const SHOP = [...STRONG_SHOP, ...WEAK_SHOP];

const FIRMWARE = [
  /\bfirmware\b/i,
  /\brma\b/i,
  /\bwarehouse\b/i,
  /\bserial( number)?\b/i,
  /\breplacement (device|unit|omi)\b/i,
  /powers? off (by itself|after)/i,
  /dies? seconds after/i,
  /turns? off .+ (100\s*%|battery)/i,
  /turning itself off/i,
  /turns? itself off/i,
  /keeps turning (itself )?off/i,
  /shuts? (itself )?off after/i,
  /\bnot charging\b/i,
  /\bwon'?t charge\b/i,
  /\bcharger\b/i,
];

const DESKTOP = [
  /\bmac\s?os\b/i,
  /\bmacos\b/i,
  /(?<!\bhardware\s)\bmac\b(?!(?:[- ]|['\u2019]s\s+)(?:add?ress(?:es)?|addr)\b|\s+id\b|\s+(?:of|on)\s+(?:(?:the|this|my|your)\s+)?omi\b)/i,
  /\bdesktop app\b/i,
  /\bomi desktop\b/i,
  /\bdesktop voice\b/i,
  /\bomi-windows\b/i,
  /\bomi windows\b/i,
  /\bwindows app\b/i,
  /\bnpm error\b/i,
  /\bERESOLVE\b/,
  /\bomi window\b/i,
  /\bfloating bubble\b/i,
  /\bcome to the front\b/i,
];

const APP = [
  /\b(android|iphone|ios)\b/i,
  /\bapple watch\b/i,
  /\b(the )?app (crash|crashed|force.?clos)/i,
  /\bcrash(ed|es|ing)?\b/i,
  /\blisten socket\b/i,
  /\b1011\b/,
  /\btranscription\b/i,
  /\bwss:\/\/api\.omi/i,
  /\bdidn'?t sync\b/i,
  /\b(recordings?|clips?) (are )?(missing|gone)\b/i,
  /\b(disconnected|offline).{0,40}\bapp\b/i,
  /\bapp.{0,40}(disconnected|offline)\b/i,
  /\bapp stayed open\b/i,
  /\bstill nothing recorded\b/i,
];

const CAPTURE_FAILURE = [
  /doesn'?t capture/i,
  /does not capture/i,
  /not capturing/i,
  /isn'?t capturing/i,
  /aren'?t capturing/i,
  /\bno audio\b/i,
];

const FAQ = [
  /\bleds?\b/i,
  /\bpair(ing)?\b/i,
  /\bdev kit\b/i,
  /\bcv1\b/i,
  /\bhow do i (turn|power|pair)/i,
  /\bbackground\b/i,
];

const ACCOUNT = [
  /fair[- ]use/i,
  /filled the memory/i,
  /memory.{0,40}full/i,
  /what are (all )?these plans/i,
  /\bthese plans\b/i,
];

const WANT_HUMAN = [
  /\btalk to (a )?(human|person)\b/i,
  /\bspeak to (a )?(human|person)\b/i,
  /\bneed (a )?(human|person|someone)\b/i,
  /\breal person\b/i,
  /\b(?:help me )?(?:get|put) (?:me )?in touch with (?:a |the )?(?:human|person|team|staff)\b/i,
  /\bcontact (?:a |the )?(?:human|person|support|shop|shipping)(?: team)?\b/i,
];

const SUPPORT_NUDGE = [
  /^any(?:one|body)\??[.!\s]*(?:even a bot.*)?$/i,
  /\bany(?:one|body) (?:there|available|responding)\b/i,
  /\b(?:still|been) waiting\b/i,
  /\bno (?:reply|response|answer)\b/i,
  /\bplease (?:reply|respond|answer)\b/i,
  /\beven a bot(?:'s)? answer\b/i,
];

function any(text, patterns) {
  const s = String(text || '');
  return patterns.some((re) => re.test(s));
}

function looksLikePhone(text) {
  const re = /(?<![\d#])\+?(?:\d[\s().-]*){6,14}\d(?!\d)/g;
  const s = String(text || '');
  let match;
  while ((match = re.exec(s))) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 15) return true;
  }
  return false;
}

function looksLikePii(text) {
  const s = String(text || '');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s)) return true;
  if (/\b\d{1,5}\s+\w+.+\b(st|street|ave|avenue|rd|road|blvd)\b/i.test(s)) return true;
  if (/\b(phone|tel)\b.{0,12}\d{7,}/i.test(s)) return true;
  if (looksLikePhone(s)) return true;
  return false;
}

function isPublicForumSafe(text) {
  const route = classify(text);
  if (looksLikePii(text)) return false;
  if (route?.responseMode === 'grounded') return true;
  if (['shop', 'privacy'].includes(route.area)) return false;
  if (route.lane === 'money') return false;
  return true;
}

function parseAreaOwners(raw) {
  const src = raw === undefined ? process.env.AREA_OWNERS : raw;
  const map = {};
  const text = String(src || '').trim();
  if (!text) return map;
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      for (const [key, value] of Object.entries(parsed || {})) {
        if (AREAS.includes(key) && value) map[key] = String(value).trim();
      }
      return map;
    } catch {
      return map;
    }
  }
  for (const part of text.split(',')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const area = part.slice(0, idx).trim();
    const rest = part.slice(idx + 1).trim();
    if (!AREAS.includes(area) || !rest) continue;
    map[area] = rest;
  }
  return map;
}

function ownerRef(area, owners) {
  const raw = (owners || parseAreaOwners())[area];
  if (!raw) return null;
  const role = raw.match(/^role:(\d{5,})$/i);
  if (role) return { kind: 'role', id: role[1] };
  const user = raw.match(/^(\d{5,})$/);
  if (user) return { kind: 'user', id: user[1] };
  return null;
}

function ownerMention(area, owners) {
  const ref = ownerRef(area, owners);
  if (!ref) return '';
  return ref.kind === 'role' ? `<@&${ref.id}>` : `<@${ref.id}>`;
}

function namesBothApps(text) {
  const s = String(text || '');
  const desktop = /\b(desktop|macos|mac\s?os|computer app)\b/i.test(s);
  const phone = /\b(mobile app|phone app|iphone|ios app|android)\b/i.test(s);
  return desktop && phone;
}

function looksLikeCaptureFailure(text) {
  return any(text, CAPTURE_FAILURE);
}

function looksLikeTranscription(text) {
  return /\btranscri(?:b\w*|pt\w*)\b/i.test(String(text || ''));
}

function reasonNamesCause(text) {
  return /\b(app-side|app side|app bug|firmware bug|phone app bug|known cause|computer app bug)\b/i.test(
    String(text || '')
  );
}

function classify(text) {
  return { ...classifyRoute(text), captureFailure: looksLikeCaptureFailure(text) };
}

function looksLikeOtherLanguage(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (letters.length < 12) return false;
  const nonLatin = letters.filter((ch) => !/\p{Script=Latin}/u.test(ch)).length;
  return nonLatin / letters.length >= 0.35;
}

function classifyRoute(text) {
  const s = String(text || '');
  const wantHuman = any(s, WANT_HUMAN);

  if (/\bin order to\b/i.test(s) && !any(s, SHOP) && !any(s, STRONG_MONEY) && !any(s, WEAK_MONEY)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }

  if (any(s, PRIVACY)) {
    return { area: 'privacy', lane: 'privacy', escalate: true, wantHuman };
  }
  if (any(s, STRONG_MONEY)) {
    return { area: 'shop', lane: 'money', escalate: true, wantHuman };
  }
  if (looksLikeShippingQuote(s)) {
    return {
      area: 'shop',
      lane: 'shop',
      intent: 'shipping_quote',
      responseMode: 'grounded',
      escalate: true,
      wantHuman,
    };
  }
  if (any(s, STRONG_SHOP)) {
    return { area: 'shop', lane: 'shop', escalate: true, wantHuman };
  }
  if (looksLikeOtherLanguage(s)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }
  if (looksLikeProductQuestion(s)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }
  if (any(s, FIRMWARE)) {
    return { area: 'firmware', lane: 'firmware', escalate: true, wantHuman };
  }
  if (any(s, DESKTOP)) {
    return { area: 'desktop', lane: 'tech', escalate: true, wantHuman };
  }
  if (any(s, APP)) {
    return { area: 'app', lane: 'tech', escalate: true, wantHuman };
  }
  if (any(s, WEAK_SHOP)) {
    return { area: 'shop', lane: 'shop', escalate: true, wantHuman };
  }
  if (any(s, WEAK_MONEY)) {
    return { area: 'shop', lane: 'money', escalate: true, wantHuman };
  }
  if (any(s, ACCOUNT)) {
    return { area: 'shop', lane: 'account', escalate: true, wantHuman };
  }
  if (
    looksLikeDocs(s) &&
    !any(s, STRONG_MONEY) &&
    !any(s, SHOP) &&
    !any(s, WEAK_MONEY) &&
    !any(s, ACCOUNT)
  ) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }
  if (any(s, FAQ)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }
  return { area: 'unknown', lane: 'unknown', escalate: wantHuman, wantHuman };
}

function isTechLane(route) {
  return route?.lane === 'tech' || route?.area === 'firmware';
}

function specialistNames(area, lane) {
  if (lane === 'faq') return '';
  if (area === 'shop' || area === 'app') return 'Mohsin';
  if (area === 'desktop') return 'Aryan';
  if (area === 'firmware') return 'TuEmb';
  if (area === 'privacy') return 'David';
  return 'Aryan, David, undivisible';
}

function shouldPingOwner(route) {
  if (!route || route.lane === 'faq') return false;
  return Boolean(route.escalate) && route.area !== 'unknown';
}

function skipModel(route) {
  return (
    route?.lane === 'money' ||
    route?.lane === 'privacy' ||
    route?.lane === 'shop'
  );
}

function requiresGroundedAnswer(route) {
  return route?.responseMode === 'grounded' || !skipModel(route);
}

function looksLikeTax(text) {
  return /\b((import\s+)?tax(es)?|duties|customs)\b/i.test(String(text || ''));
}

function looksLikeShippingQuote(text) {
  const s = String(text || '');
  return (
    /\b(shipping|delivery)\s+(costs?|fees?|prices?|quotes?|rates?)\b/i.test(s) ||
    /\b(costs?|prices?|quotes?|rates?)\s+(?:for|of)\s+(shipping|delivery)\b/i.test(s) ||
    /\b(checkout|cashout)\b.{0,40}\b(shipping|delivery)\b/i.test(s) ||
    /\b(shipping|delivery)\b.{0,40}\b(checkout|cashout)\b/i.test(s) ||
    /\b(arrange|arranging|alternative|different|cheaper|special)\b.{0,32}\b(shipping|delivery)\b/i.test(s)
  );
}

function looksLikeSupportNudge(text) {
  return any(text, SUPPORT_NUDGE);
}

function looksLikePlan(text) {
  return /\b(subscription|redemption code|unlimited yearly|plus plan|no active plan|stuck on free|downgraded to free|billing bug)\b/i.test(
    String(text || '')
  );
}

function looksLikeHardFailure(text) {
  const s = String(text || '');
  if (/\b(crash|crashed|1011|exception|error code|won'?t charge|not charging|turns? itself off)\b/i.test(s)) return true;
  return /\b(app (was|stayed) open|kept the app (open|running)|blue light)\b/i.test(s) && /\b(nothing|still)\b/i.test(s);
}

function looksLikeProductQuestion(text) {
  const s = String(text || '');
  if (looksLikeHardFailure(s)) return false;
  if (
    any(s, STRONG_MONEY) ||
    any(s, WEAK_MONEY) ||
    any(s, STRONG_SHOP) ||
    any(s, WEAK_SHOP) ||
    any(s, PRIVACY) ||
    any(s, ACCOUNT)
  ) return false;
  if (looksLikeRecordingHow(s)) return true;
  if (looksLikeDeviceReset(s)) return true;
  return /\b(how (do|does|can|should)|where (do|does|can|is|are)|which (omi )?(device|app|setting|option)|if i .{0,60}\b(can|will|does)|is it (meant|supposed)|supposed to|any clue|like \w+ does|can (it|omi|the device)|does (it|omi|the device)|what does|why (does|is|can)|i'?d like)\b/i.test(s);
}

function looksLikeRecordingHow(text) {
  const s = String(text || '');
  if (looksLikeHardFailure(s)) return false;
  const plaud = /\bplaud\b/i.test(s) && /\b(record|24)/i.test(s);
  const day = /\b24\s*hours?\b/i.test(s) && /\brecord/i.test(s);
  const alone = /\b(not app|without the app|by itself)\b/i.test(s) && /\brecord/i.test(s);
  return plaud || day || alone;
}

function looksLikeDeviceReset(text) {
  const s = String(text || '');
  if (looksLikeHardFailure(s)) return false;
  if (/\bcrash(ed|es|ing)?\b/i.test(s)) return false;
  if (/\b(delete|wipe|erase)\b/i.test(s) && /\b(account|data|conversation|memory)\b/i.test(s)) return false;
  if (/\b(already reset|after (a |the )?reset|reset it and)\b/i.test(s)) return false;
  return /\breset\b/i.test(s) && /\b(how|can i|want to|omi|device|necklace|pendant)\b/i.test(s);
}

function deviceResetReply() {
  return [
    'To reset the necklace, press and hold the button, and while still holding, place it on the charger. It may take a few tries.',
    'If that does not reset it, let it discharge until it powers off, then charge it again.',
    'If there is no light at all, use that same reset. If it still stays off, leave it on the charger for 6–8 hours. If it gets slightly warm, keep charging for 12–14 hours.',
    'If none of that works, email help@omi.me. These steps are from the Omi troubleshooting guide: https://help.omi.me/en/articles/12847359-omi-device-troubleshooting-guide',
  ].join('\n\n');
}

function recordingHowReply() {
  return "The 24 hours on the Omi page is battery life, about a day to a few days depending on the device. It is not a full day of recording with the phone app closed. The necklace needs the Omi app. You can leave the app in the background. If you swipe it away, it stops writing down what was said and the device disconnects. Turn it on with one press. Blue means it is connected to the phone. Red means it is on but not connected. Speak near it. The words can take up to a minute to show in the app. DevKit 2 is the one whose docs say it can record on its own. If the app stayed open, the light was blue, and still nothing showed up, say so here.";
}

function looksLikeDocs(text) {
  return /\b(instructions|documentation|how (it|this|does it) works?|how it'?s different)\b/i.test(
    String(text || '')
  );
}

function whenModelDown(route, question) {
  if (looksLikeOtherLanguage(question) && route?.lane === 'faq' && !route?.wantHuman) {
    return {
      agent: {
        final_answer: '',
        confidence: 0.2,
        escalate: true,
        reason: 'Question is not in English.',
      },
      reply: "I can't answer that language from chat right now. A person will take it.",
    };
  }
  const known = cannedReply(route, question);
  const canAnswer = route?.lane === 'faq' && !route?.wantHuman && known;
  return {
    agent: {
      final_answer: '',
      confidence: canAnswer ? 0.9 : 0.2,
      escalate: !canAnswer,
      reason: canAnswer ? '' : staffReason(route, question),
    },
    reply: known || "I can't finish this from chat right now.",
  };
}

function orderLookupLive() {
  try {
    return require('./orderFlow').isLive();
  } catch {
    return false;
  }
}

function shopStatusReply(route, question) {
  if (route?.wantHuman || looksLikeSupportNudge(question)) {
    return [
      "You're asking for a person from the shop team to check this shipment.",
      "I can't provide the tracking or expected delivery date myself.",
      "Please don't post your address or payment details here.",
    ].join(' ');
  }
  const head =
    "I can't see order status from here, so I can't tell you where that order is or when it will arrive. That needs someone with access to the order system, and I'm not going to guess a date.";
  if (orderLookupLive()) {
    return `${head}\n\nUse /order to check your own orders. We email a code to the address on the order so nobody can look up someone else's. Keep your order number handy.`;
  }
  return `${head}\n\nEmail help@omi.me with the order number. Order lookup in chat is not live yet. Keep your order number handy.`;
}

function shippingQuoteReply() {
  return [
    'That is a checkout shipping quote, not an order-status question.',
    "I can't override the rate or confirm a special shipping route from chat. The shop team needs to check whether another shipping option is available for your destination.",
    "Keep a screenshot of the checkout quote ready, but don't post your full address here.",
  ].join(' ');
}

function orderNote(question) {
  const order = String(question || '').match(/\border\s*#\s*([A-Z0-9-]{4,})/i);
  if (!order) return ' Include the order number.';
  return ` Include order #${order[1]}.`;
}

function cannedReply(route, question) {
  const lane = route?.lane;
  if (lane === 'money') {
    if (looksLikeTax(question)) {
      return "This is about tax or duties on an order. I can't change that from chat.";
    }
    if (looksLikePlan(question)) {
      return "This is about a paid plan or a redemption code. I can't change your account from chat.";
    }
    return `I can't issue a refund, cancel an order, or change a payment from chat. Email help@omi.me and ask for the refund to the original payment method.${orderNote(question)} I can't promise the refund or a date.`;
  }
  if (lane === 'privacy') {
    return "This is about deleting your account or what Omi saved. I can't do that from chat.";
  }
  if (lane === 'shop') {
    if (looksLikeTax(question)) {
      return "This is about tax or duties on an order. I can't change that from chat.";
    }
    if (route?.intent === 'shipping_quote' || looksLikeShippingQuote(question)) {
      return shippingQuoteReply();
    }
    return shopStatusReply(route, question);
  }
  if (looksLikeRecordingHow(question)) return recordingHowReply();
  if (looksLikeDeviceReset(question)) return deviceResetReply();
  if (lane === 'firmware') {
    return "This looks like a problem with the Omi device itself. I can't see your device from here, so I won't guess what's wrong.";
  }
  if (lane === 'tech' && route?.area === 'desktop') {
    return "You wrote about the computer app. I can't open that app from here, so I won't guess a fix.";
  }
  if (lane === 'tech') {
    return "You wrote about the phone app. I can't open that app from here, so I won't guess a fix.";
  }
  if (/\bblue\b/i.test(String(question || '')) && /\blight\b/i.test(String(question || ''))) {
    return 'A solid blue light means the Omi is on and connected to your phone.';
  }
  if (/\bhow do i turn\b/i.test(String(question || '')) && /\boff\b/i.test(String(question || ''))) {
    return 'On the necklace, hold the button for about 3 seconds to turn it off. One press turns it on.';
  }
  if (/\bdelete\b/i.test(String(question || '')) && /\bconversation\b/i.test(String(question || ''))) {
    return 'Open that conversation and delete it from its detail view. That deletes the transcript and any stored audio for it.';
  }
  return null;
}

function staffReason(route, question) {
  const lane = route?.lane;
  if (route?.intent === 'shipping_quote' || looksLikeShippingQuote(question)) {
    return 'Checkout shipping quote or alternate shipping route';
  }
  if (looksLikeTax(question) && (lane === 'money' || lane === 'shop' || route?.area === 'shop')) {
    return 'Tax, duties, or customs';
  }
  if (looksLikePlan(question) && (lane === 'money' || route?.area === 'shop')) {
    return 'Paid plan or redemption code';
  }
  if (lane === 'money') return 'Refund, charge, or address change';
  if (lane === 'privacy') return 'Data deletion / privacy request';
  if (looksLikeCaptureFailure(question) && looksLikeTranscription(question)) {
    return 'Transcription unavailable, and the device is not capturing. Cannot see the app from chat.';
  }
  if (
    namesBothApps(question) &&
    (lane === 'tech' || route?.area === 'desktop' || route?.area === 'app')
  ) {
    return 'Cannot see the computer app or the phone app from chat.';
  }
  if (route?.area === 'app') return 'Cannot see the phone app from chat';
  if (route?.area === 'desktop') return 'Cannot see the computer app from chat';
  if (lane === 'firmware' || route?.area === 'firmware') {
    return 'Device problem; cannot see the Omi from chat';
  }
  if (lane === 'tech') return 'Cannot see the app from chat';
  if (lane === 'shop') return 'Order or shipping';
  if (lane === 'account') return 'Fair use, memory limit, or plan question';
  if (lane === 'faq' && looksLikeDocs(question)) {
    return 'Docs question. Do not invent how it works or plan prices.';
  }
  return 'Needs a person';
}

function pickStaffReason(route, modelReason, question) {
  if (route?.lane === 'faq' && looksLikeDocs(question)) return staffReason(route, question);
  const lane = route?.lane;
  const area = route?.area;
  if (namesBothApps(question) && (lane === 'tech' || area === 'desktop' || area === 'app')) {
    return staffReason(route, question);
  }
  const reason = String(modelReason || '').trim();
  const techish =
    lane === 'tech' ||
    lane === 'firmware' ||
    area === 'app' ||
    area === 'desktop' ||
    area === 'firmware';
  if (techish && reasonNamesCause(reason)) return staffReason(route, question);
  return reason || staffReason(route, question);
}

function knownIssueReply() {
  return "This is already marked as a known issue. I can't see the app or the device from here, so I won't add a new diagnosis. A person has to confirm it.";
}

function describe(route) {
  const lane = route?.lane;
  const area = route?.area;
  if (lane === 'account') {
    return 'Account limits and plans. Answer phone vs computer if they asked. Do not invent prices.';
  }
  if (lane === 'firmware' || area === 'firmware') {
    return 'The device itself is failing. They may already have paired.';
  }
  if (area === 'desktop') return 'Computer app install or bug.';
  if (area === 'app') {
    return 'The phone app is reporting a problem. Do not name a cause or where recordings are.';
  }
  if (lane === 'shop') return 'Order, shipping, or customs.';
  if (lane === 'money') return 'Refund, charge, tax, plan, or address. Do not promise money back.';
  if (lane === 'privacy') return 'Delete account or data.';
  if (lane === 'faq') return 'How-to they asked for. Do not dump extra setup.';
  return 'Read their message. Answer what they asked. Do not change the subject.';
}

module.exports = {
  AREAS,
  classify,
  looksLikePii,
  isPublicForumSafe,
  parseAreaOwners,
  ownerRef,
  ownerMention,
  isTechLane,
  shouldPingOwner,
  specialistNames,
  skipModel,
  requiresGroundedAnswer,
  looksLikeTax,
  looksLikeShippingQuote,
  looksLikeSupportNudge,
  looksLikePlan,
  looksLikeDocs,
  looksLikeRecordingHow,
  looksLikeDeviceReset,
  looksLikeProductQuestion,
  looksLikeOtherLanguage,
  cannedReply,
  whenModelDown,
  staffReason,
  pickStaffReason,
  knownIssueReply,
  looksLikeCaptureFailure,
  looksLikeTranscription,
  namesBothApps,
  describe,
};
