const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const axios = require('axios');
const { queryAgent, reviewAnswer, understandQuestion } = require('../commandcode');

// A real HTTP body stays unfinished until the application aborts it. The test
// drives the deadline after headers/body bytes arrive, not after a wall-clock
// race between a streaming interval, socket inactivity and a busy runner.
function unfinishedServer(t) {
  const requests = [];
  const waiting = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"choices":[');
    const closed = new Promise(resolve => res.on('close', resolve));
    const request = { res, closed };
    if (waiting.length) waiting.shift()(request);
    else requests.push(request);
  });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    url: `http://127.0.0.1:${server.address().port}/`,
    nextRequest: () => requests.length ? Promise.resolve(requests.shift()) : new Promise(resolve => waiting.push(resolve)),
  })));
}

function manualDeadlines(t, milliseconds) {
  const controllers = [];
  t.mock.method(AbortSignal, 'timeout', actual => {
    assert.equal(actual, milliseconds);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  return controllers;
}

function observedHttpPost() {
  const bodies = [];
  const post = (url, body, options) => {
    let received;
    const observed = new Promise(resolve => { received = resolve; });
    bodies.push(observed);
    return axios.post(url, body, { ...options, onDownloadProgress: event => {
      if (event.loaded > 0) received();
    } });
  };
  return { post, bodies };
}

async function abortHttpAttempts(provider, deadlines, bodies, attempts) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const { res, closed } = await provider.nextRequest();
    assert.ok(bodies[attempt], 'the real HTTP client registered a body observation');
    await bodies[attempt];
    assert.equal(res.writableEnded, false, 'headers arrived but the response body is unfinished');
    assert.equal(deadlines.length, attempt + 1, 'each HTTP attempt has its own full-operation deadline');
    assert.equal(deadlines[attempt].signal.aborted, false);
    deadlines[attempt].abort(new Error('manual deadline elapsed'));
    await closed;
    assert.equal(res.writableEnded, false, 'the actual HTTP connection closed without completing the body');
  }
}

function withProvider(t, url, timeoutMs) {
  const previous = { key: process.env.CMD_API_KEY, url: process.env.CMD_API_URL, timeout: process.env.CMD_TIMEOUT_MS };
  process.env.CMD_API_KEY = 'test-only-key';
  process.env.CMD_API_URL = url;
  process.env.CMD_TIMEOUT_MS = String(timeoutMs);
  t.after(() => {
    for (const [name, value] of [['CMD_API_KEY', previous.key], ['CMD_API_URL', previous.url], ['CMD_TIMEOUT_MS', previous.timeout]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

const LATE_ANSWER = JSON.stringify({ choices: [{ message: { content: JSON.stringify({
  final_answer: 'This arrived after the deadline.', grounded: true, relevant: true, confidence: 0.9, escalate: false, sources_used: [],
}) } }] });

for (const [name, attempts, call] of [
  ['planner', 1, post => understandQuestion({ question: 'How do I pair my device?', route: { lane: 'tech', area: 'device' }, post })],
  ['answer', 2, post => queryAgent({ question: 'How do I pair my device?', route: { lane: 'tech', area: 'device' }, post })],
  ['review', 2, post => reviewAnswer({ question: 'How do I pair my device?', draft: 'Open the app.', lane: 'general', understanding: {}, post })],
]) {
  test(`${name} deadline aborts the actual HTTP transport before the response body completes`, { timeout: 30_000 }, async (t) => {
    const provider = await unfinishedServer(t);
    withProvider(t, provider.url, 30_000);
    const deadlines = manualDeadlines(t, 30_000);
    const { post, bodies } = observedHttpPost();
    const checked = assert.rejects(call(post), { code: 'ECONNABORTED' });
    await abortHttpAttempts(provider, deadlines, bodies, attempts);
    await checked;
    assert.equal(deadlines.length, attempts, 'no extra retry after the allowed attempts');
  });
}

test('a normal successful provider response still completes inside the deadline', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(LATE_ANSWER);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  withProvider(t, `http://127.0.0.1:${server.address().port}/`, 2_000);
  const parsed = await queryAgent({ question: 'How do I pair my device?', route: { lane: 'tech', area: 'device' } });
  assert.equal(parsed.final_answer, 'This arrived after the deadline.');
});

test('the deadline error carries no response text', { timeout: 30_000 }, async (t) => {
  const provider = await unfinishedServer(t);
  withProvider(t, provider.url, 30_000);
  const deadlines = manualDeadlines(t, 30_000);
  const { post, bodies } = observedHttpPost();
  const checked = assert.rejects(queryAgent({ question: 'Where is my order?', post }), (err) => {
    assert.equal(err.code, 'ECONNABORTED');
    assert.doesNotMatch(String(err.message), /choices/);
    assert.doesNotMatch(String(err.message), /arrived after the deadline/);
    return true;
  });
  await abortHttpAttempts(provider, deadlines, bodies, 2);
  await checked;
});

for (const [stage, attempts, call] of [
  ['planner', 1, post => understandQuestion({ question: 'How do I organize notes?', route: { lane: 'faq' }, post })],
  ['answer', 2, post => queryAgent({ question: 'How do I organize notes?', route: { lane: 'faq' }, post })],
  ['review', 2, post => reviewAnswer({ question: 'How do I organize notes?', draft: 'Open the notes.', understanding: {}, post })],
]) test(`${stage} manual deadline cancels an unfinished response body without a wall clock`, async t => {
  withProvider(t, 'https://provider.invalid/synthetic-test', 250);
  const deadlines = [];
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 250);
    const controller = new AbortController();
    deadlines.push(controller);
    return controller.signal;
  });
  const calls = [];
  const post = async (_url, _body, options) => {
    assert.equal(options.timeout, 250, 'keep the existing transport timeout too');
    assert.ok(options.signal instanceof AbortSignal, 'the full-operation deadline reaches the adapter');
    return new Promise((resolve, reject) => {
      calls.push({ signal: options.signal, finishBody: () => resolve({ data: JSON.parse(LATE_ANSWER) }) });
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('synthetic cancellation'), { code: 'ERR_CANCELED' })), { once: true });
    });
  };
  let settled = false;
  const pending = call(post).finally(() => { settled = true; });
  const checked = assert.rejects(pending, { code: 'ECONNABORTED' });
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (let turn = 0; turn < 30; turn++) await Promise.resolve();
    assert.equal(calls.length, attempt + 1);
    assert.equal(deadlines.length, attempt + 1, 'each retry gets its own deadline');
    assert.equal(settled, false, 'an unfinished body has not been accepted');
    assert.equal(calls[attempt].signal.aborted, false);
    deadlines[attempt].abort(new Error('manual deadline elapsed'));
  }
  await checked;
  assert.equal(calls.length, attempts, 'no extra request after the allowed retries');
  for (const attempt of calls) attempt.finishBody();
  assert.ok(calls.every(attempt => attempt.signal.aborted), 'late bodies cannot undo cancellation');
});
