// ---------------------------------------------------------------------------
// KNOWLEDGE HUB — BACAK B: HOST'UN KENDİ GEÇMİŞ CEVAPLARINDAN KB ÖNERİSİ
//
// Kurucu (09-11): *"geçmiş host cevaplarını da kaynak yapalım"* — ve asıl gerekçe
// onun öteki cümlesi: *"AI'ımız sus pus olmasın, her bokta bırakmasın."* Host aynı
// soruyu 40 kez elle cevaplamışsa ürün bundan BİR ŞEY ÖĞRENMİYOR; her seferinde
// yeniden devrediyor. En ucuz bilgi kaynağı host'un zaten yazdığı metindir.
//
// 🚨 BU MODÜL SAF: LLM YOK, DB YOK, AĞ YOK. Girdi bir mesaj listesi, çıktı ÖNERİ
// listesi. Hiçbir şey kaydetmez, hiçbir şey modele göndermez.
//
// ⚠️ ÇIKTI "KB KALEMİ" DEĞİL, "ÖNERİ"DİR. Host onaylayana kadar AI'a ULAŞMAZ —
// A1 onay sözleşmesi (`kb-review.ts` allowlist: yalnız `legacy`+`approved`) ve
// kabul yolu mevcut `POST /api/kb` (orada `host_manual`/`approved` damgalanır).
// `kb-extract.ts` (A5, yapıştırılan metin) ile AYNI desen, farklı kaynak.
// ---------------------------------------------------------------------------

import { classifyFallback } from "./ai/fallback";

/** Modele/host'a giden öneri metninin üst sınırı (KB kalemi tavanı 20k, öneri çok daha kısa olmalı). */
export const SUGGESTION_MAX_CHARS = 1_200;
/** Bir konu KAÇ KEZ cevaplandıysa "bu host'un yerleşik bilgisi" sayılır. */
export const DEFAULT_MIN_OCCURRENCES = 2;

/**
 * 🚨 ÜRÜNÜN AI YOLUNDA KULLANDIĞI AD (sınıflandırma sihirli string'i, CLAUDE.md
 * "DOKUNMA" listesi). Burada YALNIZ ELEME için okunur.
 */
const AI_SENDER_NAMES = new Set(["GuestOps AI", "Lixus AI"]);

/**
 * Kelime ağı niyetinden KB kategorisine eşleme.
 *
 * 🚨 LİSTE BİLEREK DAR — A3 (`kb-gaps.ts`) ile aynı gerekçeler:
 *  · `checkin`/`checkout` EŞLENMEZ: giriş/çıkış saati bir MÜLK ALANIDIR; KB'ye
 *    ikinci kopya çıkarmak ÇİFT KOPYA YASAĞIDIR (`kb-extract.ts` de aynı kuralı
 *    uyguluyor) ve iki kaynak çelişince retrieval çelişki korumasına düşer.
 *  · `complaint` · `refund` · `early_departure` · `human_request` · `early_checkin`
 *    · `late_checkout` EŞLENMEZ: bunlar OPERASYONEL niyettir, bilgi değil. O
 *    konuşmalardaki host cevabı tek bir misafire özgü bir KARARDIR ("bu sefer
 *    izin veriyorum") — kalıcı kural sanılırsa ürün YANLIŞ SÖZ verir.
 *  · `amenity` EŞLENMEZ: çok geniş, hangi olanak olduğu belirsiz (A3 de eşlemiyor).
 *  · `general` EŞLENMEZ: kategori sinyali YOK.
 *
 * 🚨 TEK KAYNAK BU ALLOWLIST'TİR. İlk yazımda bir de `NON_KNOWLEDGE_INTENTS`
 * denylist'i vardı ve MUTASYON TURU İKİSİNİN DE PİNLENEMEDİĞİNİ gösterdi: biri
 * silinince öteki yakalıyordu (M5 allowlist sayesinde, M9 denylist sayesinde
 * HAYATTA KALDI). Yedekleme değil, ÖLÇÜLMÜŞ FAZLALIKTI → denylist silindi.
 * Eleme artık tek yerde: burada OLMAYAN her niyet düşer (fail-closed yön).
 */
export const INTENT_TO_CATEGORY: Readonly<Record<string, string>> = {
  wifi: "wifi",
  parking: "parking",
  location: "location",
  cleaning: "cleaning",
};

