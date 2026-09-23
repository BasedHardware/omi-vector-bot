const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseFaqCommand,
  addSnippet,
  search,
  resetKnowledge,
  applyStaffFacts,
  collectFaqFromMessages,
  hydrateFromDiscord,
  filterSnippetsForLane,
} = require('../knowledge');
const { canSaveFaq, isHandoffThread } = require('../handoff');

test('parseFaqCommand reads faq lines and rejects normal staff talk', () => {
  assert.equal(parseFaqCommand('Keep the app in the background.'), null);
  assert.equal(parseFaqCommand('faq:'), '');
  assert.equal(
    parseFaqCommand('faq: Order lookups need a person. Vector cannot see Shopify.'),
    'Order lookups need a person. Vector cannot see Shopify.'
  );
  assert.equal(
    parseFaqCommand('FAQ:   teal LED means charging and connected'),
    'teal LED means charging and connected'
  );
});

test('addSnippet stores searchable facts and rejects empty or staff-lie lines', () => {
  resetKnowledge();
  assert.equal(addSnippet('').ok, false);
  assert.equal(addSnippet('   ').ok, false);
  assert.equal(addSnippet('I have spoken to the higher-ups already.').ok, false);
  assert.equal(addSnippet('I have spoken to the higher-ups already.').reason, 'lie');

  const saved = addSnippet('Order and tracking lookups need a person. Vector cannot see Shopify.');
  assert.equal(saved.ok, true);
  const hits = search('where is my order');
  assert.equal(hits.length >= 1, true);
  assert.match(hits[0], /cannot see Shopify/);
  const punctuated = search('Where is my order?');
  assert.equal(punctuated.length >= 1, true);
  assert.match(punctuated[0], /Shopify/);
  assert.equal(search('pairing bluetooth').length, 0);
  resetKnowledge();
});

test('only named staff can save when an allow list is set', () => {
  assert.equal(canSaveFaq('111', []), true);
  assert.equal(canSaveFaq('123456789012345678', ['123456789012345678', '999']), true);
  assert.equal(canSaveFaq('111', ['123456789012345678']), false);
});

test('normal Handoff sentences are not faq commands so Vector stays quiet', () => {
  assert.equal(isHandoffThread({ isThread: () => true, name: 'Handoff · astar6969' }), true);
  assert.equal(parseFaqCommand('I will look up the order in Shopify.'), null);
});

test('tech lanes drop pairing FAQ facts', () => {
  const mixed = [
    'Pairing: open the Omi app and wait for Bluetooth.',
    'Order and tracking lookups need a person. Vector cannot see Shopify.',
  ];
  assert.deepEqual(filterSnippetsForLane(mixed, 'tech'), []);
  assert.equal(filterSnippetsForLane(mixed, 'faq').length, 1);
  assert.deepEqual(
    filterSnippetsForLane(
      [
        'The blue light on the necklace means it is on and connected.',
        'Order and tracking lookups need a person. Vector cannot see Shopify.',
      ],
      'shop'
    ),
    ['Order and tracking lookups need a person. Vector cannot see Shopify.']
  );
});

test('a deletion answer does not pick up the Shopify fact', () => {
  const snippets = filterSnippetsForLane(
    ['Order and tracking lookups need a person. Vector cannot see Shopify.'],
    'tech'
  );
  const out = applyStaffFacts(
    'I hear you: on the desktop app, deleting a memory or conversation just gives you an error, and on mobile it looks deleted, then comes back about thirty seconds later.',
    snippets
  );
  assert.equal(/shopify|order and tracking/i.test(out), false);
  assert.match(out, /desktop app/i);
});

