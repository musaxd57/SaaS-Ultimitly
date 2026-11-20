// ---------------------------------------------------------------------------
// QR'DA BİRDEN ÇOK MİSAFİR MESAJINA TEK CEVAP — saf çekirdek (kurucu 11-20 öğlen F4-b; tasarım
// `docs/TASARIM-2026-11-20-qr-tek-cevap.md`; anahtar `GUEST_CHAT_TURN_MERGE_ENABLED` VARSAYILAN KAPALI).
//
// Kurucu (AYNEN): "kanal gibi olsun … 5 tane soru sormuşsa bile tek cevapta verebilir; ortalama uzunluk dağılımını iyi yap, 10 soru mesaj
// çok uzar o zaman 2'ye bölebilsin. İlk taslağı iptal etmek, ilk soruyu silmek demek olmasın. Wi-Fi cevabı zaten misafire gittiyse ikinci
// cevap yalnız otoparkı kapsasın. Her mesaja sabit üç saniye eklemeyelim. İkinci soru güvenle cevaplanamıyorsa onu açık tutalım; QR'da kısmi
// gönderimi bu değişiklikle gizlice açmayalım."
//
// Model: misafir satırı modelden ÖNCE yazılır ve "açık" işaret taşır; karar verilince (cevap / devir / sessiz kapanış) işaret "kararı
// verildi"ye döner. TUR = o an açık olan misafir satırları. İşaret satırın KENDİSİNDE (`Message.externalId` öneki — QR satırlarında bu alan
// boştu; `(conversationId, externalId)` tekilliği aynı istek kimliğinin ikinci satırını da engeller). Saat karşılaştırması yok.
//
// Bu dosya saf: veritabanı / ortam okuması yalnız anahtar yüklemi. Veritabanı yarısı `guest-chat-turn.ts`.
// ---------------------------------------------------------------------------

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function qrTurnMergeEnabled(): boolean {
  return process.env.GUEST_CHAT_TURN_MERGE_ENABLED === "1";
}

/** Kararı henüz verilmemiş misafir satırı. */
export const QR_TURN_OPEN_PREFIX = "qr-open:";
/** Kararı verilmiş misafir satırı (cevaplandı / ev sahibine bırakıldı / cevap gerekmedi). */
export const QR_TURN_DONE_PREFIX = "qr:";

export const qrTurnOpenId = (key: string) => `${QR_TURN_OPEN_PREFIX}${key}`;
export const qrTurnDoneId = (key: string) => `${QR_TURN_DONE_PREFIX}${key}`;

/** Satırın istek kimliği (iki işaretten biri); QR tur satırı değilse `null`. */
export function qrTurnKeyOf(externalId: string | null | undefined): string | null {
  if (!externalId) return null;
  if (externalId.startsWith(QR_TURN_OPEN_PREFIX)) return externalId.slice(QR_TURN_OPEN_PREFIX.length) || null;
  if (externalId.startsWith(QR_TURN_DONE_PREFIX)) return externalId.slice(QR_TURN_DONE_PREFIX.length) || null;
  return null;
}

export const isQrTurnOpen = (externalId: string | null | undefined) => Boolean(externalId?.startsWith(QR_TURN_OPEN_PREFIX));

/**
 * Açık satır bu kadar eskiyse SAHİPSİZDİR: onu işleyen istek öldü (süren bir istek saniyeler sürer; çalışan kilit 120 sn). Sahipsiz satır
 * yeni tura KATILMAZ (dünkü "yarın" bugünün cevabına karışmasın) ve sessizce de kalmaz: ev sahibine bırakılır.
 */
export const QR_TURN_FRESH_MS = 5 * 60_000;

/** Bir turda birleştirilecek en çok mesaj ve birleşik metnin en çok uzunluğu — aşılırsa tur modele gitmez, ev sahibine kalır. */
export const QR_TURN_MAX_MESSAGES = 10;
export const QR_TURN_MAX_CHARS = 8_000;

export interface QrTurnRowLike {
  id: string;
  body: string;
  createdAt: Date;
}

/**
 * Açık satırları (yazılış sırasıyla) tur + sahipsiz diye ayırır. Ölçü kendi satırının anı: ondan `QR_TURN_FRESH_MS`ten eski olan sahipsiz.
 * Kendi satırı her zaman turdadır.
 */
