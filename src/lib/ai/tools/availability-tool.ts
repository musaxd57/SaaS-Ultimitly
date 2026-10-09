import {
  AVAILABILITY_ENGINE_VERSION,
  checkAvailability,
  type AvailabilityAnswer,
  type AvailabilityInput,
  type InvalidReason,
} from "@/modules/availability/core";
import type { VerifiedToolResult } from "./contract";

// ---------------------------------------------------------------------------
// MÜSAİTLİK ARACI — deterministik müsaitlik motorunun (`modules/availability`) `VerifiedToolResult` biçimi.
//
// Eşleme (motorun kendi kararından; ikinci bir müsaitlik mantığı YOK):
//   · aralık geçersiz                                   → invalid_request (+ motorun nedeni)
//   · mülk bu kiracıda yok                              → not_found (asla "müsait" değil)
//   · verdict available + certainty verified (motor: her kaynak taze) → ok
//   · verdict unavailable + verified → ok YALNIZ ev sahibinin kendi girişi bir geceyi kapatıyorsa ya da bütün kaynaklar tazeyse;
//     aksi hâlde stale (`claim_from_stale_source`, inceleme 10-09 P1)
//   · bir gece bayat / hiç okunmamış / tazeliği kayıtsız kaynağa dayanıyor → stale
//   · diğer her şey (bilinmeyen gece, kanıtsız işgal, hata, kısmi okuma) → uncertain
// Değer PII taşımaz: karar, kesinlik, aralık, gece sayıları, çakışma sayısı, bilinmeme nedenleri.
// ---------------------------------------------------------------------------

export const AVAILABILITY_TOOL = "availability.check" as const;
/** Araç SÖZLEŞMESİNİN sürümü (durum eşlemesi değişince artar); motorun kendi sürümü değerde `engineVersion`. */
export const AVAILABILITY_TOOL_VERSION = 2 as const;

export interface AvailabilityToolValue {
  verdict: AvailabilityAnswer["verdict"];
  certainty: AvailabilityAnswer["certainty"];
  from: string;
  to: string;
  nights: number;
  freeNights: number;
  blockedNights: number;
  unknownNights: number;
  conflictCount: number;
  engineVersion: typeof AVAILABILITY_ENGINE_VERSION;
}

const STALE_REASONS = new Set(["source_stale", "source_never_synced", "source_freshness_unrecorded"]);

export type AvailabilityToolInput =
  | { kind: "loaded"; input: AvailabilityInput }
  | { kind: "property_not_found" };

/** SAF eşleme: motor girdisi (ya da "mülk yok") + aralık → araç sonucu. */
export function availabilityToolResult(
  organizationId: string,
  propertyId: string,
  loaded: AvailabilityToolInput,
  range: { from: string; to: string },
  now: Date,
): VerifiedToolResult<AvailabilityToolValue> {
  const base = {
    tool: AVAILABILITY_TOOL,
    toolVersion: AVAILABILITY_TOOL_VERSION,
    asOf: now.toISOString(),
    scope: { organizationId, propertyId },
  };
  if (loaded.kind === "property_not_found") {
    return { ...base, status: "not_found", value: null, reasons: ["property_not_in_organization"] };
  }
  const r = checkAvailability(loaded.input, range);
  if (!r.ok) {
    return { ...base, status: "invalid_request", value: null, reasons: [r.reason satisfies InvalidReason] };
  }
  const a = r.value;
  const free = a.nights.filter((n) => n.state === "free").length;
  const blocked = a.nights.filter((n) => n.state === "booked" || n.state === "held").length;
  const unknown = a.nights.filter((n) => n.state === "unknown").length;
  const unknownReasons = [...new Set(a.nights.flatMap((n) => n.unknownReasons))].sort();
  const value: AvailabilityToolValue = {
    verdict: a.verdict,
    certainty: a.certainty,
    from: a.range.from,
    to: a.range.to,
    nights: a.range.nights,
    freeNights: free,
    blockedNights: blocked,
    unknownNights: unknown,
    conflictCount: a.conflicts.length,
    engineVersion: a.engineVersion,
  };
  // 🚨 "Dolu" kesinliği (inceleme 10-09, P1): motor bir besleme satırını kaynağın SON başarılı okumasında görüldüyse "taze"
  // sayıyor ama o okumanın ne kadar eski olduğuna bakmıyor — 10 saat önce görülen ve sonra iptal edilmiş bir konaklama kesin
  // "dolu" çıkıyordu. Araç kuralı: ev sahibinin KENDİ girişi bir geceyi kapatıyorsa kesin; değilse bütün kaynaklar taze olmalı.
  // ("boş" kararı motorda zaten her kaynağın taze olmasını ister.)
  const hostBlocked = a.nights.some((n) => (n.state === "booked" || n.state === "held") && n.claims.some((c) => c.basis === "host_asserted"));
  const allSourcesFresh = a.sources.every((src) => src.state === "fresh");
  const definite = a.certainty === "verified" && a.verdict !== "unknown" && (a.verdict === "available" || hostBlocked || allSourcesFresh);
  if (definite) {
    return { ...base, status: "ok", value, reasons: a.conflicts.length > 0 ? ["conflict_present"] : [] };
  }
  if (a.verdict === "unavailable" && a.certainty === "verified") {
    return { ...base, status: "stale", value, reasons: ["claim_from_stale_source"] };
  }
  const stale = unknownReasons.some((x) => STALE_REASONS.has(x));
  const reasons = unknownReasons.length > 0 ? unknownReasons : ["unconfirmed_claims"];
  return { ...base, status: stale ? "stale" : "uncertain", value, reasons };
}
