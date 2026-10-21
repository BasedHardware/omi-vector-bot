const assert = require('node:assert/strict');
const test = require('node:test');
const {
  consumerSourceFit,
  mergeRanked,
  rankLocalChunks,
  selectSubQuestionEvidence,
} = require('../retrieval');
const { topPages } = require('../docs');

const phoneQuestion = 'Rename a saved task in the Android app';

function sourceRows() {
  return {
    guide: {
      title: 'Rename saved task in Android app',
      body: 'Select a saved task and change its label in the Android app.',
      blurb: 'Rename saved task in Android app',
      url: 'https://docs.omi.me/user-guide/synthetic-task-labels',
      source: 'docs', chunk_index: 0, rank: 0.9,
    },
    charging: {
      title: 'Charging your device',
      body: 'Connect the phone app before charging your device.',
      blurb: 'Connect the phone app before charging your device.',
      url: 'https://help.omi.me/en/articles/synthetic-charging-guide',
      source: 'help', chunk_index: 0, rank: 0.2,
    },
  };
}

test('phone rank fusion keeps a more relevant docs page above unrelated help', () => {
  const { guide, charging } = sourceRows();
  const ranked = mergeRanked([[charging], [guide]], 2, { customerQuestion: phoneQuestion });
  assert.equal(ranked[0].url, guide.url);
  assert.equal(ranked.length, 2, 'lower-ranked evidence is not removed');
});

test('phone local ranking keeps the answering docs chunk above unrelated help', () => {
  const { guide, charging } = sourceRows();
  const ranked = rankLocalChunks([phoneQuestion], [charging, guide], 2, { customerQuestion: phoneQuestion });
  assert.equal(ranked[0].url, guide.url);
});

test('phone index selection fetches the matching docs page rather than unrelated help', () => {
  const { guide, charging } = sourceRows();
  assert.equal(topPages(phoneQuestion, [charging, guide], 1)[0].url, guide.url);
});

test('each phone sub-question chooses its best match before source preference', () => {
  const { guide, charging } = sourceRows();
  const subQuestions = [
    { question: phoneQuestion, query: 'rename saved task Android app' },
    { question: 'Choose notification options', query: 'notification preferences' },
    { question: 'Choose a profile language', query: 'profile language' },
    { question: 'Share a conversation', query: 'share conversation' },
  ];
  const complements = subQuestions.slice(1).map((part, index) => ({
    title: part.query, body: part.query, source: 'docs', chunk_index: 0,
    url: `https://docs.omi.me/user-guide/synthetic-complement-${index}`,
  }));
  const ranked = selectSubQuestionEvidence([charging, guide, ...complements], subQuestions, 8, {
    customerQuestion: phoneQuestion,
  });
  assert.equal(ranked[0].url, guide.url);
  for (const page of complements) assert.ok(ranked.some(row => row.url === page.url));
  assert.ok(ranked.length <= 8);
  assert.ok(new Set(ranked.map(row => row.url)).size <= 4);
});

test('consumer phone fit only demotes incompatible pages and gives no domain bonus', () => {
  const { guide, charging } = sourceRows();
  assert.equal(consumerSourceFit(phoneQuestion, guide), 0);
  assert.equal(consumerSourceFit(phoneQuestion, charging), 0);
  for (const page of [
    { ...guide, url: 'https://docs.omi.me/python_sdk/synthetic-task-labels' },
    { ...guide, title: `${guide.title} desktop` },
  ]) assert.ok(consumerSourceFit(phoneQuestion, page) < 0);
});

test('equally relevant SDK pages stay below the phone guide in every selector', () => {
  const { guide } = sourceRows();
  const sdk = { ...guide, url: 'https://docs.omi.me/sdk/synthetic-task-labels' };
  const options = { customerQuestion: phoneQuestion };
  assert.equal(mergeRanked([[sdk], [guide]], 2, options)[0].url, guide.url);
  assert.equal(rankLocalChunks([phoneQuestion], [sdk, guide], 2, options)[0].url, guide.url);
  assert.equal(topPages(phoneQuestion, [sdk, guide], 2)[0].url, guide.url);
  const parts = Array.from({ length: 4 }, () => phoneQuestion);
  // Distinct planner parts are necessary to exercise the multipart selector.
  assert.equal(selectSubQuestionEvidence([sdk, guide], parts.map((question, index) => ({
    question: `${question} part ${index}`, query: phoneQuestion,
  })), 2, options)[0].url, guide.url);
});

test('phone relevance stays ahead of existing Help Center authority bonuses', () => {
  const question = 'Android task label';
  const guide = {
    title: question, body: question, source: 'docs', chunk_index: 0, rank: 0.9,
    url: 'https://docs.omi.me/user-guide/synthetic-label-guide',
  };
  const help = {
    title: 'Android task', body: 'Label options are described here.', source: 'help', chunk_index: 0, rank: 0.89,
    url: 'https://help.omi.me/en/articles/synthetic-task-overview',
  };
  assert.equal(rankLocalChunks([question], [help, guide], 2, { customerQuestion: question })[0].url, guide.url);
  assert.equal(mergeRanked([[help], [guide]], 2, { customerQuestion: question })[0].url, guide.url);
});

test('explicit developer and desktop questions keep their existing ranking policy', () => {
  const { guide, charging } = sourceRows();
  const sdk = { ...guide, url: 'https://docs.omi.me/sdk/synthetic-task-labels' };
  for (const question of [
    'Use the SDK to rename a task from an Android app',
    'Rename a task on the desktop and Android app',
  ]) {
    assert.equal(consumerSourceFit(question, guide), 0);
    assert.equal(consumerSourceFit(question, sdk), 0);
    assert.equal(consumerSourceFit(question, charging), 0);
    const ranked = mergeRanked([[charging], [guide]], 2, { customerQuestion: question });
    assert.equal(ranked[0].url, guide.url, 'provider relevance is preserved');
  }
});
