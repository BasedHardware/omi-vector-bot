const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isAllowedTextAttachment,
  hasUsableAttachment,
  clipAttachmentText,
  formatQuestion,
  fetchTextAttachments,
  MAX_BYTES,
  errorLinesFromImageText,
} = require('../attachments');

test('allows log/txt/json and text/plain, skips images', () => {
  assert.equal(isAllowedTextAttachment({ name: 'omi_debug.log' }), true);
  assert.equal(isAllowedTextAttachment({ name: 'notes.txt' }), true);
  assert.equal(isAllowedTextAttachment({ name: 'dump.json' }), true);
  assert.equal(
    isAllowedTextAttachment({ name: 'plain', contentType: 'text/plain' }),
    true
  );
  assert.equal(
    isAllowedTextAttachment({ name: 'shot.png', contentType: 'image/png' }),
    false
  );
  assert.equal(isAllowedTextAttachment({ name: 'photo.jpg' }), false);
});

test('hasUsableAttachment sees a Collection-like attachments map', () => {
  const attachments = new Map([
    ['1', { name: 'shot.png', contentType: 'image/png' }],
    ['2', { name: 'omi_debug.log', url: 'https://example.com/x.log' }],
  ]);
  assert.equal(hasUsableAttachment({ attachments }), true);
  assert.equal(hasUsableAttachment({ attachments: new Map() }), false);
});

test('clips oversize attachment text', () => {
  const out = clipAttachmentText('a'.repeat(MAX_BYTES + 500), 100);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 100 + 10);
  assert.equal(out.endsWith('\n…'), true);
});

test('formatQuestion prefixes attachment blocks and keeps the caption', () => {
  const q = formatQuestion('button works, some conversations fail', [
    { name: 'omi_debug.log', text: 'websocket 1011 server_error' },
  ]);
  assert.match(q, /button works/i);
  assert.match(q, /Attachment omi_debug\.log/);
  assert.match(q, /websocket 1011/);
});

test('fetchTextAttachments clips logs, ignores png, uses at most two files', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      arrayBuffer: async () => Buffer.from(`log-from-${url}`),
    };
  };
  const attachments = [
    { name: 'shot.png', contentType: 'image/png', url: 'https://cdn/shot.png' },
    { name: 'a.log', url: 'https://cdn/a.log' },
    { name: 'b.txt', url: 'https://cdn/b.txt' },
    { name: 'c.log', url: 'https://cdn/c.log' },
  ];
  const files = await fetchTextAttachments(attachments, fetchImpl);
  assert.equal(files.length, 2);
  assert.deepEqual(
    files.map((f) => f.name),
    ['a.log', 'b.txt']
  );
  assert.equal(calls.includes('https://cdn/shot.png'), false);
  assert.match(files[0].text, /log-from-https:\/\/cdn\/a\.log/);
  const big = await fetchTextAttachments([{ name: 'big.log', url: 'https://cdn/big.log' }], async () => ({
    ok: true,
    arrayBuffer: async () => Buffer.from('a'.repeat(MAX_BYTES * 2)),
  }));
  assert.equal(big[0].text.endsWith('\n…'), true);
  assert.ok(Buffer.byteLength(big[0].text, 'utf8') <= MAX_BYTES + 10);
});

test('a picture is not fetched and gets an unread sentence', async () => {
  const { shouldMentionUnreadImage, unreadImageSentence } = require('../attachments');
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, arrayBuffer: async () => Buffer.from('png') };
  };
  const image = new Map([['1', { name: 'shot.png', contentType: 'image/png', url: 'https://cdn.example/shot.png' }]]);
  const files = await fetchTextAttachments(image, fetchImpl);
  assert.equal(files.length, 0);
  assert.equal(called, false);
  assert.equal(shouldMentionUnreadImage(image, files), true);
  assert.match(unreadImageSentence(), /did not read the picture/i);
  const { shouldMentionUnreadMedia, unreadMediaSentence } = require('../attachments');
  assert.equal(shouldMentionUnreadMedia(new Map([['1', { name: 'clip.mp4', contentType: 'video/mp4' }]])), true);
  assert.match(unreadMediaSentence(), /did not watch or listen/i);
  assert.equal(
    shouldMentionUnreadMedia(
      new Map([
        ['1', { name: 'shot.png', contentType: 'image/png' }],
        ['2', { name: 'omi_debug.log' }],
      ]),
      [{ name: 'omi_debug.log', text: 'hello from the log' }]
    ),
    false
  );
  assert.equal(
    shouldMentionUnreadMedia(
      new Map([
        ['1', { name: 'voice.m4a', contentType: 'audio/mp4' }],
        ['2', { name: 'omi_debug.log' }],
      ]),
      [{ name: 'omi_debug.log', text: 'hello from the log' }]
    ),
    true
  );
  assert.equal(
    shouldMentionUnreadImage(
      new Map([
        ['1', { name: 'shot.png', contentType: 'image/png' }],
        ['2', { name: 'omi_debug.log' }],
      ]),
      [{ name: 'omi_debug.log', text: 'hello from the log' }]
    ),
    false
  );
  const question = formatQuestion('Keep getting transcription unavailable', files);
  assert.equal(/png|image/i.test(question), false);
});

test('errorLinesFromImageText keeps error lines and drops other chats', () => {
  const blob = [
    'Conversations',
    'Shipping, Found Wallet',
    'Waiting for transcript',
    'Sep 23, 2026',
    'transcription unavailable',
    'websocket closed code 1011 server_error',
    'Can you check shipping tomorrow',
  ].join('\n');
  const out = errorLinesFromImageText(blob);
  assert.equal(
    out,
    'transcription unavailable\nwebsocket closed code 1011 server_error'
  );
  assert.equal(out.includes('Shipping'), false);
  assert.equal(out.includes('Found Wallet'), false);
  assert.equal(out.includes('Conversations'), false);
  assert.equal(out.includes('Waiting for transcript'), false);
  assert.equal(errorLinesFromImageText('Shipping\nFound Wallet\nConversations'), '');
});

test('errorLinesFromImageText keeps exception, failed, disconnected, and code digits', () => {
  const out = errorLinesFromImageText(
    ['Alex', 'exception while saving', 'failed', 'disconnected', 'code: 1006', 'Hello there'].join('\n')
  );
  assert.equal(out, 'exception while saving\nfailed\ndisconnected\ncode: 1006');
});