test('applyStaffFacts prepends Shopify when the model dropped it', () => {
  const out = applyStaffFacts(
    "I can't see orders, tracking, or shipping from here, so I won't guess at a status or a date.",
    ['Order and tracking lookups need a person. Vector cannot see Shopify.']
  );
  assert.match(out, /Shopify/);
  assert.match(out, /can't see orders/);
  const already = applyStaffFacts(
    'Vector cannot see Shopify. Keep the order number handy.',
    ['Order and tracking lookups need a person. Vector cannot see Shopify.']
  );
  assert.equal((already.match(/Shopify/g) || []).length, 1);
});

test('collectFaqFromMessages reads faq lines from Handoff history and skips bots', () => {
  const found = collectFaqFromMessages([
    { author: { bot: true }, content: 'faq: ignore the bot' },
    { author: { bot: false }, content: 'any update on it' },
    {
      author: { bot: false },
      content: 'faq: Order and tracking lookups need a person. Vector cannot see Shopify.',
    },
  ]);
  assert.deepEqual(found, [
    'Order and tracking lookups need a person. Vector cannot see Shopify.',
  ]);
});

test('user prompt tells the model to use staff-saved knowledge words', () => {
  const { buildUserPrompt, buildSystemPrompt, faqTextForLane, buildToolFacts } = require('../prompt');
  const user = buildUserPrompt({
    question: 'Where is my order?',
    threadHistory: [],
    knowledgeSnippets: ['Order and tracking lookups need a person. Vector cannot see Shopify.'],
    route: { lane: 'shop', area: 'shop' },
  });
  assert.match(user, /staff-saved/i);
  assert.match(user, /Shopify/);
  assert.match(user, /Lane: shop/);
  assert.match(buildSystemPrompt({ lane: 'faq' }), /Omi Support/);
  assert.match(buildSystemPrompt({ lane: 'faq' }), /Keep names they used/);
  assert.match(buildSystemPrompt({ lane: 'faq' }), /customer/i);
  assert.match(buildSystemPrompt({ lane: 'faq' }), /Everyday words/);
  assert.match(buildSystemPrompt({ lane: 'firmware' }), /Think about their message/);
  assert.match(buildSystemPrompt({ lane: 'account' }), /numbered questions/);
  assert.match(buildSystemPrompt({ lane: 'faq' }), /"topic"/);
  assert.match(faqTextForLane('faq'), /Pairing/);
  assert.equal(/Pairing|Bluetooth/i.test(faqTextForLane('tech')), false);
  assert.equal(/Pairing|swipe it away/i.test(faqTextForLane('unknown')), false);
  assert.equal(/Pairing|swipe it away/i.test(faqTextForLane('account')), false);
  assert.match(faqTextForLane('account'), /do not need a computer/i);
  assert.match(faqTextForLane('tech'), /Do not invent order status/);
  assert.match(faqTextForLane('tech'), /blue = on, connected/);
  assert.equal(/Pairing: turn the device/i.test(faqTextForLane('tech')), false);
  assert.match(faqTextForLane('shop'), /Do not invent order status/);
  assert.equal(/blue = on|necklace|recording/i.test(faqTextForLane('shop')), false);
  assert.match(buildSystemPrompt({ lane: 'shop' }), /Do not mention device lights/);
  assert.equal(/If they mention a device light/i.test(buildSystemPrompt({ lane: 'shop' })), false);
  const techPrompt = buildSystemPrompt({ lane: 'tech' });
  assert.match(techPrompt, /Do not name a cause/);
  assert.equal(/They may still be on the watch or phone/i.test(techPrompt), false);
  const asked = buildUserPrompt({
    question: 'Are my recordings deleted?',
    threadHistory: [],
    knowledgeSnippets: [],
    route: { lane: 'tech', area: 'app' },
  });
  assert.match(asked, /may still be on the watch or phone/i);
  const notAsked = buildUserPrompt({
    question: 'Keep getting transcription unavailable',
    threadHistory: [],
    knowledgeSnippets: [],
    route: { lane: 'tech', area: 'app' },
  });
  assert.equal(/may still be on the watch or phone/i.test(notAsked), false);
  const accountTools = buildToolFacts({
    route: { lane: 'account', area: 'shop' },
  });
  assert.match(accountTools, /computer is extra/i);
  assert.equal(/paid, shipped/i.test(accountTools), false);
  const tools = buildToolFacts({
    route: { lane: 'tech', area: 'desktop' },
    githubText: '',
  });
  assert.match(tools, /cannot open their phone/i);
  assert.match(tools, /This ticket:/i);
  assert.match(tools, /If they named a light colour/i);
  assert.equal(/do not teach Bluetooth, lights/i.test(tools), false);
  assert.match(tools, /OpenRouter/);
  assert.equal(/paid, shipped/i.test(tools), false);
});

test('hydrateFromDiscord reloads faq lines from Handoff threads', async () => {
  resetKnowledge();
  const previous = process.env.VECTOR_TEST_CHANNEL_ID;
  process.env.VECTOR_TEST_CHANNEL_ID = 'chan1';
  const messages = new Map([
    [
      '1',
      {
        author: { bot: false },
        content: 'faq: Order and tracking lookups need a person. Vector cannot see Shopify.',
      },
    ],
  ]);
  const thread = {
    id: 't1',
    name: 'Handoff · astar6969',
    messages: { fetch: async () => messages },
  };
  const client = {
    channels: {
      fetch: async () => ({
        threads: {
          fetchActive: async () => ({ threads: new Map([['t1', thread]]) }),
          fetchArchived: async () => ({ threads: new Map() }),
        },
      }),
    },
  };
  const added = await hydrateFromDiscord(client);
  assert.equal(added, 1);
  assert.match(search('order')[0], /Shopify/);
  resetKnowledge();
  if (previous === undefined) delete process.env.VECTOR_TEST_CHANNEL_ID;
  else process.env.VECTOR_TEST_CHANNEL_ID = previous;
});

test('a question in another script does not pull an unrelated staff fact', () => {
  resetKnowledge();
  addSnippet('Order and tracking lookups need a person. Vector cannot see Shopify.');
  assert.equal(search('मेरा ऑर्डर कहाँ है?').length, 0);
  assert.equal(search('Мой заказ не пришёл').length, 0);
  assert.equal(search('주문 어디쯤 왔나요?').length, 0);
  assert.equal(search('Where is my order?').length, 1);
  resetKnowledge();
});
