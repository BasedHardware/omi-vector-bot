const API_VERSION = '2024-10';
const LOOKUP_TIMEOUT_MS = 8000;

function isConfigured() {
  return Boolean(String(process.env.SHOPIFY_STORE || '').trim() && String(process.env.SHOPIFY_ACCESS_TOKEN || '').trim());
}

function storeHost() {
  const raw = String(process.env.SHOPIFY_STORE || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
  if (!raw) return '';
  return raw.includes('.') ? raw : `${raw}.myshopify.com`;
}

function isOrderQuestion(text) {
  const s = String(text || '');
  if (/\bin order to\b/i.test(s)) return false;
  return (
    /\b(my|the)\s+order\b/i.test(s) ||
    /\border\s*(#|number|id|num|status)\b/i.test(s) ||
    /\bwhere\s+is\s+my\s+order\b/i.test(s) ||
    /\btracking\b/i.test(s) ||
    /#\d{3,}/.test(s)
  );
}

function needsWriteHuman(text) {
  const s = String(text || '');
  return (
    /\brefunds?\b/i.test(s) ||
    /\bwrong address\b/i.test(s) ||
    /\bchange (my )?(the )?(shipping )?address\b/i.test(s) ||
    /\bcancel (my )?(the )?(order|purchase)\b/i.test(s)
  );
}

function extractLookupKeys(text) {
  const s = String(text || '');
  const numbered =
    s.match(/#\s*(\d{3,})\b/) ||
    s.match(/\border\s*(?:number|no\.?|id|#)?\s*[#:]?\s*(\d{3,})\b/i);
  const mail = s.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return {
    orderName: numbered ? `#${numbered[1]}` : '',
    email: mail ? mail[0] : '',
  };
}

function hasLookupKey(text) {
  const keys = extractLookupKeys(text);
  return Boolean(keys.orderName || keys.email);
}

function normalizeEmail(raw) {
  const email = String(raw || '').trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function shouldLookup(route, text, { verifiedEmail } = {}) {
  if (!isConfigured()) return false;
  if (!normalizeEmail(verifiedEmail)) return false;
  if (route?.lane === 'shop') return true;
  if (route?.lane === 'money' && hasLookupKey(text)) return true;
  return false;
}

function payLabel(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'paid') return 'paid';
  if (key === 'pending') return 'pending payment';
  if (key === 'refunded') return 'refunded';
  if (key === 'partially_refunded') return 'partially refunded';
  if (key === 'voided') return 'voided';
  if (key === 'authorized') return 'authorized';
  return key || 'unknown payment status';
}

function shipLabel(order) {
  if (order.cancelled) return 'cancelled';
  const key = String(order.fulfillmentStatus || '').toLowerCase();
  if (key === 'fulfilled') return 'shipped';
  if (key === 'partial') return 'partially shipped';
  if (key === 'restocked') return 'restocked';
  return 'not shipped';
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function addressLooksComplete(addr) {
  if (!addr || typeof addr !== 'object') return false;
  return Boolean(
    addr.city && (addr.country || addr.country_code) && (addr.zip || addr.address1)
  );
}

function summarizeOrder(raw) {
  const fulfillments = Array.isArray(raw?.fulfillments) ? raw.fulfillments : [];
  const trackings = [];
  for (const f of fulfillments) {
    const numbers = Array.isArray(f.tracking_numbers) && f.tracking_numbers.length
      ? f.tracking_numbers
      : f.tracking_number
        ? [f.tracking_number]
        : [];
    const urls = Array.isArray(f.tracking_urls) && f.tracking_urls.length
      ? f.tracking_urls
      : f.tracking_url
        ? [f.tracking_url]
        : [];
    numbers.filter(Boolean).forEach((number, i) => {
      trackings.push({
        number: String(number),
        url: String(urls[i] || urls[0] || ''),
        company: String(f.tracking_company || ''),
      });
    });
  }

  const titles = (raw?.line_items || [])
    .map((item) => String(item?.title || '').trim())
    .filter(Boolean);

  const addr = raw?.shipping_address || {};
  return {
    name: String(raw?.name || '').trim(),
    createdAt: raw?.created_at || '',
    cancelled: Boolean(raw?.cancelled_at),
    financialStatus: String(raw?.financial_status || ''),
    fulfillmentStatus: String(raw?.fulfillment_status || ''),
    titles,
    trackings,
    city: String(addr.city || '').trim(),
    country: String(addr.country || addr.country_code || '').trim(),
    addressComplete: addressLooksComplete(addr),
  };
}

function payShip(order) {
  return `${payLabel(order.financialStatus)}, ${shipLabel(order)}`;
}

function formatUserReply(order) {
  const name = order.name || 'That order';
  const lines = [`${name} is ${payShip(order)}.`];

  if (order.trackings.length) {
    for (const t of order.trackings) {
      lines.push(t.company ? `${t.company}: ${t.number}` : t.number);
      if (t.url) lines.push(t.url);
    }
  } else if (!order.cancelled) {
    lines.push('There is no tracking yet. I will not guess a delivery date.');
  }

  const when = formatDate(order.createdAt);
  if (when) lines.push(`Ordered ${when}.`);

  if (order.titles.length) {
    lines.push('Items:');
    for (const title of order.titles.slice(0, 8)) lines.push(`- ${title}`);
  }

  return lines.join('\n');
}

function formatStaffFacts(order) {
  const lines = [`${order.name || 'Order'} ${payShip(order)}`];
  for (const t of order.trackings) {
    lines.push(t.company ? `${t.company} ${t.number}` : t.number);
    if (t.url) lines.push(t.url);
  }
  if (order.titles.length) lines.push(`Items: ${order.titles.slice(0, 8).join(', ')}`);
  if (order.city || order.country) {
    lines.push(`Ship to: ${[order.city, order.country].filter(Boolean).join(', ')}`);
  }
  lines.push(`Address looks complete: ${order.addressComplete ? 'yes' : 'no'}`);
  return lines.join('\n');
}

function buildUserReply(lookup, question) {
  if (!isConfigured()) return null;
  if (needsWriteHuman(question)) {
    const extra = lookup?.order ? `\n\nThe order I found is ${payShip(lookup.order)}.` : '';
    return `I can't issue a refund, cancel an order, or change an address from chat.${extra}`;
  }
  if (lookup?.reason === 'unverified') {
    return "I can't look up Shopify from a number or email in chat. Anyone could type someone else's order. Email help@omi.me with the Order ID.";
  }
  if (lookup?.reason === 'no-key') {
    return 'I can look this up in Shopify if you send the order number or the email on the order.';
  }
  if (lookup?.reason === 'error' || lookup?.reason === 'auth') {
    return 'I could not reach Shopify just now. A person on the team needs to take this.';
  }
  if (!lookup?.order) {
    return 'I looked in Shopify and did not find that order. A person on the team needs to take this.';
  }
  return formatUserReply(lookup.order);
}

function staffReason(lookup, question) {
  if (needsWriteHuman(question)) return 'Refund, cancel, or address change needs a person';
  if (lookup?.reason === 'no-key') return 'Needs order number or email on the order';
  if (lookup?.reason === 'miss') return 'Shopify miss';
  if (lookup?.reason === 'error' || lookup?.reason === 'auth') return 'Shopify lookup failed';
  if (lookup?.order) return 'Order lookup for staff check';
  return 'Order question';
}

function filterKnowledge(snippets) {
  const list = snippets || [];
  if (!isConfigured()) return list;
  return list.filter((s) => !/cannot see shopify/i.test(String(s || '')));
}

async function shopifyGet(params, fetchImpl) {
  const host = storeHost();
  const url = new URL(`https://${host}/admin/api/${API_VERSION}/orders.json`);
  url.searchParams.set('status', 'any');
  url.searchParams.set('limit', '5');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const res = await fetchImpl(url, {
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' };
  if (!res.ok) return { ok: false, reason: 'error' };

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, reason: 'error' };
  }

  const orders = Array.isArray(data?.orders) ? data.orders : [];
  if (!orders.length) return { ok: false, reason: 'miss' };
  return { ok: true, raw: orders[0], order: summarizeOrder(orders[0]) };
}

function orderEmailMatches(raw, verifiedEmail) {
  return normalizeEmail(raw?.email) === normalizeEmail(verifiedEmail);
}

async function lookupOrder(text, { fetchImpl, verifiedEmail } = {}) {
  if (!isConfigured()) return { ok: false, reason: 'unconfigured' };
  const bound = normalizeEmail(verifiedEmail);
  if (!bound) return { ok: false, reason: 'unverified' };
  const keys = extractLookupKeys(text);

  const fetchFn = fetchImpl || fetch;
  try {
    if (keys.orderName) {
      const byName = await shopifyGet({ name: keys.orderName }, fetchFn);
      if (byName.reason === 'auth' || byName.reason === 'error') return { ok: false, reason: byName.reason };
      if (byName.ok) {
        if (!orderEmailMatches(byName.raw, bound)) return { ok: false, reason: 'miss' };
        return { ok: true, order: byName.order };
      }
    }
    const byEmail = await shopifyGet({ email: bound }, fetchFn);
    if (!byEmail.ok) return { ok: false, reason: byEmail.reason };
    return { ok: true, order: byEmail.order };
  } catch (err) {
    console.error('[Shopify] lookup failed:', err.message);
    return { ok: false, reason: 'error' };
  }
}

module.exports = {
  API_VERSION,
  isConfigured,
  storeHost,
  isOrderQuestion,
  needsWriteHuman,
  extractLookupKeys,
  hasLookupKey,
  shouldLookup,
  normalizeEmail,
  summarizeOrder,
  formatUserReply,
  formatStaffFacts,
  buildUserReply,
  staffReason,
  filterKnowledge,
  lookupOrder,
};