export interface HistoryMessage {
  id: string;
  conversationId: string;
  propertyId: string;
  /** "inbound" = misafir, "outbound" = bizden çıkan. */
  direction: string;
  /** `guest | ai | host | system` — eski satırlarda NULL. */
  authorType?: string | null;
  /** Görünen ad; eski (authorType NULL) satırlarda TEK sınıflandırma ipucu. */
  senderName?: string | null;
  body?: string | null;
  createdAt: Date;
  /** Ürünümüzün AI'ı mı üretti (bayrak). */
  aiAssisted?: boolean | null;
  /** Sistem olayı satırı (gövdesiz) — cevap sayılmaz. */
  systemEventType?: string | null;
}

export interface HistoryConversation {
  id: string;
  /** Konuşma "sorunlu" işaretlendiyse oradaki cevap bilgi sayılmaz. */
  status?: string | null;
}

export interface KbSuggestionFromHistory {
  propertyId: string;
  category: string;
  /** Host'un EN SON yazdığı cevap (ad yer tutucuya çevrilmiş, kırpılmış). */
  answer: string;
  /** Aynı kategoriye kaç kez cevap verilmiş. */
  occurrences: number;
  /** En son ne zaman cevaplanmış. */
  lastAnsweredAt: Date;
  /** Öneriyi doğuran host mesajlarının kimlikleri (iz; PII taşımaz). */
  sourceMessageIds: string[];
  /** Misafirin o soruyu nasıl sorduğu — host'a BAĞLAM olarak gösterilir. */
  exampleQuestion: string;
}

export interface BuildOptions {
  minOccurrences?: number;
  /** Misafir adları; cevabın içinde geçerlerse `{isim}` yer tutucusuna çevrilir. */
  guestNamesByConversation?: Readonly<Record<string, string | null | undefined>>;
}

/**
 * 🚨 SEÇİCİ, `refreshStyleProfile`'DAN DAHA DAR OLMAK ZORUNDA (ölçülmüş gerekçe).
 *
 * `write-service.ts:351-357` sağlayıcıdan gelen HER outbound satırı koşulsuz
 * `authorType:"host"` damgalıyor. Bizim AI gönderimlerimiz normalde adopt-and-heal
 * ile korunuyor, AMA yerel yazma başarısız olduysa satır "host" olarak geri
 * geliyor — `automation.ts:526-529` bunu açıkça yazıyor. Yani `authorType:"host"`
 * kümesi Hospitable tarafındaki otomasyonu ve KAYBOLMUŞ KENDİ ÇIKTIMIZI da içerir.
 * `refreshStyleProfile` yorumu (`automation.ts:2747-2757`) aynı tuzağa bir kez
 * düşüldüğünü kaydediyor: "GuestOps AI" tek başına denylist YETMEMİŞTİ.
 *
 * Bu yüzden burada ÜÇ eleme birden: `aiAssisted` bayrağı · bilinen AI adları ·
 * `authorType === "ai"`. ⚠️ BİLİNEN SINIR: sağlayıcı tarafındaki host otomasyonunu
 * (Hospitable'ın kendi şablon mesajı) hâlâ ayırt edemiyoruz — o satır gerçekten
 * host'un hesabından çıkmıştır ve bizde onu işaretleyen bir alan YOK. Bu sınır
 * kabul edildi: öneri host'a GÖSTERİLİR, otomatik kaydedilmez.
 */
export function isHostAuthored(m: HistoryMessage): boolean {
  if (m.direction !== "outbound") return false;
  if (m.systemEventType) return false;
  if (m.aiAssisted) return false;
  // ⚠️ `authorType === "ai"` AYRI kontrol GEREKMEZ: aşağıdaki "host değilse düş"
  // satırı onu zaten kapsıyor (mutasyon turu ölü kod olarak gösterdi).
  if (m.senderName && AI_SENDER_NAMES.has(m.senderName)) return false;
  // `authorType` yazılmışsa ona güven; NULL ise (eski satır) ad elemesi karar verir.
  if (m.authorType && m.authorType !== "host") return false;
  return Boolean(m.body && m.body.trim());
}

/**
 * Misafirin adını `{isim}` yer tutucusuna çevirir.
 *
 * 🚨 GEREKÇE: host "Merhaba Ayşe, şifre 1234" yazmıştır. O metin KB'ye AYNEN
 * girerse GELECEKTEKİ HER MİSAFİRE "Merhaba Ayşe" gider — hem yanlış hitap hem
 * ESKİ MİSAFİRİN ADININ SIZMASI (KVKK). Yer tutucuya çevirince mevcut ikame
 * katmanı (`kb-placeholders.ts`) her misafire doğru adı koyar; QR'da ise bilinçli
 * olarak nötr hitap kullanılır.
 */
