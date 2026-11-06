// ---------------------------------------------------------------------------
// MİSAFİR QR EKRANI METİNLERİ — TÜRKÇE / İNGİLİZCE (kurucu 10-22 U2: "Evet önerin iyi" — ilk adım iki dil, tarayıcı diline göre).
// Yapay zekâ misafirin dilinde cevap veriyordu ama ekranın kendisi ("Sorunuzu yazın…", "Gönder", kod ekranı, kapalı konaklama) yalnız
// Türkçeydi; yabancı misafir nereye yazacağını anlamayabiliyordu. Dil SUNUCUDA, isteğin `Accept-Language` başlığından seçilir (ilk
// çizim ile istemci aynı metni basar — hidrasyon farkı yok); Türkçe ilk tercih değilse İngilizce. Başlık yoksa Türkçe (ürün Türkiye odaklı).
// U3 (kurucu 10-22): misafirin girdiği kodun adı her yerde "sohbet kodu / chat code" — "giriş kodu / access code" kısa dönem kiralamada
// kapı kodu demek, misafir sayıyı kapıda deneyebiliyordu. Saf; bağımlılık yok (sunucu sayfası, istemci bileşeni ve testler aynı kaynağı okur).
// 🚨 Kurucu 11-06: metinler EV SAHİBİNİN AĞZINDAN ("size verdiğimiz sohbet kodu", "bize yazın") — "ev sahibinizin verdiği kod" gibi üçüncü
// şahıs, sanki başkası yazıyormuş gibi okunuyordu. Pin: `tests/unit/guest-chat-copy-host-voice.test.ts` (alt yazı etiketi kurucu sorusunda).
// ---------------------------------------------------------------------------

export type GuestLocale = "tr" | "en";

/**
 * `Accept-Language` → ekran dili. En yüksek ağırlıklı (q) dilin birincil etiketi "tr" ise Türkçe, başka bir dilse İngilizce; başlık boş /
 * okunamazsa Türkçe. Eşit ağırlıkta başlıktaki sıra kazanır (tarayıcılar tercih sırasıyla yazar).
 */
export function guestLocaleFromAcceptLanguage(header: string | null | undefined): GuestLocale {
  if (!header) return "tr";
  let best: { lang: string; q: number; at: number } | null = null;
  header
    .split(",")
    .slice(0, 20)
    .forEach((part, at) => {
      const [tag, ...params] = part.trim().split(";");
      const lang = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
      if (!/^[a-z]{2,3}$/.test(lang)) return;
      // "q=0.5", "Q=0.5", "q = 0.5" — hepsi aynı ağırlık (Haiku 10-22).
      const qParam = params.map((p) => p.replace(/\s+/g, "").toLowerCase()).find((p) => p.startsWith("q="));
      const q = qParam ? Number(qParam.slice(2)) : 1;
      if (!Number.isFinite(q) || q <= 0) return;
      if (!best || q > best.q) best = { lang, q, at };
    });
  const chosen = best as { lang: string } | null;
  if (!chosen) return "tr";
  return chosen.lang === "tr" ? "tr" : "en";
}

export interface GuestChatCopy {
  title: string;
  /** U4: ev sahibi "misafire görünen ad" girdiyse başlık "<ad> · Misafir Asistanı" (iç mülk adı ASLA). */
  titleFor: (place: string) => string;
  disclosure: string;
  intro: string;
  closed: string;
  footer: string;
  privacy: string;
  separatorResume: string;
  separatorHost: string;
  senderHost: string;
  senderAi: string;
  typing: string;
  inputPlaceholder: string;
  send: string;
  stalled: string;
  boundElsewhere: string;
  pinPrompt: string;
  pinPlaceholder: string;
  pinSubmit: string;
  pinChecking: string;
  pinNotDoorCode: string;
  pinUnknown: string;
  pinWrong: string;
  pinTooMany: string;
  pinLocked: (mins: number) => string;
  connectionError: string;
  replyFailed: string;
  unavailableTitle: string;
  unavailableBody: string;
  unavailableHint: string;
  inactiveTitle: string;
  inactiveBody: string;
  inactiveHint: string;
}

