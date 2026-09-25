// Episode-based response measurement (Codex #33). The old metric looked at ONE
// pair per conversation — the very FIRST inbound ever vs the first outbound
// after it — so a long-running thread was scored once, years of later guest
// questions were invisible, and (worse) the conversation was only considered
// at all if it was CREATED in the window, excluding old-but-active threads.
//
// An EPISODE is a run of consecutive guest (inbound) messages followed by the
// host/AI's next outbound: the clock starts at the FIRST message of the run
// (that's when the guest began waiting) and stops at that outbound.
//
// WINDOW ATTRIBUTION = OVERLAP (08-08 düzeltmesi; eskiden yalnız BAŞLANGIÇ'tı).
// Bir episode pencereyle kesişiyorsa sayılır: penceredeyken başlamış olabilir,
// ya da daha önce başlayıp pencerenin İÇİNE sarkmış olabilir. Sadece başlangıca
// bakmak sürekli ihmali ödüllendiriyordu — misafir ne kadar uzun bekletilirse
// açık koşu pencere sınırını o kadar kesin aşıyor ve episode sayımdan büsbütün
// düşüyordu. Pencereden ÖNCE hem başlayıp hem KAPANMIŞ episode geçmişe aittir
// ve hâlâ dışarıda kalır.
//
// SLA CONTRACT (Codex follow-up — a guest who wrote 5 minutes ago has NOT
// missed anything yet):
//   * answered, delta <= 24h        → answerable + within
//   * answered, delta  > 24h        → answerable, NOT within (late stays late)
//   * unanswered, age  > 24h (@now) → answerable, NOT within (SLA expired)
//   * unanswered, age <= 24h (@now) → PENDING — excluded from the denominator
// Both boundaries are 24h-INCLUSIVE and consistent: at exactly 24h an answer
// still counts as within, so the unanswered run is still pending.

export interface EpisodeStats {
  answerable: number;
  answeredWithin24h: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * messages: ONE conversation's messages in chronological order.
 * `noReplyNeeded` (inceleme 09-25, P2): yapay zekânın BİLEREK cevapsız bıraktığı kapanış mesajı (karar kaydı `no_reply` —
 * "Teşekkürler", "👍"). Ne yeni bir bekleme başlatır ne de açık bir beklemeyi kapatır: son "teşekkürler" 24 saat sonra
 * "kaçırılmış cevap" sayılmaz, pazartesiki teşekkürden sonra çarşamba 5 dakikada cevaplanan soru 47 saat gecikmiş görünmez.
 */
export function computeResponseEpisodes(
  messages: { direction: string; createdAt: Date; noReplyNeeded?: boolean }[],
  windowStart: Date,
  now: Date,
): EpisodeStats {
  let answerable = 0;
  let answeredWithin24h = 0;
  let runStart: Date | null = null; // first inbound of the currently-open run

  const closeAnswered = (end: Date) => {
    if (!runStart) return;
    // 🚨 PENCEREYE AİTLİK = ÖRTÜŞME, YALNIZ BAŞLANGIÇ DEĞİL (denetim 08-08).
    // Eski koşul `runStart >= windowStart` idi ve tam da SÜREKLİ İHMALİ görünmez
    // kılıyordu: bir misafir ne kadar uzun bekletilirse, açık kalan koşu pencere
    // sınırını o kadar kesin aşıyor ve episode SAYIMDAN TAMAMEN DÜŞÜYORDU.
    // Ölçüldü: 2 thread, biri iki kez ihmal edilmiş → "%100" (gerçek %50).
    // Yeni kural: episode (ilk soru → yanıt) pencereyle KESİŞİYORSA sayılır.
    // Yanıtı da pencereden ÖNCE gelmiş episode geçmişte tamamen kapanmıştır ve
    // bu raporun dönemine ait değildir → hâlâ atlanır.
    if (runStart >= windowStart || end >= windowStart) {
      answerable++;
      if (end.getTime() - runStart.getTime() <= DAY_MS) answeredWithin24h++;
    }
    runStart = null;
  };

  for (const m of messages) {
    if (m.direction === "inbound") {
      if (m.noReplyNeeded) continue; // bilerek cevapsız kapanış: bekleme başlatmaz (↑)
      if (!runStart) runStart = m.createdAt; // consecutive inbounds keep the FIRST anchor
    } else {
      closeAnswered(m.createdAt); // outbound answers the open run (no-op when none is open)
    }
  }
  // Trailing unanswered run: a miss ONLY once its 24h SLA has expired; a still-
  // fresh question is PENDING and stays out of the denominator entirely.
  // Örtüşme kuralı burada başlangıç şartını TAMAMEN kaldırır: hâlâ açık bir koşu
  // tanım gereği ŞU ANA kadar uzanır, yani pencereyle her hâlükârda kesişir. Bu
  // dalın sonsuza kadar birikmesini konuşma seçiminin kendisi engelliyor —
  // çağıran yalnız `lastMessageAt` penceresi içindeki thread'leri getirir, yani
  // misafirin en son yazdığı an pencerede olmalıdır.
  if (runStart && now.getTime() - runStart.getTime() > DAY_MS) {
    answerable++;
  }

  return { answerable, answeredWithin24h };
}
