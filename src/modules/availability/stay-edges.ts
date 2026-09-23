// ---------------------------------------------------------------------------
// KONAKLAMA KENARLARI — müsaitlik motorunun ikinci ürün tüketicisi (yol planı ④, dilim 2).
//
// Soru: bir misafir "erken girebilir miyiz / geç çıkabilir miyiz / bir gece daha kalabilir miyiz"
// diye sorduğunda host neye bakmalı? Cevap konaklamanın KENARINDAKİ gecelerdir:
//   · giriş gününden ÖNCEKİ gece (erken giriş: o gece biri kalıyorsa sabah daire dolu),
//   · çıkış günü BAŞLAYAN gece (geç çıkış + bir gece uzatma: o gece yeni misafir giriyor mu),
//   · çıkıştan sonra kayıtlı İLK rezervasyon (uzatma için ne kadar pay var),
//   · konaklamanın KENDİ gecelerinde başka bir rezervasyon (çift rezervasyon).
//
// 🚨 YALNIZ HOST'A. Yapay zekâya BAĞLANMAZ (ayrı dilim + kurucu onayı: canlı gerçekler AI'ya yalnız
// kodun ürettiği `verifiedToolResults` ile gider). Bu modül cevap METNİ üretmez, misafire söz vermez.
//
// SAF: DB/ağ/saat yok (`now` girdide). Karar mantığı `checkAvailability` ile AYNIDIR — ikinci bir
// "müsait mi" kuralı YAZILMAZ; kenar gecesi motorun kendi aralık sorgusudur.
// ---------------------------------------------------------------------------

import {
  addNights,
  calendarDateOf,
  checkAvailability,
  describeNights,
  todayKey,
  type AvailabilityInput,
  type ClaimBasis,
  type NightKey,
  type UnknownReason,
} from "./core";

export type EdgeVerdict = "available" | "unavailable" | "unknown" | "not_applicable";

export interface EdgeAnswer {
  /** Bakılan gece (yarı açık tek gece: [night, night+1)). */
  night: NightKey;
  verdict: EdgeVerdict;
  /** `checkAvailability` ile aynı anlam; `not_applicable`de her zaman "unverified". */
  certainty: "verified" | "unverified";
  /** Gece doluysa: onaylı rezervasyon mu yoksa onay bekleyen talep mi. */
  blockedBy: "booked" | "held" | null;
  /** "Boş" denemediyse neden (motorun kapalı kümesi). */
  reasons: readonly UnknownReason[];
}

export interface StayEdges {
  arrival: NightKey;
  departure: NightKey;
  today: NightKey;
  /** Giriş gününden önceki gece — geçmişteyse `not_applicable`. */
  beforeArrival: EdgeAnswer;
  /** Çıkış günü başlayan gece. */
  afterDeparture: EdgeAnswer;
  /** Çıkıştan sonra `lookAheadNights` içinde iddia taşıyan İLK gece — kesinlikten bağımsız bir KAYIT olgusu. */
  nextKnown: { night: NightKey; kind: "booked" | "held"; basis: ClaimBasis; gapNights: number } | null;
  lookAheadNights: number;
  /** Konaklamanın kendi gecelerinde BAŞKA bir rezervasyonun iddiası (çift rezervasyon). */
  overlap: { firstNight: NightKey; nights: number } | null;
}

export const STAY_EDGE_LOOKAHEAD_NIGHTS = 14;

function edge(input: AvailabilityInput, night: NightKey): EdgeAnswer {
  const na: EdgeAnswer = { night, verdict: "not_applicable", certainty: "unverified", blockedBy: null, reasons: [] };
  // Geçmiş gece (`starts_in_past`) ya da ufuk dışı gece motorun kendi aralık kuralıyla reddedilir →
  // "sorulamaz". İkinci bir "geçmiş mi" kontrolü YAZILMAZ (mutasyon turu: eşdeğer, ölü koddu).
  const r = checkAvailability(input, { from: night, to: addNights(night, 1) });
  if (!r.ok) return na;
  const n = r.value.nights[0];
  const blockedBy = n.state === "booked" || n.state === "held" ? n.state : null;
  return { night, verdict: r.value.verdict, certainty: r.value.certainty, blockedBy, reasons: n.unknownReasons };
}

/**
 * `input` en az [giriş−1, çıkış+lookAhead) aralığı için yüklenmiş olmalıdır; değilse motorun
 * `outside_loaded_range` kuralı boş görünen geceyi "bilinmiyor" yapar (sessizce "boş" DEMEZ).
 * Sıfır ya da ters konaklamada `null` (hakkında dürüst söylenecek bir şey yok).
 */
export function describeStayEdges(
  input: AvailabilityInput,
  stay: { id: string; arrival: Date; departure: Date },
  opts: { lookAheadNights?: number } = {},
): StayEdges | null {
  const look = opts.lookAheadNights ?? STAY_EDGE_LOOKAHEAD_NIGHTS;
  const arrival = calendarDateOf(stay.arrival, input.timeZone).key;
  const departure = calendarDateOf(stay.departure, input.timeZone).key;
  if (!(arrival < departure)) return null;
  const today = todayKey(input.now, input.timeZone);
  // Misafirin KENDİ satırı kenar/örtüşme hesabına girmez (kendisiyle "çakışmasın").
  const others: AvailabilityInput = { ...input, reservations: input.reservations.filter((r) => r.id !== stay.id) };

  let nextKnown: StayEdges["nextKnown"] = null;
  const ahead = describeNights(others, { from: departure, to: addNights(departure, look) }, { allowPast: true });
  if (ahead.ok) {
    const i = ahead.value.nights.findIndex((n) => n.claims.length > 0);
    if (i >= 0) {
      const n = ahead.value.nights[i];
      // Birden çok iddia varsa en güçlü kanıt raporlanır (host_asserted/fresh > unconfirmed).
      const basis = n.claims.find((c) => c.basis !== "unconfirmed")?.basis ?? n.claims[0].basis;
      nextKnown = { night: n.night, kind: n.state === "held" ? "held" : "booked", basis, gapNights: i };
    }
  }

  let overlap: StayEdges["overlap"] = null;
  const own = describeNights(others, { from: arrival, to: departure }, { allowPast: true });
  if (own.ok) {
    const taken = own.value.nights.filter((n) => n.claims.length > 0);
    if (taken.length > 0) overlap = { firstNight: taken[0].night, nights: taken.length };
  }

  return {
    arrival,
    departure,
    today,
    beforeArrival: edge(others, addNights(arrival, -1)),
    afterDeparture: edge(others, departure),
    nextKnown,
    lookAheadNights: look,
    overlap,
  };
}

