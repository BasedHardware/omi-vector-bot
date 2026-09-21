const assert = require('node:assert/strict');
const test = require('node:test');
const { VerificationService, normalizeEmail } = require('../verification');
const shopifyBind = require('../shopifyBind');
const orderFlow = require('../orderFlow');
const shopify = require('../shopify');

test('normalizeEmail rejects junk', () => {
  assert.equal(normalizeEmail('  A@B.CO  '), 'a@b.co');
  assert.equal(normalizeEmail('not-mail'), '');
});

test('OTP verify is bound to the Discord user and expires attempts', () => {
  const v = new VerificationService({ ttlMinutes: 10, maxAttempts: 2, maxSendsPerHour: 3 });
  assert.equal(v.reserveAttempt('u1', 'a@b.co'), true);
  const code = v.create('u1', 'a@b.co');
  assert.equal(v.verify('u2', code).ok, false);
  assert.equal(v.verify('u1', '000000').ok, false);
  const ok = v.verify('u1', code);
  assert.equal(ok.ok, true);
  assert.equal(ok.email, 'a@b.co');
});

test('encrypted bind stores email per Discord user', async () => {
  process.env.DATA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  shopifyBind.reset();
  assert.equal(shopifyBind.isReady(), true);
  assert.equal(await shopifyBind.get('99'), null);
  await shopifyBind.set('99', 'owner@example.com');
  assert.equal((await shopifyBind.get('99')).email, 'owner@example.com');
  assert.equal(await shopifyBind.get('100'), null);
  assert.equal(await shopifyBind.remove('99'), true);
  assert.equal(await shopifyBind.get('99'), null);
  shopifyBind.reset();
  delete process.env.DATA_ENCRYPTION_KEY;
});

test('/order stays dark until Shopify, bind key, and Resend are all set', () => {
  delete process.env.SHOPIFY_STORE;
  delete process.env.SHOPIFY_ACCESS_TOKEN;
  delete process.env.DATA_ENCRYPTION_KEY;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
  assert.equal(orderFlow.isLive(), false);
});

test('hasRecentOrderForEmail is false without a matching order', async () => {
  process.env.SHOPIFY_STORE = 'omi-test';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpua_test';
  try {
    const hit = await shopify.hasRecentOrderForEmail('owner@example.com', {
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        json: async () => ({
          orders: [{ name: '#1', email: 'owner@example.com', financial_status: 'paid', fulfillments: [] }],
        }),
      }),
    });
    assert.equal(hit, true);
    const miss = await shopify.hasRecentOrderForEmail('owner@example.com', {
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        json: async () => ({ orders: [] }),
      }),
    });
    assert.equal(miss, false);
  } finally {
    delete process.env.SHOPIFY_STORE;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
  }
});
