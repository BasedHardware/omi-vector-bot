const test = require('node:test');
const assert = require('node:assert/strict');
const {formatEvidence} = require('../retrieval');
const {reviewAnswer, queryAgent} = require('../commandcode');
const {approvedReview} = require('../reviewDecision');
const validChecks = {unsupported_absence:false,unsupported_customer_data:false,citations_supported:true};
const excerpt = '[S1 | Documentation | authoritative | excerpt; complete page coverage not established]\nAppearance guide\n\nThe view has a font-size control.';
function setup(t) {
  const previous = process.env.CMD_API_KEY;
  process.env.CMD_API_KEY = 'synthetic-contract-key';
  t.after(()=>{ if(previous===undefined)delete process.env.CMD_API_KEY;else process.env.CMD_API_KEY=previous; });
}
function reviewed(final_answer, claim_checks, extra = {}) {
  return {final_answer,grounded:true,relevant:true,confidence:0.9,escalate:false,sources_used:[],claim_checks,...extra};
}
function post(response, inspect = () => {}) {
  return async (_url, body) => { inspect(body); return {data:{choices:[{message:{content:JSON.stringify(response)}}]}}; };
}

test('formatted selected evidence is explicitly an excerpt, not a complete-page guarantee', () => {
  const source = formatEvidence([{source:'docs',title:'Appearance guide',body:'The view has a font-size control.'}]);
  assert.match(source, /excerpt; complete page coverage not established/u);
  assert.match(source, /font-size control/u);
});

test('answer and reviewer receive the same absence/data-claim contract', async t => {
  setup(t);
  const inspect = body => {
    const rules = body.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
    assert.match(rules, /absence from (?:the )?(?:provided )?excerpts/iu);
    assert.match(rules, /specific customer.*(?:exists|safe|recoverable)/iu);
    assert.match(rules, /could not confirm/iu);
  };
  await queryAgent({question:'Can outline controls be adjusted?',toolFacts:excerpt,post:post({final_answer:'I could not confirm that option.',escalate:true},inspect)});
  await reviewAnswer({question:'Can outline controls be adjusted?',draft:'I could not confirm that option.',lane:'faq',sources:excerpt,post:post(reviewed('I could not confirm that option.',validChecks,{escalate:true}),inspect)});
});

test('normal and compact review requests advertise the complete required JSON shape', async t => {
  setup(t);
  for (const compact of [false, true]) {
    await t.test(compact ? 'compact retry' : 'normal request', async () => {
      const requests = [];
      await reviewAnswer({
        question:'Can outline controls be adjusted?',
        draft:'I could not confirm that option.',lane:'faq',sources:excerpt,
        post:async (_url, body) => {
          requests.push(body);
          const content = compact && requests.length === 1 ? '' : JSON.stringify(
            reviewed('I could not confirm that option.',validChecks,{escalate:true}));
          return {data:{choices:[{message:{content}}]}};
        },
      });
      assert.equal(requests.length,compact ? 2 : 1);
      for (const request of requests) {
        const format = request.messages.find(m=>m.role==='system' && m.content.includes('Reply with JSON only: '));
        assert.ok(format,'the real review request must advertise its JSON response shape');
        const advertised = format.content.match(/Reply with JSON only:\s*(\{[^\n]*?\})\./u);
        assert.ok(advertised,'the response example must remain a complete JSON object');
        const example = JSON.parse(advertised[1]);
        assert.deepEqual(example.claim_checks,validChecks);
      }
    });
  }
});

test('a reviewer cannot approve an absence claim inferred from partial evidence', async t => {
  setup(t);
  const draft = 'The guide does not describe outline controls.';
  const result = await reviewAnswer({question:'Can outline controls be adjusted?',draft,lane:'faq',sources:excerpt,
    post:post(reviewed(draft,{...validChecks,unsupported_absence:true}))});
  assert.equal(approvedReview(result),false);
  assert.equal(result.escalate,true);
});

test('an explicit supported negative statement in the full supplied page can pass', async t => {
  setup(t);
  const draft = 'Outline controls are not available.';
  const sources = '[S1 | Documentation | authoritative | full supplied page]\nAppearance guide\n\nOutline controls are not available.';
  const result = await reviewAnswer({question:'Can outline controls be adjusted?',draft,lane:'faq',sources,post:post(reviewed(draft,validChecks))});
  assert.equal(approvedReview(result),true);
});

test('general retention documentation cannot establish a particular customer data outcome', async t => {
  setup(t);
  const draft = 'Your saved notes are intact and recoverable.';
  const result = await reviewAnswer({question:'What happened to the notes I saved?',draft,lane:'faq',
    sources:'[S1 | Documentation | excerpt]\nRetention guide\n\nSaved notes use cloud storage.',
    post:post(reviewed(draft,{...validChecks,unsupported_customer_data:true}))});
  assert.equal(approvedReview(result),false);
  assert.equal(result.escalate,true);
});

test('a rewritten uncertainty reply with human review remains allowed', async t => {
  setup(t);
  const result = await reviewAnswer({question:'Can outline controls be adjusted?',draft:'Outline controls do not exist.',lane:'faq',sources:excerpt,
    post:post(reviewed('I could not confirm that option; a person needs to check.',validChecks,{escalate:true}))});
  assert.equal(approvedReview(result),true);
  assert.equal(result.escalate,true);
});

test('missing or malformed claim checks cannot be silently treated as approval', async t => {
  setup(t);
  for (const checks of [undefined,{}, {...validChecks,unsupported_absence:'false'}, {...validChecks,citations_supported:false}]) {
    const result = await reviewAnswer({question:'Can outline controls be adjusted?',draft:'The view has a font-size control.',lane:'faq',sources:excerpt,
      post:post(reviewed('The view has a font-size control.',checks))});
    assert.equal(approvedReview(result),false);
    assert.equal(result.escalate,true);
  }
});
