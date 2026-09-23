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
  if (type.startsWith('image/')) return false;
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

function isWatchableAttachment(att) {
  if (!att) return false;
  const type = String(att.contentType || att.content_type || '').toLowerCase();
  const name = String(att.name || att.filename || '');
  if (type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')) return true;
  return /\.(png|jpe?g|gif|webp|mp4|mov|webm|mp3|m4a|wav|ogg)$/i.test(name);
}

function shouldMentionUnreadMedia(attachments) {
  return attachmentsList(attachments).some(isWatchableAttachment);
}

function unreadMediaSentence() {
  return 'I did not watch or listen to the file. Type the error line shown on the screen.';
}

function isImageAttachment(att) {
  if (!att) return false;
  const type = String(att.contentType || att.content_type || '').toLowerCase();
  const name = String(att.name || att.filename || '');
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(name);
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
    .filter(isAllowedTextAttachment)
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
};
