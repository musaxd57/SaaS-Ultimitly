// ---------------------------------------------------------------------------
// CEVAP DİLİ HEDEFİ — TEK DEĞER (gölge; kurucu 11-20 öğlen-2 konu 1, Codex görüşü + Fable önerisi; K1-1 kurucu cevabı bekliyor).
// Tasarım `docs/TASARIM-2026-11-20-cevap-dili-hedefi.md`. Anahtar `AI_REPLY_LANGUAGE_SHADOW_ENABLED` (yalnız "1", VARSAYILAN KAPALI):
// açıkken YALNIZ gölge kaydı yazılır — istem, dil kapısı ve koddan kurulan metin bugünkü değerlerini kullanmaya devam eder.
//
// SORUN (kodda okundu): "misafire hangi dilde cevap verilecek" sorusunu bugün ÜÇ yer ayrı ayrı cevaplıyor:
//   · istem           — `guestTurnLanguage(son mesaj, cevapsızlar)` (kod eminse dil satırı yazılır);
//   · dil kapısı      — kanal: `gateGuestLanguage(kod, modelin beyanı, metinler)` · QR: kod, değilse anlama katmanı / model ipucu;
//   · koddan metin    — kanal: `guestTurnLanguage` · QR: `confidentLanguage(mesaj)`; selam: kod, değilse modelin beyanı.
// Üçü çoğu zaman aynı sonucu verir ama aynı DEĞERİ okumaz: kod emin değilken istem dil satırı yazmaz, kapı modelin beyanını kullanır, kod
// metni İngilizceye düşer. Ayrıca üç ayrı kavram tek değişkende: mesajın YAZILDIĞI dil ≠ misafirin İSTEDİĞİ cevap dili ("Could you please
// answer in Turkish?" → yazıldığı dil İngilizce, istenen cevap dili Türkçe).
//
// HEDEF: tur başına TEK değer + nereden geldiği. Öncelik (Codex'in sırası; ülke / ad / milliyet HİÇBİR adımda girdi değildir):
//   1. açık cevap dili tercihi — ANLAM kararıdır, sözcük listesiyle verilmez (kurucu 11-18): anlama katmanı okur. Bu dilimde girdi
//      alanı hazır (`explicitPreference`), okuyucu henüz yok → hep `null`; sözcük ağı yalnız "bu mesajda dil isteği OLABİLİR" adayını
//      işaretler ve o durumda hedef BELİRSİZ kalır (yanlış dile kilitlenmez).
//   2. son anlamlı mesajın dili — kod eminse kod; değilse anlama katmanının dili, misafirin kendi metninde izi varsa.
//   3. bu turun cevapsız mesajlarının birlikte dili (kod).
//   4. modelin beyanı, misafirin metninde izi varsa (bugünkü kapı kuralı).
// "OK", emoji, adres, ad dili DEĞİŞTİRMEZ: bunlar kodda "emin değil"dir ve hiçbir adımı tetiklemez.
//
// YAPRAK + SAF: yalnız `language-signal.ts`in saf yüklemlerini çağırır.
// ---------------------------------------------------------------------------

import { confidentLanguage, languageEvidence, mentionsLanguageName, type ConfidentLanguage } from "./language-signal";

/** Yalnız tam "1" açar (`STRICT_ONE_FLAGS`). */
export function replyLanguageShadowEnabled(): boolean {
  return process.env.AI_REPLY_LANGUAGE_SHADOW_ENABLED === "1";
}

const SUPPORTED: ReadonlySet<string> = new Set<ConfidentLanguage>(["tr", "en", "de", "fr", "es", "ru", "ar"]);
const asLanguage = (v: string | null | undefined): ConfidentLanguage | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return SUPPORTED.has(s) ? (s as ConfidentLanguage) : null;
};

export const REPLY_LANGUAGE_SOURCES = ["explicit", "latest_code", "latest_understanding", "turn_code", "declared", "request_unread", "none"] as const;
export type ReplyLanguageSource = (typeof REPLY_LANGUAGE_SOURCES)[number];

export interface ReplyLanguageTarget {
  /** Cevabın yazılacağı dil; `null` = belirsiz (istem eski kuralına döner, kapı dil yüzünden tutmaz). */
  language: ConfidentLanguage | null;
  source: ReplyLanguageSource;
}

