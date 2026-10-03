const router = require('./router');

const PERSON_KINDS = new Set(['order_lookup', 'account_action', 'exception_request']);

function personKind(understanding) {
  const kind = String(understanding?.supportKind || '').trim();
  return PERSON_KINDS.has(kind) ? kind : '';
}

function routeWithUnderstanding(route, understanding) {
  const current = route || { area: 'unknown', lane: 'unknown' };
  const kind = String(understanding?.supportKind || '').trim();
  const translated = router.classify(understanding?.standaloneQuestion || '');
  if (kind === 'order_lookup') {
    return { ...current, area: 'shop', lane: 'shop', escalate: true };
  }
  if (kind === 'account_action') {
    const privacy = current.lane === 'privacy' || translated.lane === 'privacy';
    return { ...current, area: privacy ? 'privacy' : 'shop', lane: privacy ? 'privacy' : 'account', escalate: true };
  }
  if (kind === 'exception_request') {
    const money = current.lane === 'money' || translated.lane === 'money';
    return { ...current, area: 'shop', lane: money ? 'money' : 'shop', escalate: true };
  }
  const weakRoute = current.lane === 'unknown' ||
    (current.lane === 'faq' && current.area === 'unknown' && router.isTechLane(translated));
  if (kind === 'technical_problem' && weakRoute) {
    const area = ['app', 'desktop', 'firmware'].includes(translated.area) ? translated.area : 'unknown';
    return { ...current, area, lane: area === 'firmware' ? 'firmware' : 'tech', escalate: true };
  }
  return current;
}

function suppressAcknowledgment(understanding, question) {
  if (understanding?.messageKind !== 'acknowledgment') return false;
  const text = String(question || '');
  return !/[?？]/.test(text) && !/\b(?:but|however|still|except|yet)\b/i.test(text);
}

function personReply(kind) {
  if (kind === 'order_lookup') {
    return "I can't verify your order's status, tracking, or delivery date from chat. A person needs to check it privately.";
  }
  if (kind === 'account_action') {
    return "I can't make account or data changes from chat. A person needs to handle this privately.";
  }
  return "I can't approve or promise an exception from chat. A person needs to review this request.";
}

function personReason(kind) {
  if (kind === 'order_lookup') return 'Order lookup requires a verified staff check';
  if (kind === 'account_action') return 'Account or data action requires staff access';
  return 'Exception request requires staff review';
}

module.exports = { personKind, routeWithUnderstanding, suppressAcknowledgment, personReply, personReason };
