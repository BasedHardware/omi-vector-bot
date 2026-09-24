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
  assert.ok(v.reserveAttempt('u1', 'a@b.co'));
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

const LIVE_ENV = {
  SHOPIFY_STORE: 'omi-test',
  SHOPIFY_ACCESS_TOKEN: 'shpua_test',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  RESEND_API_KEY: 're_test',
  EMAIL_FROM: 'help@omi.me',
};

function shopifyResponse(mode) {
  if (mode === 'throw') throw new Error('socket hang up');
  if (typeof mode === 'number') return { status: mode, ok: false, json: async () => ({}) };
  const orders =
    mode === 'hit'
      ? [{ name: '#1001', email: 'owner@example.com', financial_status: 'paid', fulfillments: [] }]
      : [];
  return { status: 200, ok: true, json: async () => ({ orders }) };
}

async function withLiveShop(fn) {
  const prevEnv = {};
  for (const [key, value] of Object.entries(LIVE_ENV)) {
    prevEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const prevFetch = globalThis.fetch;
  const prevError = console.error;
  const shop = { mode: 'hit', calls: 0, emails: [], errors: [] };
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.includes('.myshopify.com/')) {
      shop.calls += 1;
      return shopifyResponse(shop.mode);
    }
    if (href === 'https://api.resend.com/emails') {
      shop.emails.push(JSON.parse(init.body));
      return { status: 200, ok: true, json: async () => ({ id: 'email_1' }) };
    }
    throw new Error(`unexpected fetch ${href}`);
  };
  console.error = (...args) => shop.errors.push(args.join(' '));
  shopifyBind.reset();
  orderFlow.verification.reset();
  try {
    await fn(shop);
  } finally {
    globalThis.fetch = prevFetch;
    console.error = prevError;
    shopifyBind.reset();
    orderFlow.verification.reset();
    for (const [key, value] of Object.entries(prevEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fakeInteraction(kind, extra) {
  const sent = [];
  return {
    sent,
    user: { id: 'u1' },
    isChatInputCommand: () => kind === 'command',
    isModalSubmit: () => kind === 'modal',
    isRepliable: () => true,
    reply: async (payload) => {
      sent.push(payload);
    },
    ...extra,
  };
}

function slash(commandName) {
  return fakeInteraction('command', { commandName });
}

function submit(customId, value) {
  return fakeInteraction('modal', { customId, fields: { getTextInputValue: () => value } });
}

async function send(interaction) {
  assert.equal(await orderFlow.handleOrderInteraction(interaction), true);
  return interaction.sent.map((payload) => payload.content);
}

test('bound /order and /orders say the lookup failed when Shopify errors, not that there are no orders', async () => {
  await withLiveShop(async (shop) => {
    await shopifyBind.set('u1', 'owner@example.com');
    for (const [mode, command] of [
      [401, 'order'],
      [503, 'orders'],
    ]) {
      shop.mode = mode;
      assert.deepEqual(
        await send(slash(command)),
        ['Order lookup failed. Try again in a moment.'],
        `${command} ${mode}`
      );
    }
    assert.equal(shop.errors.length, 2);
    assert.match(shop.errors.join('\n'), /Shopify lookup failed: auth[\s\S]*Shopify lookup failed: error/);
    assert.doesNotMatch(shop.errors.join('\n'), /owner@example\.com/);
  });
});

test('bound /order still says no recent orders when Shopify answers with none', async () => {
  await withLiveShop(async (shop) => {
    await shopifyBind.set('u1', 'owner@example.com');
    shop.mode = 'empty';
    assert.deepEqual(await send(slash('orders')), ['No recent orders were found for your verified email.']);
    assert.deepEqual(shop.errors, []);
  });
});

test('link_email does not say a code was sent when Shopify fails, and gives the send back', async () => {
  await withLiveShop(async (shop) => {
    for (const mode of [500, 401, 'throw']) {
      shop.mode = mode;
      assert.deepEqual(await send(submit('link_email', 'owner@example.com')), [
        'Order lookup failed. Try again in a moment.',
      ]);
    }
    assert.equal(shop.emails.length, 0);
    shop.mode = 'hit';
    const [reply] = await send(submit('link_email', 'owner@example.com'));
    assert.match(reply, /a verification code was sent/);
    assert.equal(shop.emails.length, 1);
  });
});

test('link_email still spends a send on an email with no order', async () => {
  await withLiveShop(async (shop) => {
    shop.mode = 'empty';
    const replies = [];
    for (let i = 0; i < 4; i += 1) {
      const [reply] = await send(submit('link_email', 'stranger@example.com'));
      replies.push(reply);
    }
    assert.match(replies[0], /If that email matches a recent order, a verification code was sent/);
    assert.equal(replies[2], replies[0]);
    assert.equal(replies[3], 'Too many verification requests. Try again later.');
    assert.equal(shop.emails.length, 0);
    assert.equal(shop.calls, 3);
  });
});

test('verify_code keeps the link and says so when Shopify fails right after', async () => {
  await withLiveShop(async (shop) => {
    await send(submit('link_email', 'owner@example.com'));
    const code = shop.emails[0].text.match(/\b(\d{6})\b/)[1];
    shop.mode = 503;
    assert.deepEqual(await send(submit('verify_code', code)), [
      'Verified. Order lookup failed. Try /order again in a moment.',
    ]);
    assert.equal((await shopifyBind.get('u1')).email, 'owner@example.com');
    assert.doesNotMatch(shop.errors.join('\n'), /owner@example\.com/);
  });
});

test('hasRecentOrderForEmail throws instead of answering no when Shopify fails', async () => {
  process.env.SHOPIFY_STORE = 'omi-test';
  process.env.SHOPIFY_ACCESS_TOKEN = 'shpua_test';
  try {
    await assert.rejects(
      shopify.hasRecentOrderForEmail('owner@example.com', { fetchImpl: async () => shopifyResponse(503) }),
      /Shopify lookup failed: error/
    );
  } finally {
    delete process.env.SHOPIFY_STORE;
    delete process.env.SHOPIFY_ACCESS_TOKEN;
  }
});

test('releaseAttempt gives back the send it was handed, not a later one', () => {
  const v = new VerificationService({ maxSendsPerHour: 2 });
  const now = Date.now;
  try {
    Date.now = () => 1000;
    const first = v.reserveAttempt('u1', 'a@b.co');
    Date.now = () => 2000;
    v.reserveAttempt('u1', 'a@b.co');
    v.releaseAttempt('u1', 'a@b.co', first);
    assert.deepEqual(v.sends.get('u1:a@b.co').timestamps, [2000]);
    assert.ok(v.reserveAttempt('u1', 'a@b.co'));
    assert.equal(v.reserveAttempt('u1', 'a@b.co'), false);
  } finally {
    Date.now = now;
  }
});
