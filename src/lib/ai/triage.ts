import "server-only";

// ---------------------------------------------------------------------------
// m48 — SORUNLU KONUŞMA TRİYAJI: tek yazma/okuma sözleşmesi
//
// Model escalate ederken `actionSuggestion` ("ne yapılmalı") ve `missingInfo`
// ("misafirden ne lazım") ZATEN üretiyordu; ikisi de hiçbir yere yazılmıyor,
// istek bitince yok oluyordu. Bu modül o ödenmiş analizi altı `Conversation`
// kolonuna yazmanın TEK yolu.
//
// 🚨 İKİNCİ MODEL ÇAĞRISI YOK ve OLMAYACAK. İkinci bir çağrı KIRPILMIŞ metinden,
// bilgi tabanı ve rezervasyon GÖRMEDEN koşar — yani birincisinden DAHA KÖTÜ bir
// analiz üretir, üstelik günlük AI kotasını harcayarak. Bu tasarımın tek fikri
// "zaten ödediğimizi saklamak".
//
// ⚠️ ÜÇ ÇAĞIRAN VAR, İKİ DEĞİL (kod-denetimi, 08-09):
//   1. `applyChannelAutoReply`   → kaynak "model"   (koşullu updateMany)
//   2. `sendDueAlerts`           → kaynak "keyword" (koşullu updateMany)
//   3. `applyInboundMessageRules`→ kaynak "keyword" (KOŞULSUZ update + ayrı
//      koşullu triyaj yazması). Bu üçüncüsü `classifyMessage` kullanıyor ve o
//      fonksiyonun gövdesi tek satır: `return classifyFallback(message)` — yani
//      MODEL HİÇ KOŞMUYOR. Kaynağı "model" yazmak arayüze yalan söyletirdi.
// ---------------------------------------------------------------------------

/** Triyajı üreten yol. Kapalı set — DB enum DEĞİL, kod-clamp (`riskType` emsali:
 *  yeni bir yol eklendiğinde migration gerekmesin). */
export const TRIAGE_SOURCES = ["model", "keyword"] as const;
export type TriageSource = (typeof TRIAGE_SOURCES)[number];

/** `missingInfo` sözleşmesi — `ai/index.ts`teki `sanitizeStringList(…, 5, 80)`
 *  ile BİREBİR aynı olmak ZORUNDA. İki farklı sınır, aynı verinin iki farklı
 *  kırpılmış hâlini üretir ve hangisinin doğru olduğu belirsizleşir. */
export const MISSING_INFO_MAX_ITEMS = 5;
export const MISSING_INFO_MAX_CHARS = 80;
/** Öneri metni sınırı — `ai/index.ts:287` ile aynı. Host'un ekranına basılıyor. */
export const ACTION_SUGGESTION_MAX_CHARS = 300;

/**
 * Modelin güvenini yazılabilir hâle getir.
 *
 * 🚨 `typeof x === "number"` YETMEZ: `NaN` ve `Infinity` o kapıdan GEÇER
 * (ikisinin de `typeof`'u `"number"`). Değer JSON'dan geliyor ve şemaca zorunlu
 * değil. Bozuk bir değer Postgres'e `double precision` olarak yazılır ve sonra
 * iki şey birden bozulur: arayüzde `%NaN` görünür ve ileride bir eşik
 * karşılaştırması (`aiConfidence < 0.5`) `NaN` ile DAİMA false döner — yani
 * "düşük güvenlileri işaretle" özelliği sessizce hiç çalışmaz.
 *
 * 0..1'e ayrıca clamp edilir: model 1.4 yazarsa arayüz "%140 güven" göstermez.
 * (Model çıktısı DAİMA daraltılır, asla olduğu gibi kabul edilmez — `riskType`
 * kod-clamp'inin aynısı.)
 */
export function clampConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Kapalı sete clamp — bilinmeyen değer NULL olur, uydurulmaz. */
export function clampTriageSource(value: unknown): TriageSource | null {
  return typeof value === "string" && (TRIAGE_SOURCES as readonly string[]).includes(value)
    ? (value as TriageSource)
    : null;
}

export function clampActionSuggestion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, ACTION_SUGGESTION_MAX_CHARS) : null;
}

/**
 * `missingInfo` listesini kolona yazılacak JSON string'e çevir.
 * Boş liste → NULL (boş dizi yazmak "analiz var ama boş" ile "analiz yok"u
 * karıştırırdı; kaynak kolonu zaten o ayrımı taşıyor).
 */
export function packMissingInfo(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, MISSING_INFO_MAX_ITEMS)
    .map((x) => x.slice(0, MISSING_INFO_MAX_CHARS));
  return items.length ? JSON.stringify(items) : null;
}

