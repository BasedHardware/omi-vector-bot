// Shared definition for customer-facing troubleshooting instructions and eval.
// Requests for diagnostic details and descriptions of app behavior are not steps.
const ACTION = '(?:try|check|make sure|enable|allow|restart|reboot|reset|reconnect|pair|unpair|charge|plug|unplug|update|open|close|keep|hold|press|tap|turn\\s+on|turn\\s+off|switch|go\\s+to|reinstall|uninstall|log\\s+out|sign\\s+out|clear|delete|flash|factory\\s+reset|do\\s+(?:a\\s+)?factory\\s+reset)';
const IMPERATIVE = new RegExp(`^(?:[-*]\\s*|\\d+[.)]\\s*)?(?:please\\s+)?${ACTION}\\b`, 'i');
const SECOND_PERSON = new RegExp(`\\byou\\s+(?:can|should|need\\s+to)\\s+${ACTION}\\b`, 'i');
const LEADING_CONDITION = /^(?:[-*]\s*|\d+[.)]\s*)?(?:(?:if|when)\b[^,\n]{0,160},\s*|(?:then|otherwise|after that),?\s*)+/i;
// Keep citation syntax shared with answer presentation: East Asian source
// labels commonly use a fullwidth colon instead of the ASCII colon.
const SOURCE_LABEL_NAME = '(?:Sources?|Fuentes?|Quellen?|Fonte|Fontes|Fonti|Sumber|Kaynak|Srot|स्रोत|出典|来源|來源|출처|Источник|Riferimenti)';
const SOURCE_LABEL_SEPARATOR = '[:：]';
const SOURCE_LINE = new RegExp(`(?:^|\\n)\\s*${SOURCE_LABEL_NAME}\\s*${SOURCE_LABEL_SEPARATOR}[^\\n]*`, 'giu');

function isInstructionSentence(sentence) {
  const text = String(sentence || '').trim().replace(LEADING_CONDITION, '');
  if (/^(?:[-*]\s*|\d+[.)]\s*)?(?:please\s+)?(?:do not|don't|never|avoid)\b/i.test(text)) return false;
  return IMPERATIVE.test(text) || SECOND_PERSON.test(text);
}

function hasTroubleshootingStep(answer) {
  return String(answer || '')
    .replace(SOURCE_LINE, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .some(isInstructionSentence);
}

module.exports = { isInstructionSentence, hasTroubleshootingStep, SOURCE_LABEL_NAME, SOURCE_LABEL_SEPARATOR };
