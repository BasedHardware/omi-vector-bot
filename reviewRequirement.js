// Shared bounded grammar for publication and its wording-only routing guard.
// A recognized requirement is not delivery, acceptance or a completed check.
const REQUIREMENT = /^(?:(no)\s+|(?:a|the)\s+)?(?:person|human|someone)(?:\s+on\s+the\s+team)?\s+((?:still\s+)?needs?\s+to|has\s+to|must|should|(?:may|might|will)\s+need\s+to)\s+(?:review|check|handle|take|look\s+at)\s+(?:this|it|that|(?:your|the)\s+(?:case|issue|request|problem|report|details|evidence))[.!?]?$/i;

function classifyReviewRequirement(text) {
  const shown = String(text || '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
  const match = REQUIREMENT.exec(shown);
  return {
    recognized: Boolean(match),
    needsPerson: Boolean(match && !match[1] && !/^(?:may|might)\b/i.test(match[2])),
  };
}

// Only a complete present-availability qualifier for bounded diagnostics can
// precede an independent requirement. A future request/appeal/action or unknown
// condition is not made unconditional merely because it contains an imperative.
const OPTIONAL_DIAGNOSTIC = /^\s*if\s+(?:you|they|the customer)\s+(?:already\s+)?(?:know|have|can\s+(?:find|see|read))\s+(?:(?:the|your|an?|any)\s+)?(?:app version|OS version|device model|error (?:code|message)|diagnostic logs?|log files?|screenshots?)\s*,\s*(?:please\s+)?(?:share|include|provide|send|add|give)\s+(?:it|them|that|those)[.!?]?\s*$/i;

function isOptionalDiagnosticQualifier(text) {
  return OPTIONAL_DIAGNOSTIC.test(String(text || ''));
}

module.exports = { classifyReviewRequirement, isOptionalDiagnosticQualifier };