/**
 * Kolondan `string[]` oku — ASLA fırlatmaz.
 *
 * 🚨 Bu değer `/inbox` sayfasında okunuyor ve orası bir SERVER COMPONENT: orada
 * fırlayan bir istisna TÜM SAYFAYI 500'ler, yalnız o kartı değil. Yani kozmetik
 * bir alan gelen kutusunu komple indirebilirdi.
 *
 * Şekil doğrulaması da şart: JSON geçerli olup `{"a":1}` dönebilir ve `.map()`
 * o zaman patlar. Sessiz `catch {}` DEĞİL — `[]` dönmek burada DOĞRU davranış,
 * çünkü "eksik bilgi listesi yok" zaten geçerli bir durum.
 */
export function parseMissingInfo(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export interface TriageInput {
  source: TriageSource;
  /** Model yolunda dolu; kelime yollarında YOK (model hiç koşmadı). */
  actionSuggestion?: unknown;
  missingInfo?: unknown;
  confidence?: unknown;
  /** Triyajı tetikleyen mesajın id'si — bayatlık bunun üzerinden ölçülür. */
  triggerMessageId: string | null;
  /** Yazma anı. Test edilebilirlik için parametre; üretimde `new Date()`. */
  now: Date;
}

export interface TriageData {
  aiActionSuggestion: string | null;
  aiMissingInfoJson: string | null;
  aiConfidence: number | null;
  aiTriageSource: TriageSource | null;
  aiTriageTriggerMessageId: string | null;
  aiTriagedAt: Date;
}

/**
 * Altı kolonun yazılacak hâli.
 *
 * 🚨 HER ALAN AÇIKÇA YAZILIR — eksik alan `undefined` BIRAKILMAZ. Prisma
 * `undefined`i "bu kolona DOKUNMA" diye yorumlar; kelime yolunda analiz
 * alanlarını atlasaydık ÖNCEKİ escalation'ın model analizi hayatta kalır ve
 * arayüz onu YENİ analiz sanardı.
 *
 * ⚠️ "ATOMİK YENİLEME" İDDİASININ TAM HÂLİ (Codex düzeltmesi, 08-09) — eski
 * yazım "her escalation atomik yeniler" diyordu ve BİR İSTİSNAYI atlıyordu:
 *   · Yazma GERÇEKLEŞİRSE altı alan BİRLİKTE yenilenir. Kısmi güncelleme
 *     YAPISAL olarak imkânsızdır (tek `updateMany`, altı alan) — "üçü yeni,
 *     üçü eski" diye bir ara durum yoktur.
 *   · Yazma GERÇEKLEŞMEYEBİLİR. `applyInboundMessageRules` yolunda triyaj
 *     yazması tazelik çapasına koşulludur; çapa kaymışsa `count === 0` olur ve
 *     altı alan da ESKİ hâlinde kalır — üstelik `status` KOŞULSUZ yazıldığı
 *     için konuşma "problem" listesine girer. Yani DB'de "sorunlu ama analizi
 *     bir önceki mesaja ait" bir satır oluşabilir.
 *   · O durumda korumayı OKUMA YÜZEYİ üstlenir: `isTriageStale` tetikleyici
 *     mesajı mevcut son inbound mesajla karşılaştırır, uyuşmazsa satır BAYAT
 *     işaretlenir ve panel "Bu analizden sonra yeni mesaj geldi" rozetini
 *     çizer. Yani eski snapshot host'a GÜNCEL analiz gibi gösterilmez.
 * Zincirin tamamı `tests/integration/ai-triage-stale-window.test.ts`te
 * uçtan uca (gerçek fonksiyon + gerçek `count=0`) kanıtlı.
 */
export function buildTriageData(input: TriageInput): TriageData {
  return {
    aiActionSuggestion: clampActionSuggestion(input.actionSuggestion),
    aiMissingInfoJson: packMissingInfo(input.missingInfo),
    aiConfidence: clampConfidence(input.confidence),
    aiTriageSource: clampTriageSource(input.source),
    aiTriageTriggerMessageId: input.triggerMessageId,
    aiTriagedAt: input.now,
  };
}

/**
 * Triyaj BAYAT mı? (okuma yüzeyi için)
 *
 * Ölçü: tetikleyici mesaj ile konuşmanın SON inbound mesajı farklıysa bayat.
 * Fail-safe: id çözülemiyorsa (mesaj silinmiş/anonimleştirilmiş) `aiTriagedAt`
 * ile `lastMessageAt` karşılaştırılır; o da yoksa **bayat sayılır** —
 * bilinmeyenin güvenli yönü "bu tavsiyeye güvenme"dir.
 */
export function isTriageStale(args: {
  triggerMessageId: string | null;
  latestInboundMessageId: string | null;
  triagedAt: Date | null;
  lastMessageAt: Date | null;
}): boolean {
  if (args.triggerMessageId && args.latestInboundMessageId) {
    return args.triggerMessageId !== args.latestInboundMessageId;
  }
  if (args.triagedAt && args.lastMessageAt) {
    return args.lastMessageAt.getTime() > args.triagedAt.getTime();
  }
  return true;
}
