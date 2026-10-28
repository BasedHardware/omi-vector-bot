const test = require('node:test');
const assert = require('node:assert/strict');
const { loadHelpCenter } = require('../helpcenter');
const { chunkDocument, formatEvidence, rankLocalChunks, mergeRanked } = require('../retrieval');
const { storedDocs, relevantDocs } = require('../docs');

const url = 'https://help.omi.me/en/articles/synthetic-capture-settings';
const publishedAt = '2025-01-02T03:04:05.000Z';
const updatedAt = '2026-02-03T04:05:06.000Z';
const provenance = { publishedAt, updatedAt, dateOrigin: 'article-jsonld',
  applicability: { product: 'synthetic-recorder', surface: 'mobile', version: '2' } };

async function ingest(html) {
  const pages = [];
  await loadHelpCenter(async address => ({ ok: true, text: async () => address.endsWith('sitemap.xml')
    ? `<urlset><url><loc>${url}</loc><lastmod>2026-09-01</lastmod></url></urlset>` : html }),
  { saveDocPage: async page => pages.push(page) });
  return pages[0];
}

test('official article dates survive ingestion without substituting crawl or sitemap time', async () => {
  const page = await ingest(`<title>Capture settings</title><script type="application/ld+json">${JSON.stringify({
    '@type': 'Article', url, datePublished: publishedAt, dateModified: updatedAt,
  })}</script><article><h1>Capture settings</h1><p>Capture settings can be changed in the app.</p></article>`);
  assert.deepEqual(page.provenance, { publishedAt, updatedAt, dateOrigin: 'article-jsonld' });
  const undated = await ingest('<article><h1>Capture settings</h1><p>Capture settings can be changed.</p></article>');
  assert.deepEqual(undated.provenance, {}, 'missing official dates stay unknown despite a recent sitemap/fetch');
});

test('unrelated or conflicting structured article dates do not manufacture freshness', async () => {
  const article = value => `<script type="application/ld+json">${JSON.stringify({ '@type':'Article',url,...value })}</script>`;
  for (const metadata of [
    { url:'https://help.omi.me/en/articles/synthetic-other',dateModified:updatedAt },
    { dateModified:'yesterday' }, { dateModified:'2026-02-31T00:00:00Z' },
    { datePublished:updatedAt,dateModified:publishedAt },
    { dateModified:'2999-01-01T00:00:00Z' },
  ]) {
    const page = await ingest(article(metadata) + '<article>Capture settings.</article>');
    assert.deepEqual(page.provenance, {});
  }
  const ambiguous = await ingest(article({ dateModified:updatedAt }) + article({ dateModified:publishedAt }) + '<article>Capture settings.</article>');
  assert.deepEqual(ambiguous.provenance, {}, 'contradictory page metadata is not silently picked');
});

test('chunks and formatted evidence preserve bounded provenance and explicit applicability', () => {
  const chunks = chunkDocument({ url, title:'Capture settings',body:'Capture settings use the mobile app.',provenance });
  assert.deepEqual(chunks[0].provenance, provenance);
  const evidence = formatEvidence(chunks);
  assert.match(evidence, /Published: 2025-01-02T03:04:05\.000Z/);
  assert.match(evidence, /Updated: 2026-02-03T04:05:06\.000Z/);
  assert.match(evidence, /product=synthetic-recorder; surface=mobile; version=2/);
  assert.ok(evidence.length <= 9000);
});

test('stored selection keeps date and scope metadata through the real evidence formatter', async () => {
  const evidence = await storedDocs('How do I change capture settings?', {
    searchDocPages: async (_query,_limit,sources=[]) => sources.includes('github') ? [] : [{
      url,title:'Capture settings',source:'help',body:'Capture settings use the mobile app.',chunk_index:0,rank:1,provenance,
    }],
  });
  assert.match(evidence, /Updated: 2026-02-03T04:05:06\.000Z/);
  assert.match(evidence, /surface=mobile/);
});

function competingRows() {
  const base = {title:'Capture pause',section:'Capture pause',source:'help',rank:1,chunk_index:0,
    provenance:{...provenance,applicability:{...provenance.applicability}}};
  return [
    {...base,url:'https://help.omi.me/en/articles/synthetic-older-pause',body:'Capture pause is unavailable.',
      provenance:{...base.provenance,updatedAt:'2025-02-03T04:05:06.000Z'}},
    {...base,url:'https://help.omi.me/en/articles/synthetic-newer-pause',body:'Capture pause is available in the application.'},
  ];
}

