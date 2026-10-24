const router = require('./router');
const plannerPolicy = require('./plannerPolicy');
const { shouldEscalate, CONFIDENCE_THRESHOLD, containsEscalationKeyword, needsHumanAccess } = require('./utils');
const { hasUnsyncedDataRisk } = require('./answerPipeline');

function officialCitationUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    const official = ['help.omi.me', 'docs.omi.me', 'omi.me', 'www.omi.me'].includes(url.hostname) ||
      (url.hostname === 'github.com' && /^\/BasedHardware\/omi\/(?:blob\/|releases\/tag\/)/i.test(url.pathname));
    return official ? url.href : '';
  } catch { return ''; }
}

function hasRetrievedCitation(answer, retrievedUrls) {
  if (!Array.isArray(retrievedUrls)) return false;
  const retrieved = new Set(retrievedUrls.map(officialCitationUrl).filter(Boolean));
  // Match whole URL tokens, not a trusted URL embedded in another host/query or
  // a prefix of a different article. Markdown closing punctuation is excluded.
  const cited = String(answer || '').match(/https?:\/\/[^\s<>\[\]{}"'`)，。、；｜（）［］【】]+/giu) || [];
  return cited.some(value => {
    const url = officialCitationUrl(value.replace(/[.,;!?]+$/, ''));
    return Boolean(url && retrieved.has(url));
  });
}

function protectedSubject(route, triaged, question, supportKind) {
  const protectedLanes = new Set(['shop', 'money', 'account', 'privacy']);
  const classified = router.classify(question);
  return [route, triaged, classified].some(item => protectedLanes.has(item?.lane) ||
    ['shop', 'privacy', 'account'].includes(item?.area)) ||
    Boolean(plannerPolicy.personKind({ supportKind })) || hasUnsyncedDataRisk(question) ||
    /\b(?:refunds?|replacements?|warrant(?:y|ies)|accounts?|delet(?:e|ing|ion)|eras(?:e|ing|ure))\b/i.test(String(question || ''));
}

function answerNeedsPerson(answer) {
  return /\b(?:person|human|someone)(?: on the team)?\s+(?:(?:(?:needs?|has|should|will need)\s+to\s+)(?:check|review|handle|look at|reply|contact)|will\s+(?:reply|contact)|has\s+this)\b/i.test(String(answer || ''));
}

function decideEscalation({ route = {}, question = '', answer = '', agent = {}, caption = '', triaged = {}, holdPublicCopy = false, dataLossRisk = false, reviewApproved = false, retrievedUrls = [], supportKind = '' } = {}) {
  const answerPerson = answerNeedsPerson(answer);
  const needsPerson = Boolean(
    agent.escalate || route.wantHuman || route.escalate || triaged.escalate ||
    dataLossRisk || answerPerson
  );
  const docsQuiet = !needsPerson && (
    plannerPolicy.isGroundedHowTo(route, question, answer) ||
    (route.lane === 'faq' &&
      (router.looksLikeDocs(question) ||
        router.looksLikeRecordingHow(question) ||
        router.looksLikeDeviceReset(question)))
  );
  const captionSignal = !docsQuiet &&
    (containsEscalationKeyword(caption) || needsHumanAccess(caption));
  const lowConfidence = !docsQuiet && agent.confidence < CONFIDENCE_THRESHOLD;
  // Confidence is a self-estimate, not a veto over an independently approved
  // answer. This exception cannot cancel any other signal or protected topic.
  const confidenceOnlyExempt = lowConfidence && reviewApproved === true &&
    !needsPerson && !holdPublicCopy && !captionSignal &&
    !protectedSubject(route, triaged, question, supportKind) &&
    hasRetrievedCitation(answer, retrievedUrls);
  const signals = [
    ['model_review', Boolean(agent.escalate)],
    ['want_human', Boolean(route.wantHuman)],
    ['route', Boolean(route.escalate)],
    ['triage', Boolean(triaged.escalate)],
    ['data_loss', Boolean(dataLossRisk)],
    ['answer_person', answerPerson],
    ['public_copy', Boolean(holdPublicCopy)],
    ['low_confidence', lowConfidence && !confidenceOnlyExempt],
    ['caption', captionSignal],
  ].filter(([, fired]) => fired).map(([name]) => name);
  return {
    docsQuiet,
    signals,
    escalate: Boolean(signals.length || (!docsQuiet && !confidenceOnlyExempt && shouldEscalate(agent, caption))),
  };
}

module.exports = { answerNeedsPerson, decideEscalation };
