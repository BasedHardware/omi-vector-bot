// The closing card uses the stored case language, just like the acceptance notice.
// Feedback and store reviews remain separate; reviews never affect support.
const CLOSING_COPY = {
  en: {
    title: 'How did we do?', staff: 'staff',
    description: who => [
      'Thank you for giving us the chance to help.',
      'Did we help solve your problem? Your honest feedback helps us improve.',
      'If you still need help, use the button below. If the thread cannot be reopened, open a new post in Help.',
      `Marked resolved by ${who}. Only the customer who opened this post can submit support feedback.`,
    ],
    reviewTitle: 'Share an honest app review · optional',
    reviewText: "We'd appreciate an honest rating or review of the Omi app on your store. It's optional and does not affect your support.\nOn Google Play, choose **Write a review** after opening the page.",
    resolved: 'Yes, my issue is resolved', needsHelp: 'Still need help',
    appStore: 'Review on App Store', googlePlay: 'Open Google Play',
  },
  es: {
    title: '¿Cómo lo hicimos?', staff: 'el equipo',
    description: who => [
      'Gracias por darnos la oportunidad de ayudarte.',
      '¿Te ayudamos a resolver el problema? Tus comentarios sinceros nos ayudan a mejorar.',
      'Si aún necesitas ayuda, usa el botón de abajo. Si no se puede reabrir el hilo, crea una nueva publicación en Help.',
      `Resuelto por ${who}. Solo la persona que abrió esta publicación puede enviar comentarios sobre el soporte.`,
    ],
    reviewTitle: 'Comparte una reseña sincera · opcional',
    reviewText: 'Agradecemos una valoración o reseña sincera de la app Omi en tu tienda. Es opcional y no afecta a tu soporte.\nEn Google Play, abre la página y elige **Escribir una reseña**.',
    resolved: 'Sí, mi problema está resuelto', needsHelp: 'Aún necesito ayuda',
    appStore: 'Reseñar en App Store', googlePlay: 'Abrir Google Play',
  },
  zh: {
    title: '我们的服务怎么样？', staff: '支持团队',
    description: who => [
      '感谢你给我们提供帮助的机会。',
      '我们帮你解决问题了吗？你的真实反馈能帮助我们改进。',
      '如果仍然需要帮助，请使用下方按钮。如果无法重新打开此讨论串，请在 Help 中发布新帖。',
      `${who} 将此请求标记为已解决。只有发布此帖的客户可以提交支持反馈。`,
    ],
    reviewTitle: '分享真实的应用评价 · 自愿',
    reviewText: '欢迎在应用商店为 Omi 应用提供真实的评分或评价。这完全自愿，不会影响你获得支持。\n在 Google Play 打开页面后，选择**撰写评价**。',
    resolved: '是的，问题已解决', needsHelp: '仍然需要帮助',
    appStore: '在 App Store 评价', googlePlay: '打开 Google Play',
  },
  it: {
    title: 'Come è andata?', staff: 'il team',
    description: who => [
      'Grazie per averci dato la possibilità di aiutarti.',
      'Ti abbiamo aiutato a risolvere il problema? Un feedback sincero ci aiuta a migliorare.',
      'Se hai ancora bisogno di aiuto, usa il pulsante qui sotto. Se non è possibile riaprire la conversazione, crea un nuovo post in Help.',
      `Segnato come risolto da ${who}. Solo chi ha aperto questo post può inviare un feedback sul supporto.`,
    ],
    reviewTitle: 'Condividi una recensione sincera · facoltativo',
    reviewText: 'Apprezziamo una valutazione o recensione sincera dell’app Omi sul tuo store. È facoltativa e non influisce sul supporto.\nSu Google Play, apri la pagina e scegli **Scrivi una recensione**.',
    resolved: 'Sì, il problema è risolto', needsHelp: 'Ho ancora bisogno di aiuto',
    appStore: 'Recensisci su App Store', googlePlay: 'Apri Google Play',
  },
  pt: {
    title: 'Como foi o atendimento?', staff: 'a equipe',
    description: who => [
      'Obrigado por nos dar a oportunidade de ajudar.',
      'Ajudamos a resolver seu problema? Seu feedback sincero nos ajuda a melhorar.',
      'Se ainda precisar de ajuda, use o botão abaixo. Se não for possível reabrir a conversa, crie uma nova publicação em Help.',
      `Marcado como resolvido por ${who}. Somente o cliente que abriu esta publicação pode enviar feedback sobre o suporte.`,
    ],
    reviewTitle: 'Compartilhe uma avaliação sincera · opcional',
    reviewText: 'Agradecemos uma nota ou avaliação sincera do app Omi na sua loja. É opcional e não afeta seu suporte.\nNo Google Play, abra a página e escolha **Escrever uma avaliação**.',
    resolved: 'Sim, meu problema foi resolvido', needsHelp: 'Ainda preciso de ajuda',
    appStore: 'Avaliar na App Store', googlePlay: 'Abrir Google Play',
  },
  fr: {
    title: 'Comment cela s’est-il passé ?', staff: 'l’équipe',
    description: who => [
      'Merci de nous avoir donné l’occasion de vous aider.',
      'Avons-nous aidé à résoudre votre problème ? Votre avis sincère nous aide à progresser.',
      'Si vous avez encore besoin d’aide, utilisez le bouton ci-dessous. Si le fil ne peut pas être rouvert, créez une nouvelle publication dans Help.',
      `Marqué comme résolu par ${who}. Seule la personne qui a ouvert cette publication peut donner son avis sur le support.`,
    ],
    reviewTitle: 'Partagez un avis sincère sur l’app · facultatif',
    reviewText: 'Une note ou un avis sincère sur l’app Omi dans votre boutique nous serait utile. C’est facultatif et cela n’affecte pas votre support.\nSur Google Play, ouvrez la page et choisissez **Rédiger un avis**.',
    resolved: 'Oui, mon problème est résolu', needsHelp: 'J’ai encore besoin d’aide',
    appStore: 'Donner un avis sur l’App Store', googlePlay: 'Ouvrir Google Play',
  },
  de: {
    title: 'Wie war unsere Hilfe?', staff: 'das Team',
    description: who => [
      'Danke, dass wir dir helfen durften.',
      'Haben wir dein Problem gelöst? Dein ehrliches Feedback hilft uns, besser zu werden.',
      'Wenn du noch Hilfe brauchst, nutze den Button unten. Falls der Thread nicht wieder geöffnet werden kann, erstelle einen neuen Beitrag in Help.',
      `Von ${who} als gelöst markiert. Nur die Person, die diesen Beitrag erstellt hat, kann Feedback zum Support abgeben.`,
    ],
    reviewTitle: 'Ehrliche App-Bewertung teilen · freiwillig',
    reviewText: 'Wir freuen uns über eine ehrliche Bewertung der Omi-App in deinem Store. Sie ist freiwillig und hat keinen Einfluss auf deinen Support.\nÖffne auf Google Play die Seite und wähle **Rezension schreiben**.',
    resolved: 'Ja, mein Problem ist gelöst', needsHelp: 'Ich brauche noch Hilfe',
    appStore: 'Im App Store bewerten', googlePlay: 'Google Play öffnen',
  },
  tr: {
    title: 'Nasıl yardımcı olduk?', staff: 'ekip',
    description: who => [
      'Size yardımcı olma fırsatı verdiğiniz için teşekkür ederiz.',
      'Sorununuzu çözmenize yardımcı olduk mu? Dürüst geri bildiriminiz gelişmemize yardımcı olur.',
      'Hâlâ yardıma ihtiyacınız varsa aşağıdaki düğmeyi kullanın. Başlık yeniden açılamıyorsa Help içinde yeni bir gönderi açın.',
      `${who} tarafından çözüldü olarak işaretlendi. Destek geri bildirimini yalnızca bu gönderiyi açan müşteri verebilir.`,
    ],
    reviewTitle: 'Dürüst bir uygulama yorumu paylaşın · isteğe bağlı',
    reviewText: 'Mağazanızda Omi uygulaması için dürüst bir puan veya yorum paylaşırsanız seviniriz. Bu isteğe bağlıdır ve aldığınız desteği etkilemez.\nGoogle Play’de sayfayı açtıktan sonra **Yorum yaz** seçeneğini seçin.',
    resolved: 'Evet, sorunum çözüldü', needsHelp: 'Hâlâ yardıma ihtiyacım var',
    appStore: 'App Store’da değerlendir', googlePlay: 'Google Play’i aç',
  },
  id: {
    title: 'Bagaimana layanan kami?', staff: 'tim',
    description: who => [
      'Terima kasih sudah memberi kami kesempatan untuk membantu.',
      'Apakah kami membantu menyelesaikan masalahmu? Masukan yang jujur membantu kami meningkatkan layanan.',
      'Jika masih membutuhkan bantuan, gunakan tombol di bawah. Jika utas tidak dapat dibuka kembali, buat postingan baru di Help.',
      `Ditandai selesai oleh ${who}. Hanya pelanggan yang membuka postingan ini yang dapat memberikan masukan tentang dukungan.`,
    ],
    reviewTitle: 'Bagikan ulasan aplikasi yang jujur · opsional',
    reviewText: 'Kami menghargai penilaian atau ulasan yang jujur untuk aplikasi Omi di tokomu. Ini opsional dan tidak memengaruhi dukungan yang kamu terima.\nDi Google Play, buka halaman lalu pilih **Tulis ulasan**.',
    resolved: 'Ya, masalah saya selesai', needsHelp: 'Masih membutuhkan bantuan',
    appStore: 'Ulas di App Store', googlePlay: 'Buka Google Play',
  },
  ja: {
    title: 'サポートはいかがでしたか？', staff: 'サポートチーム',
    description: who => [
      'お手伝いする機会をいただき、ありがとうございます。',
      '問題の解決に役立ちましたか？率直なご意見がサービスの改善につながります。',
      'まだお困りの場合は、下のボタンを使ってください。スレッドを再開できない場合は、Help に新しい投稿を作成してください。',
      `${who} が解決済みにしました。サポートへのご意見を送信できるのは、この投稿を作成したお客様のみです。`,
    ],
    reviewTitle: '率直なアプリレビューを共有 · 任意',
    reviewText: 'ストアで Omi アプリへの率直な評価やレビューをいただけると幸いです。任意であり、サポートには影響しません。\nGoogle Play でページを開き、**レビューを書く**を選んでください。',
    resolved: 'はい、問題は解決しました', needsHelp: 'まだサポートが必要です',
    appStore: 'App Store でレビュー', googlePlay: 'Google Play を開く',
  },
  ko: {
    title: '지원은 어떠셨나요?', staff: '지원팀',
    description: who => [
      '도와드릴 기회를 주셔서 감사합니다.',
      '문제 해결에 도움이 되었나요? 솔직한 의견은 서비스 개선에 도움이 됩니다.',
      '아직 도움이 필요하다면 아래 버튼을 이용해 주세요. 스레드를 다시 열 수 없다면 Help에 새 게시물을 작성해 주세요.',
      `${who} 님이 해결됨으로 표시했습니다. 이 게시물을 작성한 고객만 지원 의견을 제출할 수 있습니다.`,
    ],
    reviewTitle: '솔직한 앱 리뷰 공유 · 선택 사항',
    reviewText: '스토어에서 Omi 앱에 대한 솔직한 평점이나 리뷰를 남겨 주시면 감사하겠습니다. 선택 사항이며 지원에 영향을 주지 않습니다.\nGoogle Play에서 페이지를 연 뒤 **리뷰 작성**을 선택해 주세요.',
    resolved: '네, 문제가 해결되었습니다', needsHelp: '아직 도움이 필요합니다',
    appStore: 'App Store에서 리뷰', googlePlay: 'Google Play 열기',
  },
  ru: {
    title: 'Как вам наша помощь?', staff: 'команда',
    description: who => [
      'Спасибо за возможность помочь вам.',
      'Помогли ли мы решить вашу проблему? Честная обратная связь помогает нам улучшать поддержку.',
      'Если помощь ещё нужна, нажмите кнопку ниже. Если ветку нельзя открыть снова, создайте новый пост в Help.',
      `${who} отметил обращение как решённое. Отзыв о поддержке может оставить только клиент, создавший этот пост.`,
    ],
    reviewTitle: 'Честный отзыв о приложении · по желанию',
    reviewText: 'Будем рады честной оценке или отзыву о приложении Omi в вашем магазине. Это необязательно и не влияет на поддержку.\nОткройте страницу в Google Play и выберите **Написать отзыв**.',
    resolved: 'Да, моя проблема решена', needsHelp: 'Помощь ещё нужна',
    appStore: 'Отзыв в App Store', googlePlay: 'Открыть Google Play',
  },
  'hi-Latn': {
    title: 'Hamari madad kaisi rahi?', staff: 'team',
    description: who => [
      'Hamein madad karne ka mauka dene ke liye dhanyavaad.',
      'Kya hum aapki samasya hal karne mein madad kar paaye? Aapki imaandaar rai hamein behtar banne mein madad karti hai.',
      'Agar abhi bhi madad chahiye, neeche ka button dabayein. Agar thread dobara nahi khul sakta, Help mein nayi post banayein.',
      `${who} ne ise hal hua mark kiya. Sirf is post ko shuru karne wala customer support ke baare mein rai de sakta hai.`,
    ],
    reviewTitle: 'App ki imaandaar rai dein · vaikalpik',
    reviewText: 'Apne store par Omi app ki imaandaar rating ya review denge to hamein khushi hogi. Yeh vaikalpik hai aur aapko milne wali madad par asar nahi daalta.\nGoogle Play par page kholkar **Review likhein** chunein.',
    resolved: 'Haan, meri samasya hal ho gayi', needsHelp: 'Abhi bhi madad chahiye',
    appStore: 'App Store par review dein', googlePlay: 'Google Play kholein',
  },
  'hi-Deva': {
    title: 'हमारी मदद कैसी रही?', staff: 'टीम',
    description: who => [
      'हमें मदद करने का मौका देने के लिए धन्यवाद।',
      'क्या हम आपकी समस्या हल करने में मदद कर पाए? आपकी ईमानदार राय हमें बेहतर बनने में मदद करती है।',
      'अगर अभी भी मदद चाहिए, तो नीचे का बटन दबाएँ। अगर थ्रेड दोबारा नहीं खुल सकता, तो Help में नई पोस्ट बनाएँ।',
      `${who} ने इसे हल हुआ चिह्नित किया। सिर्फ इस पोस्ट को शुरू करने वाला ग्राहक सहायता के बारे में राय दे सकता है।`,
    ],
    reviewTitle: 'ऐप की ईमानदार समीक्षा दें · वैकल्पिक',
    reviewText: 'अपने स्टोर पर Omi ऐप की ईमानदार रेटिंग या समीक्षा देंगे तो हमें खुशी होगी। यह वैकल्पिक है और आपको मिलने वाली सहायता पर असर नहीं डालता।\nGoogle Play पर पेज खोलकर **समीक्षा लिखें** चुनें।',
    resolved: 'हाँ, मेरी समस्या हल हो गई', needsHelp: 'अभी भी मदद चाहिए',
    appStore: 'App Store पर समीक्षा दें', googlePlay: 'Google Play खोलें',
  },
};

function closingCopy(language = 'en') {
  const key = typeof language === 'string' ? language : 'en';
  if (Object.hasOwn(CLOSING_COPY, key)) return CLOSING_COPY[key];
  const base = key.split('-')[0];
  return Object.hasOwn(CLOSING_COPY, base) ? CLOSING_COPY[base] : CLOSING_COPY.en;
}

module.exports = { CLOSING_COPY, closingCopy };
