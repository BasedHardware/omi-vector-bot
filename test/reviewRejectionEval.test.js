const test = require('node:test');
const assert = require('node:assert/strict');
// Real evaluation wrapper, stubbed at provider/source boundaries only. No key,
// network, Discord post or protected fixture is used.
for (const key of ['CMD_API_KEY','OPENCODE_API_KEY','DATABASE_URL','DISCORD_TOKEN','TELEGRAM_TOKEN','SHOPIFY_ACCESS_TOKEN']) process.env[key] = '';
process.env.EVAL_NO_MODEL = '';
globalThis.fetch = async () => { throw new Error('Unexpected network use in synthetic evaluation test'); };
let language = 'en';
const provider = require('../commandcode');
provider.planSearch = async () => ({replyLanguage:language,queries:[],standaloneQuestion:'How is text size adjusted?'});
provider.queryAgent = async () => ({final_answer:'An unrelated draft.',confidence:0.9,escalate:false});
provider.reviewAnswer = async () => ({final_answer:'An unrelated draft.',grounded:false,relevant:false,confidence:0.1,escalate:true});
require('../docs').relevantDocs = async () => '';
require('../feedback').relevantFeedback = async () => '';
require('../github').searchOfficialCode = async () => '';
const {replyFor} = require('../scripts/customer-eval');
const {reviewRejectionReply} = require('../supportReplyCopy');
test('copy helper handles regions, unknown/prototype keys and Hindi script without promises', () => {
  assert.equal(reviewRejectionReply('DE-DE'), reviewRejectionReply('de'));
  for (const unknown of ['xx','toString','__proto__','constructor']) assert.equal(reviewRejectionReply(unknown), reviewRejectionReply('en'));
  assert.match(reviewRejectionReply('hi', 'कृपया मदद करें'), /जाँच/u);
  assert.match(reviewRejectionReply('hi', 'Kripya madad karein'), /jaanch/u);
  for (const code of ['en','de','fr','es','pt','it','tr','id','zh','ja','hi-Deva','hi-Latn']) {
    assert.equal(typeof reviewRejectionReply(code), 'string');
    assert.doesNotMatch(reviewRejectionReply(code), /https?:|@|\d|delivered|accepted|resolved|will reply/i);
  }
});
for (const [code, pattern] of [['de',/konnte.*direkte Antwort/u],['fr',/pas pu vérifier/u],['es',/pude verificar/u],['xx',/couldn't verify/u]]) {
  test(`eval rejected-review ${code} uses the shared localized body`, async () => {
    language = code;
    const result = await replyFor({id:'synthetic-localized-review',ask:'How is the text size adjusted?'}, {lane:'faq',area:'app'});
    assert.match(result.answer, pattern);
    assert.equal(result.agent.escalate, true);
  });
}
