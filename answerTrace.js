// Production metadata only. Never persist text, platform IDs, error messages or hashes of text.
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const {TRACE_DEVICES,TRACE_SCOPES}=require('./deviceApplicability');
const context = new AsyncLocalStorage();
const PREFIX = '[AnswerTrace] ';
const LANES = new Set(['faq','tech','firmware','shop','money','privacy','account','unknown']);
const STAGES = new Set(['planner','retrieval','answer','review','presentation','delivery']);
const RESULTS = new Set(['started','ok','failed','skipped','uncertain']);
const FILTERS = new Set(['financial_outcome','draft_safety','review_safety','staff_narration','presentation_privacy','support_redirect','final_privacy','reply_clipping']);
const SIGNALS = new Set(['model_review','want_human','route','triage','data_loss','answer_person','public_copy','low_confidence','caption','empty_after_private_intake','empty_after_redirect','current_contact_redirect']);
// Explicit grammar for public publisher routes. Strip titles/slugs where possible;
// reject credentials, queries, fragments, escaped data and arbitrary website URLs.
function canonicalPublisherUrl(value) {
  if (typeof value !== 'string' || value.length > 512 || /[%\s@?#\\]/.test(value)) return null;
  let u; try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase(), path = u.pathname;
  let m;
  if (host === 'help.omi.me' && (m = path.match(/^\/[a-z]{2}(?:-[a-z]{2})?\/articles\/(\d{1,12})(?:-[a-z0-9-]+)?\/?$/i)))
    return { url: `https://help.omi.me/en/articles/${m[1]}`, tier: 'help_center' };
  if (host === 'docs.omi.me' && /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\/?$/.test(path))
    return { url: 'https://docs.omi.me'+path, tier: 'documentation' };
  if (host === 'github.com' && /^\/BasedHardware\/omi\/blob\/[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(path))
    return { url: 'https://github.com'+path, tier: 'repository' };
  if (host === 'github.com' && /^\/BasedHardware\/omi\/releases\/tag\/[a-zA-Z0-9_.-]+$/.test(path))
    return { url: 'https://github.com'+path, tier: 'release_note' };
  return null;
}
// Only ingestion owners may register URLs returned by public publisher catalogs.
// A fetched answer, user link, model citation or stored row alone cannot enroll one.
const publishedSources=new Map();
function registerPublishedSources(urls) {
  for(const value of Array.isArray(urls)?urls:[]) {
    const row=canonicalPublisherUrl(value);
    if(row && (publishedSources.size<10000 || publishedSources.has(value))) publishedSources.set(value,row);
  }
}
function publicSource(value) { return publishedSources.get(value)||null; }
function attempt(name) {
  const s=context.getStore();
  if(!s || !['planner','answer','review'].includes(name)) return ()=>{};
  if(s.attempts.length>=12) { s.attemptsOmitted=true; return ()=>{}; }
  const row={stage:name,result:'started'};s.attempts.push(row);
  return result=>{ if(['ok','empty','failed'].includes(result)) row.result=result; };
}
function stage(name, result) {
  const s=context.getStore(); if(s && STAGES.has(name) && RESULTS.has(result)) s.stages[name]=result;
}
function filter(name, before, after) {
  const s=context.getStore(); if(s && FILTERS.has(name) && typeof before==='string' && typeof after==='string' && before!==after) s.filters.add(name);
}
function sources(urls) {
  const s=context.getStore(); if(!s) return;
  for(const value of (Array.isArray(urls)?urls:[]).slice(0,64)) {
    const row=publicSource(value);
    if(!row) { s.sourcesOmitted=true; continue; }
    if(s.sources.size<24 || s.sources.has(row.url)) s.sources.set(row.url,row);
    else s.sourcesOmitted=true;
  }
}
function review(result, { secondLook=false, selected=false }={}) {
  const s=context.getStore(); if(!s) return;
  const ids=(Array.isArray(result?.sources_used)?result.sources_used:[])
    .filter(v=>typeof v==='string' && /^S(?:[1-9]\d?|99)$/.test(v)).slice(0,8);
  const row={grounded:result?.grounded===true, relevant:result?.relevant===true,
    secondLook:secondLook===true, sourceIds:[...new Set(ids)]};
  if(selected) s.selectedReview=s.reviewOrigins.get(result)||row;
  else if(s.reviews.length<2) {
    s.reviews.push(row);
    if(result && typeof result==='object') s.reviewOrigins.set(result,row);
  }
}
function devices(value) {const s=context.getStore();if(s){s.detectedDevice=TRACE_DEVICES.has(value?.detectedDevice)?value.detectedDevice:'unknown';s.evidenceDeviceScope=TRACE_SCOPES.has(value?.evidenceDeviceScope)?value.evidenceDeviceScope:'unknown';}}
function route(lane) { const s=context.getStore(); if(s) s.lane=LANES.has(lane)?lane:'unknown'; }
function escalation(signals) {
  const s=context.getStore(); if(!s) return;
  // Only application policy codes, never model reasons or arbitrary strings.
  for(const code of Array.isArray(signals)?signals:[]) if(SIGNALS.has(code)) s.signals.add(code);
}
function delivery(kind, result) {
  const s=context.getStore(); if(!s) return;
  if(kind==='reply' && ['attempted','confirmed','failed','uncertain'].includes(result)) {
    s.reply=result;stage('delivery',result==='attempted'?'started':result==='confirmed'?'ok':result);
  }
  if(kind==='staff' && ['confirmed','previously_delivered','failed'].includes(result) && s.staff!=='confirmed') s.staff=result;
}
async function run(operation, { log=line=>console.log(line) }={}) {
  if(context.getStore()) return operation();
  const s={detectedDevice:'unknown',evidenceDeviceScope:'unknown',requestId:randomUUID(),lane:'unknown',stages:Object.fromEntries([...STAGES].map(name=>[name,'skipped'])),sources:new Map(),sourcesOmitted:false,
    attempts:[],attemptsOmitted:false,reviews:[],reviewOrigins:new WeakMap(),selectedReview:null,filters:new Set(),signals:new Set(),reply:'not_attempted',staff:'not_requested'};
  return context.run(s,async()=>{
    try { return await operation(); }
    finally {
      if(s.reply==='attempted') {s.reply='uncertain';s.stages.delivery='uncertain';}
      for(const row of s.attempts) if(row.result==='started') row.result='failed';
      for(const [name,result] of Object.entries(s.stages)) if(result==='started') s.stages[name]='failed';
      if(s.reply==='attempted') s.reply='uncertain';
      const row={version:1,detectedDevice:s.detectedDevice,evidenceDeviceScope:s.evidenceDeviceScope,requestId:s.requestId,lane:s.lane,stages:s.stages,
        retrievedSources:[...s.sources.values()],sourcesOmitted:s.sourcesOmitted,
        providerAttempts:s.attempts,attemptsOmitted:s.attemptsOmitted,reviews:s.reviews,selectedReview:s.selectedReview,filters:[...s.filters],
        escalationSignals:[...s.signals],delivery:{reply:s.reply,staff:s.staff}};
      try { log(PREFIX+JSON.stringify(row)); } catch { /* Observability cannot change delivery or retry. */ }
    }
  });
}
module.exports={devices,run,stage,filter,sources,review,route,escalation,delivery,publicSource,registerPublishedSources,attempt,PREFIX};
