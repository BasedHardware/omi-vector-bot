const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { storedDocs } = require('../docs');

// Independent customer-shaped variants, not benchmark wording or expected URLs.
const variants = [
  {
    name: 'Android workshop with recording, notes and voice labels',
    question: 'My Android is all I brought to a workshop. How do I capture it, read the notes afterward, and teach Omi which voice is mine?',
    parts: ['phone microphone audio capture', 'conversation transcript summary viewing', 'Speech Profile voice identification'],
  },
  {
    name: 'iPhone without a pendant and finding the result',
    question: 'Before class: I have an iPhone but no pendant. Where do I press to record, and where do I open the result later?',
    parts: ['phone microphone recording controls', 'conversation transcript summary location'],
  },
  {
    name: 'voice setup first followed by handset capture and text review',
    question: 'I want my name on what I say. Can you walk me through voice setup, capturing a discussion with the handset microphone, and reading its text?',
    parts: ['Speech Profile personal voice setup', 'phone microphone conversation capture', 'transcript reading conversation screen'],
  },
];

for (const variant of variants) test(`short multipart retrieval keeps every part: ${variant.name}`, async () => {
  const subQuestions = variant.parts.map(query => ({ question: query, query }));
  const pages = subQuestions.map(part => ({
    url: new URL(randomUUID(), 'https://help.omi.me/en/articles/').href,
    title: part.query, body: `${part.query}: use the documented app control.`,
    source: 'help', chunk_index: 0, rank: 0.4,
  }));
  // Broad results may have stronger aggregate recall, but cannot crowd out an
  // already retrieved source for one of the customer's distinct requirements.
  const general = Array.from({ length: 12 }, () => ({
    url: new URL(randomUUID(), 'https://docs.omi.me/').href,
    title: 'General app guide', body: 'General app overview and background.',
    source: 'docs', chunk_index: 0, rank: 0.9,
  }));
  const searches = [];
  const evidence = await storedDocs(variant.question, {
    searchDocPages: async (query, _limit, sources = []) => {
      searches.push(query);
      if (sources.includes('github')) return [];
      const page = pages.find(item => item.title === query);
      if (page) return [page];
      return sources.includes('help') ? [pages[0]] : general;
    },
  }, ['general app guide', ...variant.parts], { subQuestions });
  for (let index = 0; index < pages.length; index += 1) {
    assert.ok(searches.includes(variant.parts[index]), `part ${index + 1} was searched`);
    assert.ok(evidence.includes(pages[index].url), `part ${index + 1} retains its retrieved source`);
  }
  assert.ok(evidence.length <= 9_000);
  assert.ok((evidence.match(/^\[S\d+ \|/gm) || []).length <= 8);
});
