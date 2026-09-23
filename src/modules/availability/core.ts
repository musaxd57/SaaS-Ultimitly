import { dateKeyInTimeZone } from "@/lib/timezone";

// ---------------------------------------------------------------------------
// DETERMİNİSTİK MÜSAİTLİK MOTORU — SAF ÇEKİRDEK (yol planı ④, ilk dilim).
//
// Kurucu talimatı: müsaitlik ve rezervasyon durumu ASLA model hafızasından ya da RAG'den
// cevaplanmaz; kiracıya kapalı, KANIT ve TAZELİK döndüren deterministik bir araçtan gelir.
// Bu dosya o aracın kalbidir: veritabanı, ağ, saat YOK (`now` dışarıdan verilir) — aynı girdi
// her zaman aynı cevabı üretir.
//
// 🚨 GECE SEMANTİĞİ: gece N = N tarihinde BAŞLAYAN gece (mülkün takvim günü). Rezervasyon
// [giriş, çıkış) yarı açık aralığı işgal eder; aynı gün devir (biri çıkar, biri girer) ÇAKIŞMA
// DEĞİLDİR. Gece yürüyüşü saf takvim aritmetiğidir (Date.UTC devri) — DST, gece yarısı olmayan
// günler ve artık gün güvenli.
//
// 🚨 TEK TARİH KURALI (ölçüldü, 09-24 araştırması): aynı "gün" veritabanında yazan yola göre ÜÇ
// biçimde durur — Hospitable köprüsü ve elle giriş D 00:00Z, iCal tarih-değeri / saat dilimsiz
// değer D 12:00Z, iCal TZID'li değer GERÇEK AN. Kodda iki kural vardı (org dilimi / UTC) ve ikisi
// de bazı yazarlarda günü kaydırıyordu. Çapa kuralı: UTC saati TAM 00:00:00.000 ya da
// 12:00:00.000 ise değer "yalnız tarih"tir → UTC tarihi; aksi hâlde gerçek an → mülk diliminde
// tarih. Europe/Istanbul'da `/calendar` ile her yazar için birebir aynıdır (parite testi).
// Bilinen sınır: öteki dilimlerde tam 00:00Z/12:00Z'ye düşen GERÇEK bir an (ör. Auckland yerel
// gece yarısı) tarih sanılır.
//
// 🚨 KAPALI BAŞARISIZ: "boş" demek ancak KANITLA olur. Bir gece yalnız (a) üzerinde hiçbir
// rezervasyon yoksa, (b) mülkün en az bir kapsama kaynağı varsa ve (c) HER kaynak taze ve
// başarılıysa "boş"tur; aksi hâlde "bilinmiyor". Bayat/hatalı kaynak asla "boş" üretmez.
// İşgal ise kaynağın tazeliğinden BAĞIMSIZ birleşimdir: bir iddianın eklenmesi hiçbir geceyi
// dolu→boş çeviremez. İki kaynak aynı geceyi işgal ederse BİRLEŞTİRİLMEZ (değişmez 6) —
// çakışma olarak raporlanır.
// ---------------------------------------------------------------------------

export const AVAILABILITY_ENGINE_VERSION = 1 as const;

/** Doğrulanmış "YYYY-MM-DD" (mülk takvim günü). */
export type NightKey = string;

const NIGHT_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Takvimde gerçekten var olan günse anahtarı döner (2026-02-30 → null). */
export function parseNightKey(value: string): NightKey | null {
  const m = NIGHT_KEY_RE.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return value;
}

