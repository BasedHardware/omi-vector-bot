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

const SHOP = [
  /\border\s*status\b/i,
  /\bwhere(\s+is|'?s)\s+(my\s+)?order\b/i,
  /\btracking\b/i,
  /\bshipping\b/i,
  /\bcustoms\b/i,
];

const WEAK_SHOP = [/\border\s*(#|number|id|num)\b/i, /\b(my|the)\s+order\b/i];

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
];

const PLATFORM = [/\b(android|iphone|ios)\b/i, /\bapple watch\b/i];

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
];

function any(text, patterns) {
  const s = String(text || '');
  return patterns.some((re) => re.test(s));
}

function looksLikePii(text) {
  const s = String(text || '');
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s)) return true;
  if (/\b\d{1,5}\s+\w+.+\b(st|street|ave|avenue|rd|road|blvd)\b/i.test(s)) return true;
  if (/\b(phone|tel)\b.{0,12}\d{7,}/i.test(s)) return true;
  return false;
}

function mentionsOrder(text) {
  return any(text, SHOP) || any(text, WEAK_SHOP);
}

function isPublicForumSafe(text) {
  const route = classify(text);
  if (looksLikePii(text)) return false;
  if (mentionsOrder(text)) return false;
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
  return /\btranscription\b/i.test(String(text || ''));
}

function reasonNamesCause(text) {
  return /\b(app-side|app side|app bug|firmware bug|phone app bug|known cause|computer app bug)\b/i.test(
    String(text || '')
  );
}

function classify(text) {
  return { ...classifyRoute(text), captureFailure: looksLikeCaptureFailure(text) };
}

function classifyRoute(text) {
  const s = String(text || '');
  const wantHuman = any(s, WANT_HUMAN);

  if (/\bin order to\b/i.test(s) && !mentionsOrder(s) && !any(s, STRONG_MONEY) && !any(s, WEAK_MONEY)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }

  if (any(s, PRIVACY)) {
    return { area: 'privacy', lane: 'privacy', escalate: true, wantHuman };
  }
  if (any(s, STRONG_MONEY)) {
    return { area: 'shop', lane: 'money', escalate: true, wantHuman };
  }
  if (any(s, SHOP)) {
    return { area: 'shop', lane: 'shop', escalate: true, wantHuman };
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
  if (any(s, PLATFORM)) {
    return { area: 'app', lane: 'tech', escalate: true, wantHuman };
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
    return { area: 'unknown', lane: 'faq', escalate: true, wantHuman };
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
  return route?.lane === 'money' || route?.lane === 'privacy' || route?.lane === 'shop';
}

function looksLikeTax(text) {
  return /\b((import\s+)?tax(es)?|duties|customs)\b/i.test(String(text || ''));
}

function looksLikePlan(text) {
  return /\b(subscription|redemption code|unlimited yearly|plus plan|no active plan|stuck on free|downgraded to free|billing bug)\b/i.test(
    String(text || '')
  );
}

function looksLikeDocs(text) {
  return /\b(instructions|documentation|how (it|this|does it) works?|how it'?s different)\b/i.test(
    String(text || '')
  );
}

function whenModelDown(route, question) {
  return {
    agent: {
      final_answer: '',
      confidence: 0.2,
      escalate: true,
      reason: staffReason(route, question),
    },
    reply: cannedReply(route, question) || "I can't finish this from chat right now.",
  };
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
    return "This is about money — a refund, a charge, or a shipping address. I can't change those from chat.";
  }
  if (lane === 'privacy') {
    return "This is about deleting your account or what Omi saved. I can't do that from chat.";
  }
  if (lane === 'shop') {
    if (looksLikeTax(question)) {
      return "This is about tax or duties on an order. I can't change that from chat.";
    }
    return "I can't see order status from here, so I can't tell you where that order is or when it will arrive. That needs someone with access to the order system, and I'm not going to guess a date.\n\nUse /order to check your own orders. We email a code to the address on the order so nobody can look up someone else's. Keep your order number handy.";
  }
  if (lane === 'firmware') {
    return "This looks like a problem with the Omi device itself. I can't see your device from here, so I won't guess what's wrong.";
  }
  if (lane === 'tech' && route?.area === 'desktop') {
    return "You wrote about the computer app. I can't open that app from here, so I won't guess a fix.";
  }
  if (lane === 'tech') {
    return "You wrote about the phone app. I can't open that app from here, so I won't guess a fix.";
  }
  return null;
}

function staffReason(route, question) {
  const lane = route?.lane;
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
  mentionsOrder,
  isPublicForumSafe,
  parseAreaOwners,
  ownerRef,
  ownerMention,
  isTechLane,
  shouldPingOwner,
  specialistNames,
  skipModel,
  looksLikeTax,
  looksLikePlan,
  looksLikeDocs,
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
