const { redactSensitive } = require('./privacy');
const { SOURCE_LABEL_NAME, SOURCE_LABEL_SEPARATOR } = require('./supportSteps');

// Public output only. These patterns never authorize a private lookup or store
// extracted values; capability and confirmed delivery come from application code.
const SENSITIVE = /e[- ]?mail|correo|courriel|bestellnummer|num[eé]ro\s+(?:de\s+commande|do\s+pedido)|n[uú]mero\s+(?:de\s+pedido|do\s+pedido)|numero\s+di\s+ordine|order\s*(?:number|no\.?|id|details)|tracking\s*(?:number|link|code)|full\s+address|shipping\s+address|billing\s+address|payment\s*(?:details|information)|card\s*(?:number|details)|password|passwort|mot\s+de\s+passe|contrase[nñ]a|senha|parola|kata\s+sandi|verification\s*code|security\s*code|one.time\s*code|\botp\b|sipariş\s*numara|nomor\s*pesanan|alamat\s*(?:lengkap|email)|adresse\s*(?:compl[eè]te|postale)|direcci[oó]n\s*completa|endere[cç]o\s*completo|indirizzo\s*completo|vollst[aä]ndige\s*adresse|邮箱|郵箱|订单号|訂單號|密码|密碼|验证码|完整地址|付款信息|メールアドレス|注文番号|パスワード|認証コード|住所|ईमेल|ऑर्डर\s*नंबर|पासवर्ड|सत्यापन\s*कोड|पूरा\s*पता/iu;
const REQUEST = /(?<![\p{L}\p{M}])(?:send|share|post|paste|provide|tell\s+me|give\s+(?:me|us)|upload|submit|forward|reply\s+with|sende[\p{L}\p{M}]*|schick[\p{L}\p{M}]*|teil[\p{L}\p{M}]*|poste[\p{L}\p{M}]*|envoy[\p{L}\p{M}]*|partag[\p{L}\p{M}]*|indiqu[\p{L}\p{M}]*|compart[\p{L}\p{M}]*|publica[\p{L}\p{M}]*|env[ií][ae][\p{L}\p{M}]*|invi[ai][\p{L}\p{M}]*|fornis[\p{L}\p{M}]*|kirim[\p{L}\p{M}]*|bagikan|berikan|paylaş[\p{L}\p{M}]*|gönder[\p{L}\p{M}]*|bhej[\p{L}\p{M}]*|bata[\p{L}\p{M}]*)(?![\p{L}\p{M}])|提供|发送|發送|分享|提交|送って|教えて|入力して.*(?:ここ|スレッド)|भेज|साझा|बताएँ/iu;
const OTHER_SENSITIVE = /(?:your|full|postal|home|shipping|billing)\s+address|zahlungsdaten|kontodaten|coordonn[eé]es\s+bancaires|(?:informations?|donn[eé]es)\s+de\s+paiement|datos\s+de\s+pago|dados\s+de\s+pagamento|dati\s+di\s+pagamento|ödeme\s+bilgi|kart\s*numara|rincian\s+pembayaran|nomor\s+kartu|支払い情報|भुगतान\s*जानकारी|doğrulama\s*kod|verification\s*pin|शुल्क\s*विवरण/iu;
const LOGIN_SECRET = /(?:login|sign[- ]?in|authentication)\s*(?:code|pin)/iu;
const hasSensitive = text => SENSITIVE.test(text) || OTHER_SENSITIVE.test(text) || LOGIN_SECRET.test(text) || /\bpassphrase\b/iu.test(text);
const COLLECTION = new RegExp(`(?:${REQUEST.source})|\\b(?:confirm|verify)\\b|\\blet\\s+(?:me|us)\\s+know\\b|\\benter\\b(?=[^\\n.!?]*\\b(?:here|thread|chat|public)\\b)`, 'iu');
const NOUN_QUESTION = /(?:what['’]s\s+your|what\s+is\s+your|which\s+is\s+your|\b(?:what|which)\b[^.!?\n]{0,80}\b(?:did\s+you|do\s+you|your)\b|could\s+(?:you|we).*have|quel\w*\s+est\s+votre|welche\w*\s+ist\s+deine|cu[aá]l\s+es\s+tu)/iu;
const CLAUSES = new RegExp(`\\s*[;；]\\s*|\\s+(?:and|but|und|aber|et|mais|y|pero|e|ve|dan|aur)\\s+(?=(?:please\\s+|bitte\\s+|veuillez\\s+)?(?:${COLLECTION.source}))`, 'iu');
const PRIVATE_ROUTE = /\b(?:(?:DM|PM)\s+(?:me|us)|direct[- ]message\s+(?:me|us)|(?:send|write|message)[^.!?]{0,60}(?:(?:me|us)[^.!?]{0,20}privately|(?:in|via|by)\s+(?:a\s+)?(?:DM|PM|direct[- ]message))|private\s+message)\b|私信|ダイレクトメッセージ/iu;
const NEGATIVE = /(?:do\s+not|don['’]t|never|must\s+not|should\s+not|avoid|not\s+(?:need|required)|nicht|niemals|ne\s+pas|n['’].*pas|no|nunca|n[aã]o|non|jangan|gönderme|paylaşma|मत|नहीं|不要|请勿|しないで|送らないで)\s*$/iu;
const SOURCE = new RegExp(`^\\s*${SOURCE_LABEL_NAME}\\s*${SOURCE_LABEL_SEPARATOR}`, 'iu');
const publicSupportEmail = value => /^(?:help@omi\.me|team@basedhardware\.com)$/iu.test(value);
const DIAGNOSTIC = /device|app\s*version|operating\s*system|\bOS\b|mod[eè]le|version|ger[aä]t|dispositivo|cihaz|perangkat|设备|機種|デバイス|डिवाइस/iu;
const COPY = {
  en: ['For order verification, use `/order` privately; keep other private details out of this thread.', 'A team member will ask privately for any needed account or order details. Never send passwords, payment details or verification codes.'],
  de: ['Nutze `/order` zur privaten Bestellprüfung; teile hier keine privaten Angaben.', 'Ein Teammitglied fragt benötigte Konto- oder Bestellangaben privat ab. Teile niemals Passwörter, Zahlungsdaten oder Bestätigungscodes.'],
  fr: ['Pour vérifier une commande en privé, utilise `/order` ; ne publie aucune donnée privée ici.', 'Un membre de l’équipe demandera en privé les informations de compte ou de commande nécessaires. Ne transmets jamais de mot de passe, de données de paiement ou de code de vérification.'],
  es: ['Para verificar un pedido en privado, usa `/order`; no publiques datos privados aquí.', 'Una persona del equipo pedirá en privado los datos de cuenta o pedido necesarios. Nunca envíes contraseñas, datos de pago ni códigos de verificación.'],
  pt: ['Use `/order` para verificar um pedido em privado; não publique dados privados aqui.', 'Uma pessoa da equipe pedirá em privado os dados de conta ou pedido necessários. Nunca envie senhas, dados de pagamento ou códigos de verificação.'],
  it: ['Usa `/order` per verificare un ordine in privato; non pubblicare dati privati qui.', 'Una persona del team chiederà in privato i dati necessari di account o ordine. Non inviare mai password, dati di pagamento o codici di verifica.'],
  tr: ['Sipariş doğrulaması için `/order` komutunu özel olarak kullan; özel bilgileri burada paylaşma.', 'Ekipten biri gerekli hesap veya sipariş bilgilerini özel olarak isteyecek. Parola, ödeme bilgileri veya doğrulama kodları gönderme.'],
  id: ['Gunakan `/order` untuk verifikasi pesanan secara pribadi; jangan kirim data pribadi di utas ini.', 'Anggota tim akan meminta informasi akun atau pesanan yang diperlukan secara pribadi. Jangan kirim kata sandi, rincian pembayaran atau kode verifikasi.'],
  zh: ['请使用 `/order` 进行非公开的订单验证，不要在讨论串中发布隐私信息。', '团队成员会通过非公开方式询问必要的账户或订单信息。请勿发送密码、付款信息或验证码。'],
  ja: ['注文の非公開確認には `/order` を使い、このスレッドに個人情報を書かないでください。', '担当者が必要なアカウント・注文情報を非公開で確認します。パスワード、支払い情報、認証コードは送らないでください。'],
  'hi-Deva': ['ऑर्डर के निजी सत्यापन के लिए `/order` का उपयोग करें; निजी जानकारी इस थ्रेड में न भेजें।', 'टीम का सदस्य ज़रूरी खाता या ऑर्डर जानकारी निजी रूप से पूछेगा। पासवर्ड, भुगतान जानकारी या सत्यापन कोड कभी न भेजें।'],
  'hi-Latn': ['Order ke niji satyapan ke liye `/order` istemal karein; niji jaankari is thread mein na bhejein.', 'Team ka sadasya zaroori account ya order jaankari niji taur par poochega. Password, payment details ya verification code kabhi na bhejein.'],
};
const ownedLines = Object.values(COPY).flat();
function locale(language, question) {
  const raw = String(language || 'en');
  const base = raw.toLowerCase().split('-')[0];
  return Object.hasOwn(COPY, raw) ? raw : base === 'hi'
    ? /\p{Script=Devanagari}/u.test(question || '') ? 'hi-Deva' : 'hi-Latn'
    : Object.hasOwn(COPY, base) ? base : 'en';
}
function officialUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !privateUrl(value) &&
      (['help.omi.me', 'docs.omi.me'].includes(url.hostname) ||
       (['omi.me', 'www.omi.me'].includes(url.hostname) && /^\/pages\//.test(url.pathname)) ||
       (url.hostname === 'github.com' && /^\/BasedHardware\//i.test(url.pathname)));
  } catch { return false; }
}
function privateUrl(value) {
  try {
    const url = new URL(value);
    const decoded = decodeURIComponent(url.pathname + url.search + url.hash);
    const emails = decoded.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu) || [];
    return Boolean(url.username || url.password) || emails.some(value => !publicSupportEmail(value)) ||
      [...url.searchParams.keys()].some(name => /^(?:token|email|password|secret|key|code|order|order_id)$/i.test(name));
  } catch { return true; }
}
function trimUrl(value) { return value.replace(/[.,;!?。)\]}>’”'"]+$/u, ''); }
function escapeRegex(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function valuePattern(value) {
  const start = /^[\p{L}\p{N}]/u.test(value) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = /[\p{L}\p{N}]$/u.test(value) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(start + escapeRegex(value) + end, 'giu');
}
function privateValues(question) {
  const values = new Set();
  const input = String(question || '');
  // Explicitly labelled values are removed even when the answer omits labels.
  const label = /(order\s*(?:number|id)|tracking\s*(?:number|code)|e[- ]?mail|password|passphrase|passwort|mot\s+de\s+passe|contrase[nñ]a|verification\s*code|security\s*code|login\s*code|\botp\b|address|adresse|direcci[oó]n|ईमेल|पासवर्ड|सत्यापन\s*कोड|पता|订单号|密码|验证码|注文番号|パスワード|認証コード)\s*(?:(?:is|ist|est|es|[eé])\s+|[:=：は是]\s*)([^\n;。！？।]+)/giu;
  // Look ahead instead of consuming the rest of a compound declaration: each
  // later labelled field in the same sentence must still be discovered.
  for (const match of input.matchAll(new RegExp(`(?=${label.source})`, 'giu'))) {
    const quoted = match[2].trim().match(/^['"`]([^'"`]+)['"`]/u);
    const phrase = /address|adresse|direcci[oó]n|पता|password|passphrase|passwort|mot\s+de\s+passe|contrase[nñ]a|पासवर्ड|密码|パスワード/iu.test(match[1]);
    const code = /code|\botp\b|कोड|验证码|認証コード/iu.test(match[1]);
    const groupedCode = code && match[2].trim().match(/^\d(?:[\d -]*\d)?/u)?.[0];
    const value = (quoted?.[1] || groupedCode || (phrase ? match[2].split(/\.\s+|,\s*|\s+(?:but|aber|mais|pero)\s+|\s+(?:and|und|et|y|e)\s+(?=(?:my|the|this|our|I|it|mein\w*|der|die|das|le|la|el|mi)\b)/iu)[0] : match[2].trim().split(/[\s,]+/u)[0]))
      .replace(/[.,;:!?)}\]>'"…]+$/u, '').trim();
    if (value && !publicSupportEmail(value)) values.add(value);
  }
  for (const match of input.matchAll(/https?:\/\/[^\s<>]+/giu)) {
    const value = trimUrl(match[0]);
    if (!officialUrl(value)) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}
function onlySensitiveObjects(text) {
  return !text
    .replace(new RegExp([SENSITIVE.source, OTHER_SENSITIVE.source, LOGIN_SECRET.source, '\\bpassphrase\\b'].join('|'), 'giu'), '')
    .replace(/\b(?:your|any|all|the|and|or|address)\b/giu, '').replace(/[\s,/-]+/gu, '');
}
function unsafeRequest(text) {
  if (!hasSensitive(text)) return false;
  if (NOUN_QUESTION.test(text)) return true;
  const verbs = [...text.matchAll(new RegExp(COLLECTION.source, 'giu'))];
  for (const [index, verb] of verbs.entries()) {
    const before = text.slice(index ? verbs[index - 1].index + verbs[index - 1][0].length : 0, verb.index).trim();
    const after = text.slice(verb.index + verb[0].length, verbs[index + 1]?.index);
    const objectBefore = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Devanagari}/u.test(text) || /paylaş|gönder|bhej|bata/iu.test(verb[0]);
    if (!hasSensitive(after) && !(objectBefore && hasSensitive(before))) continue;
    const maskingState = /^(?:confirm|verify)$/iu.test(verb[0]) && after.match(/^\s+(?:that\s+)?(.+?)\s+(?:is|are)\s+(?:hidden|redacted|removed|masked|covered|blurred)(?:\s+before(?:\s+((?:uploading|sharing|posting)\b[^.!?]*))?)?[,.!\s]*$/iu);
    const safeEvidenceSuffix = maskingState && (!maskingState[2] ||
      (/^(?:uploading|sharing|posting)\s+(?:(?:a|an|the|your)\s+)?(?:screenshot|photo|image|logs?)\b/iu.test(maskingState[2]) && !hasSensitive(maskingState[2])));
    if (maskingState && onlySensitiveObjects(maskingState[1]) && safeEvidenceSuffix) continue;
    // A masked screenshot request is safe only when the collection object is
    // evidence, not a separate order identifier or secret followed by evidence.
    const maskedEvidence = after.match(/^\s+(?:(?:a|an|the|your)\s+)?(?:screenshot|photo|image|logs?)\b(.*?)\bwith\b([^.!?\n]*)\b(?:hidden|redacted|removed|masked|covered|blurred)[.!?\s]*$/iu);
    if (maskedEvidence && !hasSensitive(maskedEvidence[1]) && onlySensitiveObjects(maskedEvidence[2])) continue;
    if (NEGATIVE.test(before) || /^\s+(?:not|nicht|pas|मत)\b/iu.test(after) ||
      (/\b(?:teil|sende|schick)/iu.test(verb[0]) && /\bnicht\b/iu.test(after))) continue;
    return true;
  }
  if (verbs.length) return false;
  return false;
}

function publicReplyPrivacy(answer, opts = {}) {
  const question = String(opts.question || '');
  const code = locale(opts.language, question);
  let needed = opts.privateIntakeNeeded === true;
  let text = String(answer || '').replace(/[\uE000-\uE005]/g, '').trim();
  for (const line of ownedLines) if (text.includes(line)) {
    text = text.split(line).join(''); needed = true;
  }
  const values = privateValues(question);
  const channels = [];
  const allowedChannels = new Set((opts.allowedChannelIds || []).map(String).filter(value => /^\d{16,22}$/.test(value)));
  text = text.replace(/<#(\d{16,22})>/g, (value, id) => allowedChannels.has(id) ? `\uE002${channels.push(value) - 1}\uE003` : value);
  const urls = [];
  // Protect knowledge URLs from sentence splitting and general ID redaction.
  text = text.replace(/[\uE000\uE001]/g, '').replace(/https?:\/\/[^\s<>]+/giu, value => {
    const url = trimUrl(value);
    const tail = value.slice(url.length);
    let decoded = url;
    try { decoded = decodeURIComponent(url); } catch { /* privateUrl already rejects malformed encoding */ }
    if (privateUrl(url) || values.some(secret => valuePattern(secret).test(decoded))) return `[private link]${tail}`;
    if (!officialUrl(url)) return value;
    const index = urls.push(url) - 1;
    return `\uE000${index}\uE001${tail}`;
  });
  for (const value of values) {
    // Short labelled values are still secrets. Token boundaries avoid turning
    // an unrelated word containing a short value into collateral redaction.
    text = text.split(/(\uE000\d+\uE001|\uE002\d+\uE003)/gu)
      .map(part => /^[\uE000\uE002]/u.test(part) ? part : part.replace(valuePattern(value), '[private detail]')).join('');
  }
  const contacts = [];
  text = text.replace(/\b(?:help@omi\.me|team@basedhardware\.com)\b/giu, value => `\uE004${contacts.push(value) - 1}\uE005`);
  text = redactSensitive(text, { issue: true }).replace(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/gu, '[payment detail]');
  const disclosureContext = needed || hasSensitive(question) || text.split(/\n|(?<=[.!?。！？।])\s+/u).some(unsafeRequest);
  const unsafePart = part => {
    const route = PRIVATE_ROUTE.exec(part);
    return unsafeRequest(part) || (disclosureContext && route && !NEGATIVE.test(part.slice(0, route.index).trim()));
  };
  const cleaned = [];
  for (const line of text.split('\n')) {
    if (SOURCE.test(line) && !line.replace(SOURCE, '').replace(/\uE000\d+\uE001|[\s,<>]/g, '')) { cleaned.push(line); continue; }
    const sentences = line.split(/(?<=[.!?。！？।])\s+|(?<=[。！？।])/u);
    if (!sentences.some(sentence => sentence.split(CLAUSES).some(unsafePart))) { cleaned.push(line); continue; }
    const safeSentences = [];
    for (const sentence of sentences) {
      const parts = sentence.split(CLAUSES);
      const kept = [];
      for (const part of parts) {
        if (!unsafePart(part)) { kept.push(part); continue; }
        needed = true;
        // Keep separately requested non-sensitive diagnostics in mixed lists.
        if (DIAGNOSTIC.test(part)) {
          const fragments = part.split(/,\s*|\s+(?:and|und|et|y|e|ve|dan|aur)\s+/iu)
            .filter(value => DIAGNOSTIC.test(value) && !hasSensitive(value));
          if (fragments.length) kept.push(fragments.join(', ').replace(/[,.\s]+$/, '') + '.');
        }
      }
      if (kept.length) safeSentences.push(kept.join('; '));
    }
    if (safeSentences.length) cleaned.push(safeSentences.join(' '));
  }
  text = cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (needed || opts.orderAvailable !== true) {
    text = text.split('\n').map(line => line.split(/(?<=[.!?。！？।])\s+/u).filter(part => {
      if (!/\/orders?\b/iu.test(part)) return true;
      needed = true; return false;
    }).join(' ')).join('\n').trim();
  }
  text = text.replace(/\uE002(\d+)\uE003/g, (_, index) => channels[Number(index)]);
  text = text.replace(/\uE004(\d+)\uE005/g, (_, index) => contacts[Number(index)]);
  text = text.replace(/\uE000(\d+)\uE001/g, (_, index) => urls[Number(index)]);
  for (const url of urls) if (!text.includes(url)) text = [text, `Source: ${url}`].filter(Boolean).join('\n');
  const empty = !text.split('\n').filter(line => !SOURCE.test(line)).join('').trim();
  const privateNextStep = needed && opts.appendNextStep !== false
    ? opts.orderAvailable === true ? COPY[code][0] : opts.staffDelivered === true ? COPY[code][1] : '' : '';
  if (privateNextStep) text = [text, privateNextStep].filter(Boolean).join('\n\n');
  return { text: text.trim(), privateNextStep, channelLinks: channels, privateIntakeNeeded: needed, empty };
}

module.exports = { publicReplyPrivacy };
