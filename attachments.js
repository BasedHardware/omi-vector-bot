const MAX_FILES = 2;
const MAX_BYTES = 40 * 1024;
const TIMEOUT_MS = 8_000;
const ALLOWED_EXT = /\.(log|txt|json)$/i;

function attachmentsList(attachments) {
  if (!attachments) return [];
  if (typeof attachments.values === 'function') return [...attachments.values()];
  if (Array.isArray(attachments)) return attachments;
  return Object.values(attachments);
}

function isAllowedTextAttachment(att) {
  if (!att) return false;
  const name = String(att.name || att.filename || '');
  const type = String(att.contentType || att.content_type || '').toLowerCase();
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return false;
  if (ALLOWED_EXT.test(name)) return true;
  if (type === 'text/plain' || type === 'application/json') return true;
  return false;
}

function hasUsableAttachment(message) {
  return attachmentsList(message?.attachments).some(isAllowedTextAttachment);
}

function clipAttachmentText(text, max = MAX_BYTES) {
  const s = String(text || '');
  if (Buffer.byteLength(s, 'utf8') <= max) return s;
  let out = s;
  while (out.length && Buffer.byteLength(out, 'utf8') > max) {
    out = out.slice(0, Math.max(0, out.length - 256));
  }
  return `${out}\n…`;
}

function isSpoilerImageName(name) {
  if (!String(name).startsWith('SPOILER_')) return false;
  return !/\.(mp4|mov|webm|mp3|m4a|wav|ogg|log|txt|json)$/i.test(name);
}

function isWatchableAttachment(att) {
  if (!att) return false;
  const type = String(att.contentType || att.content_type || '').toLowerCase();
  const name = String(att.name || att.filename || '');
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return true;
  if (/\.(png|jpe?g|gif|webp|mp4|mov|webm|mp3|m4a|wav|ogg)$/i.test(name)) return true;
  return isSpoilerImageName(name);
}

function shouldMentionUnreadMedia(attachments, textFiles) {
  const logRead = (textFiles || []).some((file) => file && String(file.text || '').trim());
  return attachmentsList(attachments).some(
    (att) => isWatchableAttachment(att) && !(logRead && isImageAttachment(att))
  );
}

function unreadMediaSentence() {
  return 'I did not watch or listen to the file. Type the error line shown on the screen.';
}

function isErrorLine(line) {
  return /transcription unavailable/i.test(line)
    || /websocket/i.test(line)
    || /\b1011\b/.test(line)
    || /server_error/i.test(line)
    || /\berror\b/i.test(line)
    || /\bexception\b/i.test(line)
    || /\bfailed\b/i.test(line)
    || /\bdisconnected\b/i.test(line)
    || /\bcode\s*[:#-]?\s*\d+/i.test(line)
    || /\btimed out\b/i.test(line)
    || /\bnot capturing\b/i.test(line);
}

function isOtherChatLine(line) {
  if (isErrorLine(line)) return false;
  if (/\bconversations\b/i.test(line)) return true;
  if (/waiting for transcript/i.test(line)) return true;
  if (looksLikeDate(line)) return true;
  if (looksLikeShortName(line)) return true;
  return !isErrorLine(line);
}

function looksLikeDate(line) {
  if (/^(today|yesterday|tomorrow)$/i.test(line)) return true;
  if (/^\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?$/.test(line)) return true;
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(,\s*\d{4})?$/i.test(line)) return true;
  if (/^\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(,\s*\d{4})?$/i.test(line)) return true;
  return false;
}

function looksLikeShortName(line) {
  const cleaned = line.replace(/[,|·•]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.length > 40) return false;
  const words = cleaned.split(' ');
  if (words.length > 4) return false;
  return words.every((word) => /^[A-Z][a-zA-Z'-]{0,20}$/.test(word) || /^[A-Z]{2,6}$/.test(word));
}

function errorLinesFromImageText(text) {
  const kept = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || isOtherChatLine(line)) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

function screenshotErrorLines(text) {
  return errorLinesFromImageText(text);
}

async function defaultRecognize(buf) {
  const { createWorker } = require('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const result = await worker.recognize(buf);
    return result?.data?.text || '';
  } finally {
    await worker.terminate();
  }
}

async function imageErrorLines(attachments, { fetchImpl, recognize } = {}) {
  const fetchFn = fetchImpl || fetch;
  const read = recognize || (process.env.VECTOR_OCR === '1' ? defaultRecognize : null);
  if (typeof read !== 'function') return '';
  const images = attachmentsList(attachments).filter(isImageAttachment).slice(0, 1);
  const kept = [];
  for (const att of images) {
    const url = att.url || att.proxyURL || att.proxy_url;
    if (!url) continue;
    try {
      const res = await fetchFn(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const text = await read(buf);
      const lines = errorLinesFromImageText(text);
      if (lines) kept.push(lines);
    } catch (err) {
      console.error('[Attach] image read failed:', err.message);
    }
  }
  return kept.join('\n');
}

function isImageAttachment(att) {
  if (!att) return false;
  const type = String(att.contentType || att.content_type || '').toLowerCase();
  const name = String(att.name || att.filename || '');
  if (type.startsWith('image/')) return true;
  if (type.startsWith('video/') || type.startsWith('audio/')) return false;
  if (/\.(mp4|mov|webm|mp3|m4a|wav|ogg)$/i.test(name)) return false;
  if (/\.(png|jpe?g|gif|webp)$/i.test(name)) return true;
  return isSpoilerImageName(name);
}

function shouldMentionUnreadImage(attachments, textFiles) {
  const hasImage = attachmentsList(attachments).some(isImageAttachment);
  if (!hasImage) return false;
  if ((textFiles || []).some((file) => file && String(file.text || '').trim())) return false;
  if (attachmentsList(attachments).some(isAllowedTextAttachment)) return false;
  return true;
}

function unreadImageSentence() {
  return 'I did not read the picture. Type the error line shown on the screen.';
}

function formatQuestion(userText, files) {
  const caption = String(userText || '').trim();
  const blocks = (files || [])
    .filter((f) => f && f.text)
    .map((f) => `Attachment ${f.name || 'file'}:\n${f.text}`)
    .join('\n\n');
  if (caption && blocks) return `${caption}\n\n${blocks}`;
  return caption || blocks || '';
}

async function fetchTextAttachments(discordAttachments, fetchImpl = globalThis.fetch) {
  const picked = attachmentsList(discordAttachments)
    .filter((att) => isAllowedTextAttachment(att) && !isWatchableAttachment(att))
    .slice(0, MAX_FILES);
  const out = [];
  for (const att of picked) {
    if (!att.url) continue;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(att.url, { signal: ctrl.signal });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const text = clipAttachmentText(buf.subarray(0, MAX_BYTES + 1).toString('utf8'));
      if (text.trim()) out.push({ name: att.name || 'file', text });
    } catch (err) {
      console.error('[Attach] fetch failed:', err.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

module.exports = {
  MAX_FILES,
  MAX_BYTES,
  isAllowedTextAttachment,
  hasUsableAttachment,
  clipAttachmentText,
  formatQuestion,
  fetchTextAttachments,
  isImageAttachment,
  shouldMentionUnreadImage,
  unreadImageSentence,
  isWatchableAttachment,
  shouldMentionUnreadMedia,
  unreadMediaSentence,
  errorLinesFromImageText,
  screenshotErrorLines,
  imageErrorLines,
};
