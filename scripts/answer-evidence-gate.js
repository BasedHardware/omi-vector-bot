// Run from the trusted base only; inspect PR metadata, never execute PR code.
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const PATHS = new Set(['prompt.js','supportVoice.js','commandcode.js','retrieval.js','docs.js',
  'reviewDecision.js','reviewRequirement.js','escalationPolicy.js','honesty.js','privacy.js',
  'publicReplyPrivacy.js','answerPipeline.js','answerFilterAudit.js','sourceProvenance.js',
  'sourcecode.js','utils.js','router.js','plannerPolicy.js','triage.js','index.js','promptContext.js']);
function affectsAnswers(file) {
  return (typeof file==='string' && /^[^/]+\.(?:js|json|sql)$/.test(file)) || PATHS.has(file) || /^(?:prompts|filters|scripts|\.github\/workflows)\//.test(file) ||
    file === 'scripts/customer-eval.js' || file === 'scripts/support-adversarial.js' ||
    file === 'scripts/answer-evidence-gate.js' || file === '.github/workflows/answer-evidence.yml';
}
function evidenceBlock(body) {
  // Exactly one heading, no accepting a conveniently duplicated block.
  const matches=[...String(body||'').matchAll(/^## Answer-change evidence\r?$/gm)];
  if(matches.length!==1) throw Error('Exactly one Answer-change evidence section is required');
  return String(body).slice(matches[0].index+matches[0][0].length).split(/^## /m)[0].trim().replace(/\r\n/g,'\n');
}
function parseFields(block) {
  const fields={};
  for(const line of block.split('\n')) {
    if(!line.trim()) continue;
    const m=line.match(/^(Mode|Head|Evidence|Justification):\s*(\S.*)$/);
    if(!m || fields[m[1]]) throw Error('Evidence section must contain unique plain fields only');
    fields[m[1]]=m[2].trim();
  }
  return fields;
}
function evaluate({pr,files,reviews=[],permissions={}}) {
  const changed=files.some(row=>affectsAnswers(row.filename)||affectsAnswers(row.previous_filename));
  if(!changed) return {ok:true,reason:'No governed answer paths changed'};
  const block=evidenceBlock(pr.body), f=parseFields(block);
  if(!/^[a-f0-9]{40}$/.test(f.Head||'') || f.Head!==pr.head?.sha) throw Error('Evidence Head must be the current PR head SHA');
  if(f.Mode==='comparison') {
    // Require an internal, non-executable record location. This verifies a link,
    // NOT scientific adequacy, grade correctness or a fresh paid comparison.
    const repo=pr.base?.repo?.full_name;
    if(typeof repo!=='string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw Error('Invalid base repository');
    let u; try{u=new URL(f.Evidence);}catch{throw Error('A comparison evidence URL is required');}
    const prefix='/'+repo+'/';
    if(u.protocol!=='https:' || u.hostname!=='github.com' || u.username || u.password || u.port || u.search ||
      !u.pathname.startsWith(prefix) || !/^(?:actions\/runs\/\d+|issues\/\d+|pull\/\d+)$/.test(u.pathname.slice(prefix.length)))
      throw Error('Comparison Evidence must link this repository Actions run or issue/PR record');
    return {ok:true,reason:'Current-head comparison evidence link supplied; accuracy review remains mandatory'};
  }
  if(f.Mode!=='no-answer-change') throw Error('Choose comparison or no-answer-change; pending is blocking');
  if(!f.Justification || f.Justification.length<40 || f.Justification.length>2000) throw Error('A concrete no-answer-change justification is required');
  const digest=createHash('sha256').update(block).digest('hex');
  const marker='Mira evidence approval: '+digest;
  const latest=new Map();
  // API order is chronological; include dismissals/changes requested so an old
  // approval cannot outlive a later reviewer decision.
  for(const review of reviews) {
    const login=review.user?.login;
    if(!login || review.state==='PENDING') continue;
    latest.set(login,review);
  }
  const approved=[...latest].some(([login,review])=>login!==pr.user?.login &&
    review.user?.type==='User' && permissions[login]===true && review.state==='APPROVED' &&
    review.commit_id===pr.head.sha && String(review.body||'').split(/\r?\n/).some(line=>line===marker));
  if(!approved) throw Error('Current-head no-answer-change justification needs a non-author maintainer approval matching its digest');
  return {ok:true,reason:'Exact-head no-answer-change justification approved',digest};
}
async function run({token,repository,number,fetchImpl=fetch}) {
  if(!token || !/^[\w.-]+\/[\w.-]+$/.test(repository||'') || !Number.isSafeInteger(number) || number<1) throw Error('Missing trusted gate inputs');
  const base='https://api.github.com/repos/'+repository;
  const get=async path=>{
    const response=await fetchImpl(base+path,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('GitHub metadata read failed');
    return response.json();
  };
  const pages=async path=>{
    const rows=[];
    for(let page=1;page<=100;page++) {
      const batch=await get(path+'?per_page=100&page='+page);
      if(!Array.isArray(batch)) throw Error('Invalid GitHub list');
      rows.push(...batch);if(batch.length<100)return rows;
    }
    throw Error('GitHub pagination limit exceeded');
  };
  const pr=await get('/pulls/'+number);
  if(pr.base?.repo?.full_name!==repository || pr.base.ref!=='main') throw Error('Unexpected PR target');
  const files=await pages('/pulls/'+number+'/files');
  if(files.length!==pr.changed_files) throw Error('Incomplete changed-file inventory');
  const reviews=await pages('/pulls/'+number+'/reviews');
  const permissions={};
  for(const login of [...new Set(reviews.filter(r=>r.state==='APPROVED'&&r.user?.type==='User'&&r.user.login!==pr.user.login).map(r=>r.user.login))]) {
    if(!/^[a-zA-Z0-9-]{1,39}$/.test(login)) continue;
    const permission=await get('/collaborators/'+login+'/permission');
    permissions[login]=['write','maintain','admin'].includes(permission.permission);
  }
  const result=evaluate({pr,files,reviews,permissions});
  // Detect mutations during pagination/permission reads; do not publish a green
  // result for a stale body, target, diff, or head.
  const fresh=await get('/pulls/'+number);
  if(fresh.head.sha!==pr.head.sha || fresh.base.sha!==pr.base.sha || fresh.body!==pr.body || fresh.changed_files!==pr.changed_files)
    throw Error('PR changed during gate; rerun on current metadata');
  return result;
}
async function publish({token,repository,number,fetchImpl=fetch}) {
  const url='https://api.github.com/repos/'+repository;
  const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'};
  const request=async(path,method='GET',body)=>{
    const response=await fetchImpl(url+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('Policy check API unavailable');
    return response.json();
  };
  if(!token||!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!Number.isSafeInteger(number)||number<1) throw Error('Invalid policy inputs');
  const pr=await request('/pulls/'+number);
  if(pr.base?.ref!=='main'||pr.base.repo.full_name!==repository||!/^[a-f0-9]{40}$/.test(pr.head?.sha)) throw Error('Invalid policy target');
  const check=await request('/check-runs','POST',{name:'Mira answer evidence',head_sha:pr.head.sha,status:'in_progress'});
  let result,error;
  try { result=await run({token,repository,number,fetchImpl}); }
  catch(e){error=e;}
  const fresh=await request('/pulls/'+number);
  if(fresh.head.sha!==pr.head.sha||fresh.body!==pr.body||fresh.base.sha!==pr.base.sha) error=Error('PR changed');
  await request('/check-runs/'+check.id,'PATCH',{status:'completed',conclusion:error?'failure':'success',
    output:{title:error?'Answer evidence is missing or unapproved':'Answer evidence policy satisfied',
      summary:error?'Check the current-head evidence block and exact-body reviewer approval, then rerun. No provider requests were made.':result.reason}});
  if(error) throw error;
  return result;
}
async function refreshReviews({token,repository,fetchImpl=fetch}) {
  if(!token||!/^[\w.-]+\/[\w.-]+$/.test(repository||'')) throw Error('Invalid review refresh inputs');
  const numbers=[];
  for(let page=1;page<=10;page++) {
    const response=await fetchImpl('https://api.github.com/repos/'+repository+'/pulls?state=open&base=main&per_page=100&page='+page,
      {headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('Review refresh list unavailable');
    const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid open PR list');
    for(const row of rows) {
      if(!row || !Number.isSafeInteger(row.number)||row.number<1||numbers.includes(row.number))throw Error('Invalid or unstable open PR inventory');
      numbers.push(row.number);
    }
    if(rows.length<100)break;
    if(page===10)throw Error('Review refresh inventory exceeded bound');
  }
  let blocked=false;
  // Review relay payloads may omit their PR association. Recheck all open main
  // PRs from a fresh server list rather than trusting branch-provided numbers.
  for(const number of new Set(numbers)) {
    try {await publish({token,repository,number,fetchImpl});}catch{blocked=true;}
  }
  if(blocked)throw Error('One or more evidence checks blocked');
}
if(require.main===module) {
  const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
  const repository=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN;
  let operation;
  if(process.env.GITHUB_EVENT_NAME==='workflow_run') {
    if(event.workflow_run?.event!=='pull_request_review'||event.repository?.full_name!==repository) throw Error('Unexpected review relay');
    operation=refreshReviews({token,repository});
  } else {
    const number=event.pull_request?.number || Number(event.inputs?.pull_request_number);
    operation=publish({token,repository,number});
  }
  operation.then(()=>console.log('Answer evidence checks refreshed.')).catch(()=>{console.error('Answer evidence gate blocked: inspect the exact-head evidence section and reviewer approval.');process.exitCode=1;});
}
module.exports={affectsAnswers,evidenceBlock,evaluate,run,publish,refreshReviews};