// ---------------------------------------------------------------------------
// HOST METNİ — sade, teknik sözcük yok ("kaynak/senkron/kanıt" yok). "Müsait/kiralanabilir"
// DENMEZ: köprü takvim bloklarını ve minimum konaklama kurallarını bilmez; en güçlü ifade
// "bağlı takvimlerinizde boş"tur.
// ---------------------------------------------------------------------------

const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

export function formatNightTr(key: NightKey): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS_TR[m - 1]}`;
}

const REASON_TEXT: Partial<Record<UnknownReason, string>> = {
  no_coverage_sources: "Bu daireye bağlı bir takvim yok.",
  source_error: "Takvim bağlantısında hata var.",
  source_never_synced: "Takvim bağlantısı henüz hiç okunmadı.",
  source_stale: "Takvim bağlantısı bir süredir güncellenmedi.",
  source_freshness_unrecorded: "Rezervasyonların en son ne zaman güncellendiğini bilmiyoruz.",
  load_truncated: "Bu daire için çok fazla kayıt var; tamamına bakılamadı.",
  anomalous_claim: "Takvimde tarihleri hatalı bir kayıt var.",
};

export type StayEdgeTone = "ok" | "warn" | "info";
export interface StayEdgeLine {
  tone: StayEdgeTone;
  text: string;
}
export interface StayEdgeSummary {
  lines: StayEdgeLine[];
  /** Kesinlik eksikse TEK açıklama satırı (her satırda tekrarlanmaz). */
  footer: string | null;
}

const CHECK_BEFORE_PROMISE = "Misafire söz vermeden önce kanal takviminden kontrol edin.";

function edgeLine(label: string, e: EdgeAnswer): StayEdgeLine | null {
  const when = `${formatNightTr(e.night)} gecesi`;
  switch (e.verdict) {
    case "not_applicable":
      return null;
    case "unavailable": {
      const what = e.blockedBy === "held" ? "onay bekleyen bir talep var" : "dolu";
      const stale = e.certainty === "verified" ? "" : " (kayıt güncel olmayabilir)";
      return { tone: "warn", text: `${label}: ${when} ${what}${stale}.` };
    }
    case "available":
      return { tone: "ok", text: `${label}: ${when} bağlı takvimlerinizde boş.` };
    case "unknown":
      return { tone: "info", text: `${label}: ${when} kayıtlı rezervasyon yok.` };
  }
}

/**
 * Konaklama kenarlarını host'a gösterilecek satırlara çevirir. Kesinlik eksikse satırlar olgu
 * söyler ("kayıtlı rezervasyon yok") ve TEK dipnot neden emin olunamadığını + ne yapılacağını yazar.
 */
export function summarizeStayEdges(s: StayEdges): StayEdgeSummary {
  const lines: StayEdgeLine[] = [];
  if (s.overlap) {
    lines.push({
      tone: "warn",
      text:
        s.overlap.nights === 1
          ? `Bu konaklamanın ${formatNightTr(s.overlap.firstNight)} gecesinde başka bir rezervasyon da var.`
          : `Bu konaklamanın ${s.overlap.nights} gecesinde başka bir rezervasyon da var (ilki ${formatNightTr(s.overlap.firstNight)}).`,
    });
  }
  const before = edgeLine("Erken giriş", s.beforeArrival);
  if (before) lines.push(before);
  const after = edgeLine("Geç çıkış / uzatma", s.afterDeparture);
  if (after) lines.push(after);
  if (s.nextKnown) {
    const held = s.nextKnown.kind === "held" ? " (onay bekleyen talep)" : "";
    lines.push({
      tone: "info",
      text:
        s.nextKnown.gapNights === 0
          ? `Sonraki kayıtlı rezervasyon çıkış günü başlıyor${held}.`
          : `Sonraki kayıtlı rezervasyon: ${formatNightTr(s.nextKnown.night)}${held} — arada ${s.nextKnown.gapNights} gece.`,
    });
  } else {
    lines.push({ tone: "info", text: `Çıkıştan sonraki ${s.lookAheadNights} gecede kayıtlı rezervasyon yok.` });
  }

  const unsure = [s.beforeArrival, s.afterDeparture].filter(
    (e) => e.verdict !== "not_applicable" && e.certainty === "unverified",
  );
  let footer: string | null = null;
  if (unsure.length > 0) {
    const reasons = unsure.flatMap((e) => e.reasons);
    const why = reasons.map((r) => REASON_TEXT[r]).find(Boolean) ?? "Kayıtların güncel olduğundan emin değiliz.";
    footer = `${why} ${CHECK_BEFORE_PROMISE}`;
  }
  return { lines, footer };
}
