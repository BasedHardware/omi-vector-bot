const test=require('node:test'),assert=require('node:assert/strict');
const {presentReviewedAnswer,prepareDraftForReviewWithAudit}=require('../answerPipeline');
const {reviewAnswer}=require('../commandcode');
const {reviewWithSecondLook,approvedReview}=require('../reviewDecision');
const claims=[
 'Your refund has been approved and will arrive tomorrow.',
 'We have issued your account credit.',
 'The replacement is on its way.',
 'Your return has been processed.',
 'The warranty claim is approved.',
 'Deine Rückerstattung wurde genehmigt.',
 'Votre remboursement a été approuvé.',
 'Tu reembolso ha sido aprobado.',
 'Seu reembolso foi aprovado.',
 'Il tuo rimborso è stato approvato.',
 'İadeniz onaylandı.',
 'Pengembalian dana Anda telah disetujui.',
 '您的退款已获批准。',
 '返金は承認されました。',
 '환불이 승인되었습니다.',
 'Ваш возврат одобрен.',
 'आपका रिफंड स्वीकृत हो गया है।',
 'Aapka refund approve ho gaya hai.',
];
test('unverified customer financial outcomes cannot survive public presentation in supported languages',()=>{
 for(const claim of claims) {
  const answer=presentReviewedAnswer(claim+'\n\nSource: https://help.omi.me/en/articles/98760010-policy');
  assert.ok(!answer.includes(claim),claim);
  assert.match(answer,/https:\/\/help\.omi\.me\/en\/articles\/98760010-policy/);
 }
});
test('financial policy, uncertainty, required review and custody warnings are kept',()=>{
 for(const text of ['Refunds are reviewed by the team.','Refunds are issued only after approval.','I cannot confirm whether your refund was approved.',
  'If your return is approved, the team will explain the next step.','Rückerstattungen werden vom Team geprüft.',
  'Les remboursements sont examinés par l’équipe.','Los reembolsos requieren revisión del equipo.',
  'Do not share payment details here. Keep unsynced recordings until the team checks.'])
  assert.equal(presentReviewedAnswer(text),text,text);
});
test('removed approval cannot return through a second approving review',async()=>{
 let calls=0;
 const bad='Your refund has been approved and will arrive tomorrow.';
 const prepared=prepareDraftForReviewWithAudit(bad,'money','Please review my refund request');
 assert.ok(!prepared.draft.includes(bad));assert.ok(prepared.removed.length);
 const result=await reviewWithSecondLook({question:'Please review my refund request',draft:'A person needs to review this.',lane:'money',sources:'',
  removedBySafetyFilters:prepared.removed},{log:()=>{},review:args=>reviewAnswer({...args,post:async()=>{
   calls++;return{data:{choices:[{message:{content:JSON.stringify({final_answer:bad,grounded:true,relevant:true,confidence:1,escalate:false})}}]}};
  }})});
 assert.equal(calls,2);assert.equal(approvedReview(result),false);assert.ok(!result.final_answer.includes(bad));
});

test('policy prerequisites and an explicitly attributed screen label do not become outcome assertions',()=>{
 for(const text of ['Your refund needs approval from the team.','Your replacement must be approved by the team first.',
  'I cannot approve your refund. A person needs to review it.',
  "You reported seeing an 'approved' label for your refund; a person needs to verify that status."])
  assert.equal(presentReviewedAnswer(text),text,text);
 for(const text of ['Your refund has been approved. It will arrive tomorrow.',
  'I cannot confirm an approval; your credit has been issued.',
  'Your replacement needs review; it has already shipped.']) {
   const shown=presentReviewedAnswer(text,{question:'Please check my refund request'});
   assert.doesNotMatch(shown,/has been approved|will arrive tomorrow|has been issued|already shipped/i,text);
 }
});

test('separate affirmative clauses cannot borrow uncertainty, policy or source-heading exemptions',()=>{
 for(const text of ['I cannot confirm the date, and your refund has been approved.',
  'Your replacement must be approved first and your refund has been approved.',
  'Refunds are issued after review and your credit has been issued.',
  'Je ne peux pas confirmer la date et votre remboursement a été approuvé.',
  'No puedo confirmar la fecha y tu reembolso ha sido aprobado.',
  'Source: Your refund has been approved.',
  'Source: https://help.omi.me/en/articles/98760010-policy Your refund has been approved.',
  'You will receive your refund tomorrow.',
  'Your replacement will be delivered on Monday.']) {
  const shown=presentReviewedAnswer(text,{question:'Please review my refund request'});
  assert.doesNotMatch(shown,/refund has been approved|credit has been issued|remboursement a été approuvé|reembolso ha sido aprobado|receive your refund|delivered on Monday/i,text);
 }
 const plain='First line.\n\nSecond line.\tA useful detail.';
 assert.equal(require('../honesty').stripUnverifiedOutcomeClaims(plain),plain);
});

test('conditions remain atomic, code returns remain code, and known money context covers short statuses',()=>{
 const {stripUnverifiedOutcomeClaims:strip}=require('../honesty');
 for(const text of ['If your return is approved and you have a shipping label, send the device back.',
  'Only after your return is approved and inspected, send the device back.',
  'Returns are accepted within thirty days of purchase.',
  'The function returns the processed transcript.',
  'Do not ship the replacement until the refund is approved.']) assert.equal(strip(text),text,text);
 for(const text of ['Your refund is confirmed.','Your refund is complete.','Your replacement has been sent.',
  'Ihre Rückerstattung wurde bestätigt.','Votre remboursement est confirmé.','Tu reembolso está confirmado.','您的退款成功。',
  'Es wurde genehmigt.']) assert.equal(strip(text,{financialContext:true}),'',text);
});

test('independent review: prefaced statuses and mixed exemptions cannot assert an outcome',()=>{
 const strip=require('../honesty').stripUnverifiedOutcomeClaims;
 for(const text of ['Gute Nachrichten, es wurde inzwischen genehmigt.','Good news, it has been approved.',
  'Refunds are usually reviewed, and a credit has been issued.',
  'Do not ship the replacement until the refund is approved; your refund has been approved.',
  'After your refund was approved, keep the receipt.']) assert.equal(strip(text,{financialContext:true}),'',text);
 for(const text of ['Refunds are processed to the original payment method.','This function returns the processed transcript.',
  'Return the processed transcript.','Has your refund been approved?']) assert.equal(strip(text),text,text);
});