export function partitionQrTurn<T extends QrTurnRowLike>(open: readonly T[], own: { id: string; createdAt: Date }): { turn: T[]; stale: T[] } {
  const turn: T[] = [];
  const stale: T[] = [];
  for (const row of open) {
    if (row.id !== own.id && own.createdAt.getTime() - row.createdAt.getTime() > QR_TURN_FRESH_MS) stale.push(row);
    else turn.push(row);
  }
  return { turn, stale };
}

/**
 * Turun modele ve kapılara giden metni: mesajlar yazılış sırasıyla, satır sonuyla birleşik — misafir hepsini TEK mesajda yazmış gibi.
 * Yeni bir istem biçimi yok: çok sorulu tek mesajın bugünkü yolu (anlama, getirme, kapılar, dil) aynen işler.
 */
export function mergeQrTurnText(texts: readonly string[]): string {
  return texts.map((t) => t.trim()).filter(Boolean).join("\n");
}

/** Tur modele gidemeyecek kadar büyük mü (mesaj sayısı / birleşik uzunluk)? */
export function qrTurnTooLarge(texts: readonly string[]): boolean {
  return texts.length > QR_TURN_MAX_MESSAGES || mergeQrTurnText(texts).length > QR_TURN_MAX_CHARS;
}

export type QrTurnCommitVerdict =
  /** Bu istek hiçbir şey yazmaz: kendi satırının kararı başka istekte verildi ya da daha yeni mesajın isteği bütün turu kapsayacak. */
  | { action: "drop" }
  | {
      action: "commit";
      /** Kararı ŞİMDİ verilen satırlar (bu isteğin gördüğü ve hâlâ açık olanlar). */
      rowIds: string[];
      /** Cevap metni yazılır mı. */
      writeReply: boolean;
      /** Cevap yazılacaktı ama tur değişti → kalan satırlar ev sahibine bırakıldı. */
      heldInstead: boolean;
    };

/**
 * KAYIT ANI HÜKMÜ (konuşma kilidi altında okunan açık satırlarla). Kurallar:
 *  · Kendi satırı artık açık değil → başka bir istek onun kararını verdi → bırak.
 *  · DEVİR kararı ASLA düşmez (tehlike bildirimi daha yeni bir mesaj yüzünden kaybolmaz): gördüğü, hâlâ açık satırlar için yazılır.
 *    Daha yeni (görülmemiş) mesaj varsa ya da gördüğü satırlardan biri bu arada kapandıysa devirle birlikte gidecek METİN yazılmaz.
 *  · Cevap / sessiz kapanış: daha yeni açık mesaj varsa BAYAT → bırak (o mesajın isteği hepsini birlikte cevaplar; ilk soru silinmez,
 *    satırı açık kalır). Gördüğü satırlardan biri bu arada ev sahibine bırakıldıysa taslak onu da kapsıyordu → cevap gitmez, kalan
 *    satırlar ev sahibine kalır (kısmi gönderim açılmaz).
 */
export function qrTurnCommitVerdict(input: {
  ownId: string;
  /** Taslak / karar hazırlanırken görülen tur satırları. */
  seenIds: readonly string[];
  /** Kayıt anında açık olan satırlar. */
  openIds: readonly string[];
  hasReply: boolean;
  escalated: boolean;
}): QrTurnCommitVerdict {
  const open = new Set(input.openIds);
  if (!open.has(input.ownId)) return { action: "drop" };
  const seen = new Set(input.seenIds);
  const newer = input.openIds.some((id) => !seen.has(id));
  const rowIds = input.seenIds.filter((id) => open.has(id));
  const missing = rowIds.length !== input.seenIds.length;
  if (input.escalated) return { action: "commit", rowIds, writeReply: input.hasReply && !newer && !missing, heldInstead: false };
  if (newer) return { action: "drop" };
  if (missing) return { action: "commit", rowIds, writeReply: false, heldInstead: true };
  return { action: "commit", rowIds, writeReply: input.hasReply, heldInstead: false };
}

