const router = require('./router');

const PERSON_KINDS = new Set(['order_lookup', 'account_action', 'exception_request', 'money', 'privacy']);
const CANNED_LANES = new Set(['money', 'privacy', 'shop', 'account']);
const ENGLISH_WORDS = new Set(['i', 'my', 'me', 'we', 'our', 'you', 'your', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has', 'do', 'does', 'did', 'can', 'could', 'would', 'what', 'where', 'how', 'why', 'please', 'want', 'need', 'to', 'for', 'with', 'this', 'that', 'from']);
const OTHER_LANGUAGE_WORDS = /\b(?:quiero|necesito|reembolso|pedido|factura|donde|como|quero|preciso|meu|minha|obrigado|ich|mein|meine|bitte|rechnung|kann|sipari[sş]|iade|nas[iı]l|merhaba|mujhe|mera|meri|kya|kaise|chahiye|hai|nahi|merci|gracias)\b/i;

function skipPlannerForCanned(route, question) {
  if (!CANNED_LANES.has(route?.lane) || route?.responseMode === 'grounded') return false;
  const text = String(question || '');
  if (/[^\x00-\x7F]/.test(text) || OTHER_LANGUAGE_WORDS.test(text)) return false;
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  return words.filter((word) => ENGLISH_WORDS.has(word)).length >= 2;
}

function isPlainAcknowledgment(question) {
  const text = String(question || '').trim();
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length || words.length > 8 || /[?？\n\r]/.test(text)) return false;
  // A missing question mark is common in support requests. A model's
  // "acknowledgment" label cannot override these question/problem cues.
  if (/^(?:has|is|did|does|can|when|why|how|what)\b/i.test(text) ||
      /\b(?:when|why|how|what|not|still|again|now|empty|error|broken|issue|another|but|however|except|yet|missing|failed|failing|stuck|stopped|vanished|lost|cannot|can't|won't|want|need|please|refund|cancel|delete|replace|help)\b/i.test(text)) return false;
  return /\b(?:thanks|thank you|gracias|merci|obrigad[oa]|danke|grazie|fixed|resolved|works|working|ok|okay|yes|yeah|great|perfect|understood|got it|all good)\b/i.test(text) ||
    /(?:ありがとう|ありがとうございます|谢谢|謝謝|감사합니다|고마워요)/u.test(text);
}

function suppressOffTopic(understanding, route) {
  return understanding?.messageKind === 'off_topic' &&
    understanding?.wantsPerson !== true &&
    !route?.wantHuman && !route?.escalate &&
    !CANNED_LANES.has(route?.lane) && !router.isTechLane(route);
}

function personKind(understanding) {
  const kind = String(understanding?.supportKind || '').trim();
  return PERSON_KINDS.has(kind) ? kind : '';
}

function routeWithUnderstanding(route, understanding, originalQuestion = '') {
  const base = route || { area: 'unknown', lane: 'unknown' };
  const current = understanding?.wantsPerson === true
    ? { ...base, wantHuman: true, escalate: true }
    : base;
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
  if (kind === 'money') return { ...current, area: 'shop', lane: 'money', escalate: true };
  if (kind === 'privacy') return { ...current, area: 'privacy', lane: 'privacy', escalate: true };
  const reportedFault = /\b(?:empty|missing|vanished|lost|stopped|failed|failing|broken|error|crash(?:ed|ing)?|doesn['’]?t|won['’]?t|cannot|can['’]?t|not working|not syncing|no answer)\b/i.test(String(originalQuestion || ''));
  const weakRoute = current.lane === 'unknown' ||
    (current.lane === 'faq' && current.area === 'unknown' &&
      (router.isTechLane(translated) || understanding?.messageKind === 'new_symptom' || reportedFault) &&
      !router.looksLikeProductQuestion(originalQuestion));
  if (kind === 'technical_problem' && weakRoute) {
    const area = ['app', 'desktop', 'firmware'].includes(translated.area) ? translated.area : 'unknown';
    return { ...current, area, lane: area === 'firmware' ? 'firmware' : 'tech', escalate: true };
  }
  return current;
}

function suppressAcknowledgment(_understanding, question) {
  return isPlainAcknowledgment(question);
}

const LOCALIZED_HANDOFF = {
  es: { pending: 'Una persona del equipo debe revisar esto.', thread: 'Una persona del equipo responderá en este hilo.', sent: 'Una persona del equipo ya tiene este caso.', failed: 'No pude entregar el caso al equipo. Escribe a help@omi.me en privado.', duplicate: 'El equipo ya tiene este caso.', issue: 'El problema está registrado en este hilo.' },
  pt: { pending: 'Uma pessoa da equipe precisa analisar isso.', thread: 'Uma pessoa da equipe responderá nesta conversa.', sent: 'A equipe já recebeu este caso.', failed: 'Não consegui enviar o caso à equipe. Escreva para help@omi.me em privado.', duplicate: 'A equipe já tem este caso.', issue: 'O problema está registrado nesta conversa.' },
  de: { pending: 'Jemand aus dem Team muss das prüfen.', thread: 'Jemand aus dem Team antwortet in diesem Thread.', sent: 'Das Team hat diesen Fall erhalten.', failed: 'Ich konnte den Fall nicht an das Team weiterleiten. Bitte schreibe privat an help@omi.me.', duplicate: 'Das Team hat diesen Fall bereits.', issue: 'Das Problem ist in diesem Thread festgehalten.' },
  tr: { pending: 'Ekipten birinin bunu incelemesi gerekiyor.', thread: 'Ekipten biri bu başlıkta yanıt verecek.', sent: 'Ekip bu talebi aldı.', failed: 'Talebi ekibe iletemedim. Lütfen help@omi.me adresine özel olarak yazın.', duplicate: 'Ekip bu talebi zaten aldı.', issue: 'Sorun bu başlıkta kayıtlı.' },
  fr: { pending: "Une personne de l'équipe doit examiner cela.", thread: "Une personne de l'équipe répondra dans ce fil.", sent: "L'équipe a reçu ce dossier.", failed: "Je n'ai pas pu transmettre le dossier à l'équipe. Écrivez à help@omi.me en privé.", duplicate: "L'équipe a déjà ce dossier.", issue: 'Le problème est consigné dans ce fil.' },
  id: { pending: 'Seseorang dari tim perlu meninjau ini.', thread: 'Seseorang dari tim akan membalas di utas ini.', sent: 'Tim sudah menerima kasus ini.', failed: 'Saya tidak dapat mengirim kasus ini ke tim. Silakan email help@omi.me secara pribadi.', duplicate: 'Tim sudah menerima kasus ini.', issue: 'Masalah ini tercatat di utas ini.' },
  'hi-Latn': { pending: 'Team ke kisi vyakti ko iski jaanch karni hogi.', thread: 'Team ka koi vyakti isi thread mein jawab dega.', sent: 'Team ko yeh mamla mil gaya hai.', failed: 'Main yeh mamla team tak nahi pahuncha saka. Kripya help@omi.me par private email karein.', duplicate: 'Team ke paas yeh mamla pehle se hai.', issue: 'Yeh samasya isi thread mein darj hai.' },
  'hi-Deva': { pending: 'टीम के किसी व्यक्ति को इसकी जाँच करनी होगी।', thread: 'टीम का कोई व्यक्ति इसी थ्रेड में जवाब देगा।', sent: 'टीम को यह मामला मिल गया है।', failed: 'मैं यह मामला टीम तक नहीं पहुँचा सका। कृपया help@omi.me पर निजी ईमेल करें।', duplicate: 'टीम के पास यह मामला पहले से है।', issue: 'यह समस्या इसी थ्रेड में दर्ज है।' },
  ja: { pending: '担当者による確認が必要です。', thread: '担当者がこのスレッドで返信します。', sent: '担当者にこの件を共有しました。', failed: '担当者に届けられませんでした。詳細を help@omi.me に非公開でメールしてください。', duplicate: '担当者にはすでに共有されています。', issue: '問題はこのスレッドに記録されています。' },
};

function handoffLocale(understanding, question) {
  const language = String(understanding?.replyLanguage || 'en').toLowerCase().split('-')[0];
  if (language === 'hi') return LOCALIZED_HANDOFF[/\p{Script=Devanagari}/u.test(String(question || '')) ? 'hi-Deva' : 'hi-Latn'];
  return LOCALIZED_HANDOFF[language] || null;
}

function handoffFooters(understanding, question) {
  const language = String(understanding?.replyLanguage || 'en').toLowerCase().split('-')[0];
  if (language === 'en') return null;
  const locale = handoffLocale(understanding, question);
  if (!locale) return null;
  return {
    thread: locale.thread || '', sent: locale.sent || '', failed: locale.failed || '',
    duplicate: locale.duplicate || '', pending: locale.pending || '', issue: locale.issue || '',
  };
}

function safeHandoffAcknowledgment(understanding, question) {
  const language = String(understanding?.replyLanguage || '').toLowerCase();
  const acknowledgment = String(understanding?.handoffAcknowledgment || '').trim();
  if (!language || language === 'en' || !acknowledgment || acknowledgment.length > 220) return '';
  if (/[\d@#€$£₹<>\n\r]|https?:\/\//i.test(acknowledgment)) return '';
  if (!/\p{Script=Devanagari}/u.test(String(question || '')) &&
      /\p{Script=Devanagari}/u.test(acknowledgment)) return '';
  return acknowledgment;
}

function personReply(kind, route, question, understanding) {
  if (route?.intent === 'shipping_quote') return router.cannedReply(route, question);
  const acknowledgment = safeHandoffAcknowledgment(understanding, question);
  if (String(understanding?.replyLanguage || 'en').toLowerCase().split('-')[0] !== 'en') {
    const localized = acknowledgment || handoffLocale(understanding, question)?.pending;
    if (localized) return localized;
  }
  let reply;
  if (kind === 'order_lookup') {
    reply = router.cannedReply({ ...route, area: 'shop', lane: 'shop', wantHuman: false }, question);
  } else if (kind === 'account_action') {
    reply = route?.lane === 'privacy'
      ? router.cannedReply(route, question)
      : "I can't change your account from chat. A person needs to review this privately.";
  } else if (kind === 'privacy') {
    reply = "I can't delete your data from chat. A person needs to review this privately.";
  } else if (kind === 'money') {
    reply = "I can't change billing from chat. A person needs to review the request.";
  } else if (route?.wantHuman) {
    reply = 'A person needs to review your request.';
  } else if (route?.lane === 'money') {
    reply = "I can't issue or promise a refund from chat. A person needs to review the request.";
  } else if (/\b(?:replacement|warranty)\b/i.test(String(question || ''))) {
    reply = "I can't approve a replacement or warranty exception from chat. A person needs to review this request.";
  } else {
    reply = 'A person needs to review this request.';
  }
  return reply;
}

function isGroundedHowTo(route, question, answer) {
  if (route?.lane !== 'faq' || route?.wantHuman || !router.looksLikeProductQuestion(question)) return false;
  const text = String(answer || '');
  if (!/https:\/\/(?:help|docs)\.omi\.me\//i.test(text)) return false;
  const uncertainty = /\b(?:couldn['’]?t find|can['’]?t find|couldn['’]?t verify|could not verify|can['’]?t verify|cannot verify|not sure|can['’]?t confirm|unable to verify|don['’]?t know)\b/i.exec(text);
  const actionableStep = /\b(?:open|go to|tap|select|choose|press|connect|update|visit)\b/i.exec(text);
  if (uncertainty && (!actionableStep || uncertainty.index < actionableStep.index)) return false;
  return true;
}

function verifiedCannedReply(route, question, evidence) {
  if (route?.lane !== 'faq' || route?.wantHuman || route?.escalate ||
      !router.looksLikeProductQuestion(question)) return '';
  const reply = String(router.cannedReply(route, question) || '');
  const cited = /\bSource:\s*(https:\/\/(?:help|docs)\.omi\.me\/[^\s)]+)/i.exec(reply);
  if (!cited) return '';
  const normalize = (url) => String(url || '').replace(/\.md\/?$/i, '').replace(/\/$/, '');
  const source = normalize(cited[1]);
  const block = String(evidence || '').split(/(?=\[S\d+\s*\|)/).find((part) =>
    [...part.matchAll(/https:\/\/(?:help|docs)\.omi\.me\/[^\s)]+/gi)]
      .some((match) => normalize(match[0]) === source));
  if (!block) return '';
  const numbers = (reply.slice(0, cited.index).match(/\b\d+\b/g) || []);
  if (numbers.some((number) => !new RegExp(`\\b${number}\\b`).test(block))) return '';
  return reply;
}

function personReason(kind) {
  if (kind === 'order_lookup') return 'Order lookup requires a verified staff check';
  if (kind === 'account_action') return 'Account or data action requires staff access';
  return 'Exception request requires staff review';
}

module.exports = { personKind, routeWithUnderstanding, skipPlannerForCanned, suppressAcknowledgment, suppressOffTopic, personReply, personReason, handoffFooters, isGroundedHowTo, verifiedCannedReply };
