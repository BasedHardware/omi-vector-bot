const router = require('./router');
const plannerPolicy = require('./plannerPolicy');
const { shouldEscalate } = require('./utils');

function answerNeedsPerson(answer) {
  return /\b(?:person|human|someone)(?: on the team)?\s+(?:(?:(?:needs?|has|should|will need)\s+to\s+)(?:check|review|handle|look at|reply|contact)|will\s+(?:reply|contact)|has\s+this)\b/i.test(String(answer || ''));
}

function decideEscalation({ route = {}, question = '', answer = '', agent = {}, caption = '', triaged = {}, holdPublicCopy = false, dataLossRisk = false } = {}) {
  const needsPerson = Boolean(
    agent.escalate || route.wantHuman || route.escalate || triaged.escalate ||
    dataLossRisk || answerNeedsPerson(answer)
  );
  const docsQuiet = !needsPerson && (
    plannerPolicy.isGroundedHowTo(route, question, answer) ||
    (route.lane === 'faq' &&
      (router.looksLikeDocs(question) ||
        router.looksLikeRecordingHow(question) ||
        router.looksLikeDeviceReset(question)))
  );
  return {
    docsQuiet,
    escalate: Boolean(holdPublicCopy || needsPerson || (!docsQuiet && shouldEscalate(agent, caption))),
  };
}

module.exports = { answerNeedsPerson, decideEscalation };