// ── UZUN CEVABI İKİ MESAJA BÖLME ───────────────────────────────────────────────────────────────────────────────────────────────────
//
// Ölçüm (`docs/olcum/` açık ölçüm dosyaları, misafire GİTMİŞ 2.350 cevap, 11-20): medyan 138 karakter, %90 229, %99 347, en uzun 556;
// cümle başına ~106 karakter; tek sorunun cevabı tipik 90–140 karakter. Beş sorunun cevabı ≈ 500–700 karakter → tek mesaj; on sorunun
// cevabı ≈ 1.000–1.400 → telefonda tek baloncuk ekranı aşar → iki mesaj. Eşik bu yüzden 700. Gönderim tavanı (2.000) aynen durur.
//
// Bölme yalnız SUNUMDUR: kapılar metnin tamamını tek parça görür, iki parça art arda aynı işlemde yazılır. Cümle ortasından bölünmez;
// sınır bulunamazsa bölünmez.

/** Bundan uzun cevap iki mesaja bölünür. */
export const QR_REPLY_SPLIT_OVER = 700;
/** Parçalardan hiçbiri bundan kısa kalmaz (üç satırlık kuyruk ayrı baloncuk olmasın). */
export const QR_REPLY_PART_MIN = 200;

const SENTENCE_END = new Set([".", "!", "?", "…", "؟", "。", "！", "？"]);
const isSpace = (ch: string | undefined) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === " ";
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
/** Küçük harfle başlayan devam ("vb. gibi") cümle başı değildir; büyük harf, rakam, harf olmayan işaret ve küçük/büyük ayrımı olmayan yazılar cümle başıdır. */
function startsSentence(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return !(ch.toLowerCase() === ch && ch.toUpperCase() !== ch);
}

/**
 * Cevabı en çok İKİ mesaja böler; kısa cevap ve uygun sınırı olmayan cevap tek parça döner. Sınır önceliği: boş satır > satır sonu >
 * cümle sonu; ortaya en yakın olan. Doğrusal tek geçiş (model metni; düzenli ifade yok).
 */
export function splitQrReply(text: string): string[] {
  const t = text.trim();
  if (t.length <= QR_REPLY_SPLIT_OVER) return [t];
  // Aday: `at` = ikinci parçanın başladığı konum; `rank` büyük = daha doğal sınır.
  const candidates: { at: number; rank: number }[] = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\n") {
      let j = i;
      let breaks = 0;
      while (j < t.length && isSpace(t[j])) {
        if (t[j] === "\n") breaks += 1;
        j += 1;
      }
      if (j < t.length) candidates.push({ at: j, rank: breaks >= 2 ? 3 : 2 });
      i = j - 1;
      continue;
    }
    if (SENTENCE_END.has(ch!) && isSpace(t[i + 1])) {
      // "1. Wi-Fi …" liste numarası cümle sonu değildir: nokta, satır başındaki 1–2 rakamdan hemen sonra geliyorsa.
      if (ch === "." && isDigit(t[i - 1])) {
        let k = i - 1;
        while (k >= 0 && isDigit(t[k])) k -= 1;
        if (i - 1 - k <= 2 && (k < 0 || t[k] === "\n")) continue;
      }
      let j = i + 1;
      let lineBreak = false;
      while (j < t.length && isSpace(t[j])) {
        if (t[j] === "\n") lineBreak = true;
        j += 1;
      }
      // Satır sonu varsa aday yukarıdaki dalda zaten üretilir (daha yüksek öncelikle).
      if (!lineBreak && j < t.length && startsSentence(t[j])) candidates.push({ at: j, rank: 1 });
    }
  }
  const mid = t.length / 2;
  const fits = (c: { at: number }) => {
    const left = t.slice(0, c.at).trimEnd().length;
    const right = t.length - c.at;
    return left >= QR_REPLY_PART_MIN && right >= QR_REPLY_PART_MIN;
  };
  const usable = candidates.filter(fits);
  if (usable.length === 0) return [t];
  // Ortadaki bantta (%35–%65) en doğal sınır; bantta aday yoksa ortaya en yakın olan.
  const inBand = usable.filter((c) => c.at >= t.length * 0.35 && c.at <= t.length * 0.65);
  const pool = inBand.length > 0 ? inBand : usable;
  // (Yayma işleciyle `Math.max(...)` çok adaylı metinde yığını taşırır — indirgeme.)
  const topRank = inBand.length > 0 ? pool.reduce((m, c) => (c.rank > m ? c.rank : m), 0) : null;
  const best = pool
    .filter((c) => topRank === null || c.rank === topRank)
    .reduce((a, b) => (Math.abs(b.at - mid) < Math.abs(a.at - mid) ? b : a));
  return [t.slice(0, best.at).trimEnd(), t.slice(best.at)];
}
