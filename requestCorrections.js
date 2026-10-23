// Customer grammar only, never planner output or quoted bot history. A denial
// removes that action signal, not another request elsewhere in the message.
function requestCorrection(value) {
  const text = String(value || '').replace(/[\u2018\u2019]/g, "'");
  const denied = new Set();
  const start = /\b(?:(?:i|we)\s+(?:(?:am|are|was|were)\s+not\s+(?:asking|requesting|seeking)|(?:did\s+not|didn't|do\s+not|don't|never)\s+(?:ask(?:ed)?|request(?:ed)?|want(?:ed)?|need(?:ed)?|seek|made|make|submit(?:ted)?))|no\s+(?:estoy\s+pidiendo|estamos\s+pidiendo|quiero|queremos|he\s+pedido|hemos\s+pedido|solicit[eé]))\b/gi;
  // Replace only the denied predicate through its object; do not swallow a
  // subsequent positive refund/deletion/replacement request or technical fact.
  const withoutDeniedActions = text.replace(new RegExp(start.source + '[^,;.!?\\n]{0,100}', 'gi'), clause => {
    const boundary = clause.search(/\b(?:but|however|instead|pero|sin\s+embargo)\b/i);
    const head = boundary < 0 ? clause : clause.slice(0, boundary);
    const money = /\b(?:refunds?|reembolsos?|payment\s+adjustment|billing\s+adjustment)\b/i.exec(head);
    const privacy = /\b(?:data\s+deletion|(?:delete|erase|remove)\s+(?:my|our)\s+(?:account|data)|(?:borrar|eliminar)\s+(?:mi|nuestra)\s+(?:cuenta|datos))\b/i.exec(head);
    const action = [money && { match: money, kind: 'money' }, privacy && { match: privacy, kind: 'privacy' }]
      .filter(Boolean).sort((a, b) => a.match.index - b.match.index)[0];
    if (!action) return clause;
    denied.add(action.kind);
    return ' corrected request ' + clause.slice(action.match.index + action.match[0].length);
  });
  return { text: withoutDeniedActions, denied };
}

module.exports = { requestCorrection };
