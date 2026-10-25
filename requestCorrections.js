// Customer grammar only, never planner output or quoted bot history. A denial
// removes that action signal, not another request elsewhere in the message.
const ACTION_OBJECTS = [
  { scope: 'refund', lane: 'money', source: '(?:refunds?|reembolsos?)' },
  { scope: 'payment_adjustment', lane: 'money', source: '(?:payment|billing)\\s+adjustment' },
  { scope: 'account_deletion', lane: 'privacy', source: '(?:(?:delete|erase|remove)\\s+(?:my|our)\\s+account|(?:borrar|eliminar)\\s+(?:mi|nuestra)\\s+cuenta)' },
  { scope: 'data_deletion', lane: 'privacy', source: '(?:data\\s+deletion|(?:delete|erase|remove)\\s+(?:my|our)\\s+data|(?:borrar|eliminar)\\s+(?:mi|nuestra)\\s+datos)' },
];

function requestCorrection(value) {
  const text = String(value || '').replace(/[\u2018\u2019]/g, "'");
  const denied = new Set();
  const deniedScopes = new Set();
  const start = /\b(?:(?:i|we)\s+(?:(?:am|are|was|were)\s+not\s+(?:asking|requesting|seeking)|(?:did\s+not|didn't|do\s+not|don't|never)\s+(?:ask(?:ed)?|request(?:ed)?|want(?:ed)?|need(?:ed)?|seek|made|make|submit(?:ted)?))|no\s+(?:estoy\s+pidiendo|estamos\s+pidiendo|quiero|queremos|he\s+pedido|hemos\s+pedido|solicit[eé]))\b/gi;
  // A protected action must be the denied verb's direct object. Searching
  // later in a clause can erase an independent positive action. Unknown
  // constructions stay untouched and retain protected routing.
  const object = '(?:' + ACTION_OBJECTS.map(action => action.source).join('|') + ')';
  const prefix = '\\s+(?:(?:for|to)\\s+)?(?:(?:a|an|the|any|un|una|el|la)\\s+)?';
  const withoutDeniedActions = text.replace(new RegExp(start.source + prefix + '(' + object + ')\\b', 'gi'), (_clause, action) => {
    const target = ACTION_OBJECTS.find(candidate => new RegExp('^' + candidate.source + '$', 'i').test(action));
    denied.add(target.lane);
    deniedScopes.add(target.scope);
    return ' corrected request ';
  });
  return { text: withoutDeniedActions, denied, deniedScopes };
}

// Reuse the same bounded direct-object vocabulary for temporal withdrawal.
// A refund withdrawal must not erase a cancellation/charge in the same lane.
function actionScopes(value) {
  const text = requestCorrection(value).text;
  return ACTION_OBJECTS.filter(action => new RegExp('\\b' + action.source + '\\b', 'i').test(text)).map(action => action.scope);
}

function withoutWithdrawnActions(value, scopes) {
  let text = requestCorrection(value).text;
  for (const action of ACTION_OBJECTS) {
    if (scopes.has(action.scope)) text = text.replace(new RegExp('\\b' + action.source + '\\b', 'gi'), ' ');
  }
  return text;
}

function withdrawalLanes(scopes) {
  return new Set(ACTION_OBJECTS.filter(action => scopes.has(action.scope)).map(action => action.lane));
}

module.exports = { requestCorrection, actionScopes, withoutWithdrawnActions, withdrawalLanes };
