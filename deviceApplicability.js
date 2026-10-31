// Publisher restrictions are structured data. Customer/model text cannot grant
// source scope. Unknown scope never means universal applicability.
const TRACE_DEVICES=new Set(['unknown','omi_necklace','omi_devkit','limitless_pendant','other','multiple']);
const TRACE_SCOPES=new Set(['unknown','unrestricted','omi_necklace','omi_devkit','limitless_pendant','other','multiple']);
const name=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();
function product(value) {
 return typeof value==='string' && /^[\p{L}\p{N} ._+/-]{2,80}$/u.test(value) ? value.trim() : '';
}
function normalizeDeviceScope(value) {
 if(!value || !['publisher-product','publisher-introduction'].includes(value.origin))return null;
 const products=[...new Set((Array.isArray(value.products)?value.products:[]).map(product).filter(Boolean))].slice(0,8);
 return products.length?{products,origin:value.origin,...(value.conflicting===true?{conflicting:true}:{})}:null;
}
function isPublisherSource(value) {
 try {const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.port &&
  (['help.omi.me','docs.omi.me','omi.me','www.omi.me'].includes(u.hostname) || u.hostname==='github.com' && /^\/BasedHardware\/omi\/blob\//i.test(u.pathname));}catch{return false;}
}
function publisherDeviceScope(title,body) {
 const candidates=[];
 for(const raw of String(body||'').slice(0,2400).split(/\n+|(?<=[.!?])\s+/u)) {
  const line=raw.replace(/\s+/g,' ').trim();
  if(!line || /^['‘’"“”>`]/u.test(line))continue;
  let m;
  m=line.match(/^(?:Omi|this app) lets you use your ([\p{L}\p{N}][\p{L}\p{N} ._+/-]{1,60}?) with (?:the )?(?:Omi|this) app\b/iu);
  if(m && name(title).includes(name(m[1])))candidates.push(m[1]);
 }
 const products=[...new Set(candidates.map(name))];
 return products.length?normalizeDeviceScope({products,origin:'publisher-introduction'}):null;
}
function scopeFor(row) {
 if(!isPublisherSource(row?.url))return null;
 return normalizeDeviceScope(row?.provenance?.deviceScope);
}
function restrictionFor(row) {
 if(!isPublisherSource(row?.url))return null;
 return scopeFor(row)||publisherDeviceScope(row.title,row.body,row?.provenance?.applicability?.product);
}
function deviceCode(value) {
 const n=name(value);
 if(/\bomi (?:necklace|pendant|consumer device)\b/.test(n))return 'omi_necklace';
 if(/\bomi (?:dev ?kit|developer kit)\b/.test(n))return 'omi_devkit';
 if(/\blimitless pendant\b/.test(n))return 'limitless_pendant';
 return n?'other':'unknown';
}
function ownershipProse(raw) {
 let fence=null,quote=null,code=0,out='';
 for(const line of String(raw||'').split('\n')) {
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
  if(fence){
   if(marker && marker[1][0]===fence.char && marker[1].length>=fence.length && !marker[2].trim())fence=null;
   continue;
  }
  if(!quote && !code && marker){fence={char:marker[1][0],length:marker[1].length};continue;}
  if(/^\s*>|^ {4}|^\t/u.test(line))continue;
  const chars=[...line];
  for(let i=0;i<chars.length;i++) {
   const c=chars[i],word=x=>/[\p{L}\p{N}]/u.test(x||'');
   if(c==='`'&&!quote){
    let end=i+1;while(chars[end]==='`')end++;
    const length=end-i;
    if(!code)code=length;else if(code===length)code=0;
    i=end-1;out+=' ';continue;
   }
   if(code)continue;
   const contraction=(c==="'"||c==='’')&&word(chars[i-1])&&word(chars[i+1]);
   if(quote){if(c===quote&&!contraction){quote=null;out+=' ';}continue;}
   if(!contraction && ['"','“',"'",'‘'].includes(c)){quote=({'“':'”','‘':'’'})[c]||c;out+=' ';continue;}
   out+=c;
  }
  out+='\n';
 }
 return out;
}
function ownedDevice(question,history=[],products=[]) {
 const messages=[...history.filter(row=>row?.customerOwned===true && row.source!=='previous_post').map(row=>row.content),question];
 const names=[...new Set([...products,'Omi necklace','Omi DevKit 2','Omi DevKit','Limitless Pendant'])];
 const escaped=p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 let known='';
 for(const raw of messages) {
  const text=ownershipProse(raw);
  const mentioned=[...new Set(names.filter(p=>new RegExp('(?<![\\p{L}\\p{N}])'+escaped(p)+'(?![\\p{L}\\p{N}])','iu').test(text)).map(name))];
  const specific=mentioned.filter(p=>!mentioned.some(other=>other!==p && other.startsWith(p+' ')));
  if(specific.length>1){known='multiple';continue;}
  if(!specific.length)continue;
  // Only complete current-device assertions establish identity. A prefix plus
  // an arbitrary suffix cannot select the target of this request. In particular
  // future/delivery statements and another unnamed focus stay unestablished.
  known='';
  const target=specific[0],aliases=names.filter(p=>name(p)===target);
  for(const sentence of text.split(/\n+|(?<=[.!?])\s+/u).map(v=>v.trim()).filter(Boolean)) {
   for(const alias of aliases) {
    const p=escaped(alias),end='[.!?]?$',article='(?:an?\\s+|the\\s+)?';
    const direct=new RegExp('^(?:Device:\\s*'+p+'|I\\s+(?:(?:now|currently)\\s+)?(?:use|have|own)\\s+'+article+p+"|I(?: am|['’]m)\\s+(?:(?:now|currently)\\s+)?using\\s+"+article+p+'|(?:my|mon|ma|mein|meine|mi)\\s+'+p+')'+end,'iu');
    const symptom=new RegExp('^My\\s+'+p+"\\s+(?:disconnects?|stops? (?:linking|connecting)|is (?:not )?(?:connecting|working|paired)|keeps? disconnecting|won['’]t (?:connect|pair|charge)|doesn['’]t (?:connect|pair|charge))(?:(?: when| as soon as| after| whenever| while) [^,;.!?]{1,120})?"+end,'iu');
    if(direct.test(sentence)||symptom.test(sentence))known=target;
   }
  }
 }
 return known;
}
const WARNINGS={en:'Do not reinstall, log out or clear local recordings until you receive support guidance; unsynced recordings may still be on your phone.',fr:'Ne réinstallez pas l’application, ne vous déconnectez pas et n’effacez pas les enregistrements locaux avant de recevoir les consignes du support ; des enregistrements non synchronisés peuvent encore se trouver sur votre téléphone.',de:'Installiere die App nicht neu, melde dich nicht ab und lösche keine lokalen Aufnahmen, bis du Hinweise vom Support erhältst; nicht synchronisierte Aufnahmen können noch auf dem Telefon liegen.',es:'No reinstales la aplicación, no cierres sesión ni borres grabaciones locales hasta que recibas indicaciones del soporte; puede haber grabaciones sin sincronizar en tu teléfono.',pt:'Não reinstale o app, não saia da conta nem apague gravações locais até receber orientações do suporte; gravações não sincronizadas podem estar no telefone.',it:'Non reinstallare l’app, non uscire dall’account e non cancellare registrazioni locali fino a quando ricevi indicazioni dall’assistenza; potrebbero esserci registrazioni non sincronizzate sul telefono.',tr:'Destekten yönlendirme alana kadar uygulamayı yeniden yüklemeyin, oturumu kapatmayın veya yerel kayıtları silmeyin; eşitlenmemiş kayıtlar telefonunuzda olabilir.',id:'Sampai Anda menerima panduan dukungan, jangan instal ulang aplikasi, keluar dari akun, atau hapus rekaman lokal; rekaman yang belum tersinkron mungkin masih ada di ponsel.',zh:'在收到支持团队的指导之前，请勿重新安装应用、退出账号或删除本地录音；手机上可能仍有未同步的录音。',ja:'サポートから案内を受けるまでは、アプリの再インストール、ログアウト、ローカル録音の削除をしないでください。未同期の録音がスマートフォンに残っている可能性があります。',ko:'지원 안내를 받을 때까지 앱을 재설치하거나 로그아웃하거나 로컬 녹음을 삭제하지 마세요. 동기화되지 않은 녹음이 휴대폰에 남아 있을 수 있습니다.',ru:'До получения рекомендаций поддержки не переустанавливайте приложение, не выходите из аккаунта и не удаляйте локальные записи: несинхронизированные записи могут оставаться на телефоне.',hi:'सहायता के निर्देश मिलने तक ऐप दोबारा इंस्टॉल न करें, लॉग आउट न करें और स्थानीय रिकॉर्डिंग न मिटाएँ; बिना सिंक हुई रिकॉर्डिंग फ़ोन में हो सकती हैं।','hi-Latn':'Support ki salah milne tak app dobara install na karein, log out na karein aur local recordings na mitaayein; bina sync hui recordings phone par ho sakti hain.'};
const QUESTIONS={en:'Which device are you using?',fr:'Quel appareil utilisez-vous ?',de:'Welches Gerät verwendest du?',es:'¿Qué dispositivo estás usando?',pt:'Qual dispositivo você está usando?',it:'Quale dispositivo stai usando?',tr:'Hangi cihazı kullanıyorsunuz?',id:'Perangkat apa yang Anda gunakan?',zh:'你使用的是哪款设备？',ja:'どのデバイスを使っていますか？',ko:'어떤 기기를 사용하고 계신가요?',ru:'Какое устройство вы используете?',hi:'आप कौन-सा डिवाइस इस्तेमाल कर रहे हैं?','hi-Latn':'Aap kaunsa device istemal kar rahe hain?'};
function applicabilityDecision({question,threadHistory=[],sourceCatalog=[],sourceIds=[],answer='',language='en',dataLossRisk=false}={}) {
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
 const scopeNames=[...new Set(products.map(name))];
 const evidenceDeviceScope=!rows.length?'unknown':!restrictions.length?'unknown':conflict||scopeNames.length>1?'multiple':deviceCode(scopeNames[0]);
 const locale=QUESTIONS[language]?language:String(language).split('-')[0];
 const questionText=QUESTIONS[locale]||QUESTIONS.en;
 const warning=dataLossRisk?(WARNINGS[locale]||WARNINGS.en):'';
 return {blocked:mismatched,detectedDevice,evidenceDeviceScope,
  question:[questionText,warning].filter(Boolean).join('\n\n')};
}
module.exports={isPublisherSource,restrictionFor,normalizeDeviceScope,publisherDeviceScope,scopeFor,ownedDevice,applicabilityDecision,TRACE_DEVICES,TRACE_SCOPES};
