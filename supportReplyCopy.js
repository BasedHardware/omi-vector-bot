// Application-owned rejection copy. It reports uncertainty and the need for
// review, never staff receipt, acceptance, a fix or a promised response time.
const REVIEW_REJECTION = {
  en: "I couldn't verify a direct answer to what you asked from the official Omi information. I won't substitute a different or guessed answer; a person needs to check this.",
  de: 'Ich konnte eine direkte Antwort auf deine Frage anhand der offiziellen Omi-Informationen nicht bestätigen. Ich werde keine andere oder geratene Antwort an ihre Stelle setzen; jemand muss das prüfen.',
  fr: 'Je n’ai pas pu vérifier une réponse directe à votre question à partir des informations officielles d’Omi. Je ne vais pas la remplacer par une autre réponse ou une supposition ; une personne doit vérifier ce point.',
  es: 'No pude verificar una respuesta directa a tu pregunta con la información oficial de Omi. No voy a sustituirla por otra respuesta ni por una suposición; una persona debe revisarlo.',
  pt: 'Não consegui verificar uma resposta direta à sua pergunta nas informações oficiais da Omi. Não vou substituí-la por outra resposta ou por um palpite; uma pessoa precisa verificar isso.',
  it: 'Non ho potuto verificare una risposta diretta alla tua domanda nelle informazioni ufficiali di Omi. Non la sostituirò con una risposta diversa o un’ipotesi; una persona deve verificare questo punto.',
  tr: 'Resmî Omi bilgilerinden soruna doğrudan bir yanıtı doğrulayamadım. Bunun yerine başka bir yanıt veya tahmin sunmayacağım; bunu bir kişinin incelemesi gerekiyor.',
  id: 'Saya belum dapat memverifikasi jawaban langsung atas pertanyaanmu dari informasi resmi Omi. Saya tidak akan menggantinya dengan jawaban lain atau tebakan; seseorang perlu memeriksanya.',
  zh: '我无法根据 Omi 官方信息核实你所问问题的直接答案。我不会用其他答案或猜测来代替；需要有人核查此事。',
  ja: 'Omiの公式情報から、ご質問への直接の回答を確認できませんでした。別の回答や推測で置き換えることはしません。担当者による確認が必要です。',
  'hi-Deva': 'Omi की आधिकारिक जानकारी से आपके सवाल का सीधा जवाब सत्यापित नहीं हो सका। मैं उसकी जगह कोई दूसरा या अनुमानित जवाब नहीं दूँगा; किसी व्यक्ति को इसकी जाँच करनी होगी।',
  'hi-Latn': 'Omi ki adhikarik jaankari se aapke sawaal ka seedha jawaab satyapit nahi ho saka. Main uski jagah koi doosra ya andaze ka jawaab nahi doonga; kisi vyakti ko iski jaanch karni hogi.',
};

function reviewRejectionReply(language = 'en', question = '') {
  const raw = String(language || 'en');
  const base = raw.toLowerCase().split('-')[0];
  const code = base === 'hi' && !Object.hasOwn(REVIEW_REJECTION, raw)
    ? /\p{Script=Devanagari}/u.test(question) ? 'hi-Deva' : 'hi-Latn'
    : Object.hasOwn(REVIEW_REJECTION, raw) ? raw : base;
  return Object.hasOwn(REVIEW_REJECTION, code) ? REVIEW_REJECTION[code] : REVIEW_REJECTION.en;
}

module.exports = {reviewRejectionReply};
