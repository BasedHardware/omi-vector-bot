require('dotenv').config();
const router = require('../router');
const { relevantDocs } = require('../docs');
const { buildToolFacts } = require('../prompt');
const { queryAgent } = require('../opencode');
const triage = require('../triage');

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
    mustNot: [/\/order/i],
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
  if (modelBlocked || router.skipModel(route)) {
    const down = router.whenModelDown(route, scene.ask);
    return {
      answer: router.cannedReply(route, scene.ask) || down.reply,
      agent: down.agent,
      from: 'rules',
    };
  }
  const docsText = route.lane === 'faq' || router.looksLikeProductQuestion(scene.ask)
    ? await relevantDocs(scene.ask)
    : '';
  const toolFacts = buildToolFacts({ route, docsText });
  try {
    const agent = await queryAgent({
      question: scene.ask,
      route,
      toolFacts,
      sessionId: `eval-${scene.id}`,
    });
    return { answer: String(agent.final_answer || ''), agent, from: 'model' };
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
  for (const scene of scenarios) {
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
  console.log(`\n${scenarios.length - failed}/${scenarios.length} ok`);
  process.exit(failed ? 1 : 0);
}

main();
