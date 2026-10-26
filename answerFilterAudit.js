// Current-result-only context for the existing reviewer. Never serialize this
// text into agent JSON, history, stage evidence, logs or a durable store.
const audits = new WeakMap();
const MAX_REMOVED_UNITS = 12;
const MAX_REMOVED_CHARS = 6000;
const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();

function mergeRemovalAudits(...inputs) {
  const removed = [];
  const seen = new Set();
  let chars = 0;
  let truncated = false;
  for (const input of inputs) {
    truncated ||= input?.truncated === true;
    for (const value of Array.isArray(input?.removed) ? input.removed : []) {
      if (typeof value !== 'string') continue;
      const unit = value.trim();
      const key = normalize(unit);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (removed.length >= MAX_REMOVED_UNITS || chars + unit.length > MAX_REMOVED_CHARS) {
        truncated = true;
        continue; // Never cut a condition or warning into a misleading fragment.
      }
      removed.push(unit);
      chars += unit.length;
    }
  }
  return { removed, truncated };
}

function removedAnswerUnits(before, after) {
  const normalizedAfter = normalize(after);
  return mergeRemovalAudits({ removed: String(before || '').trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .map(unit => unit.trim()).filter(Boolean)
    .filter(unit => !normalizedAfter.includes(normalize(unit))) });
}

function rememberRemovalAudit(result, audit) {
  if (result && typeof result === 'object') audits.set(result, mergeRemovalAudits(audit));
  return result;
}

function getRemovalAudit(result) {
  return mergeRemovalAudits(result && typeof result === 'object' ? audits.get(result) : undefined);
}

module.exports = {
  MAX_REMOVED_UNITS, MAX_REMOVED_CHARS,
  mergeRemovalAudits, removedAnswerUnits, rememberRemovalAudit, getRemovalAudit,
};
