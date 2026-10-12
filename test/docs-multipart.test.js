const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs } = require('../docs');

test('multipart cold-index retrieval fetches complementary pages before broad overview hits consume the slots', async () => {
  const parts = [
    { question: 'Start microphone capture', query: 'microphone capture start' },
    { question: 'Select a transcription language', query: 'transcription language selection' },
    { question: 'Remove one conversation', query: 'individual conversation deletion' },
    { question: 'Find extracted tasks', query: 'extracted action tasks' },
  ];
  const pages = parts.map((part, index) => ({
    title: part.query, url: `https://docs.omi.me/fixture/part-${index}.md`,
    body: `${part.query}: follow the documented control for this feature.`,
  }));
  const generic = Array.from({ length: 3 }, (_, index) => ({
    title: 'App overview', url: `https://docs.omi.me/fixture/overview-${index}.md`,
    body: 'App overview: introductory information about the app.',
  }));
  const fetched = [];
  const evidence = await relevantDocs('Omi app overview', {
    queries: ['App overview'], subQuestions: parts,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/llms.txt')) return {
        ok: true, text: async () => [...generic, ...pages].map((page) => `- [${page.title}](${page.url}): ${page.title}`).join('\n'),
      };
      fetched.push(String(url));
      const page = [...generic, ...pages].find((item) => item.url === url);
      return { ok: true, text: async () => page?.body || '' };
    },
  });
  assert.ok(fetched.length <= 6, 'existing page-fetch limit is unchanged');
  for (const page of pages) assert.ok(evidence.includes(page.url), page.title);
  assert.equal(new Set([...evidence.matchAll(/^https:\/\/\S+/gm)].map((match) => match[0])).size, 4);
  assert.ok(evidence.length <= 9_000);
});
