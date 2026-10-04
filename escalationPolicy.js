const router = require('./router');
const plannerPolicy = require('./plannerPolicy');
const { shouldEscalate, CONFIDENCE_THRESHOLD, containsEscalationKeyword, needsHumanAccess } = require('./utils');

function answerNeedsPerson(answer) {
  return /\b(?:person|human|someone)(?: on the team)?\s+(?:(?:(?:needs?|has|should|will need)\s+to\s+)(?:check|review|handle|look at|reply|contact)|will\s+(?:reply|contact)|has\s+this)\b/i.test(String(answer || ''));
}

function decideEscalation({ route = {}, question = '', answer = '', agent = {}, caption = '', triaged = {}, holdPublicCopy = false, dataLossRisk = false } = {}) {
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
  const lowConfidence = !docsQuiet && agent.confidence < CONFIDENCE_THRESHOLD;
  const captionSignal = !docsQuiet &&
    (containsEscalationKeyword(caption) || needsHumanAccess(caption));
  const signals = [
    ['model_review', Boolean(agent.escalate)],
    ['want_human', Boolean(route.wantHuman)],
    ['route', Boolean(route.escalate)],
    ['triage', Boolean(triaged.escalate)],
    ['data_loss', Boolean(dataLossRisk)],
    ['answer_person', answerPerson],
    ['public_copy', Boolean(holdPublicCopy)],
    ['low_confidence', lowConfidence],
    ['caption', captionSignal],
  ].filter(([, fired]) => fired).map(([name]) => name);
  return {
    docsQuiet,
    signals,
    escalate: Boolean(signals.length || (!docsQuiet && shouldEscalate(agent, caption))),
  };
}

module.exports = { answerNeedsPerson, decideEscalation };
