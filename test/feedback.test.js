const assert = require('node:assert/strict');
const test = require('node:test');
const {
  feedbackPage,
  feedbackPostFromHtml,
  feedbackPostUrls,
  matchingPublicStatus,
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

function hydratedPageHtml(post) {
  const payload = {
    props: { pageProps: {
      ptDehydratedState: { queries: [
        { queryKey: ['/v1/submission', { slug: post.slug }], state: { data: { results: [post] } } },
        { queryKey: ['comments-list'], state: { data: { results: post.comments } } },
      ] },
    } },
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

test('Feedback extraction reads the current hydrated submission format without comments', () => {
  const post = feedbackPostFromHtml(hydratedPageHtml(calendarPost));
  const page = feedbackPage('https://feedback.omi.me/p/google-calender', post);
  assert.match(page.body, /Portal status: In Progress/);
  assert.match(page.body, /main calendar/);
  assert.doesNotMatch(`${page.title}\n${page.body}`, /Advanced and continue|person@example\.com/);
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
      return { ok: true, text: async () => hydratedPageHtml(calendarPost) };
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

test('Calendar status matches both reported symptoms, not a different completed request', () => {
  const question = 'Google Calendar extension says this app is blocked and the integration only shows my main calendar';
  const other = '[S1 | Omi Feedback portal]\nCalendar enhancement\nhttps://feedback.omi.me/p/deeper-calendar\nPortal status: Completed\nCustomer report: I want more calendar context.';
  const exact = '[S2 | Omi Feedback portal]\nGoogle calender\nhttps://feedback.omi.me/p/google-calender\nPortal status: In Progress\nCustomer report: The extension says this app is blocked and the integration only shows my main agenda.';
  assert.deepEqual(matchingPublicStatus(`${other}\n\n${exact}`, question), {
    status: 'In Progress', url: 'https://feedback.omi.me/p/google-calender',
  });
  assert.equal(matchingPublicStatus(other, question), null);
});

test('the misspelled Calendar request is considered even when four other slugs rank first', async () => {
  const question = 'I use a personal Google account. The Google Calendar extension says this app is blocked and there is no Advanced option. The built-in integration only gets my main calendar. How can I fix both and use multiple calendars?';
  const urls = [
    'https://feedback.omi.me/p/google-calender',
    'https://feedback.omi.me/p/subject-google-calendar-integration-error-activating-the-app-personal-g',
    'https://feedback.omi.me/p/deeper-google-calendar-integration-for-contextual-memories-and-meeting-management',
    'https://feedback.omi.me/p/integration-google-calendar-no-events',
    'https://feedback.omi.me/p/this-app-is-blocked-google-reminder-error',
  ];
  assert.equal(rankFeedbackPages(question, urls, 4).includes(urls[0]), false);
  const saved = [];
  const evidence = await relevantFeedback(question, {
    fetchImpl: async (url) => String(url).endsWith('/sitemap.xml')
      ? { ok: true, text: async () => urls.map((item) => `<loc>${item}</loc>`).join('') }
      : { ok: true, text: async () => hydratedPageHtml(String(url) === urls[0] ? calendarPost : {
        title: 'A related Google request', slug: String(url).split('/').at(-1),
        content: 'A different Calendar integration idea.', postStatus: { name: 'Completed' },
      }) },
    store: { saveDocPage: async (page) => saved.push(page) },
  });
  assert.deepEqual(matchingPublicStatus(evidence, question), { status: 'In Progress', url: urls[0] });
  assert.ok(saved.length <= 4);
});
