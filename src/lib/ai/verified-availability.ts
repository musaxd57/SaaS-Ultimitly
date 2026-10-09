import { addNights, type NightKey } from "@/modules/availability/core";
import { foldTurkishAscii } from "@/lib/ai/fallback";
import { resolveGuestDates, type DateResolutionContext } from "@/lib/ai/date-resolution";
import { mayStateAsFact, type VerifiedToolResult } from "@/lib/ai/tools/contract";
import type { AvailabilityToolValue } from "@/lib/ai/tools/availability-tool";

// ---------------------------------------------------------------------------
// DOĞRULANMIŞ MÜSAİTLİK CEVABI (kurucu onayı 10-09: "doğrulanınca otomatik gitsin"; talimat 09-07 "Availability replies must be
// derived from verified availability-tool output. Before automatic sending, code must verify that every date and availability claim
// in the generated result matches the tool result.") — SAF, DB yok.
//
// Akış (yalnız SAF müsaitlik sorusu — uzatma / erken giriş / geç çıkış / tarih değişikliği ev sahibinin kararı, buraya GİRMEZ):
//   1. `availabilityQueryOf`: misafirin metninden tarih aralığı (tarih çözücü; yalnız `resolved`, 1 ya da 2 gün).
//   2. Çağıran aracı koşar (`runAvailabilityTool`) → yalnız `ok` sonuç istemde modele verilir (`verifiedAvailabilityPromptBlock`).
//   3. `replyMatchesVerifiedAvailability`: cevabın müsaitlik YÖNÜ araçla aynı, cevaptaki her tarih sorulan aralıkta, izin / eylem
//      sözü ("ayırdım", "kalabilirsiniz") yok → kapı `availability_claim`ı bu cevap için kaldırır (`availability-claims.ts`).
// Anahtar `AI_VERIFIED_AVAILABILITY_ENABLED` (tam "1"; VARSAYILAN KAPALI) — açma = eval + kurucu.
// ---------------------------------------------------------------------------

export const VERIFIED_AVAILABILITY_FLAG = "AI_VERIFIED_AVAILABILITY_ENABLED";
export function verifiedAvailabilityEnabled(): boolean {
  return process.env[VERIFIED_AVAILABILITY_FLAG] === "1";
}

export interface AvailabilityQuery {
  from: NightKey;
  /** Yarı açık: çıkış günü (son gece = to − 1). */
  to: NightKey;
}

export interface VerifiedAvailability {
  query: AvailabilityQuery;
  result: VerifiedToolResult<AvailabilityToolValue>;
}

/**
 * Misafirin sorduğu aralık: tek gün → o gece; iki gün → [ilk, son) (giriş – çıkış). Belirsiz / üç ve üstü gün / tarih yok → null
 * (tahmin yok; model netleştirme sorusu sorar, kapı eskisi gibi tutar).
 */
export function availabilityQueryOf(text: string | null | undefined, ctx: DateResolutionContext): AvailabilityQuery | null {
  const r = resolveGuestDates(text, ctx);
  if (r.status !== "resolved" || r.reasons.includes("past_date")) return null;
  if (r.dates.length === 1) return { from: r.dates[0], to: addNights(r.dates[0], 1) };
  if (r.dates.length === 2 && r.dates[0] < r.dates[1]) return { from: r.dates[0], to: r.dates[1] };
  return null;
}

// Yön sözlüğü (katlanmış metin). OLUMSUZLAR önce aranır ve silinir ("müsait değil" olumlu sayılmasın).
const NEGATIVE = [
  /\bmusait degil\w*/g,
  /\bbos degil\w*/g,
  /\buygun degil\w*/g,
  /\bdolu\w*/g,
  /\brezerve\w*/g,
  /\bnot available\b/g,
  /\bunavailable\b/g,
  /\b(?:fully )?booked\b/g,
  /\boccupied\b/g,
  /\bno availability\b/g,
  /\bnot free\b/g,
];
const POSITIVE = [/\bmusait\w*/, /\bbos\b/, /\bbostur\b/, /\buygun\w*/, /\bavailable\b/, /\bfree\b/, /\bvacant\b/];
/**
 * İzin / eylem sözü — doğrulanmış takvim BİLGİSİ bunları kapsamaz (rezervasyonu misafir platformda yapar; ev sahibinin adına
 * yer ayrılmaz). Tek kaynak buradaki dar liste; genel izin taraması `availability-claims.ts` GRANT_CLAIMS'te ayrıca durur.
 */
