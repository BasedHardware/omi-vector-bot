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
  // A checkout quote needs a human decision, but it is not a tracking lookup.
  if (current.intent === 'shipping_quote') return current;
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

function safeHandoffAcknowledgment(understanding) {
  const language = String(understanding?.replyLanguage || '').toLowerCase();
  const acknowledgment = String(understanding?.handoffAcknowledgment || '').trim();
  if (!language || language === 'en' || !acknowledgment || acknowledgment.length > 220) return '';
  if (/[\d@#€$£₹<>\n\r]|https?:\/\//i.test(acknowledgment)) return '';
  return acknowledgment;
}

function personReply(kind, route, question, understanding) {
  if (route?.intent === 'shipping_quote') return router.cannedReply(route, question);
  const acknowledgment = safeHandoffAcknowledgment(understanding);
  let reply;
  if (kind === 'order_lookup') {
    reply = "I can't verify this order's status or tracking from chat. A person needs to check privately. Keep your order number handy; you can also email help@omi.me with it if needed.";
  } else if (kind === 'account_action') {
    reply = route?.lane === 'privacy'
      ? router.cannedReply(route, question)
      : "I can't change your account or remove your data from chat. A person needs to handle this privately.";
  } else if (route?.lane === 'money') {
    reply = "I can't issue or promise a refund from chat. A person needs to review the request. Email help@omi.me and keep your order number handy.";
  } else {
    reply = "I can't approve or promise a replacement or warranty exception from chat. A person needs to review this request.";
  }
  return acknowledgment ? `${acknowledgment}\n\n${reply}` : reply;
}

function isGroundedHowTo(route, question, answer) {
  if (route?.lane !== 'faq' || route?.wantHuman || !router.looksLikeProductQuestion(question)) return false;
  const text = String(answer || '');
  if (!/https:\/\/(?:help|docs)\.omi\.me\//i.test(text)) return false;
  const uncertainty = /\b(?:couldn['’]?t find|can['’]?t find|not sure|can['’]?t confirm|unable to verify|don['’]?t know)\b/i.exec(text);
  const actionableStep = /\b(?:open|go to|tap|select|choose|press|connect|update|visit)\b/i.exec(text);
  if (uncertainty && (!actionableStep || uncertainty.index < actionableStep.index)) return false;
  return true;
}

function personReason(kind) {
  if (kind === 'order_lookup') return 'Order lookup requires a verified staff check';
  if (kind === 'account_action') return 'Account or data action requires staff access';
  return 'Exception request requires staff review';
}

module.exports = { personKind, routeWithUnderstanding, suppressAcknowledgment, personReply, personReason, isGroundedHowTo };
