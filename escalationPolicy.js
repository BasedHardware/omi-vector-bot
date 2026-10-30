const router = require('./router');
const plannerPolicy = require('./plannerPolicy');
const { shouldEscalate, CONFIDENCE_THRESHOLD, containsEscalationKeyword, needsHumanAccess, stripSupportRedirectWithAudit } = require('./utils');
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

const { classifyReviewRequirement, isOptionalDiagnosticQualifier } = require('./reviewRequirement');

function answerNeedsPerson(answer) {
  // This is a conservative wording guard, not the authority for delivery or
  // acceptance. Structured model/reviewer/route/privacy signals remain separate.
  // Quoted diagnostics and a conditional or negated requirement are not an
  // unconditional request for a person in the current case.
  const prose = String(answer || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .replace(/["“][^"”]*["”]/g, '')
    .replace(/(?<![\p{L}\p{N}])['‘][^'’\n]+['’](?![\p{L}\p{N}])/gu, '')
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n')
    .replace(/[*_~]/g, '');
  const person = /\b(?:person|human|someone)(?: on the team)?\s+(?:(?:(?:needs?|has|will need)\s+to\s+|should\s+(?:to\s+)?)(?:check|review|handle|look at|reply|contact)|will\s+(?:reply|contact)|has\s+this)\b/ig;
  const direct = /^(?:[-*•]\s*|\d+[.)]\s*)?(?:(?:this|it|that|the (?:case|issue|request|problem))\s+(?:still\s+)?(?:needs|requires)\s+(?:a\s+)?(?:person|human)(?=\s*(?:[.!?]|$)|\s+(?:who|to)\s+(?:can\s+)?(?:check|review|handle|look|verify)\b))/i;
  for (const sentence of prose.split(/(?<=[.!?])\s+|\n+/)) {
    let conditional = false;
    for (const clause of sentence.split(/[;；]\s*/)) {
      // A complete conditional request for optional details does not scope a
      // later independent handoff. Ambiguous condition fragments remain held.
      const optionalDetails = isOptionalDiagnosticQualifier(clause);
      conditional ||= !optionalDetails && /\b(?:if|unless|when|until|provided)\b|\bonly\s+(?:after|once)\b|^\s*(?:after|before|once)\b/i.test(clause);
      if (conditional) continue;
      const requirement = classifyReviewRequirement(clause);
      if (requirement.recognized) {
        if (requirement.needsPerson) return true;
        continue;
      }
      if (direct.test(clause.trim())) return true;
      person.lastIndex = 0;
      for (const match of clause.matchAll(person)) {
        const prefix = clause.slice(0, match.index);
        if (/\b(?:no|not|never|without)\s+(?:(?:a|any|the)\s+)?$/i.test(prefix)) continue;
        if (/(?:does not|doesn't|do not|don't)\s+(?:mean|think|say|imply)\b[^.;]*$/i.test(prefix)) continue;
        return true;
      }
    }
  }
  return false;
}

function decideEscalation({ route = {}, question = '', answer = '', agent = {}, caption = '', triaged = {}, holdPublicCopy = false, dataLossRisk = false, reviewApproved = false, retrievedUrls = [], supportKind = '' } = {}) {
  const answerPerson = answerNeedsPerson(answer);
  // Preserve the next actor before presentation removes an external contact
  // route. This signal requires the same removed clause's bounded current
  // instruction, never an address mention or model-authored receipt claim.
  const currentContact = stripSupportRedirectWithAudit(answer).currentContactRequested;
  const needsPerson = Boolean(
    agent.escalate || route.wantHuman || route.escalate || triaged.escalate ||
    dataLossRisk || answerPerson || currentContact
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
    ['current_contact_redirect', currentContact],
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