export const GUEST_COPY: Record<GuestLocale, GuestChatCopy> = {
  tr: {
    // Sabit marka adı — iç mülk adı (ev sahibinin özel etiketi) bu herkese açık sayfaya ASLA çıkmaz.
    title: "Lixus AI Misafir Asistanı",
    titleFor: (place) => `${place} · Misafir Asistanı`,
    disclosure: "Yanıtlar yapay zekâ tarafından hazırlanabilir. Gerektiğinde işletme ekibi görüşmeye katılabilir.",
    intro: "Merhaba! 👋 Konaklamanızla ilgili sorularınızı (çöp günü, cihazlar, kurallar, çevre önerileri…) buraya yazabilirsiniz.",
    closed: "Konaklamanız sona erdiği için sohbet kapandı. İyi günler dileriz!",
    footer: "Otomatik asistan + ev sahibi. Kapı kodu gibi giriş bilgileri güvenlik için burada paylaşılmaz.",
    privacy: "Gizlilik",
    separatorResume: "Lixus AI yeniden etkinleştirildi",
    separatorHost: "İşletme ekibi görüşmeye katıldı",
    senderHost: "👥 İşletme ekibi",
    senderAi: "🤖 Lixus AI",
    typing: "🤖 Lixus AI yazıyor…",
    inputPlaceholder: "Sorunuzu yazın…",
    send: "Gönder",
    stalled: "Yeni mesajlar şu an alınamıyor. Bağlantınızı kontrol edip sayfayı yenileyebilirsiniz.",
    boundElsewhere:
      "Bu konaklama için sohbet başka bir cihazda başlatılmış. Güvenliğiniz için sohbet yalnızca ilk açılan cihazda görüntülenir. Yardıma ihtiyacınız varsa rezervasyonunuzu yaptığınız uygulamanın mesaj bölümünden bize yazın.",
    pinPrompt: "Sohbeti başlatmak için size verdiğimiz sohbet kodunu girin.",
    pinPlaceholder: "Sohbet kodu",
    pinSubmit: "Sohbeti aç",
    pinChecking: "Kontrol ediliyor…",
    pinNotDoorCode: "Bu kod kapı kodu değildir; yalnız bu sohbeti açar.",
    pinUnknown: "Kodu bilmiyorsanız rezervasyonunuzu yaptığınız uygulamanın mesaj bölümünden bize yazın.",
    pinWrong: "Kod hatalı. Size verdiğimiz sohbet kodunu kontrol edin.",
    pinTooMany: "Çok fazla deneme. Lütfen birkaç dakika sonra tekrar deneyin.",
    pinLocked: (mins) => `Çok fazla hatalı deneme. ${mins} dakika sonra tekrar deneyin.`,
    connectionError: "Bağlantı hatası. Lütfen tekrar deneyin.",
    replyFailed: "Şu an yanıt veremiyorum. Lütfen biraz sonra tekrar deneyin.",
    unavailableTitle: "Bu sohbet şu anda kullanılamıyor",
    unavailableBody: "Karekod artık geçerli değil ya da sohbet kapatılmış olabilir.",
    unavailableHint: "Yardıma ihtiyacınız varsa rezervasyonunuzu yaptığınız uygulamanın mesaj bölümünden bize yazın.",
    inactiveTitle: "Şu an aktif bir konaklama görünmüyor",
    inactiveBody: "Sohbet yalnızca konaklamanız sürerken açıktır.",
    inactiveHint: "Bir rezervasyonunuz varsa giriş gününüzde bu karekodu tekrar okutarak buraya ulaşabilirsiniz.",
  },
  en: {
    title: "Lixus AI Guest Assistant",
    titleFor: (place) => `${place} · Guest Assistant`,
    disclosure: "Replies may be prepared by AI. Our team can join the conversation when needed.",
    intro: "Hello! 👋 You can ask questions about your stay here (rubbish days, appliances, house rules, local tips…).",
    closed: "Your stay has ended, so this chat is now closed. Have a great day!",
    footer: "Automated assistant + host. For security, check-in details such as the door code are not shared here.",
    privacy: "Privacy",
    separatorResume: "Lixus AI is back on",
    separatorHost: "Our team joined the conversation",
    senderHost: "👥 Host team",
    senderAi: "🤖 Lixus AI",
    typing: "🤖 Lixus AI is typing…",
    inputPlaceholder: "Type your question…",
    send: "Send",
    stalled: "New messages can't be loaded right now. Check your connection and refresh the page.",
    boundElsewhere:
      "The chat for this stay was started on another device. For your security it is shown only on the first device. If you need help, message us in the messages section of the app you booked with.",
    pinPrompt: "Enter the chat code we gave you to start the chat.",
    pinPlaceholder: "Chat code",
    pinSubmit: "Open chat",
    pinChecking: "Checking…",
    pinNotDoorCode: "This is not the door code; it only opens this chat.",
    pinUnknown: "If you don't have the code, message us in the messages section of the app you booked with.",
    pinWrong: "Wrong code. Please check the chat code we gave you.",
    pinTooMany: "Too many attempts. Please try again in a few minutes.",
    pinLocked: (mins) => `Too many wrong attempts. Please try again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    connectionError: "Connection error. Please try again.",
    replyFailed: "I can't reply right now. Please try again shortly.",
    unavailableTitle: "This chat isn't available right now",
    unavailableBody: "The code may no longer be valid, or the chat may have been turned off.",
    unavailableHint: "If you need help, message us in the messages section of the app you booked with.",
    inactiveTitle: "There's no active stay right now",
    inactiveBody: "The chat is only open during your stay.",
    inactiveHint: "If you have a booking, scan this code again on your check-in day to reach this page.",
  },
};

/**
 * QR sohbet ucunun (sunucu) misafire döndürdüğü sabit cevaplar — yalnız Türkçe (uç dil seçmez). Ev sahibinin ağzından; "bilgilendirildi"
 * gibi bildirim cümlesi YOK (K10: devir / bildirim cümlesi misafire gitmez). Uç dosyası (`app/api/chat/[token]/route.ts`) yalnız rota
 * alanlarını dışa verebildiği için metinler burada; pin aynı test dosyasında.
 */
export const QR_SERVER_TEXT = {
  stayMessageCap: "Şu anda çok fazla mesaj aldık. Kısa süre sonra tekrar yazabilirsiniz.",
  pinRequired: "Sohbeti kullanmak için size verdiğimiz sohbet kodunu girin.",
  boundElsewhere: "Bu konaklama için sohbet başka bir cihazda başlatıldı. Yardım için rezervasyonunuzu yaptığınız uygulamanın mesaj bölümünden bize yazın.",
} as const;
