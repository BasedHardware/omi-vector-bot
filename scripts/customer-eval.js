require('dotenv').config();
const router = require('../router');
const { relevantDocs } = require('../docs');
const { relevantFeedback } = require('../feedback');
const { buildToolFacts, OFFICIAL } = require('../prompt');
const { planSearch, queryAgent, reviewAnswer } = require('../opencode');
const triage = require('../triage');
const { prepareDraftForReview, presentReviewedAnswer } = require('../answerPipeline');
const github = require('../github');
const { loadOfficialSource } = require('../sourcecode');
const {
  chunkDocument,
  combineEvidence,
  formatEvidence,
  rankLocalChunks,
  supportQueries,
} = require('../retrieval');

const scenarios = [
  {
    id: 'plaud',
    first: 'answer',
    ask: "I'd like to keep my new Omi device (not app) recording, just like Plaud does for 24 hours. I turned it on for a couple of days and nothing has recorded yet. Any clue?",
    lane: 'faq',
    must: [/battery/i, /app/i],
    mustNot: [/github\.com\/BasedHardware/i],
  },
  {
    id: 'blue-light',
    first: 'answer',
    ask: 'What does a solid blue light on my Omi mean?',
    lane: 'faq',
    must: [/connected/i],
    mustNot: [/not sure what blue/i],
  },
  {
    id: 'power-off',
    first: 'answer',
    ask: 'How do I turn the Omi necklace off?',
    lane: 'faq',
    must: [/3 second/i],
    mustNot: [/press once to turn (it |the device )?off/i],
  },
  {
    id: 'delete',
    first: 'answer',
    ask: 'How do I delete one conversation and its audio?',
    lane: 'faq',
    must: [/conversation/i],
    mustNot: [/I don't know/i],
  },
  {
    id: 'charging',
    first: 'person',
    ask: 'My OMI is not charging when placed on the charger. It started 2-3 days ago. What should I do?',
    lane: 'firmware',
    mustNot: [/error line shown on the screen/i, /\/order/i],
  },
  {
    id: 'shipping',
    first: 'person',
    ask: 'Ordered my Omi with Express Delivery on Sep 1st, #22102, and it is still in preparing status.',
    lane: 'shop',
    must: [/help@omi\.me|not live yet|order number/i],
  },
  {
    id: 'crash',
    first: 'person',
    ask: 'The Android app crashes every time I open a conversation.',
    lane: 'tech',
    mustNot: [/battery life/i],
  },
  {
    id: 'still-nothing',
    first: 'person',
    ask: 'The app stayed open, the light was blue, and still nothing recorded.',
    lane: 'tech',
    mustNot: [/24 hours on the Omi page is battery/i],
  },
];

const liveScenarios = [
  {
    id: 'google-calendar-integration',
    first: 'person',
    ask: [
      'I use a personal Google account. The Google Calendar extension says “This app is blocked”',
      'and there is no Advanced option. The built-in Omi integration only gets my main calendar.',
      'How can I fix both and use multiple calendars?',
    ].join(' '),
    lane: 'tech',
    must: [/in progress|reported|known/i, /primary|main calendar/i],
    mustNot: [/advanced.{0,30}unsafe/i, /workspace admin console/i, /change.{0,30}google account settings/i],
  },
  {
    id: 'voice-question-no-answer',
    first: 'person',
    ask: [
      'I press my Omi, feel the vibration, ask a question, and press again.',
      'The question transcription appears in the app, but I never get an answer.',
      'I already reconnected it and deleted my account.',
      'iPhone 15 Pro, iOS 27, CV1 fw 3.0.21, app 1.0.552.',
    ].join(' '),
    lane: 'tech',
    must: [/transcri/i, /AI reply|AI message|Chat|response|(?:reply|answer) (?:never|doesn.t|isn.t|not|missing)|no answer follows|what isn.t happening is an answer coming back/i],
    mustNot: [/check.*notification permission/i, /voiceReplyStep|aiResponse|ServerMessage/],
  },
  {
    id: 'developer-key',
    first: 'answer',
    ask: 'Where do I create an Omi developer API key?',
    lane: 'faq',
    must: [/developer/i, /key/i],
    mustNot: [/invent|not published/i],
  },
  {
    id: 'conversation-timeout',
    first: 'answer',
    ask: 'Where can I change how long silence lasts before Omi ends a conversation?',
    lane: 'faq',
    must: [/conversation timeout|silence/i, /settings|profile/i],
  },
  {
    id: 'offline-sync',
    first: 'answer',
    ask: 'If I record while my phone has no internet, can the conversation sync later?',
    lane: 'faq',
    must: [/sync|reconnect|internet/i],
    mustNot: [/lost for good/i],
  },
  {
    id: 'devkit-standalone',
    first: 'answer',
    ask: 'Which Omi device can record on its own without the phone app?',
    lane: 'faq',
    must: [/devkit 2/i],
    mustNot: [/consumer necklace can/i],
  },
];

function judge(scene, route, answer) {
  const problems = [];
  if (route.lane !== scene.lane && !(scene.lane === 'tech' && route.lane === 'firmware')) {
    problems.push(`lane ${route.lane}, wanted ${scene.lane}`);
  }
  const escalate = Boolean(route.escalate || route.wantHuman);
  if (scene.first === 'answer' && escalate) problems.push('sent to a person');
  if (scene.first === 'person' && route.lane === 'faq' && !escalate) problems.push('answered instead of a person');
  for (const re of scene.must || []) if (!re.test(answer)) problems.push(`missing ${re}`);
  for (const re of scene.mustNot || []) if (re.test(answer)) problems.push(`said ${re}`);
  return problems;
}

let modelBlocked = process.env.EVAL_NO_MODEL === '1';

async function replyFor(scene, route) {
  if (modelBlocked || !router.requiresGroundedAnswer(route)) {
    const down = router.whenModelDown(route, scene.ask);
    return {
      answer: router.cannedReply(route, scene.ask) || down.reply,
      agent: down.agent,
      from: 'rules',
    };
  }
  let searchPlan = {
    standaloneQuestion: scene.ask,
    customerGoal: scene.ask,
    mustAnswer: [scene.ask],
    customerFacts: [],
    supportKind: 'other',
    queries: [],
  };
  if (router.requiresGroundedAnswer(route)) {
    try {
      searchPlan = await planSearch({
        question: scene.ask,
        route,
        sessionId: `eval-${scene.id}-search`,
      });
    } catch (err) {
      if (/429|usage limit|wallet/i.test(err.message)) modelBlocked = true;
    }
  }
  let docsText = '';
  if (router.requiresGroundedAnswer(route)) {
    const sourceQuestion = searchPlan.standaloneQuestion || scene.ask;
    const usePublicSource = process.env.EVAL_PUBLIC_SOURCE === '1';
    const [pages, code, feedback, publicSource] = await Promise.all([
      usePublicSource ? '' : relevantDocs(sourceQuestion, { queries: searchPlan.queries }),
      github.searchOfficialCode(sourceQuestion, { queries: searchPlan.queries }),
      router.isTechLane(route) || route.lane === 'unknown'
        ? relevantFeedback(sourceQuestion, { queries: searchPlan.queries })
        : '',
      usePublicSource
        ? (async () => {
            const sourcePages = [];
            await loadOfficialSource(fetch, { saveDocPage: async (page) => sourcePages.push(page) });
            const chunks = sourcePages.flatMap((page) => chunkDocument(page));
            return formatEvidence(
              rankLocalChunks(supportQueries(sourceQuestion, searchPlan.queries), chunks, 8)
            );
          })()
        : '',
    ]);
    docsText = combineEvidence(pages, feedback, code, publicSource);
  }
  const toolFacts = buildToolFacts({ route, docsText });
  try {
    const agent = await queryAgent({
      question: scene.ask,
      route,
      toolFacts,
      understanding: searchPlan,
      sessionId: `eval-${scene.id}`,
    });
    const draftLane = triage.merge(route, agent, scene.ask).lane;
    const checked = await reviewAnswer({
      question: scene.ask,
      draft: prepareDraftForReview(agent.final_answer, draftLane, scene.ask),
      understanding: searchPlan,
      policy: toolFacts,
      sources: [
        `[Static fallback | lower priority]\n${OFFICIAL}`,
        docsText,
      ]
        .filter(Boolean)
        .join('\n\n'),
      sessionId: `eval-${scene.id}-review`,
    });
    agent.final_answer = checked.relevant
      ? checked.final_answer
      : "I couldn't verify a direct answer to what you asked from the official Omi information. I won't substitute a different or guessed answer; a person needs to check this.";
    agent.escalate = Boolean(agent.escalate || checked.escalate);
    agent.confidence = Math.min(Number(agent.confidence) || 0.4, Number(checked.confidence) || 0.4);
    return { answer: presentReviewedAnswer(agent.final_answer), agent, from: 'model+review' };
  } catch (err) {
    if (/429|usage limit|wallet/i.test(err.message)) modelBlocked = true;
    const down = router.whenModelDown(route, scene.ask);
    return {
      answer: router.cannedReply(route, scene.ask) || down.reply,
      agent: down.agent,
      from: `rules (${err.message})`,
    };
  }
}

async function main() {
  const key = Boolean(String(process.env.OPENCODE_API_KEY || '').trim());
  console.log(`model ${key && !modelBlocked ? 'on' : 'off'}`);
  let failed = 0;
  let ran = 0;
  const requested = String(process.env.EVAL_SCENARIO || '').trim();
  const selected = (modelBlocked ? scenarios : [...scenarios, ...liveScenarios]).filter(
    (scene) => !requested || scene.id === requested
  );
  for (const scene of selected) {
    if (liveScenarios.includes(scene) && modelBlocked) continue;
    ran += 1;
    const route = router.classify(scene.ask);
    const result = await replyFor(scene, route);
    const merged = triage.merge(route, result.agent, scene.ask);
    const problems = judge(scene, route, result.answer);
    if (problems.length) failed += 1;
    const specialist = router.specialistNames(merged.area, merged.lane);
    const action = merged.escalate
      ? `person ${specialist || 'staff'}${merged.fileIssue ? ', would file a GitHub issue' : ', no GitHub issue'}`
      : 'answers in the thread, no ping';
    console.log(`\n# ${scene.id} ${problems.length ? 'MISS' : 'OK'} via ${result.from}`);
    console.log(action);
    console.log(result.answer.replace(/\s+/g, ' ').slice(0, 420));
    if (problems.length) console.log(`problems: ${problems.join('; ')}`);
  }
  console.log(`\n${ran - failed}/${ran} ok`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { scenarios, liveScenarios, judge, replyFor };
