const assert = require('node:assert/strict');
const test = require('node:test');
const router = require('../router');

const howtos = [
  'I cannot locate the language menu in the iPhone app; please point me to it.',
  "I'm lost in the Android settings and don't know where to enable transcription.",
  'For the desktop app, what happens if the connection fails while my laptop is offline?',
  'No puedo encontrar dónde elegir el idioma en mi iPhone; necesito una guía.',
  'Estoy perdida en los ajustes de Android, no sé cómo seleccionar la transcripción.',
  '¿Qué debo hacer si la aplicación de iPhone falla cuando el teléfono está sin conexión?',
];
const failures = [
  "I can't locate any voice clips I captured this morning; the recordings are missing in the Android app.",
  "I'm lost trying to recover a meeting: my iPhone app froze and the transcript never saved.",
  "The desktop app stays offline after reconnecting to the router; it doesn't sync.",
  'Estoy perdido: la aplicación de iPhone se bloquea y muestra error 503 al abrir una conversación.',
  'Cuando abro la transcripción en Android, la aplicación deja de responder y falla cada vez.',
  'Si intento iniciar una grabación en mi iPhone, aparece un error y no graba nada.',
];

for (const [i, question] of howtos.entries()) {
  test(`navigation or hypothetical how-to ${i + 1} does not escalate`, () => {
    assert.equal(router.classify(question).escalate, false);
  });
}
for (const [i, question] of failures.entries()) {
  test(`actual report alongside navigation or a condition ${i + 1} still escalates`, () => {
    assert.equal(router.classify(question).escalate, true);
  });
}

test('navigation and uncertainty grammar does not negate an independent incident', () => {
  for (const navigation of [
    "can't find", 'cannot locate', "couldn't see where", "can't figure out", 'cannot work out',
    "I'm lost", 'I am lost', 'not sure how', "don't know how", "don't know where",
  ]) {
    assert.equal(router.classify(`In the iPhone app, ${navigation} the transcription settings.`).escalate, false, navigation);
    assert.equal(router.classify(`In the iPhone app, ${navigation} the transcription settings. The app crashed with error code 503.`).escalate, true, navigation);
  }
});

test('only conditional clauses are excluded, not the actual failure before or after them', () => {
  for (const marker of ['if', 'when', 'while', 'in case', 'whenever']) {
    assert.equal(router.classify(`Please explain Android recording ${marker} my phone is offline.`).escalate, false, marker);
    assert.equal(router.classify(`My Android app crashed ${marker} I opened a transcript.`).escalate, true, marker);
    assert.equal(router.classify(`${marker} my phone is offline, Android transcription stops with error 503.`).escalate, true, marker);
  }
  assert.equal(router.classify('Explain iPhone recording when the phone is offline, but my saved recordings are gone.').escalate, true);
});

test('navigation and hypothetical wording do not bypass protected person-required lanes', () => {
  for (const question of [
    "I can't figure out this Android setting; I want a refund.",
    'Explain desktop recording when it is offline; please delete my account.',
    'Estoy perdida en Android y necesito una persona del equipo. I need a human to help.',
    "I cannot locate the billing page; my subscription was charged twice.",
  ]) assert.equal(router.classify(question).escalate, true, question);
});

test('independent loss and unpunctuated main-clause faults remain reports', () => {
  for (const question of [
    'I cannot locate Monday’s iPhone recordings; they are gone.',
    'When I launch the Android app it crashes before the home screen loads.',
    'Cuando abro la aplicación en Android se bloquea con error 503.',
    'When my desktop app froze this morning I had to stop the meeting.',
  ]) assert.equal(router.classify(question).escalate, true, question);
  assert.equal(router.classify('Explain Android recording if the phone is offline and the app fails.').escalate, false);
});
