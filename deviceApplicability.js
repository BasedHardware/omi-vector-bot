// Publisher restrictions are structured data. Customer/model text cannot grant
// source scope. Unknown scope never means universal applicability.
const TRACE_DEVICES=new Set(['unknown','omi_necklace','omi_devkit','limitless_pendant','other','multiple']);
const TRACE_SCOPES=new Set(['unknown','unrestricted','matching','mismatched','unidentified','conflicting']);
const name=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function product(value) {
 return typeof value==='string' && /^[\p{L}\p{N} ._+/-]{2,80}$/u.test(value) ? value.trim() : '';
}
function normalizeDeviceScope(value) {
 if(!value || !['publisher-product','publisher-introduction'].includes(value.origin))return null;
 const products=[...new Set((Array.isArray(value.products)?value.products:[]).map(product).filter(Boolean))].slice(0,8);
 return products.length?{products,origin:value.origin,...(value.conflicting===true?{conflicting:true}:{})}:null;
}
function publisherDeviceScope(title,body) {
 // A title alone, incidental example or comparison cannot establish scope.
 // Recognize explicit publisher restrictions and a corroborated integration
 // introduction. The product names are data, never an allow-list of articles.
 const intro=String(body||'').slice(0,2400).replace(/\s+/g,' ');
 const candidates=[];
 for(const pattern of [
  /\b(?:this (?:guide|article|page) is (?:only )?for|for (?:the )?)([\p{L}\p{N}][\p{L}\p{N} ._+/-]{1,60}?)\s+(?:only[,.:;]|only\b)/giu,
  /\b(?:Omi|this app) lets you use your ([\p{L}\p{N}][\p{L}\p{N} ._+/-]{1,60}?) with (?:the )?(?:Omi|this) app\b/giu,
 ]) for(const m of intro.matchAll(pattern)) {
   const p=product(m[1]);
   if(p && name(title).includes(name(p)))candidates.push(p);
 }
 const products=[...new Set(candidates.map(name))];
 return products.length?normalizeDeviceScope({products,origin:'publisher-introduction'}):null;
}
function scopeFor(row) {
 const explicit=normalizeDeviceScope(row?.provenance?.deviceScope);
 if(explicit)return explicit;
 // Old #90 product tags are restrictive, except explicitly typed software.
 const legacy=product(row?.provenance?.applicability?.product);
 return legacy && row?.provenance?.applicabilityKind!=='software'
  ? {products:[legacy],origin:'publisher-product'} : null;
}
function deviceCode(value) {
 const n=name(value);
 if(/\bomi (?:necklace|pendant|consumer device)\b/.test(n))return 'omi_necklace';
 if(/\bomi (?:dev ?kit|developer kit)\b/.test(n))return 'omi_devkit';
 if(/\blimitless pendant\b/.test(n))return 'limitless_pendant';
 return n?'other':'unknown';
}
function ownedDevice(question,history=[],products=[]) {
 const messages=[...history.filter(row=>row?.customerOwned===true && row.source!=='previous_post').map(row=>row.content),question];
 let known='';
 for(const raw of messages) {
  const text=String(raw||'').replace(/```[\s\S]*?```|`[^`]*`|"[^"\n]*"|“[^”\n]*”/gu,' ')
   .split('\n').filter(line=>!/^\s*>/.test(line)).join(' ');
  // A negated/example/quoted name cannot prove ownership. Reject ambiguous
  // messages rather than filling the identity from the planner or another user.
  if(/\b(?:not|don't|do not|without|example|suppose|someone else|nicht|kein|pas|sin)\b/iu.test(text)){if(products.some(p=>name(text).includes(name(p))))known='';continue;}
  const names=[...products,'Omi necklace','Omi DevKit 2','Omi DevKit','Limitless Pendant'];
  const found=[...new Set(names.filter(p=>{
   const escaped=p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   return new RegExp('(?:\\b(?:my|using|use|have|device is|mon|ma|mein|meine|mi)\\s+(?:an?\\s+|the\\s+)?'+escaped+'(?![\\p{L}\\p{N}])|\\bDevice:\\s*'+escaped+'(?![\\p{L}\\p{N}]))','iu').test(text);
  }).map(name))];
  // Prefer the more specific full name when overlapping aliases were found.
  const specific=found.filter(p=>!found.some(other=>other!==p && other.startsWith(p+' ')));
  if(specific.length===1)known=specific[0];
  else if(specific.length>1)known='multiple';
 }
 return known;
}
const QUESTIONS={en:'Which device are you using?',fr:'Quel appareil utilisez-vous ?',de:'Welches Gerät verwendest du?',es:'¿Qué dispositivo estás usando?',pt:'Qual dispositivo você está usando?',it:'Quale dispositivo stai usando?',tr:'Hangi cihazı kullanıyorsunuz?',id:'Perangkat apa yang Anda gunakan?',zh:'你使用的是哪款设备？',ja:'どのデバイスを使っていますか？',ko:'어떤 기기를 사용하고 계신가요?',ru:'Какое устройство вы используете?',hi:'आप कौन-सा डिवाइस इस्तेमाल कर रहे हैं?','hi-Latn':'Aap kaunsa device istemal kar rahe hain?'};
function applicabilityDecision({question,threadHistory=[],sourceCatalog=[],sourceIds=[],answer='',language='en'}={}) {
 const cited=new Set(sourceIds);
 const urls=new Set((String(answer).match(/https:\/\/[^\s<>]+/g)||[]).map(v=>v.replace(/[).,;]+$/,'')));
 let rows=sourceCatalog.filter(row=>cited.has(row.id)||urls.has(row.url));
 // Missing/invalid citation selection cannot grant applicability to a known
 // restriction. A generic-only citation still remains the grounding owner's job.
 if(!rows.length)rows=sourceCatalog.filter(row=>scopeFor(row));
 const restrictions=rows.map(scopeFor).filter(Boolean);
 const products=[...new Set(restrictions.flatMap(scope=>scope.products))];
 const identity=ownedDevice(question,threadHistory,products), detectedDevice=identity==='multiple'?'multiple':deviceCode(identity);
 const conflict=restrictions.some(scope=>scope.conflicting);
 const mismatched=conflict || products.length>0 && (!identity||identity==='multiple'||restrictions.some(scope=>!scope.products.some(p=>name(p)===identity)));
 const evidenceDeviceScope=!rows.length?'unknown':!restrictions.length?'unrestricted':conflict?'conflicting':!identity?'unidentified':identity==='multiple'?'conflicting':mismatched?'mismatched':'matching';
 return {blocked:mismatched,detectedDevice,evidenceDeviceScope,
  question:QUESTIONS[language]||QUESTIONS[String(language).split('-')[0]]||QUESTIONS.en};
}
module.exports={normalizeDeviceScope,publisherDeviceScope,scopeFor,ownedDevice,applicabilityDecision,TRACE_DEVICES,TRACE_SCOPES};
