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
  /**
   * Öneriyi doğuran host mesajlarının kimlikleri (iz; PII taşımaz).
   *
   * 🚨 SUNUCUDA KALIR. Rota bunu HTTP gövdesine KOYMAZ (dış denetim 09-18,
   * bulgu 10): hiçbir yüzey okumuyordu, yani saf artık yüktü.
   */
  sourceMessageIds: string[];
  /** Misafirin o soruyu nasıl sorduğu — host'a BAĞLAM olarak gösterilir. */
  exampleQuestion: string;
  /**
   * Cevapta kalmış olabilecek hassas sınıflar (`email` · `phone` · `iban` ·
   * `idNumber`). BOŞ DEĞİLSE öneri host'a "içinde kişisel/tek kullanımlık bilgi
   * olabilir" uyarısıyla gösterilir ve tek tıkla eklenemez.
   */
  sensitiveClasses: string[];
}

export interface BuildOptions {
  minOccurrences?: number;
  /** Misafir adları; cevabın içinde geçerlerse `{isim}` yer tutucusuna çevrilir. */
  guestNamesByConversation?: Readonly<Record<string, string | null | undefined>>;
  /**
   * AI'nın ZATEN okuyabildiği KB kalemleri (`propertyId` + `category`).
   *
   * 🚨 DIŞ DENETİM 09-18, BULGU 2: rota bu listeyi çekiyordu ama YALNIZ şablon
   * bacağına veriyordu. Sonuç ölçüldü: host öneriyi ekleyip "Yeniden tara"
   * deyince AYNI öneri geri geliyor; ikinci kez eklenirse aynı mülk+kategoride
   * ÇELİŞKİLİ iki aktif kalem oluşuyor ve retrieval'ın çelişki koruması
   * misafire kesin cevap VERMİYOR — yani öneriyi kabul etmek ürünü bozuyordu.
   */
  existingKb?: readonly { propertyId: string; category: string }[];
  /** Soru↔cevap azami boşluk (test edilebilirlik; varsayılan `PAIR_MAX_GAP_MS`). */
  maxPairGapMs?: number;
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
  const full = (guestName ?? "").trim().replace(/\s+/gu, " ");
  if (!full) return text;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const sub = (input: string, needle: string) =>
    input.replace(new RegExp(`(?<![\\p{L}])${esc(needle)}(?![\\p{L}])`, "giu"), "{isim}");

  let out = text;
  // 🚨 ÖNCE TAM AD: "Li Wei" gibi iki harfli parçalardan kurulu adlar tek tek
  // maskelenemez (yanlış ikame riski) ama BİRLİKTE ayırt edicidir. Ölçüm
  // (09-18 ajanı): eski kod 2 harfli adda maskelemeyi KOMPLE kapatıyordu.
  const parts = full.split(" ");
  if (parts.length > 1 && full.length >= 3) out = sub(out, full);
  // 🚨 SONRA HER PARÇA: eski kod YALNIZ İLK kelimeyi alıyordu → soyadı ve
  // ikinci ön ad ("Ömer Faruk Tan" → yalnız "Ömer") açıkta kalıyordu.
  // Tek tek maskelemede 3 harf alt sınırı KORUNUR ("Al bunu." bozulmasın).
  for (const p of parts) if (p.length >= 3) out = sub(out, p);
  return out;
}

/**
 * Cevapta KALMIŞ olabilecek hassas içerik SINIFLARI (redakte EDİLMEZ, İŞARETLENİR).
 *
 * 🚨 NEDEN SİLMİYORUZ (ölçülmüş): bu bacağın İŞİ host'un "wifi şifresi X" gibi
 * cümlelerini bilgiye çevirmektir — sır silen bir filtre ürünün kendisini siler.
 * Mevcut `withoutSecretKbItems` de yanlış araç: o kalemi KOMPLE ELER ve ölçümde
 * 25 metnin yalnız 5'ini yakaladı (biri kazara), yani ne kapatıyor ne koruyor.
 * Doğru desen `kb-manager`'daki "Doldurulmamış alan" rozetinin aynısı: UYARIYI
 * KARARIN VERİLECEĞİ YERE koy, içeriği bozma.
 *
 * ⚠️ Kişi ADLARI burada YOK ve olamaz: üçüncü kişilerin adlarını (komşu,
 * görevli, ÖNCEKİ MİSAFİR) hiçbir katman bilmiyor. Bilinen sınır.
 */
