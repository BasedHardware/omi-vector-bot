// Public GitHub issues and customer-visible cards must never carry raw customer identifiers.
// Keep this independent of route classification so every filing path has the same boundary.
function redactSensitive(text, { issue = false } = {}) {
  let out = String(text || '');
  out = out.replace(/\b[A-Z0-9._%+-]+\s*@\s*[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
  out = out.replace(/\b[A-Z0-9._%+-]+\s*(?:\(at\)|\[at\])\s*[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
  out = out.replace(/\b(?:email|e-mail)\s*[:=]\s*[^\s,;]+/gi, '[email]');
  out = out.replace(/\b(?:address|shipping address|billing address)\s*[:=]\s*[^\n]+/gi, '[address]');
  out = out.replace(
    /\b(?:(?:flat|apt|apartment|unit)\s+[A-Za-z0-9-]+,?\s+)?\d{1,5}[A-Za-z]?\s+(?:[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'-]*\s+){0,5}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|terrace|crescent|rue|chemin|route|strasse|straße|via|viale|calle|carrer|rua|ulica|ul\.|marg|nagar)\b\.?[^\n;]*/gi,
    '[address]'
  );
  out = out.replace(/(?<![\w#])\+?(?:\(\d{1,4}\)|\d{1,4})(?:[\s().-]*(?:\(\d{1,4}\)|\d{1,4})){1,5}(?!\w)/g, (match, offset, source) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return match;
    const before = source.slice(Math.max(0, offset - 32), offset);
    const hasPhoneContext = /(?:phone|tel(?:ephone)?|whatsapp|call)\s*(?:number|no\.?|me|at|on|:|=)?\s*$/i.test(before);
    const groups = match.match(/\d+/g) || [];
    const lengths = groups.map((group) => group.length).join('-');
    const typicalGrouping = /^(?:3-3-4|5-5|2-4-4|1-3-3-4|2-5-5|2-4-6)$/.test(lengths);
    return match.trimStart().startsWith('+') || hasPhoneContext || typicalGrouping
      ? '[phone]'
      : match;
  });
  if (!issue) return out;
  out = out.replace(/\b(?:postal|post|zip)\s*code\s*[:=]\s*[^\n,;]+/gi, '[postal code]');
  out = out.replace(/https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s)]+/gi, '[attachment in Discord]');
  out = out.replace(/<@!?\d+>|<@&\d+>|(?<![\w.])@[A-Za-z0-9_.-]{2,32}/g, '[Discord user]');
  out = out.replace(/\b(?:Discord\s+)?user(?:name)?\s*[:=]\s*[^\s,;]+/gi, '[Discord user]');
  out = out.replace(/\b(?:order|ticket)\s*(?:number|no\.?|#)?\s*#?\s*\d{3,}\b/gi, '[order number]');
  out = out.replace(/(?<!\w)#\d{4,}\b/g, '[order number]');
  out = out.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AIza[A-Za-z0-9_-]{16,})\b/g, '[token]');
  out = out.replace(/\b(?:bearer|api[_ -]?key|access[_ -]?token|secret)\s*[:= ]\s*[A-Za-z0-9._-]{8,}\b/gi, '[token]');
  out = out.replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}(?:\.[A-Za-z0-9_-]+)?\b/g, '[token]');
  return out;
}

function attachmentCount(files) {
  return Array.isArray(files) ? files.length : Number(files?.size || 0);
}

module.exports = { redactSensitive, attachmentCount };