export function maskGuestName(text: string, guestName: string | null | undefined): string {
  const first = (guestName ?? "").trim().split(/\s+/u)[0];
  if (!first || first.length < 3) return text;
  const safe = first.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}])${safe}(?![\\p{L}])`, "giu"), "{isim}");
}

/** Cevabın sonunu kelime sınırında keser (ortadan bölmez). */
function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/**
 * Bir host cevabına EN YAKIN ÖNCEKİ misafir mesajını bulur.
 *
 * ⚠️ BU BİR YAKINLIK ÇIKARIMIDIR, KAYIT DEĞİL. `Message.replyToMessageId` YOK
 * (CLAUDE.md'de açık iş). `quality-audit.ts:195-200` ile AYNI kural: `lte` +
 * `id` kopma noktası — QR'da misafir ve bot satırı AYNI TX'te yazıldığı için
 * damgalar eşit olabilir ve `lt` misafir mesajını ELERDİ.
 */
function precedingGuestMessage(all: HistoryMessage[], answer: HistoryMessage): HistoryMessage | null {
  let best: HistoryMessage | null = null;
  for (const m of all) {
    if (m.conversationId !== answer.conversationId) continue;
    if (m.direction !== "inbound") continue;
    if (!m.body || !m.body.trim()) continue;
    const t = m.createdAt.getTime();
    const at = answer.createdAt.getTime();
    if (t > at || (t === at && m.id >= answer.id)) continue;
    if (!best) { best = m; continue; }
    const bt = best.createdAt.getTime();
    if (t > bt || (t === bt && m.id > best.id)) best = m;
  }
  return best;
}

/**
 * Host'un geçmiş cevaplarından KB ÖNERİLERİ üretir.
 *
 * Hiçbir şey yazmaz. Boş girdi → boş çıktı. Deterministik (aynı girdi → aynı çıktı).
 */
export function buildKbSuggestionsFromHistory(
  messages: readonly HistoryMessage[],
  conversations: readonly HistoryConversation[] = [],
  opts: BuildOptions = {},
): KbSuggestionFromHistory[] {
  const minOcc = opts.minOccurrences ?? DEFAULT_MIN_OCCURRENCES;
  // 🚨 "Sorunlu" konuşmadaki cevap BİLGİ SAYILMAZ: o konuşma bir şikâyetle
  // sonuçlanmış demektir; oradaki cevap ya bir özür ya da tek seferlik bir
  // telafidir. Yanlış cevabın ÇOĞALMASI bu bacağın en büyük riski.
  const excluded = new Set(
    conversations.filter((c) => c.status === "problem").map((c) => c.id),
  );

  const all = [...messages];
  type Bucket = { answers: HistoryMessage[]; question: string };
  const buckets = new Map<string, Bucket>();

  for (const answer of all) {
    if (excluded.has(answer.conversationId)) continue;
    if (!isHostAuthored(answer)) continue;
    const question = precedingGuestMessage(all, answer);
    if (!question?.body) continue;

    const intent = classifyFallback(question.body).intent;
    const category = INTENT_TO_CATEGORY[intent];
    if (!category) continue;

    // Ayırıcı "|": cuid ve kategori adları bu karakteri İÇEREMEZ.
    const key = `${answer.propertyId}|${category}`;
    const b = buckets.get(key) ?? { answers: [], question: question.body };
    b.answers.push(answer);
    buckets.set(key, b);
  }

  const out: KbSuggestionFromHistory[] = [];
  for (const [key, b] of buckets) {
    if (b.answers.length < minOcc) continue;
    const [propertyId, category] = key.split("|");
    // 🚨 EN YENİ cevap önerilir, en SIK olan değil: host bir şeyi değiştirdiyse
    // (yeni wifi şifresi) eski cevabın çoğunlukta olması onu DOĞRU yapmaz.
    // Sayım yalnız "bu host'un yerleşik bilgisi mi" eşiği içindir.
    const sorted = [...b.answers].sort(
      (x, y) => y.createdAt.getTime() - x.createdAt.getTime() || y.id.localeCompare(x.id),
    );
    const newest = sorted[0];
    const guestName = opts.guestNamesByConversation?.[newest.conversationId];
    out.push({
      propertyId,
      category,
      answer: clip(maskGuestName(newest.body ?? "", guestName), SUGGESTION_MAX_CHARS),
      occurrences: b.answers.length,
      lastAnsweredAt: newest.createdAt,
      sourceMessageIds: sorted.map((m) => m.id),
      exampleQuestion: clip(b.question, 200),
    });
  }
  // Deterministik sıra: çok cevaplanan önce, sonra mülk/kategori adı.
  out.sort(
    (a, z) =>
      z.occurrences - a.occurrences ||
      a.propertyId.localeCompare(z.propertyId) ||
      a.category.localeCompare(z.category),
  );
  return out;
}