test('equally authoritative same-topic and explicit-scope evidence prefers the newer document without deleting either', () => {
  const rows=competingRows();
  const local=rankLocalChunks(['Capture pause'],rows,8,{customerQuestion:'Explain capture pause.'});
  const stored=mergeRanked([rows],8,{customerQuestion:'Explain capture pause.'});
  for(const selected of [local,stored]) {
    assert.equal(selected[0].url,rows[1].url);
    assert.equal(selected.length,2);
    assert.equal(selected[0].sourcePreference,'newer_same_topic_and_explicit_scope');
  }
});

test('date preference cannot override source authority, different topics, versions or surfaces', () => {
  const variants = [
    {source:'website',url:'https://www.omi.me/pages/synthetic-pause'},
    {section:'Capture upload'},
    {provenance:{...provenance,applicability:{...provenance.applicability,version:'3'}}},
    {provenance:{...provenance,applicability:{...provenance.applicability,surface:'desktop'}}},
  ];
  for(const variant of variants) {
    const [old,fresh]=competingRows();
    const selected=mergeRanked([[old,{...fresh,...variant}]],8);
    assert.equal(selected[0].url,old.url);
    assert.ok(selected.every(row=>!row.sourcePreference));
  }
});

test('generic shared headings cannot merge unrelated article topics or displace relevant evidence at the full cap', () => {
  const [old,fresh]=competingRows();
  const relevant=Array.from({length:8},(_,index)=>({...old,title:`Offline capture guide ${index}`,section:'Overview',
    url:`https://help.omi.me/en/articles/synthetic-offline-${index}`,rank:1-index/20,
    body:'Offline capture keeps pending clips until upload completes.'}));
  const unrelated={...fresh,title:'Appearance settings',section:'Overview',rank:0.001,
    body:'Set a light or dark theme for the toolbar.'};
  const select=[
    (rows,limit)=>mergeRanked([rows],limit,{customerQuestion:'Offline capture'}),
    (rows,limit)=>rankLocalChunks(['Offline capture'],rows,limit,{customerQuestion:'Offline capture'}),
  ];
  for(const choose of select) {
    assert.equal(choose([relevant[0],unrelated],1)[0].url,relevant[0].url);
    const without=choose(relevant,8).map(row=>row.url);
    assert.deepEqual(choose([...relevant,unrelated],8).map(row=>row.url),without);
  }
});

test('a newer same-title document cannot override a stronger match or broader query corroboration', () => {
  const [old,fresh]=competingRows();
  old.rank=10;fresh.rank=0.1;
  assert.equal(mergeRanked([[old,fresh]],1)[0].url,old.url);
  old.rank=1;fresh.rank=1;
  assert.equal(mergeRanked([[old,fresh],[old]],1)[0].url,old.url);
  old.body='Capture pause supports offline duration limits.';
  assert.equal(rankLocalChunks(['Capture pause offline duration'],[old,fresh],1)[0].url,old.url);
});

test('unknown, equal, unreliable and incomparable dates or applicability do not manufacture precedence', () => {
  const variants=[
    {},{...provenance,updatedAt:'2025-02-03T04:05:06.000Z'},
    {...provenance,updatedAt:'yesterday'},
    {...provenance,dateOrigin:'crawl-time'},
    {publishedAt:updatedAt,dateOrigin:'article-jsonld',applicability:provenance.applicability},
    {...provenance,applicability:{surface:'mobile'}},
  ];
  for(const candidate of variants) {
    const [old,fresh]=competingRows();
    const selected=mergeRanked([[old,{...fresh,provenance:candidate}]],8);
    assert.equal(selected[0].url,old.url);
    assert.ok(selected.every(row=>!row.sourcePreference));
  }
});

test('punctuation in explicit version and product identifiers never merges different applicability scopes', () => {
  for (const [field,older,newer] of [['version','2.1','2-1'],['product','recorder-a','recorder a']]) {
    const [old,fresh]=competingRows();
    old.provenance={...old.provenance,applicability:{...old.provenance.applicability,[field]:older}};
    fresh.provenance={...fresh.provenance,applicability:{...fresh.provenance.applicability,[field]:newer}};
    assert.equal(mergeRanked([[old,fresh]],8)[0].url,old.url);
  }
});

test('publisher-declared software scope survives ingestion; article language and layout never become product scope', async () => {
  const page=await ingest(`<script type="application/ld+json">${JSON.stringify({
    '@type':'Article',url,dateModified:updatedAt,inLanguage:'en',
    about:{'@type':'SoftwareApplication',name:'Synthetic Recorder',operatingSystem:'Android',softwareVersion:'2.1'},
  })}</script><article>Capture settings.</article>`);
  assert.deepEqual(page.provenance.applicability,{product:'Synthetic Recorder',surface:'Android',version:'2.1'});
  const unspecified=await ingest(`<meta name="viewport" content="mobile"><script type="application/ld+json">${JSON.stringify({
    '@type':'Article',url,dateModified:updatedAt,inLanguage:'en',
  })}</script><article>Capture settings for version 2.</article>`);
  assert.equal(unspecified.provenance.applicability,undefined);
  assert.match(formatEvidence(chunkDocument(unspecified)),/applicability incomplete/);
});

