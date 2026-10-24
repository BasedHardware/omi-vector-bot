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

// Presentation must not remove a safety consequence merely because it starts
// with a pronoun. Match risk/loss concepts, not particular modal verbs or whole
// warning sentences. This only prevents deletion; it never authorizes a step.
function hasSafetyWarning(text) {
  const shown = String(text || '').replace(/[*_~`]/g, '');
  const prohibition = /\b(?:do not|don['’]t|never|must not|should not|avoid|no\s+(?:env[ií]es|compartas)|ne\b.*\bpas|nicht|nunca)\b|不要|しないで|하지\s*마/iu;
  // A consequence needs a predicate, not just a nominal support-topic mention
  // such as "deletion requests" or "people who investigate data loss".
  const predictor = /\b(?:may|might|can|could|will|would|risk(?:s|ing)?|caus(?:e|es|ing)|lead(?:s)?\s+to|result(?:s)?\s+in|peut|peuvent|pourrait|risque|entra[iî]ne|pued[ea]n?|podr[ií]a|provoca|kann|k[oö]nnte|wird|w[uü]rde|pode|poderia|pu[oò]|potrebbe)\b/iu;
  const loss = /\b(?:los(?:e|es|ing|t)|loss|eras(?:e|es|ed|ing)|delet(?:e|es|ed|ing)|wip(?:e|es|ed|ing)|effac\w*|supprim\w*|perd\w*|borr\w*|elimin\w*|verlor\w*|l[oö]sch\w*|gel[oö]sch\w*|apaga\w*)\b|丢失|遺失|失わ|消去|削除|손실/iu;
  const prediction = predictor.exec(shown);
  return prohibition.test(shown) || Boolean(prediction && loss.test(shown.slice(prediction.index + prediction[0].length)));
}

module.exports = { isInstructionSentence, hasTroubleshootingStep, hasSafetyWarning, SOURCE_LABEL_NAME, SOURCE_LABEL_SEPARATOR };
