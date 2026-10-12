const test = require('node:test');
const assert = require('node:assert/strict');
const { ActionRowBuilder } = require('discord.js');
const { closePayload, closeHandoff } = require('../commands');
const { createCaseService, createMemoryStore } = require('../supportCases');

test('Spanish closing card localizes every customer-facing section and button', () => {
  const payload = closePayload({ id: 'staff-1' }, 'es');
  const embed = payload.embeds[0];
  assert.equal(embed.title, '¿Cómo lo hicimos?');
  assert.match(embed.description, /Gracias.*ayudarte/);
  assert.match(embed.description, /Resuelto por <@staff-1>/);
  assert.match(embed.description, /Solo.*abrió.*comentarios/);
  assert.match(embed.fields[0].name, /reseña sincera.*opcional/);
  assert.match(embed.fields[0].value, /opcional y no afecta.*soporte/);
  assert.deepEqual(payload.components.flatMap(row => row.components.map(button => button.label)), [
    'Sí, mi problema está resuelto', 'Aún necesito ayuda', 'Reseñar en App Store', 'Abrir Google Play',
  ]);
});

test('Chinese closing card localizes the title, description, review copy and all buttons', () => {
  const payload = closePayload({ id: 'staff-2' }, 'zh');
  const embed = payload.embeds[0];
  assert.equal(embed.title, '我们的服务怎么样？');
  assert.match(embed.description, /感谢.*帮助/);
  assert.match(embed.description, /<@staff-2>.*已解决/);
  assert.match(embed.fields[0].name, /真实.*自愿/);
  assert.match(embed.fields[0].value, /自愿.*不会影响/);
  assert.deepEqual(payload.components.flatMap(row => row.components.map(button => button.label)), [
    '是的，问题已解决', '仍然需要帮助', '在 App Store 评价', '打开 Google Play',
  ]);
});

test('unknown or missing language preserves the existing English card byte for byte', () => {
  const expected = closePayload({ id: 'staff' });
  assert.equal(expected.embeds[0].title, 'How did we do?');
  for (const language of ['xx', '__proto__', null, undefined]) {
    assert.deepEqual(closePayload({ id: 'staff' }, language), expected);
  }
});

test('closing copy covers exactly the acceptance languages with matching regional fallback', () => {
  const { CLOSING_COPY } = require('../closingCopy');
  const { ACCEPTANCE_COPY } = require('../caseCards');
  assert.deepEqual(Object.keys(CLOSING_COPY).sort(), Object.keys(ACCEPTANCE_COPY).sort());
  for (const language of Object.keys(ACCEPTANCE_COPY)) {
    const payload = closePayload({ id: 'staff' }, language);
    assert.deepEqual(payload.components[0].components.map(button => button.custom_id), ['rate:yes', 'rate:no']);
    assert.deepEqual(payload.allowedMentions, { parse: [] });
    for (const row of payload.components) assert.doesNotThrow(() => new ActionRowBuilder(row).toJSON());
    assert.deepEqual(payload.components[1].components.map(button => button.url),
      closePayload({ id: 'staff' }).components[1].components.map(button => button.url));
    if (language !== 'en') assert.notEqual(payload.embeds[0].title, 'How did we do?');
    assert.ok(payload.embeds[0].description.includes('<@staff>'));
  }
  assert.deepEqual(closePayload({ id: 'staff' }, 'es-MX'), closePayload({ id: 'staff' }, 'es'));
  assert.deepEqual(closePayload({ id: 'staff' }, 'zh-Hans'), closePayload({ id: 'staff' }, 'zh'));
  assert.notDeepEqual(closePayload({ id: 'staff' }, 'hi-Latn'), closePayload({ id: 'staff' }, 'hi-Deva'));
});

for (const [language, title] of [['es', '¿Cómo lo hicimos?'], ['zh', '我们的服务怎么样？'], ['xx', 'How did we do?']]) {
  test(`/done uses stored context.replyLanguage (${language}), not the acting staff language`, async () => {
    const cases = createCaseService(createMemoryStore());
    const value = await cases.getOrCreateCase({ channelId: `help-${language}`, customerId: 'customer',
      customerThreadId: `help-${language}`, context: { replyLanguage: language } });
    const sent = [];
    const result = await closeHandoff({ id: `help-${language}`, name: 'Handoff · app', isThread: () => true,
      send: async payload => { sent.push(payload); return { id: 'closing-notice' }; }, edit: async () => {},
    }, { id: 'staff', locale: 'en-US' }, { cases, db: { getPendingEscalation: async () => null } });
    assert.equal(result.ok, true);
    assert.equal(sent[0].embeds[0].title, title);
    assert.equal((await cases.getCaseById(value.id)).status, 'closed');
  });
}
