// Customer grammar only, never planner output or quoted bot history. A denial
// removes that action signal, not another request elsewhere in the message.
function requestCorrection(value) {
  const text = String(value || '').replace(/[\u2018\u2019]/g, "'");
  const denied = new Set();
  const start = /\b(?:(?:i|we)\s+(?:(?:am|are|was|were)\s+not\s+(?:asking|requesting|seeking)|(?:did\s+not|didn't|do\s+not|don't|never)\s+(?:ask(?:ed)?|request(?:ed)?|want(?:ed)?|need(?:ed)?|seek|made|make|submit(?:ted)?))|no\s+(?:estoy\s+pidiendo|estamos\s+pidiendo|quiero|queremos|he\s+pedido|hemos\s+pedido|solicit[eé]))\b/gi;
  // A protected action must be the denied verb's direct object. Searching
  // later in a clause can erase an independent positive action. Unknown
  // constructions stay untouched and retain protected routing.
  const object = '(?:refunds?|reembolsos?|payment\\s+adjustment|billing\\s+adjustment|data\\s+deletion|(?:delete|erase|remove)\\s+(?:my|our)\\s+(?:account|data)|(?:borrar|eliminar)\\s+(?:mi|nuestra)\\s+(?:cuenta|datos))';
  const prefix = '\\s+(?:(?:for|to)\\s+)?(?:(?:a|an|the|any|un|una|el|la)\\s+)?';
  const withoutDeniedActions = text.replace(new RegExp(start.source + prefix + '(' + object + ')\\b', 'gi'), (_clause, action) => {
    denied.add(/refund|reembolso|payment|billing/i.test(action) ? 'money' : 'privacy');
    return ' corrected request ';
  });
  return { text: withoutDeniedActions, denied };
}

module.exports = { requestCorrection };