const SENSITIVE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["email", /[\w.+-]+@[\w-]+\.[\w.]{2,}/u],
  // Uluslararası ya da yerel biçim; en az 10 hane, ayırıcılara toleranslı.
  ["phone", /(?:\+|00)?\d[\d\s().-]{8,}\d/u],
  ["iban", /\bTR\s?\d{2}[\s\d]{16,}/iu],
  // Rezervasyon / takip / kimlik gibi uzun kimlik dizileri.
  ["idNumber", /\b(?=[A-Z0-9-]{8,})(?:[A-Z]+\d|\d+[A-Z])[A-Z0-9-]*\b/u],
];

export function sensitiveClassesIn(text: string): string[] {
  const out: string[] = [];
  for (const [name, re] of SENSITIVE_PATTERNS) if (re.test(text)) out.push(name);
  return out;
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
 * Soru ile cevap arasında kabul edilen EN BÜYÜK boşluk.
 *
 * 🚨 DIŞ DENETİM 09-18, BULGU 1c: hiçbir zaman sınırı YOKTU. Ölçülen kusur —
 * host'un çıkıştan GÜNLER sonra attığı PROAKTİF mesaj ("Değerlendirme bırakır
 * mısınız?"), arada misafir mesajı olmadığı için günler önceki soruyla
 * eşleşiyordu. 12 saat "aynı gün / ertesi sabah" cevaplarını korur, proaktif
 * mesajı eler. Değer BİR SEÇİMDİR, ölçüm değil — iki yönü de test-pinli.
 */
export const PAIR_MAX_GAP_MS = 12 * 60 * 60 * 1000;

/** Eşleştirilmiş bir "soru → cevap" OLAYI (konuşma başına birden çok olabilir). */
interface AnswerEvent {
  conversationId: string;
  propertyId: string;
  category: string;
  /** Peş peşe host mesajlarının BİRLEŞİK gövdesi. */
  answer: string;
  /** Bu olayın KENDİ sorusu (gösterilen çift gerçek çift olsun diye). */
  question: string;
  at: Date;
  ids: string[];
}

/**
 * Konuşmayı soldan sağa yürüyerek GERÇEK soru→cevap olaylarını çıkarır.
 *
 * ⚠️ BU BİR ÇIKARIMDIR, KAYIT DEĞİL — `Message.replyToMessageId` YOK (CLAUDE.md
 * açık iş). O yüzden yön FAIL-CLOSED: belirsizse olay ÜRETİLMEZ. Öneri kaybı
 * ucuzdur, yanlış kategoride ONAYLI BİLGİ pahalıdır.
 *
 * Üç kural (üçü de ölçülmüş kusurdan doğdu):
 *  ① **Peş peşe giden mesajlar TEK cevaptır.** Host cevabı iki mesaja bölerse
 *     eskiden İKİ TEKRAR sayılıyor ve `minOccurrences=2` eşiği TEK OLAYLA
 *     geçiliyordu. Gövdeler birleştirilir (bilgi kaybolmaz), olay bir sayılır.
 *  ② **Bekleyen misafir bloğu TEK bilgi kategorisi göstermeli.** "Wifi şifresi?"
 *     + "Otopark var mı?" → host tek cevap yazarsa hangisini cevapladığı
 *     BİLİNEMEZ; eski kod "en yakın önceki"yi alıp wifi şifresini `parking`
 *     kategorisine yazıyordu. İki aday → olay DÜŞER. Selamlama gibi
 *     kategorisiz mesajlar aday SAYILMAZ, yani "Merhaba + wifi şifresi?"
 *     yaygın hâli korunur.
 *  ③ **Araya giren HER giden mesaj bekleyen bloğu TÜKETİR.** AI cevapladıysa
 *     sonraki host mesajı o sorunun cevabı sayılamaz.
 */
function extractAnswerEvents(
  messages: readonly HistoryMessage[],
  excluded: ReadonlySet<string>,
  maxGapMs: number,
): AnswerEvent[] {
  const byConv = new Map<string, HistoryMessage[]>();
  for (const m of messages) {
    if (excluded.has(m.conversationId)) continue;
    const list = byConv.get(m.conversationId);
    if (list) list.push(m);
    else byConv.set(m.conversationId, [m]);
  }

  const events: AnswerEvent[] = [];
  for (const rows of byConv.values()) {
    // Deterministik sıra; eşit damgada `id` kopma noktası (QR'da misafir ve bot
    // satırı aynı TX'te yazılabiliyor — `quality-audit.ts` ile aynı kural).
    rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

    let pending: HistoryMessage[] = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].direction === "inbound") {
        if (rows[i].body?.trim()) pending.push(rows[i]);
        i += 1;
        continue;
      }
      // ① Giden mesajların peş peşe giden TÜM dizisi tek bir cevap olayıdır.
      const group: HistoryMessage[] = [];
      while (i < rows.length && rows[i].direction !== "inbound") {
        group.push(rows[i]);
        i += 1;
      }
      const parts = group.filter(isHostAuthored);
      const block = pending;
      pending = []; // ③ blok her hâlükârda tüketilir (AI cevabı da tüketir).
      if (!parts.length || !block.length) continue;

      // ② Bekleyen blokta KAÇ FARKLI bilgi kategorisi var? Son geçen kazanır
      // (cevaba en yakın olan), ama SAYI birden büyükse olay düşer.
      const candidates = new Map<string, HistoryMessage>();
      for (const q of block) {
        const category = INTENT_TO_CATEGORY[classifyFallback(q.body!).intent];
        if (category) candidates.set(category, q);
      }
      if (candidates.size !== 1) continue;
      const [category, question] = [...candidates][0];

      const gap = parts[0].createdAt.getTime() - question.createdAt.getTime();
      if (gap < 0 || gap > maxGapMs) continue;

      const last = parts[parts.length - 1];
      events.push({
        conversationId: last.conversationId,
        propertyId: last.propertyId,
        category,
        answer: parts.map((p) => (p.body ?? "").trim()).filter(Boolean).join("\n"),
        question: question.body!,
        at: last.createdAt,
        ids: parts.map((p) => p.id),
      });
    }
  }
  return events;
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

  const events = extractAnswerEvents(messages, excluded, opts.maxPairGapMs ?? PAIR_MAX_GAP_MS);

  // Ayırıcı "|": cuid ve kategori adları bu karakteri İÇEREMEZ.
  const keyOf = (propertyId: string, category: string) => `${propertyId}|${category}`;
  const taken = new Set((opts.existingKb ?? []).map((k) => keyOf(k.propertyId, k.category)));

  const buckets = new Map<string, AnswerEvent[]>();
  for (const e of events) {
    const key = keyOf(e.propertyId, e.category);
    // 🚨 AI'nın ZATEN okuyabildiği kalem varsa öneri üretilmez (bulgu 2).
    if (taken.has(key)) continue;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }

  const out: KbSuggestionFromHistory[] = [];
  for (const [key, list] of buckets) {
    // 🚨 EŞİK KONUŞMA SAYAR, MESAJ DEĞİL (bulgu 1b). "Bu host'un yerleşik
    // bilgisi mi" sorusunun anlamlı olması için farklı MİSAFİRLERE tekrar
    // edilmiş olması gerekir; aynı konuşmadaki iki cümle tek olaydır.
    const conversations = new Set(list.map((e) => e.conversationId));
    if (conversations.size < minOcc) continue;
    const [propertyId, category] = key.split("|");
    // 🚨 EN YENİ cevap önerilir, en SIK olan değil: host bir şeyi değiştirdiyse
    // (yeni wifi şifresi) eski cevabın çoğunlukta olması onu DOĞRU yapmaz.
    const sorted = [...list].sort(
      (x, y) => y.at.getTime() - x.at.getTime() || y.ids[0].localeCompare(x.ids[0]),
    );
    const newest = sorted[0];
    const guestName = opts.guestNamesByConversation?.[newest.conversationId];
    // 🚨 SORU DA MASKELENİR (bulgu 3): `exampleQuestion` misafirin KENDİ
    // metnidir ve cevapla aynı ekranda gösterilir; eskiden ham gidiyordu.
    const answer = clip(maskGuestName(newest.answer, guestName), SUGGESTION_MAX_CHARS);
    out.push({
      propertyId,
      category,
      answer,
      occurrences: conversations.size,
      lastAnsweredAt: newest.at,
      sourceMessageIds: sorted.flatMap((e) => e.ids),
      exampleQuestion: clip(maskGuestName(newest.question, guestName), 200),
      sensitiveClasses: sensitiveClassesIn(answer),
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