function keyToUtcMs(key: NightKey): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function utcMsToKey(ms: number): NightKey {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addNights(key: NightKey, n: number): NightKey {
  const [y, m, d] = key.split("-").map(Number);
  return utcMsToKey(Date.UTC(y, m - 1, d + n));
}

/** [from, to) arasındaki gece sayısı; to ≤ from ise ≤ 0. */
export function nightsBetween(from: NightKey, to: NightKey): number {
  return Math.round((keyToUtcMs(to) - keyToUtcMs(from)) / 86_400_000);
}

export type StoredAnchor = "utc_midnight" | "utc_noon" | "instant";

/** Saklanan değerin mülk takvimindeki günü (çapa kuralı, ↑ başlık). */
export function calendarDateOf(stored: Date, timeZone: string): { key: NightKey; anchor: StoredAnchor } {
  const h = stored.getUTCHours();
  const exact = stored.getUTCMinutes() === 0 && stored.getUTCSeconds() === 0 && stored.getUTCMilliseconds() === 0;
  if (exact && h === 0) return { key: utcMsToKey(stored.getTime()), anchor: "utc_midnight" };
  if (exact && h === 12) return { key: utcMsToKey(stored.getTime()), anchor: "utc_noon" };
  return { key: dateKeyInTimeZone(stored, timeZone), anchor: "instant" };
}

export function todayKey(now: Date, timeZone: string): NightKey {
  return dateKeyInTimeZone(now, timeZone);
}

/** `booked` confirmed|completed · `held` pending · `ignored` cancelled · tanınmayan → İŞGAL EDER. */
export type StatusClass = "booked" | "held" | "ignored" | "unrecognized";

export function statusClassOf(status: string): StatusClass {
  switch (status) {
    case "confirmed":
    case "completed":
      return "booked";
    case "pending":
      return "held";
    case "cancelled":
      return "ignored";
    default:
      return "unrecognized";
  }
}

/**
 * İddianın NEREDEN geldiği — yalnız açıklayıcıdır, karar vermez; kanal ETİKETİNDEN yetenek
 * çıkarılmaz (değişmez 20). Yükleyici (load.ts) KANITLI alanlardan hesaplar:
 *   calendar_feed        = `calendarSourceId` dolu (takvim bağlantısından)
 *   channel_connection   = `connectionId` dolu (kanıtlanmış kanal bağlantısı)
 *   host_entered         = elle giriş / dosya / silinmiş beslemenin öksüzü (mekanizma işaretçisi)
 *   channel_unattributed = kanal etiketli ama bağlantısı kanıtsız (V0.4 öncesi köprü satırları)
 */
export type ClaimOrigin = "calendar_feed" | "channel_connection" | "host_entered" | "channel_unattributed";

/** Neden güvendiğimiz: `fresh` = kaynağın son başarılı okumasında görüldü · `host_asserted` =
 *  host'un kendi girişi · `unconfirmed` = hâlâ geçerli olduğu kanıtsız (bayat köprü, hayalet satır). */
export type ClaimBasis = "fresh" | "host_asserted" | "unconfirmed";

/** Kişisel veri TAŞIMAZ: misafir adı, rezervasyon kodu, kanal etiketi yok. */
export interface ReservationSnapshot {
  id: string;
  arrival: Date;
  departure: Date;
  status: string;
  origin: ClaimOrigin;
  calendarSourceId: string | null;
  /** Besleme satırının son görüldüğü an (yalnız kayıp-tespiti açıkken yazılır). */
  feedLastSeenAt: Date | null;
}

/** Mülkün rezervasyonlarını bize bildiren kaynak. URL / sır TAŞIMAZ. */
export interface CoverageSource {
  id: string;
  kind: "calendar_feed" | "channel_link";
  label: string;
  lastStatus: "ok" | "error" | null;
  /** Son BAŞARILI okuma; bilinmiyorsa null (köprü bugün kaydetmiyor). */
  lastSuccessAt: Date | null;
}

export interface AvailabilityPolicy {
  /** Kaynak bu kadar süredir başarılı okunmadıysa bayattır. */
  sourceFreshMs: number;
  /** Tek sorguda en fazla gece. */
  maxNights: number;
  /** Bugünden en fazla bu kadar gün ileri sorulabilir. */
  maxHorizonDays: number;
}

export const DEFAULT_AVAILABILITY_POLICY: AvailabilityPolicy = {
  sourceFreshMs: 6 * 60 * 60 * 1000,
  maxNights: 62,
  maxHorizonDays: 365,
};

export interface AvailabilityInput {
  propertyId: string;
  timeZone: string;
  now: Date;
  reservations: readonly ReservationSnapshot[];
  sources: readonly CoverageSource[];
  /** Yükleyici satır tavanına çarptıysa true → boş görünen hiçbir gece "boş" sayılmaz. */
  loadTruncated: boolean;
  policy?: AvailabilityPolicy;
}

export type NightState = "booked" | "held" | "free" | "unknown";

export type UnknownReason =
  | "no_coverage_sources"
  | "source_error"
  | "source_never_synced"
  | "source_stale"
  | "source_freshness_unrecorded"
  | "load_truncated"
  | "anomalous_claim";

export interface NightClaim {
  reservationId: string;
  origin: ClaimOrigin;
  statusClass: StatusClass;
  basis: ClaimBasis;
}

export interface NightEvidence {
  night: NightKey;
  state: NightState;
  claims: readonly NightClaim[];
  unknownReasons: readonly UnknownReason[];
}

/** İki ya da daha çok iddianın aynı geceleri işgal etmesi — OLGU, birleştirme kararı DEĞİL. */
export interface Conflict {
  /** Yarı açık [from, to). */
  from: NightKey;
  to: NightKey;
  reservationIds: readonly string[];
  facts: {
    /** Tüm iddiaların giriş/çıkışı birebir aynı (aynı konaklama iki kaynaktan gelmiş olabilir). */
    identicalSpan: boolean;
    sameOrigin: boolean;
    anyHeld: boolean;
  };
}

export type SourceState = "fresh" | "error" | "never_synced" | "stale" | "unrecorded";

export interface NightsReport {
  engineVersion: typeof AVAILABILITY_ENGINE_VERSION;
  propertyId: string;
  timeZone: string;
  asOf: string;
  range: { from: NightKey; to: NightKey; nights: number };
  nights: readonly NightEvidence[];
  conflicts: readonly Conflict[];
  sources: readonly { id: string; kind: CoverageSource["kind"]; label: string; state: SourceState }[];
  anomalies: readonly { reservationId: string; kind: "zero_nights" | "inverted" }[];
}

export type InvalidReason = "bad_date" | "from_not_before_to" | "too_many_nights" | "beyond_horizon" | "starts_in_past";

export type AvailabilityVerdict = "available" | "unavailable" | "unknown";

export interface AvailabilityAnswer extends NightsReport {
  verdict: AvailabilityVerdict;
  /** Yalnız `verified` bir sonuç ileride otomatik bir cevaba dayanak olabilir. */
  certainty: "verified" | "unverified";
}

export type RangeResult<T> = { ok: true; value: T } | { ok: false; reason: InvalidReason };

function sourceState(s: CoverageSource, now: Date, policy: AvailabilityPolicy): SourceState {
  if (s.lastStatus === "error") return "error";
  if (s.lastSuccessAt === null) return s.lastStatus === "ok" ? "unrecorded" : s.kind === "channel_link" ? "unrecorded" : "never_synced";
  if (now.getTime() - s.lastSuccessAt.getTime() > policy.sourceFreshMs) return "stale";
  return "fresh";
}

const UNKNOWN_FOR_STATE: Record<Exclude<SourceState, "fresh">, UnknownReason> = {
  error: "source_error",
  never_synced: "source_never_synced",
  stale: "source_stale",
  unrecorded: "source_freshness_unrecorded",
};

function claimBasis(r: ReservationSnapshot, sourcesById: Map<string, CoverageSource>): ClaimBasis {
  if (r.origin === "host_entered") return "host_asserted";
  if (r.origin === "calendar_feed" && r.calendarSourceId) {
    const src = sourcesById.get(r.calendarSourceId);
    if (src?.lastSuccessAt && r.feedLastSeenAt && r.feedLastSeenAt.getTime() >= src.lastSuccessAt.getTime()) return "fresh";
  }
  return "unconfirmed";
}

function validateRange(
  input: AvailabilityInput,
  range: { from: string; to: string },
  opts: { allowPast: boolean },
): RangeResult<{ from: NightKey; to: NightKey; nights: number }> {
  const policy = input.policy ?? DEFAULT_AVAILABILITY_POLICY;
  const from = parseNightKey(range.from);
  const to = parseNightKey(range.to);
  if (!from || !to) return { ok: false, reason: "bad_date" };
  const nights = nightsBetween(from, to);
  if (nights <= 0) return { ok: false, reason: "from_not_before_to" };
  if (nights > policy.maxNights) return { ok: false, reason: "too_many_nights" };
  const today = todayKey(input.now, input.timeZone);
  if (!opts.allowPast && from < today) return { ok: false, reason: "starts_in_past" };
  if (to > addNights(today, policy.maxHorizonDays)) return { ok: false, reason: "beyond_horizon" };
  return { ok: true, value: { from, to, nights } };
}

/**
 * Aralıktaki her gecenin durumu + kanıtı + çakışmalar. Geçmiş geceler serbest (host görünümleri
 * için). Aralık doğrulaması başarısızsa neden döner — asla fırlatmaz.
 */
export function describeNights(
  input: AvailabilityInput,
  range: { from: string; to: string },
  opts: { allowPast?: boolean } = {},
): RangeResult<NightsReport> {
  const policy = input.policy ?? DEFAULT_AVAILABILITY_POLICY;
  const r = validateRange(input, range, { allowPast: opts.allowPast ?? true });
  if (!r.ok) return r;
  const { from, to, nights: count } = r.value;

  const sourcesById = new Map(input.sources.map((s) => [s.id, s]));
  const sourceStates = input.sources.map((s) => ({ s, state: sourceState(s, input.now, policy) }));
  // "Boş" diyebilmek için KAPSAMANIN tamamı taze olmalı; tek bir bozuk kaynak yeter.
  const coverageReasons = new Set<UnknownReason>();
  if (input.sources.length === 0) coverageReasons.add("no_coverage_sources");
  for (const { state } of sourceStates) if (state !== "fresh") coverageReasons.add(UNKNOWN_FOR_STATE[state]);
  if (input.loadTruncated) coverageReasons.add("load_truncated");

  type Span = { r: ReservationSnapshot; arr: NightKey; dep: NightKey; cls: StatusClass; basis: ClaimBasis };
  const spans: Span[] = [];
  const anomalies: NightsReport["anomalies"][number][] = [];
  const anomalousNights = new Set<NightKey>();
  for (const res of input.reservations) {
    const cls = statusClassOf(res.status);
    if (cls === "ignored") continue;
    const arr = calendarDateOf(res.arrival, input.timeZone).key;
    const dep = calendarDateOf(res.departure, input.timeZone).key;
    const n = nightsBetween(arr, dep);
    if (n === 0) {
      anomalies.push({ reservationId: res.id, kind: "zero_nights" });
      continue;
    }
    if (n < 0) {
      // Ters kayıt: hangi geceleri kastettiği bilinemez → aradaki geceler "boş" DENEMEZ.
      anomalies.push({ reservationId: res.id, kind: "inverted" });
      for (let k = dep; k < arr; k = addNights(k, 1)) anomalousNights.add(k);
      continue;
    }
    spans.push({ r: res, arr, dep, cls, basis: claimBasis(res, sourcesById) });
  }

  const nights: NightEvidence[] = [];
  for (let i = 0, night = from; i < count; i++, night = addNights(night, 1)) {
    const covering = spans.filter((s) => s.arr <= night && night < s.dep);
    const claims: NightClaim[] = covering
      .map((s) => ({ reservationId: s.r.id, origin: s.r.origin, statusClass: s.cls, basis: s.basis }))
      .sort((a, b) => (a.reservationId < b.reservationId ? -1 : a.reservationId > b.reservationId ? 1 : 0));
    let state: NightState;
    const reasons = new Set<UnknownReason>();
    if (claims.length > 0) {
      state = claims.some((c) => c.statusClass !== "held") ? "booked" : "held";
    } else {
      for (const reason of coverageReasons) reasons.add(reason);
      if (anomalousNights.has(night)) reasons.add("anomalous_claim");
      state = reasons.size === 0 ? "free" : "unknown";
    }
    nights.push({ night, state, claims, unknownReasons: [...reasons].sort() });
  }

  // Çakışma: ≥2 iddialı ardışık geceler, iddia kümesi AYNI kaldıkça tek aralık.
  const conflicts: Conflict[] = [];
  let open: { from: NightKey; ids: string; claims: readonly NightClaim[] } | null = null;
  const close = (end: NightKey) => {
    if (!open) return;
    const involved = spans.filter((s) => open!.claims.some((c) => c.reservationId === s.r.id));
    const first = involved[0];
    conflicts.push({
      from: open.from,
      to: end,
      reservationIds: open.claims.map((c) => c.reservationId),
      facts: {
        identicalSpan: involved.every((s) => s.arr === first.arr && s.dep === first.dep),
        sameOrigin: involved.every((s) => s.r.origin === first.r.origin),
        anyHeld: involved.some((s) => s.cls === "held"),
      },
    });
    open = null;
  };
  for (const n of nights) {
    const ids = n.claims.length >= 2 ? n.claims.map((c) => c.reservationId).join(",") : "";
    if (open && open.ids !== ids) close(n.night);
    if (ids && !open) open = { from: n.night, ids, claims: n.claims };
  }
  close(to);

  return {
    ok: true,
    value: {
      engineVersion: AVAILABILITY_ENGINE_VERSION,
      propertyId: input.propertyId,
      timeZone: input.timeZone,
      asOf: input.now.toISOString(),
      range: { from, to, nights: count },
      nights,
      conflicts,
      sources: sourceStates.map(({ s, state }) => ({ id: s.id, kind: s.kind, label: s.label, state })),
      anomalies,
    },
  };
}

/**
 * Misafir/araç sorusu: "[from, to) müsait mi?". Geçmişten başlayan aralık reddedilir.
 *   available + verified   → her gece kanıtla boş
 *   unavailable + verified → en az bir gece, taze ya da host'un kendi girdiği bir iddiayla dolu
 *   unavailable + unverified → dolu görünüyor ama yalnız kanıtsız iddialarla (hayalet olabilir)
 *   unknown                → dolu değil ama "boş" demeye yetecek kanıt yok
 */
export function checkAvailability(input: AvailabilityInput, range: { from: string; to: string }): RangeResult<AvailabilityAnswer> {
  const report = describeNights(input, range, { allowPast: false });
  if (!report.ok) return report;
  const nights = report.value.nights;
  const blocked = nights.filter((n) => n.state === "booked" || n.state === "held");
  let verdict: AvailabilityVerdict;
  let certainty: AvailabilityAnswer["certainty"];
  if (blocked.length > 0) {
    verdict = "unavailable";
    certainty = blocked.some((n) => n.claims.some((c) => c.basis !== "unconfirmed")) ? "verified" : "unverified";
  } else if (nights.every((n) => n.state === "free")) {
    verdict = "available";
    certainty = "verified";
  } else {
    verdict = "unknown";
    certainty = "unverified";
  }
  return { ok: true, value: { ...report.value, verdict, certainty } };
}
