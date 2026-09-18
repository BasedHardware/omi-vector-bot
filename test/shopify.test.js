const assert = require('node:assert/strict');
const test = require('node:test');
const shopify = require('../shopify');

async function withShopifyEnv(fn) {
  const prevStore = process.env.SHOPIFY_STORE;
  const prevToken = process.env.SHOPIFY_ACCESS_TOKEN;
  process.env.SHOPIFY_STORE = 'omi-test';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpua_test';
  try {
    return await fn();
  } finally {
    if (prevStore === undefined) delete process.env.SHOPIFY_STORE;
    else process.env.SHOPIFY_STORE = prevStore;
    if (prevToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
    else process.env.SHOPIFY_ACCESS_TOKEN = prevToken;
  }
}

const SAMPLE = {
  name: '#1042',
  created_at: '2026-09-12T10:00:00Z',
  cancelled_at: null,
  financial_status: 'paid',
  fulfillment_status: 'fulfilled',
  email: 'hidden@example.com',
  line_items: [{ title: 'Omi' }],
  fulfillments: [
    {
      tracking_number: '1Z999',
      tracking_company: 'UPS',
      tracking_url: 'https://www.ups.com/track?loc=en_US&tracknum=1Z999',
    },
  ],
  shipping_address: {
    name: 'A Person',
    address1: '123 Secret St',
    phone: '555-0100',
    city: 'Berlin',
    country: 'Germany',
    zip: '10115',
  },
};

test('isConfigured is false without store and token', () => {
  const prevStore = process.env.SHOPIFY_STORE;
  const prevToken = process.env.SHOPIFY_ACCESS_TOKEN;
  delete process.env.SHOPIFY_STORE;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  assert.equal(shopify.isConfigured(), false);
  if (prevStore !== undefined) process.env.SHOPIFY_STORE = prevStore;
  if (prevToken !== undefined) process.env.SHOPIFY_ACCESS_TOKEN = prevToken;
});

test('order questions match; pairing in order to does not', () => {
  assert.equal(shopify.isOrderQuestion('Where is my order?'), true);
  assert.equal(shopify.isOrderQuestion('tracking for #1042'), true);
  assert.equal(shopify.isOrderQuestion('in order to pair, I press the button'), false);
});

test('refunds and address changes still need a person', () => {
  assert.equal(shopify.needsWriteHuman('I want a refund'), true);
  assert.equal(shopify.needsWriteHuman('please change my shipping address'), true);
  assert.equal(shopify.needsWriteHuman('Where is my order?'), false);
});

test('extractLookupKeys reads #order and email, not a bare year', () => {
  assert.deepEqual(shopify.extractLookupKeys('Where is my order?'), {
    orderName: '',
    email: '',
  });
  assert.equal(shopify.extractLookupKeys('order #1042').orderName, '#1042');
  assert.equal(shopify.extractLookupKeys('I ordered in 2024').orderName, '');
  assert.equal(
    shopify.extractLookupKeys('email is jane@omi.me').email.toLowerCase(),
    'jane@omi.me'
  );
});

test('user reply has paid, tracking, no address or arrival guess', () => {
  const order = shopify.summarizeOrder(SAMPLE);
  const out = shopify.formatUserReply(order);
  assert.match(out, /#1042/);
  assert.match(out, /paid/);
  assert.match(out, /shipped/);
  assert.match(out, /1Z999/);
  assert.match(out, /Omi/);
  assert.equal(/Secret St/i.test(out), false);
  assert.equal(/555-0100/.test(out), false);
  assert.equal(/hidden@example/.test(out), false);
  assert.equal(/A Person/.test(out), false);
  assert.equal(/arriv/i.test(out), false);
  assert.equal(/Tuesday/i.test(out), false);
});

test('staff facts include city and country, not street', () => {
  const facts = shopify.formatStaffFacts(shopify.summarizeOrder(SAMPLE));
  assert.match(facts, /Berlin/);
  assert.match(facts, /Germany/);
  assert.match(facts, /Address looks complete: yes/);
  assert.equal(/Secret St/i.test(facts), false);
  assert.equal(/555-0100/.test(facts), false);
  assert.equal(/hidden@example/.test(facts), false);
});

test('buildUserReply asks for keys, reports a miss, and does not refund', () =>
  withShopifyEnv(() => {
    assert.match(
      shopify.buildUserReply({ reason: 'no-key' }, 'Where is my order?'),
      /order number or the email on the order/
    );
    const miss = shopify.buildUserReply({ reason: 'miss' }, 'Where is my order #1042?');
    assert.match(miss, /did not find/);
    assert.equal(/arriv/i.test(miss), false);

    const refund = shopify.buildUserReply(
      { ok: true, order: shopify.summarizeOrder(SAMPLE) },
      'I want a refund on order #1042'
    );
    assert.match(refund, /need a person/);
    assert.match(refund, /paid/);
    assert.equal(/issued a refund/i.test(refund), false);
  }));

test('filterKnowledge drops cannot-see-Shopify once lookup is live', () => {
  const stale = ['Order lookups need a person. Vector cannot see Shopify.', 'Teal LED means charging.'];
  const prevStore = process.env.SHOPIFY_STORE;
  const prevToken = process.env.SHOPIFY_ACCESS_TOKEN;
  delete process.env.SHOPIFY_STORE;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  assert.equal(shopify.filterKnowledge(stale).length, 2);
  process.env.SHOPIFY_STORE = 'omi-test';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpua_test';
  const live = shopify.filterKnowledge(stale);
  assert.equal(live.length, 1);
  assert.match(live[0], /Teal LED/);
  if (prevStore === undefined) delete process.env.SHOPIFY_STORE;
  else process.env.SHOPIFY_STORE = prevStore;
  if (prevToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
  else process.env.SHOPIFY_ACCESS_TOKEN = prevToken;
});

test('lookupOrder hits Shopify by order name and skips logging PII in the result', async () => {
  await withShopifyEnv(async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return {
        status: 200,
        ok: true,
        json: async () => ({ orders: [SAMPLE] }),
      };
    };
    const result = await shopify.lookupOrder('Where is order #1042?', { fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.order.name, '#1042');
    assert.equal(result.order.city, 'Berlin');
    assert.equal(Object.prototype.hasOwnProperty.call(result.order, 'email'), false);
    assert.match(calls[0], /orders\.json/);
    assert.match(calls[0], /name=%231042|name=#1042/);
    assert.equal(/hidden@example/.test(JSON.stringify(result.order)), false);
  });
});

test('lookupOrder miss and no-key', async () => {
  await withShopifyEnv(async () => {
    const none = await shopify.lookupOrder('Where is my order?');
    assert.equal(none.reason, 'no-key');
    const fetchImpl = async () => ({
      status: 200,
      ok: true,
      json: async () => ({ orders: [] }),
    });
    const miss = await shopify.lookupOrder('order #9999', { fetchImpl });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, 'miss');
  });
});
