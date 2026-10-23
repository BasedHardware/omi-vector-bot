const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const axios = require('axios');
const { queryAgent, reviewAnswer, understandQuestion } = require('../commandcode');

// A loopback provider that sends headers at once, then trickles the JSON body
// one byte at a time so socket inactivity never fires, far past the budget.
function trickleServer(body, { intervalMs = 20 } = {}) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    let index = 0;
    const timer = setInterval(() => {
      res.write(body[index]);
      index += 1;
      if (index >= body.length) { clearInterval(timer); res.end(); }
    }, intervalMs);
    res.on('close', () => clearInterval(timer));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    url: `http://127.0.0.1:${server.address().port}/`,
    nominalMs: body.length * intervalMs,
  })));
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

for (const [name, call] of [
  ['planner', () => understandQuestion({ question: 'How do I pair my device?', route: { lane: 'tech', area: 'device' } })],
  ['answer', () => queryAgent({ question: 'How do I pair my device?', route: { lane: 'tech', area: 'device' } })],
  ['review', () => reviewAnswer({ question: 'How do I pair my device?', draft: 'Open the app.', lane: 'general', understanding: {} })],
]) {
  test(`${name} request stops at the deadline even when the response body keeps trickling`, async (t) => {
    const { server, url, nominalMs } = await trickleServer(LATE_ANSWER);
    t.after(() => server.close());
    const timeoutMs = 250;
    withProvider(t, url, timeoutMs);
    const started = Date.now();
    await assert.rejects(call(), (err) => /timeout/i.test(String(err.message)) || err.code === 'ECONNABORTED');
    const elapsed = Date.now() - started;
    // Each stage retries at most once on timeout, so two budgets is the ceiling;
    // the unbounded body would have taken the full nominal stream time.
    assert.ok(elapsed < Math.min(nominalMs, timeoutMs * 3), `took ${elapsed}ms; nominal stream ${nominalMs}ms`);
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

test('the deadline error carries no response text', async (t) => {
  const { server, url } = await trickleServer(LATE_ANSWER);
  t.after(() => server.close());
  withProvider(t, url, 100);
  await assert.rejects(queryAgent({ question: 'Where is my order?' }), (err) => {
    assert.doesNotMatch(String(err.message), /arrived after the deadline/);
    return true;
  });
});

test('axios timeout alone does not bound a trickling body (documents the mechanism)', async (t) => {
  const { server, url, nominalMs } = await trickleServer('{"ok":true}', { intervalMs: 40 });
  t.after(() => server.close());
  const started = Date.now();
  await axios.post(url, {}, { timeout: 100 });
  assert.ok(Date.now() - started >= nominalMs - 60);
});
