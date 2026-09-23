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
  screenshotErrorLines,
  shouldMentionUnreadMedia,
  unreadMediaSentence,
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

test('errorLinesFromImageText keeps transcription unavailable, 1011, and server_error alone', () => {
  const out = errorLinesFromImageText(
    [
      'Conversations',
      'Shipping, Found Wallet',
      'Transcription unavailable',
      '1011',
      'server_error',
      'Today',
    ].join('\n')
  );
  assert.equal(out, 'Transcription unavailable\n1011\nserver_error');
  assert.equal(out.includes('Shipping'), false);
  assert.equal(out.includes('Conversations'), false);
});

test('errorLinesFromImageText keeps code 1006, timed out, and not capturing', () => {
  const out = errorLinesFromImageText(
    [
      'Weekly sync with Priya',
      'code 1006',
      'timed out',
      'not capturing',
      'Sep 23, 2026',
    ].join('\n')
  );
  assert.equal(out, 'code 1006\ntimed out\nnot capturing');
  assert.equal(out.includes('Weekly sync with Priya'), false);
  assert.equal(out.includes('Priya'), false);
  assert.equal(errorLinesFromImageText('Weekly sync with Priya'), '');
});

test('screenshotErrorLines joins filtered lines and does not fetch', () => {
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = () => {
    fetched = true;
    throw new Error('screenshotErrorLines must not fetch');
  };
  try {
    assert.equal(screenshotErrorLines(''), '');
    assert.equal(screenshotErrorLines('Weekly sync with Priya\nConversations'), '');
    assert.equal(
      screenshotErrorLines(['Weekly sync with Priya', 'code 1006', 'timed out', 'not capturing'].join('\n')),
      'code 1006\ntimed out\nnot capturing'
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('image content type, spoilers, and alt text stay unread and unfetched', async () => {
  const disguised = {
    name: 'notes.log.txt',
    contentType: 'image/png',
    url: 'https://cdn.example/notes.log.txt',
    description: 'transcription unavailable',
  };
  assert.equal(isAllowedTextAttachment(disguised), false);
  let fetched = false;
  const disguisedFiles = await fetchTextAttachments([disguised], async () => {
    fetched = true;
    return { ok: true, arrayBuffer: async () => Buffer.from('png-bytes') };
  });
  assert.equal(fetched, false);
  assert.deepEqual(disguisedFiles, []);
  assert.equal(shouldMentionUnreadMedia([disguised], disguisedFiles), true);
  assert.equal(
    shouldMentionUnreadMedia(
      [disguised],
      [{ name: 'omi_debug.log', text: 'websocket 1011' }]
    ),
    false
  );

  const spoiler = {
    name: 'SPOILER_screenshot',
    url: 'https://cdn.example/spoiler',
    description: 'code 1006 on the pendant',
  };
  fetched = false;
  const spoilerFiles = await fetchTextAttachments([spoiler], async () => {
    fetched = true;
    return { ok: true, arrayBuffer: async () => Buffer.from('png-bytes') };
  });
  assert.equal(fetched, false);
  assert.deepEqual(spoilerFiles, []);
  assert.equal(shouldMentionUnreadMedia([spoiler], spoilerFiles), true);
  assert.equal(
    shouldMentionUnreadMedia(
      [{ name: 'SPOILER_clip.mp4', contentType: 'video/mp4' }],
      [{ name: 'omi_debug.log', text: 'hello from the log' }]
    ),
    true
  );

  const described = {
    name: 'shot.png',
    contentType: 'image/png',
    url: 'https://cdn.example/shot.png',
    description: 'ALT_TEXT_SECRET transcription unavailable',
    alt: 'ALT_TEXT_SECRET transcription unavailable',
  };
  fetched = false;
  const describedFiles = await fetchTextAttachments([described], async () => {
    fetched = true;
    return { ok: true, arrayBuffer: async () => Buffer.from('png-bytes') };
  });
  assert.equal(fetched, false);
  assert.deepEqual(describedFiles, []);
  assert.equal(JSON.stringify(describedFiles).includes('ALT_TEXT_SECRET'), false);
  assert.equal(formatQuestion('caption', describedFiles).includes('ALT_TEXT_SECRET'), false);
  assert.equal(shouldMentionUnreadMedia([described], describedFiles), true);
  assert.equal(shouldMentionUnreadMedia([described], [described]), true);
  assert.equal(unreadMediaSentence(), 'I did not watch or listen to the file. Type the error line shown on the screen.');
});