test('newer complementary instructions and older safety details both survive unchanged evidence limits', async () => {
  const [old,fresh]=competingRows();
  old.body='Capture pause has an indicator; keep local captures until upload is confirmed.';
  fresh.body='Capture pause is available from the toolbar.';
  const rows=[old,fresh];
  const evidence=await storedDocs('Explain capture pause.',{searchDocPages:async(_q,_n,sources=[])=>sources.includes('github')?[]:rows});
  for(const row of rows) {assert.ok(evidence.includes(row.url));assert.ok(evidence.includes(row.body));}
  assert.ok(evidence.indexOf(fresh.url)<evidence.indexOf(old.url));
  assert.ok(evidence.length<=9000);
  assert.ok((evidence.match(/^\[S\d+ \|/gm)||[]).length<=8);
});

test('answer and both reviewer modes receive one shared conflict/applicability policy without an extra provider request', async t => {
  const {queryAgent,reviewAnswer}=require('../commandcode');
  const {SOURCE_DATE_POLICY}=require('../sourceProvenance');
  const previous=process.env.CMD_API_KEY;
  process.env.CMD_API_KEY='synthetic-source-policy-key';
  t.after(()=>{if(previous===undefined)delete process.env.CMD_API_KEY;else process.env.CMD_API_KEY=previous;});
  let calls=0,reviewAttempts=0;
  const post=async(_url,body)=>{
    calls++;
    const system=body.messages.filter(row=>row.role==='system').map(row=>row.content).join('\n');
    assert.equal(system.split(SOURCE_DATE_POLICY).length-1,1);
    if (system.includes('final relevance and grounding gate') && ++reviewAttempts===1)
      throw Object.assign(new Error('synthetic retryable review timeout'),{code:'ECONNABORTED'});
    return {data:{choices:[{message:{content:JSON.stringify({final_answer:'Capture pause depends on the documented application version.',
      grounded:true,relevant:true,confidence:0.8,escalate:false,sources_used:['S1']})}}]}};
  };
  await queryAgent({question:'Explain capture pause.',route:{lane:'faq'},post});
  await reviewAnswer({question:'Explain capture pause.',draft:'Capture pause depends on the documented version.',
    lane:'faq',sources:formatEvidence(competingRows()),post});
  assert.equal(calls,3);
  assert.equal(reviewAttempts,2,'existing timeout retry exercises the compact reviewer path');
});

test('two- and three-part live retrieval keeps the six parallel fetches and unchanged per-page timeout', async t => {
  const budgets=[];
  t.mock.method(AbortSignal,'timeout',ms=>{budgets.push(ms);return new AbortController().signal;});
  const pages=['Capturealpha','Capturebeta','Capturegamma'].flatMap(term=>Array.from({length:3},(_,i)=>({
    title:`${term} guide ${i}`,url:`https://docs.omi.me/synthetic-${term.toLowerCase()}-${i}.md`,
  })));
  for (const count of [2,3]) {
    const started=[]; let release;
    const waiting=new Promise(resolve=>{release=resolve;});
    const pending=relevantDocs('Capturealpha Capturebeta Capturegamma procedures',{
      queries:['Capturebeta','Capturegamma'],
      subQuestions:pages.filter((_,i)=>i%3===0).slice(0,count).map(page=>({question:page.title,query:page.title})),
      fetchImpl:async(address,options)=>{
        assert.ok(options.signal);
        if(String(address).endsWith('/llms.txt'))return{ok:true,text:async()=>pages.map(page=>`- [${page.title}](${page.url}): Capture procedures`).join('\n')};
        started.push(address); await waiting;
        return{ok:true,text:async()=> '# Capture procedure\nUse the documented controls.'};
      },
    });
    await new Promise(resolve=>setImmediate(resolve));
    try {assert.equal(started.length,6,'all six requests start before any page completes');}
    finally {release();}
    const evidence=await pending;
    assert.ok(evidence.length<=9000);
    assert.ok((evidence.match(/^\[S\d+ \|/gm)||[]).length<=8);
  }
  assert.ok(budgets.length>=12);
  assert.ok(budgets.every(ms=>ms===10000));
});
