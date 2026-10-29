const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const gate=require('../scripts/answer-evidence-gate');
const sha='a'.repeat(40),repo='BasedHardware/omi-vector-bot';
const input=()=>({pr:{head:{sha},base:{sha:'b'.repeat(40),ref:'main',repo:{full_name:repo}},user:{login:'author'},changed_files:1,
 body:'## Answer-change evidence\nMode: comparison\nHead: '+sha+'\nEvidence: https://github.com/'+repo+'/actions/runs/123\n'},files:[{filename:'prompt.js'}]});
test('all governed paths and rename-away changes require evidence; ordinary docs do not',()=>{
 for(const file of ['prompt.js','supportVoice.js','commandcode.js','retrieval.js','docs.js','reviewDecision.js','escalationPolicy.js','honesty.js','privacy.js','publicReplyPrivacy.js','utils.js','answerPipeline.js']) {
  const x=input();x.files=[{filename:file}];x.pr.body='';assert.throws(()=>gate.evaluate(x));
 }
 const x=input();x.files=[{filename:'new.js',previous_filename:'prompt.js'}];x.pr.body='';assert.throws(()=>gate.evaluate(x));
 x.files=[{filename:'docs/guide.md'}];assert.equal(gate.evaluate(x).ok,true);
});
test('comparison record is required on current head; pending, duplicate fields and external URLs fail closed',()=>{
 assert.equal(gate.evaluate(input()).ok,true);
 for(const body of ['',input().pr.body.replace(sha,'c'.repeat(40)),input().pr.body.replace('comparison','pending'),input().pr.body+'Head: '+sha,
  input().pr.body+'\n## Answer-change evidence\nMode: comparison',input().pr.body.replace('github.com','github.com.evil.test'),input().pr.body.replace('/actions/runs/123','/blob/main/prompt.js')]) {
  const x=input();x.pr.body=body;assert.throws(()=>gate.evaluate(x));
 }
});
function noChange(){
 const x=input();x.pr.body='## Answer-change evidence\nMode: no-answer-change\nHead: '+sha+'\nJustification: Metadata-only observability leaves all reply selection and delivery owners unchanged.';
 const digest=createHash('sha256').update(gate.evidenceBlock(x.pr.body)).digest('hex');
 x.reviews=[{state:'APPROVED',commit_id:sha,body:'Mira evidence approval: '+digest,user:{login:'reviewer',type:'User'}}];x.permissions={reviewer:true};return x;
}
test('no-answer-change is an independently approved, exact-body and exact-head exemption',()=>{
 assert.equal(gate.evaluate(noChange()).ok,true);
 for(const mutate of [x=>x.reviews=[],x=>x.permissions={},x=>x.reviews[0].user.login='author',x=>x.reviews[0].user.type='Bot',x=>x.reviews[0].commit_id='c'.repeat(40),x=>x.pr.body+=' changed',x=>x.reviews[0].state='DISMISSED',x=>x.reviews.push({...x.reviews[0],state:'CHANGES_REQUESTED'})]) {
  const x=noChange();mutate(x);assert.throws(()=>gate.evaluate(x));
 }
});
test('metadata pagination, renamed paths and a concurrent head change are checked without executing branch code',async()=>{
 const x=input(),calls=[],pr={...x.pr};
 const fetchImpl=async url=>{
  calls.push(url);let value;
  if(url.includes('/files?'))value=x.files;
  else if(url.includes('/reviews?'))value=[];
  else value={...pr,head:{sha:calls.length>3?'c'.repeat(40):sha}};
  return{ok:true,json:async()=>value};
 };
 await assert.rejects(gate.run({token:'synthetic',repository:repo,number:1,fetchImpl}),/PR changed/);
 assert.equal(calls.length,4);
 assert.ok(calls.every(v=>v.startsWith('https://api.github.com/repos/'+repo+'/')));
});

test('production ingestion scripts are governed evidence paths',()=>{
 for(const filename of ['scripts/fill-db.js','scripts/new-ingestion-owner.js']) {
  const x=input();x.files=[{filename}];x.pr.body='';assert.throws(()=>gate.evaluate(x));
 }
});

test('head-check publisher completes a failed policy as failure and never includes PR prose',async()=>{
 const x=input();x.pr.body='PRIVATE-UNTRUSTED-PROSE';const writes=[];
 const fetchImpl=async(url,opts)=>{
  let data;
  if(opts.method==='POST'){writes.push(JSON.parse(opts.body));data={id:23};}
  else if(opts.method==='PATCH'){writes.push(JSON.parse(opts.body));data={id:23};}
  else if(url.includes('/files?'))data=x.files;
  else if(url.includes('/reviews?'))data=[];
  else data=x.pr;
  return{ok:true,json:async()=>data};
 };
 await assert.rejects(gate.publish({token:'synthetic',repository:repo,number:1,fetchImpl}));
 assert.equal(writes[0].head_sha,sha);assert.equal(writes[0].status,'in_progress');
 assert.equal(writes.at(-1).conclusion,'failure');assert.ok(!JSON.stringify(writes).includes('PRIVATE-UNTRUSTED-PROSE'));
});
test('review-event refresh rechecks current server inventory even without a relay PR number',async()=>{
 const x=input();let posts=0,patches=0;
 const fetchImpl=async(url,opts)=>{
  let data;
  if(url.includes('/pulls?'))data=[{number:7}];
  else if(opts.method==='POST'){posts++;data={id:1};}
  else if(opts.method==='PATCH'){patches++;assert.equal(JSON.parse(opts.body).conclusion,'success');data={id:1};}
  else if(url.includes('/files?'))data=x.files;
  else if(url.includes('/reviews?'))data=[];
  else {assert.match(url,/\/pulls\/7$/);data=x.pr;}
  return{ok:true,json:async()=>data};
 };
 await gate.refreshReviews({token:'synthetic',repository:repo,fetchImpl});
 assert.equal(posts,1);assert.equal(patches,1);
});

test('review refresh rejects malformed or duplicated PR inventory rather than leaving checks untouched and claiming success',async()=>{
 for(const rows of [[{}],[{number:'7'}],[{number:0}],[{number:7},{number:7}]]) {
  let calls=0;
  await assert.rejects(gate.refreshReviews({token:'synthetic',repository:repo,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>rows};}}),/inventory/);
  assert.equal(calls,1);
 }
});