const ACTION_CLAIMS = [
  /\b(?:ayirdim|ayirdik|rezerve ettim|rezerve ettik|rezervasyonunuzu (?:yaptim|yaptik|olusturdum|olusturduk)|tuttum|tuttuk)\b/,
  /\bkalabilirsiniz\b/,
  /\b(?:i|we) (?:have )?(?:booked|reserved|held|blocked)\b/,
  /\byou can stay\b/,
];

export type AvailabilityPolarity = "available" | "unavailable" | "mixed" | "none";

export function replyAvailabilityPolarity(reply: string): AvailabilityPolarity {
  let t = foldTurkishAscii(reply).replace(/\s+/g, " ");
  let neg = false;
  for (const re of NEGATIVE) {
    if (re.test(t)) neg = true;
    t = t.replace(re, " ");
  }
  const pos = POSITIVE.some((re) => re.test(t));
  return neg && pos ? "mixed" : neg ? "unavailable" : pos ? "available" : "none";
}

export function replyHasActionClaim(reply: string): boolean {
  const t = foldTurkishAscii(reply).replace(/\s+/g, " ");
  return ACTION_CLAIMS.some((re) => re.test(t));
}

/**
 * Cevap doğrulanmış sonuçla BİREBİR uyumlu mu? Kural (hepsi):
 *  · araç sonucu `ok` ve beklenen kapsam (kiracı + mülk) — `mayStateAsFact`;
 *  · cevabın müsaitlik yönü araçla aynı (karışık / yönsüz cevap uyumlu SAYILMAZ);
 *  · cevapta adı geçen her gün sorulan aralıkta ([from, to] — çıkış günü dahil); başka tarih yok, belirsiz tarih yok;
 *  · izin / eylem sözü yok.
 */
export function replyMatchesVerifiedAvailability(
  reply: string | null | undefined,
  va: VerifiedAvailability,
  scope: { organizationId: string; propertyId: string },
  dateCtx: DateResolutionContext,
): boolean {
  if (typeof reply !== "string" || reply.trim() === "") return false;
  if (!mayStateAsFact(va.result, scope)) return false;
  const v = va.result.value;
  if (!v || (v.verdict !== "available" && v.verdict !== "unavailable")) return false;
  if (v.from !== va.query.from || v.to !== va.query.to) return false;
  if (replyHasActionClaim(reply)) return false;
  if (replyAvailabilityPolarity(reply) !== v.verdict) return false;
  const mentioned = resolveGuestDates(reply, dateCtx);
  if (mentioned.status === "ambiguous") return false;
  return mentioned.dates.every((k) => k >= va.query.from && k <= va.query.to);
}

/** İstem bloğu (YALNIZ `ok` sonuç). Misafir metni taşımaz; tarihler koddan. */
export function verifiedAvailabilityPromptBlock(va: VerifiedAvailability | null | undefined): string {
  const v = va?.result.value;
  if (!va || va.result.status !== "ok" || !v || (v.verdict !== "available" && v.verdict !== "unavailable")) return "";
  const state = v.verdict === "available" ? "MÜSAİT (bütün geceler boş)" : "DOLU (en az bir gece kapalı)";
  return `
════════════════════════════════════════════════════
DOĞRULANMIŞ TAKVİM SONUCU (kod az önce kontrol etti — bu mesaj için TEK yetkili kaynak)
════════════════════════════════════════════════════
Misafirin sorduğu aralık: ${va.query.from} giriş – ${va.query.to} çıkış (${v.nights} gece) → ${state}.
Yalnız bu aralık için bu sonucu kısa ve net söyle. Başka bir tarih için müsaitlik söyleme. Yer ayırdığını / rezervasyon yaptığını /
"kalabilirsiniz" gibi bir izin verdiğini SÖYLEME (rezervasyonu misafir kendisi yapar). Fiyat söyleme. Bu blok Bölüm 7.5'teki
"takvim doğrulanmadı" kuralının YERİNE geçer, ama YALNIZ yukarıdaki aralık için.`;
}
