const test=require('node:test'),assert=require('node:assert/strict');
const trace=require('../answerTrace');
test('trace schema rejects arbitrary text, customer identifiers and URL payloads at every entry',async()=>{
 trace.registerPublishedSources(['https://help.omi.me/en/articles/12345678-safe-page','https://docs.omi.me/get_started/Introduction']);
 const lines=[],privateText='PRIVATE-CUSTOMER-MODEL-TEXT',id='900000000000000001';
 await trace.run(async()=>{
  trace.route(privateText);trace.stage(privateText,'ok');trace.stage('review',privateText);
  trace.filter(privateText,'a','b');trace.filter('draft_safety',privateText,'safe');
  trace.sources(['https://help.omi.me/en/articles/12345678-safe-page',
   'https://docs.omi.me/get_started/Introduction',
   `https://docs.omi.me/page?key=${privateText}`,'https://help.omi.me/en/articles/12345678#secret',
   'https://docs.omi.me/user%40example.com','https://docs.omi.me@evil.test/page','https://omi.me/customer/'+id]);
  trace.review({grounded:true,relevant:false,final_answer:privateText,sources_used:['S1',id,privateText,'S2\nsecret']});
  trace.escalation(['data_loss',privateText,id]);trace.delivery('reply',privateText);
  trace.delivery('reply','attempted');throw Error(privateText);
 },{log:line=>lines.push(line)}).catch(()=>{});
 assert.equal(lines.length,1);const text=lines[0];
 assert.ok(!text.includes(privateText));assert.ok(!text.includes(id));
 assert.ok(!text.includes('secret'));assert.ok(!text.includes('example'));
 const row=JSON.parse(text.slice(trace.PREFIX.length));
 assert.equal(row.lane,'unknown');assert.deepEqual(row.filters,['draft_safety']);
 assert.deepEqual(row.escalationSignals,['data_loss']);assert.deepEqual(row.reviews[0].sourceIds,['S1']);
 assert.equal(row.retrievedSources.length,2);assert.equal(row.sourcesOmitted,true);
 assert.equal(row.delivery.reply,'uncertain');
});
test('trace isolates concurrent attempts, bounds metadata and logger failure never changes the result',async()=>{
 const lines=[];
 trace.registerPublishedSources(Array.from({length:100},(_,i)=>`https://docs.omi.me/page${i}`));
 await Promise.all([trace.run(async()=>{await new Promise(resolve=>setImmediate(resolve));trace.route('faq');trace.sources(Array.from({length:100},(_,i)=>`https://docs.omi.me/page${i}`));return trace.run(async()=>trace.stage('answer','ok'));},{log:v=>lines.push(v)}),
  trace.run(async()=>{trace.route('tech');trace.delivery('reply','confirmed');},{log:v=>lines.push(v)})]);
 assert.equal(lines.length,2);const rows=lines.map(v=>JSON.parse(v.slice(trace.PREFIX.length)));
 assert.notEqual(rows[0].requestId,rows[1].requestId);
 assert.equal(rows.find(v=>v.lane==='faq').retrievedSources.length,24);
 assert.equal(rows.find(v=>v.lane==='tech').retrievedSources.length,0);
 assert.equal(await trace.run(async()=>42,{log:()=>{throw Error('logger down');}}),42);
});
test('trace URL trust is derived from allowed publisher routes, never labels or model text',()=>{
 trace.registerPublishedSources(['https://github.com/BasedHardware/omi/blob/main/app/lib/main.dart','https://github.com/BasedHardware/omi/releases/tag/v2.0.1']);
 assert.equal(trace.publicSource('https://github.com/BasedHardware/omi/blob/main/app/lib/main.dart').tier,'repository');
 assert.equal(trace.publicSource('https://github.com/BasedHardware/omi/releases/tag/v2.0.1').tier,'release_note');
 for(const u of ['http://docs.omi.me/test','https://docs.omi.me:8443/test','https://docs.omi.me.evil.test/test','https://github.com/Other/omi/blob/main/test','https://github.com/BasedHardware/omi/issues/1']) assert.equal(trace.publicSource(u),null);
});

test('confirmed staff receipt survives later bookkeeping failure and selected second look keeps its identity',async()=>{
 const lines=[];
 await trace.run(async()=>{
  const first={grounded:false,relevant:true,sources_used:['S1']};
  const second={grounded:true,relevant:true,sources_used:['S2']};
  trace.review(first);trace.review(second,{secondLook:true});trace.review(second,{selected:true});
  trace.delivery('staff','confirmed');trace.delivery('staff','failed');
 },{log:v=>lines.push(v)});
 const row=JSON.parse(lines[0].slice(trace.PREFIX.length));
 assert.equal(row.selectedReview.secondLook,true);assert.equal(row.delivery.staff,'confirmed');
 assert.deepEqual(row.selectedReview.sourceIds,['S2']);
});

test('unregistered URL paths are never promoted by a source callback or model citation',async()=>{
 const rows=[];
 await trace.run(async()=>trace.sources(['https://docs.omi.me/customer/900000000000000001/PRIVATE-CUSTOMER-TEXT']),{log:v=>rows.push(v)});
 assert.ok(!rows[0].includes('900000000000000001'));assert.ok(!rows[0].includes('PRIVATE-CUSTOMER-TEXT'));
 assert.equal(JSON.parse(rows[0].slice(trace.PREFIX.length)).sourcesOmitted,true);
});
test('real compact retry records both physical attempts without answer text or exceptions',async()=>{
 const {reviewAnswer}=require('../commandcode');const rows=[];let calls=0;
 await trace.run(async()=>reviewAnswer({question:'Where is status?',draft:'Open Status.',lane:'faq',sources:'',
  post:async()=>({data:{choices:[{message:{content:++calls===1?'':JSON.stringify({final_answer:'Open Status.',grounded:true,relevant:true})}}]}})}),{log:v=>rows.push(v)});
 const row=JSON.parse(rows[0].slice(trace.PREFIX.length));
 assert.equal(calls,2);assert.deepEqual(row.providerAttempts,[{stage:'review',result:'empty'},{stage:'review',result:'ok'}]);
 assert.ok(!rows[0].includes('Open Status'));
});
