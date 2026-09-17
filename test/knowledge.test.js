const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseFaqCommand,
  addSnippet,
  search,
  resetKnowledge,
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

test('user prompt tells the model to use staff-saved knowledge words', () => {
  const { buildUserPrompt, buildSystemPrompt } = require('../prompt');
  const user = buildUserPrompt({
    question: 'Where is my order?',
    threadHistory: [],
    knowledgeSnippets: ['Order and tracking lookups need a person. Vector cannot see Shopify.'],
  });
  assert.match(user, /staff-saved/i);
  assert.match(user, /Shopify/);
  assert.match(buildSystemPrompt(), /Keep names they used/);
});
