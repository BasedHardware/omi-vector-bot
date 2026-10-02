const assert = require('node:assert/strict');
const test = require('node:test');
const {
  feedbackPage,
  feedbackPostFromHtml,
  feedbackPostUrls,
  rankFeedbackPages,
  relevantFeedback,
} = require('../feedback');

function pageHtml(post) {
  const payload = {
    props: {
      pageProps: {
        fallback: {
          'rq:single:/v1/submission': { data: { results: [post] } },
        },
      },
    },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></html>`;
}

const calendarPost = {
  title: 'Google calender person@example.com',
  slug: 'google-calender',
  content:
    '<p>Google says “This app is blocked”, and the Omi integration only shows my main calendar. Contact me at person@example.com.</p>',
  postStatus: { name: 'In Progress', type: 'active' },
  postCategory: { name: { en: 'Bugs & Errors' } },
  upvotes: 8,
  commentCount: 8,
  date: '2026-03-17T02:14:23.840Z',
  lastModified: '2026-10-01T15:46:40.700Z',
  user: { name: 'Customer', email: 'person@example.com' },
  comments: [{ content: 'Use Advanced and continue anyway.' }],
};

test('the Feedback sitemap keeps only public post pages and tolerates the calendar misspelling', () => {
  const urls = feedbackPostUrls(`
    <loc>https://feedback.omi.me/p/google-calender</loc>
    <loc>https://feedback.omi.me/changelog</loc>
    <loc>https://evil.example/p/google-calendar</loc>`);
  assert.deepEqual(urls, ['https://feedback.omi.me/p/google-calender']);
  assert.deepEqual(
    rankFeedbackPages('Google Calendar app is blocked', urls),
    ['https://feedback.omi.me/p/google-calender']
  );
});

test('Feedback extraction keeps portal status and the report but drops identity and comments', () => {
  const post = feedbackPostFromHtml(pageHtml(calendarPost));
  const page = feedbackPage('https://feedback.omi.me/p/google-calender', post);
  assert.match(page.body, /Portal status: In Progress/);
  assert.match(page.body, /Customer report: Google says/);
  assert.match(page.body, /\[email\]/);
  assert.match(page.title, /\[email\]/);
  assert.doesNotMatch(`${page.title}\n${page.body}`, /person@example\.com|Customer$|Advanced and continue/);
});

test('relevant Feedback is labeled as an issue signal and saved without comments', async () => {
  const saved = [];
  const text = await relevantFeedback('Google Calendar says this app is blocked and only uses main calendar', {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/sitemap.xml')) {
        return {
          ok: true,
          text: async () => '<loc>https://feedback.omi.me/p/google-calender</loc>',
        };
      }
      return { ok: true, text: async () => pageHtml(calendarPost) };
    },
    store: { saveDocPage: async (page) => saved.push(page) },
  });
  assert.match(
    text,
    /Omi Feedback portal \| issue\/status signal only; customer report is not product documentation/
  );
  assert.match(text, /Portal status: In Progress/);
  assert.doesNotMatch(text, /Advanced and continue|person@example\.com/);
  assert.equal(saved.length, 1);
});
