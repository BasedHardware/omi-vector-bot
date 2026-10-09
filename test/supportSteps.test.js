const assert = require('node:assert/strict');
const test = require('node:test');
const { hasTroubleshootingStep, isInstructionSentence } = require('../supportSteps');

test('source lines use the same multilingual punctuation rules as answer presentation', () => {
  for (const label of ['Source', 'Sources', 'Fuente', 'Fuentes', 'Quelle', 'Quellen', 'Fonte', 'Fontes', 'Fonti',
    'Sumber', 'Kaynak', 'Srot', 'स्रोत', '出典', '来源', '來源', '출처', 'Источник', 'Riferimenti']) {
    for (const colon of [':', '：']) {
      const citation = `${label} ${colon} https://help.omi.me/guide. Open is part of the cited page title.`;
      assert.equal(hasTroubleshootingStep(`This describes the reported behavior.\n${citation}`), false, `${label}${colon}`);
      assert.equal(hasTroubleshootingStep(`Restart the app.\n${citation}`), true, `${label}${colon}`);
    }
  }
});

test('citation normalization does not suppress actual steps or ordinary source prose', () => {
  assert.equal(isInstructionSentence('Open Settings → Profile.'), true);
  assert.equal(hasTroubleshootingStep('Sources of background problems vary.\nOpen Settings → Profile.'), true);
  assert.equal(hasTroubleshootingStep('The source of the issue is unknown.'), false);
});
