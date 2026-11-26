// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ARAÇ SONUCU SÖZLEŞMESİ (`verifiedToolResults`, kurucu talimatı 09-07 "Dynamic fact authority").
//
// "Availability, reservation state, prices, payments, task state and executed actions may be stated only from
// verifiedToolResults. Knowledge-base records, RAG retrieval, conversation history and guest claims are not authoritative
// for live operational facts. stale/error/uncertain results must never become a definite answer."
//
// Bu dosya SAF (DB / ağ / saat yok). Bir araç sonucu:
//   · KİRACI KAPSAMLIDIR (org + mülk) — başka kiracının kaydı sonuçta "not_found"dur, asla "boş / müsait" değil;
//   · DURUM taşır: yalnız `ok` kesin bilgi sayılabilir; `stale` / `uncertain` / `error` / `not_found` / `invalid_request`
//     kesin cevaba DÖNÜŞEMEZ (`mayStateAsFact`);
//   · KANIT ve TAZELİK taşır (kapalı küme kodlar + `asOf`) — misafir metni / adı / iletişim / sır TAŞIMAZ;
//   · SÜRÜMLÜDÜR (`tool` + `toolVersion`) — ölçüm raporları ve izler hangi sözleşmeyle üretildiğini bilir.
//
// 🚨 Bu sözleşme bugün HİÇBİR isteme / misafir cevabına BAĞLI DEĞİL (talimat: "Do not activate these instructions until
// … contracts exist, are validated, and have red-first integration and mutation tests"). Bağlama ayrı dilim + kurucu onayı.
// ---------------------------------------------------------------------------

export type ToolStatus = "ok" | "stale" | "uncertain" | "error" | "not_found" | "invalid_request";

export const TOOL_STATUSES: readonly ToolStatus[] = ["ok", "stale", "uncertain", "error", "not_found", "invalid_request"];

export interface VerifiedToolResult<T> {
  tool: string;
  toolVersion: number;
  status: ToolStatus;
  /** Sonucun üretildiği an (ISO). Tazelik kararı araç içinde verilir; tüketici yeniden yorumlamaz. */
  asOf: string;
  scope: { organizationId: string; propertyId: string | null };
  /** Yalnız `ok` ve kısmen `stale` / `uncertain` iken dolu olabilir; `error` / `not_found` / `invalid_request` → null. */
  value: T | null;
  /** Kapalı küme kanıt / gerekçe kodları (PII YOK). */
  reasons: readonly string[];
}

/**
 * Bu sonuç misafire KESİN bilgi olarak söylenebilir mi? Kural: yalnız `ok` (+ değer var) VE sonuç ZORUNLU beklenen kapsam
 * (kiracı + mülk) için üretilmiş olmalı (tur 4: isteğe bağlı kapsam kapsamsız çağrıya izin veriyordu) (inceleme 10-09: B mülkünün sonucu A mülkü hakkındaki cevaba dayanak olamaz).
 */
export function mayStateAsFact(
  r: Pick<VerifiedToolResult<unknown>, "status" | "value"> & Partial<Pick<VerifiedToolResult<unknown>, "scope">>,
  expected: { organizationId: string; propertyId: string | null },
): boolean {
  if (r.status !== "ok" || r.value === null) return false;
  if (r.scope?.organizationId !== expected.organizationId || r.scope?.propertyId !== expected.propertyId) return false;
  return true;
}
