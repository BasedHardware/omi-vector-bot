const AREAS = ['shop', 'app', 'desktop', 'firmware', 'privacy', 'unknown'];

// Refunds and charges always beat a product bug. "billing reasons" in a
// desktop 402 report is not a Shopify refund.
const STRONG_MONEY = [
  /\brefunds?\b/i,
  /\bcharged\b/i,
  /\binvoice\b/i,
  /\btax\b/i,
  /\bwrong address\b/i,
  /\bchange (my )?(the )?(shipping )?address\b/i,
  /\bcancel (my )?(the )?(order|purchase)\b/i,
];

const WEAK_MONEY = [
  /\bmy billing\b/i,
  /\bbilling (issue|question|problem|for)\b/i,
  /\bpayment\b/i,
];

const PRIVACY = [/\bprivacy\b/i, /\bgdpr\b/i, /\bdelete my (account|data)\b/i];

const SHOP = [
  /\border\s*(#|number|id|num|status)\b/i,
  /\b(my|the)\s+order\b/i,
  /\bwhere\s+is\s+my\s+order\b/i,
  /\btracking\b/i,
  /\bshipping\b/i,
];

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
  /\bmac\b/i,
  /\bdesktop app\b/i,
  /\bomi desktop\b/i,
  /\bdesktop voice\b/i,
  /\bomi-windows\b/i,
  /\bomi windows\b/i,
  /\bwindows app\b/i,
];

const APP = [
  /\b(android|iphone|ios)\b/i,
  /\b(the )?app (crash|crashed|force.?clos)/i,
  /\bcrash(ed|es|ing)?\b/i,
  /\blisten socket\b/i,
  /\b1011\b/,
  /\btranscription\b/i,
  /\bwss:\/\/api\.omi/i,
];

const FAQ = [
  /\bleds?\b/i,
  /\bpair(ing)?\b/i,
  /\bdev kit\b/i,
  /\bcv1\b/i,
  /\bhow do i (turn|power|pair)/i,
  /\bbackground\b/i,
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

function isPublicForumSafe(text) {
  const route = classify(text);
  if (looksLikePii(text)) return false;
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

function classify(text) {
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
  if (any(s, WEAK_MONEY)) {
    return { area: 'shop', lane: 'money', escalate: true, wantHuman };
  }
  if (any(s, FAQ)) {
    return { area: 'unknown', lane: 'faq', escalate: wantHuman, wantHuman };
  }
  return { area: 'unknown', lane: 'unknown', escalate: wantHuman, wantHuman };
}

function isTechLane(route) {
  return route?.lane === 'tech' || route?.area === 'firmware';
}

function shouldPingOwner(route) {
  if (!route || route.lane === 'faq') return false;
  return Boolean(route.escalate) && route.area !== 'unknown';
}

function skipModel(route) {
  return route?.lane === 'money' || route?.lane === 'privacy' || route?.lane === 'firmware';
}

function cannedReply(route) {
  const lane = route?.lane;
  if (lane === 'money') {
    return "This is about money — a refund, a charge, or a shipping address. I can't change those from chat.";
  }
  if (lane === 'privacy') {
    return "This is about deleting your account or what Omi saved. I can't do that from chat.";
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

function staffReason(route) {
  const lane = route?.lane;
  if (lane === 'money') return 'Refund, charge, or address change';
  if (lane === 'privacy') return 'Data deletion / privacy request';
  if (route?.area === 'app') return 'Phone app bug; cannot see the app from chat';
  if (route?.area === 'desktop') return 'Computer app bug; cannot see the app from chat';
  if (lane === 'firmware' || route?.area === 'firmware') {
    return 'Device problem; cannot see the Omi from chat';
  }
  if (lane === 'tech') return 'Product bug; cannot see the app from chat';
  if (lane === 'shop') return 'Order or shipping';
  return 'Needs a person';
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
  skipModel,
  cannedReply,
  staffReason,
};
