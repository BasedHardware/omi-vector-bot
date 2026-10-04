const assert = require('node:assert/strict');
const test = require('node:test');
const { startDocsRetrieval } = require('../retrievalSession');

test('raw-question lookup starts immediately and planner-only queries are merged without duplicate evidence', async () => {
  const raw = '[S1 | Official docs | authoritative]\nPairing guide\nhttps://docs.omi.me/pair\nPair in the app.';
  const planned = '[S1 | Official docs | authoritative]\nConnection guide\nhttps://docs.omi.me/connect\nCheck the connection.';
  const calls = [];
  let finishRaw;
  const lookup = (question, options) => {
    calls.push({ question, options });
    if (calls.length === 1) return new Promise((resolve) => { finishRaw = () => resolve(raw); });
    return Promise.resolve(`${planned}\n\n${raw}`);
  };
  const complete = startDocsRetrieval('How do I pair Omi?', lookup);
  assert.equal(calls.length, 1, 'first search starts before planning finishes');
  const resultPromise = complete('How do I pair Omi?', ['Omi Bluetooth connection guide']);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].options.queries.includes('Omi Bluetooth connection guide'));
  assert.equal(calls[0].options.lookupCache, calls[1].options.lookupCache);
  finishRaw();
  const result = await resultPromise;
  assert.equal((result.match(/https:\/\/docs\.omi\.me\/pair/g) || []).length, 1);
  assert.equal((result.match(/https:\/\/docs\.omi\.me\/connect/g) || []).length, 1);
});

test('no second lookup is made when planning adds no new search wording', async () => {
  let calls = 0;
  const complete = startDocsRetrieval('Where is the pairing guide?', async () => {
    calls += 1;
    return '[S1 | Official docs | authoritative]\nPairing\nhttps://docs.omi.me/pair\nGuide';
  });
  await complete('Where is the pairing guide?', []);
  assert.equal(calls, 1);
});