export interface ReplyLanguageInput {
  /** Bu turun son misafir mesajı. */
  latest: string;
  /** Aynı turun önceki cevapsız misafir mesajları (yazılış sırasıyla). */
  pending?: readonly string[];
  /** Anlama katmanının okuduğu AÇIK cevap dili tercihi (okuyucu yokken `null`). */
  explicitPreference?: string | null;
  /** Anlama katmanının mesaj dili (katman koşmadıysa `null`). */
  understandingLanguage?: string | null;
  /** Cevap modelinin beyan ettiği dil. */
  declaredLanguage?: string | null;
}

/** Hedef dili ve kaynağını çöz (saf). */
export function resolveReplyLanguageTarget(input: ReplyLanguageInput): ReplyLanguageTarget {
  const pending = input.pending ?? [];
  const texts = [...pending, input.latest];
  const explicit = asLanguage(input.explicitPreference);
  if (explicit) return { language: explicit, source: "explicit" };
  // Mesaj bir dil İSTİYOR olabilir ama isteği okuyan katman yok: yazıldığı dile KİLİTLENMEZ ("answer in Turkish" İngilizce yazılır).
  if (mentionsLanguageName(input.latest)) return { language: null, source: "request_unread" };
  const latestCode = confidentLanguage(input.latest);
  if (latestCode) return { language: latestCode, source: "latest_code" };
  const evidence = languageEvidence(texts.join("\n"));
  const understood = asLanguage(input.understandingLanguage);
  if (understood && languageEvidence(input.latest).has(understood)) return { language: understood, source: "latest_understanding" };
  if (pending.length > 0) {
    const turn = confidentLanguage(texts.join("\n"));
    if (turn) return { language: turn, source: "turn_code" };
  }
  const declared = asLanguage(input.declaredLanguage);
  if (declared && evidence.has(declared)) return { language: declared, source: "declared" };
  return { language: null, source: "none" };
}

/** Bugün üç tüketicinin okuduğu değerler (çağıran kendi yolundaki GERÇEK değerleri verir — burada yeniden hesaplanmaz). */
export interface ReplyLanguageConsumers {
  prompt: ConfidentLanguage | null;
  gate: ConfidentLanguage | null;
  codeText: ConfidentLanguage | null;
}

export const REPLY_LANGUAGE_AGREEMENTS = ["same", "consumers_differ", "target_differs", "target_fills", "target_unsure"] as const;
export type ReplyLanguageAgreement = (typeof REPLY_LANGUAGE_AGREEMENTS)[number];

/**
 * Gölge kıyası: üç tüketici birbiriyle ve hedefle uyuşuyor mu.
 *  · consumers_differ — bugün üç yer AYNI turda farklı dil okuyor (dolu değerler arasında fark);
 *  · target_differs   — tüketiciler kendi içinde tutarlı ama hedef başka bir dil diyor;
 *  · target_fills     — bugün hiçbiri emin değil (hepsi boş), hedef bir dil veriyor;
 *  · target_unsure    — bugün bir dil okunuyor, hedef "belirsiz" diyor (ör. dil isteği adayı);
 *  · same             — hepsi aynı (ya da hepsi belirsiz).
 */
export function compareReplyLanguage(consumers: ReplyLanguageConsumers, target: ReplyLanguageTarget): ReplyLanguageAgreement {
  const values = [consumers.prompt, consumers.gate, consumers.codeText].filter((v): v is ConfidentLanguage => v !== null);
  const distinct = new Set(values);
  if (distinct.size > 1) return "consumers_differ";
  const current = values[0] ?? null;
  if (current === target.language) return "same";
  if (current === null) return "target_fills";
  if (target.language === null) return "target_unsure";
  return "target_differs";
}

/** Gölge kaydının kapalı biçimi (metin YOK: yalnız dil kodları ve kaynak). */
export function replyLanguageShadowDetail(
  input: ReplyLanguageInput,
  consumers: ReplyLanguageConsumers,
  target: ReplyLanguageTarget,
): { p: string | null; g: string | null; c: string | null; u: string | null; d: string | null; x: boolean; n: number; t: string | null; s: ReplyLanguageSource } {
  return {
    p: consumers.prompt,
    g: consumers.gate,
    c: consumers.codeText,
    u: asLanguage(input.understandingLanguage),
    d: asLanguage(input.declaredLanguage),
    x: mentionsLanguageName(input.latest),
    n: (input.pending ?? []).length,
    t: target.language,
    s: target.source,
  };
}
