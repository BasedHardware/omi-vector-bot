// Shared definition for customer-facing troubleshooting instructions and eval.
// Requests for diagnostic details and descriptions of app behavior are not steps.
const ACTION = '(?:try|check|make sure|enable|allow|restart|reboot|reset|reconnect|pair|unpair|charge|plug|unplug|update|open|close|keep|hold|press|tap|turn\\s+on|turn\\s+off|switch|go\\s+to|reinstall|log\\s+out|sign\\s+out|clear|delete|flash|factory\\s+reset)';
const IMPERATIVE = new RegExp(`^(?:[-*]\\s*|\\d+[.)]\\s*)?(?:please\\s+)?${ACTION}\\b`, 'i');
const SECOND_PERSON = new RegExp(`\\byou\\s+(?:can|should|need\\s+to)\\s+${ACTION}\\b`, 'i');

function isInstructionSentence(sentence) {
  const text = String(sentence || '').trim();
  if (/^(?:[-*]\s*|\d+[.)]\s*)?(?:please\s+)?(?:do not|don't|never|avoid)\b/i.test(text)) return false;
  return IMPERATIVE.test(text) || SECOND_PERSON.test(text);
}

function hasTroubleshootingStep(answer) {
  return String(answer || '')
    .replace(/(?:^|\n)Sources?:[^\n]*/gi, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .some(isInstructionSentence);
}

module.exports = { isInstructionSentence, hasTroubleshootingStep };
