// ---------------------------------------------------------------------------
// KANIT: resmî kayıt okuması (K2) + hak sahipliği bağı (K3) — operatör girdisinin doğrulanması ve onaya hazır olma (Faz 1a; tasarım §3).
// SAF.
//
// · Okuma = YENİDEN ÜRETİLEBİLİR SORGU KAYDI (Opus P2-17): kaynak (kapalı küme) + sorgulanan değer + kayıttan KOPYALANAN alanlar.
//   🚨 Numara eşleşmesi KAYITTA GÖRÜNEN belge numarasıyla hesaplanır, operatörün sorguya yazdığı değerle DEĞİL (Opus 11-06 P2-8: sorgu
//   alanı başvurudaki numarayla dolu gelince eşleşme kendini doğruluyordu). Unvan normalize eşit olmalı; "benziyor" puanı YOK — unvan
//   tutmuyorsa (ya da tesis kaydında unvan hiç görünmüyorsa) operatör ancak yazılı gerekçeyle onaylar (gerekçe olay günlüğünde kalır).
// · Onay şartları (K2 + K3): son 7 gün içinde "geçerli" ve numarası eşleşen bir okuma + GÜÇLÜ bir hak sahipliği kanıtı + belgedeki vergi
//   numarasının başvurudakiyle eşleşmesi (operatör numarayı yazar, kod özetini karşılaştırır, numara SAKLANMAZ — Opus 11-06 P1-2) + tesis
//   belgesinde operatörün kayıttaki tesisle eşleştirdiği daireler (Opus 11-06 P1-3). Kayıtlı alan adı (DNS) tek başına GÜÇLÜ sayılmaz.
// · "okunamadı" ve "bulunamadı" hüküm VERMEZ (F16): onay açmaz; doğrulanmış belgeyi de kendiliğinden askıya almaz (askıyı operatör verir).
//   Kayıtta AÇIK iptal — ve kayıttaki numara belgeninkiyle aynıysa — doğrulanmış belge hemen askıya alınır (tasarım §4.1).
// ---------------------------------------------------------------------------

import { AGENCY_GROUPS, isRegistrySourceId, sourceAllowedFor, type HolderKind, type LicenseType, type RegistrySourceId } from "./catalog";
import { normalizeLegalName, normalizeLicenseNumber } from "./normalize";
import { parseTaxId } from "./tax-id";

export const READING_OUTCOMES = ["valid", "cancelled", "not_found", "unreadable"] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];

export const PROOF_METHODS = ["esign_declaration", "document_set", "registry_contact", "registered_domain"] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];
/** Tek başına onay için yeterli yöntemler. */
export const STRONG_PROOF_METHODS: ReadonlySet<ProofMethod> = new Set(["esign_declaration", "document_set", "registry_contact"]);

export const READING_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReadingFields = {
  /** Kayıtta görünen belge numarası — eşleşme BUNUNLA (sorgu değeriyle değil). */
  number?: string;
  legalName?: string;
  agencyName?: string;
  facilityName?: string;
  group?: string;
  facilityType?: string;
  starClass?: string;
  city?: string;
  district?: string;
  address?: string;
  statusText?: string;
};

export type ReadingEvidence = {
  source: RegistrySourceId;
  query: string;
  queryNorm: string;
  outcome: ReadingOutcome;
  fields: ReadingFields;
  match: { number: boolean; legalName: boolean };
  note?: string;
};

/** Saklanan kanıt: vergi numarasının KENDİSİ yok, yalnız karşılaştırma sonucu. */
export type ProofEvidence = { method: ProofMethod; evidenceRef: string; taxIdMatched: boolean };

/**
 * 11 haneli TC kimlik numarasına benzeyen dizi (serbest metinde TCKN saklanmaz — tasarım §3.3; Haiku 11-06 #7). Rakamlar arasındaki
 * boşluk / nokta / tire / eğik çizgi ve görünmez karakterler yok sayılır ("100 000 001 46" de yakalanır — Opus 11-06 P3-17).
 */
export function containsTcknLike(s: string): boolean {
  const joined = s
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/(\d)[\s./-]+(?=\d)/g, "$1");
  return /(?:^|\D)[1-9]\d{10}(?:\D|$)/.test(joined);
}

function short(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? null : s;
}

const FIELD_LIMITS: Record<keyof ReadingFields, number> = {
  number: 60,
  legalName: 200,
  agencyName: 200,
  facilityName: 200,
  group: 1,
  facilityType: 60,
  starClass: 20,
  city: 40,
  district: 40,
  address: 300,
  statusText: 60,
};
/** Türe göre kopyalanabilen alanlar (acenta kaydında tesis alanı, tesis kaydında grup yok). */
const AGENCY_FIELDS: ReadonlySet<keyof ReadingFields> = new Set(["number", "legalName", "agencyName", "group", "city", "statusText"]);
const FACILITY_FIELDS: ReadonlySet<keyof ReadingFields> = new Set([
  "number",
  "legalName",
  "facilityName",
  "facilityType",
  "starClass",
  "city",
  "district",
  "address",
  "statusText",
]);

export type ReadingError = "source" | "query" | "outcome" | "fields" | "number" | "group" | "note";

/** Operatörün okuma girdisi → kanıt (eşleşme hesaplanmış) ya da hata kodu. */
export function parseReading(
  license: { type: LicenseType; numberNorm: string; holderNameNorm: string },
  raw: Record<string, unknown>,
): { ok: true; value: ReadingEvidence } | { ok: false; error: ReadingError } {
  const source = raw.source;
  if (!isRegistrySourceId(source) || !sourceAllowedFor(license.type, source)) return { ok: false, error: "source" };
  // Sorgu, kayıtta ARANAN değerdir (numara ya da unvan) — eşleşmeye katılmaz, yalnız sorgunun yeniden üretilebilmesi için saklanır.
  const query = short(raw.query, 100);
  if (!query) return { ok: false, error: "query" };
  const queryNorm = normalizeLicenseNumber(query);
  // Sorguya belge numarası dışında TC kimliğe benzeyen değer yazılmaz (belgenin kendi numarası öyle görünse bile kabul edilir).
  if (containsTcknLike(query) && queryNorm !== license.numberNorm) return { ok: false, error: "query" };
  const outcome = raw.outcome;
  if (typeof outcome !== "string" || !(READING_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: "outcome" };
  const f = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? (raw.fields as Record<string, unknown>) : {};
  const allowed = license.type === "agency" ? AGENCY_FIELDS : FACILITY_FIELDS;
  const foreign = Object.keys(f).find((k) => !allowed.has(k as keyof ReadingFields));
  if (foreign !== undefined) return { ok: false, error: foreign === "group" ? "group" : "fields" };
  const fields: ReadingFields = {};
  for (const k of Object.keys(FIELD_LIMITS) as (keyof ReadingFields)[]) {
    if (!allowed.has(k)) continue;
    const v = short(f[k], FIELD_LIMITS[k]);
    if (v === null) return { ok: false, error: k === "number" ? "number" : "fields" };
    if (!v) continue;
    // Kayıttan kopyalanan metin alanlarında TC kimlik numarası saklanmaz (numara alanı belge numarasıdır, aşağıda ayrıca).
    if (k !== "number" && containsTcknLike(v)) return { ok: false, error: "fields" };
    fields[k] = v;
  }
  const found = outcome === "valid" || outcome === "cancelled";
  if (!found && Object.keys(fields).length > 0) return { ok: false, error: "fields" };
  let registryNumberNorm = "";
  if (found) {
    if (!fields.number) return { ok: false, error: "number" };
    registryNumberNorm = normalizeLicenseNumber(fields.number);
    if (!registryNumberNorm) return { ok: false, error: "number" };
    if (containsTcknLike(fields.number) && registryNumberNorm !== license.numberNorm) return { ok: false, error: "number" };
    // Acenta kaydında eşleşme anahtarı ticari unvan; tesis kaydında tesis adı zorunlu (unvan görünmeyebilir — tasarım §3.2).
    if (license.type === "agency" ? !fields.legalName : !fields.facilityName) return { ok: false, error: "fields" };
  }
  if (license.type === "agency" && outcome === "valid") {
    if (!fields.group || !(AGENCY_GROUPS as readonly string[]).includes(fields.group)) return { ok: false, error: "group" };
  }
  const note = short(raw.note, 500);
  if (note === null || (note && containsTcknLike(note))) return { ok: false, error: "note" };
  const match = {
    number: found && registryNumberNorm === license.numberNorm,
    legalName: found && !!fields.legalName && normalizeLegalName(fields.legalName) === license.holderNameNorm,
  };
  return { ok: true, value: { source, query, queryNorm, outcome: outcome as ReadingOutcome, fields, match, ...(note ? { note } : {}) } };
}

export type ProofInput = { method: ProofMethod; evidenceRef: string; taxDigits: string };

/**
 * Operatörün kanıt girdisi. Vergi numarası (şirket: VKN; şahıs işletmesi: TC kimlik no) operatörün belgeden (vergi levhası, e-imza
 * sertifikası) okuduğu değerdir; çağıran özetini başvurudakiyle karşılaştırır ve YALNIZ sonucu saklar.
 */
export function parseProof(raw: Record<string, unknown>, holderKind: HolderKind): { ok: true; value: ProofInput } | { ok: false; error: "method" | "ref" | "tax" } {
  const method = raw.method;
  if (typeof method !== "string" || !(PROOF_METHODS as readonly string[]).includes(method)) return { ok: false, error: "method" };
  const ref = short(raw.evidenceRef, 500);
  if (!ref || ref.length < 5 || containsTcknLike(ref)) return { ok: false, error: "ref" };
  const tax = parseTaxId(holderKind, raw.taxId);
  if (!tax) return { ok: false, error: "tax" };
  return { ok: true, value: { method: method as ProofMethod, evidenceRef: ref, taxDigits: tax.digits } };
}

export type ApprovalMissing =
  | "reading"
  | "reading_stale"
  | "reading_not_valid"
  | "number_mismatch"
  | "name_mismatch"
  | "proof"
  | "proof_weak"
  | "tax_unconfirmed"
  | "units_unconfirmed";

/**
 * Onaya hazır mı: son okuma (en çok 7 günlük, "geçerli", kayıttaki numara eşleşmiş; unvan eşleşmemişse yazılı gerekçe) + son kanıt
 * (güçlü yöntem, vergi numarası eşleşmiş) + tesis belgesinde en az bir teyitli daire. Eksikler sırayla döner — operatör ekranı ne eksik
 * olduğunu gösterir.
 */
export function approvalReadiness(args: {
  lastReading: { at: Date; value: ReadingEvidence } | null;
  lastProof: { at: Date; value: ProofEvidence } | null;
  now: Date;
  nameOverride?: string | null;
  unitsConfirmed?: boolean;
}): { ok: true } | { ok: false; missing: ApprovalMissing[] } {
  const missing: ApprovalMissing[] = [];
  const r = args.lastReading;
  if (!r) missing.push("reading");
  else {
    if (args.now.getTime() - r.at.getTime() > READING_MAX_AGE_DAYS * DAY_MS) missing.push("reading_stale");
    if (r.value.outcome !== "valid") missing.push("reading_not_valid");
    if (!r.value.match.number) missing.push("number_mismatch");
    const override = (args.nameOverride ?? "").trim();
    if (!r.value.match.legalName && override.length < 10) missing.push("name_mismatch");
  }
  const p = args.lastProof;
  if (!p) missing.push("proof");
  else {
    if (!STRONG_PROOF_METHODS.has(p.value.method)) missing.push("proof_weak");
    // Eski biçimli (`taxIdConfirmed` kutusu) kanıt sayılmaz: yalnız kodun karşılaştırdığı sonuç geçer.
    if (p.value.taxIdMatched !== true) missing.push("tax_unconfirmed");
  }
  if (args.unitsConfirmed === false) missing.push("units_unconfirmed");
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Kayıtta kabul edilen ticari unvanın normal biçimi (tesis kaydı unvan göstermiyorsa null). */
export function registryNameNormOf(fields: ReadingFields): string | null {
  const n = fields.legalName ? normalizeLegalName(fields.legalName) : "";
  return n || null;
}

/**
 * Doğrulanmış belgede kayıttaki unvan hâlâ aynı hak sahibini mi gösteriyor: onayda kabul edilen kayıt unvanı ya da hak sahibinin unvanı.
 * Onayda kayıt unvan göstermediyse (tesis) yeni okumada da göstermemeli ya da hak sahibininkiyle aynı olmalı.
 */
export function registryNameStillMatches(reading: ReadingEvidence, acceptedNameNorm: string | null, holderNameNorm: string): boolean {
  const n = registryNameNormOf(reading.fields);
  if (n === null) return acceptedNameNorm === null;
  return n === acceptedNameNorm || n === holderNameNorm;
}

/** Acenta grubu değişimi (tasarım §4.1): aynı · A'dan daralma (yetki hemen daralır) · diğer (genişleme / yan geçiş → operatör). */
export function groupChange(current: unknown, next: string | undefined): "same" | "narrowed" | "changed" {
  if (typeof current !== "string" || !next) return "changed";
  if (current === next) return "same";
  if (current === "A" && (next === "B" || next === "C")) return "narrowed";
  return "changed";
}

/** Okumadaki tesis nitelikleri kayıttan gelir (ev sahibinin beyanını ezer); acentada yalnız grup. */
export function attributesFromReading(type: LicenseType, current: unknown, reading: ReadingEvidence): Record<string, unknown> {
  if (type === "agency") return { group: reading.fields.group };
  const base = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return {
    ...base,
    ...(reading.fields.facilityType ? { facilityType: reading.fields.facilityType } : {}),
    ...(reading.fields.starClass ? { starClass: reading.fields.starClass } : {}),
  };
}

export type VerifiedReadingVerdict =
  | { kind: "renew"; attributes: Record<string, unknown>; registryNameNorm: string | null; groupNarrowed: boolean }
  /** Kayıt geçerli ama belgeyle uyuşmuyor → işaret hemen kalkar, belge operatörün yeniden kontrol listesine düşer (Opus 11-06 P3-12). */
  | { kind: "clear"; why: "number" | "name" | "group" }
  | { kind: "suspend" }
  | { kind: "none" };

/**
 * Doğrulanmış belgeye yeni okuma (tasarım §4.1). Hüküm yalnız tam okumadan: bulunamadı / okunamadı → hiçbir şey (F16). Açık iptal ancak
 * kayıttaki numara bu belgeninkiyse askı (Opus 11-06 P2-5). Geçerli okuma yalnız numara + unvan + grup tutarsa işareti tazeler; grup
 * A'dan daraldıysa yeni (dar) grup hemen uygulanır; genişleme / yan geçiş operatöre kalır (Opus 11-06 P2-6).
 */
export function verifiedReadingVerdict(args: {
  type: LicenseType;
  attributes: unknown;
  acceptedNameNorm: string | null;
  holderNameNorm: string;
  reading: ReadingEvidence;
}): VerifiedReadingVerdict {
  const r = args.reading;
  if (r.outcome === "cancelled") return r.match.number ? { kind: "suspend" } : { kind: "none" };
  if (r.outcome !== "valid") return { kind: "none" };
  if (!r.match.number) return { kind: "clear", why: "number" };
  if (!registryNameStillMatches(r, args.acceptedNameNorm, args.holderNameNorm)) return { kind: "clear", why: "name" };
  const nextName = registryNameNormOf(r.fields) ?? args.acceptedNameNorm;
  if (args.type === "agency") {
    const current = args.attributes && typeof args.attributes === "object" ? (args.attributes as Record<string, unknown>).group : undefined;
    const change = groupChange(current, r.fields.group);
    if (change === "changed") return { kind: "clear", why: "group" };
    return { kind: "renew", attributes: { group: r.fields.group }, registryNameNorm: nextName, groupNarrowed: change === "narrowed" };
  }
  return { kind: "renew", attributes: attributesFromReading(args.type, args.attributes, r), registryNameNorm: nextName, groupNarrowed: false };
}

/**
 * Askıdan dönüş: SON ASKIDAN SONRAKİ okuma (Opus 11-06 P3-11) son 7 gün içinde, "geçerli", kayıttaki numara eşleşmiş ve unvan hâlâ aynı
 * hak sahibini gösteriyor. Nitelikler kayıttan alınır (açık operatör kararı — genişleme de burada kabul edilir).
 */
export function reinstateReadiness(
  readingSinceSuspend: { at: Date; value: ReadingEvidence } | null,
  now: Date,
  acceptedNameNorm: string | null,
  holderNameNorm: string,
): boolean {
  if (!readingSinceSuspend) return false;
  const v = readingSinceSuspend.value;
  return (
    now.getTime() - readingSinceSuspend.at.getTime() <= READING_MAX_AGE_DAYS * DAY_MS &&
    v.outcome === "valid" &&
    v.match.number &&
    registryNameStillMatches(v, acceptedNameNorm, holderNameNorm)
  );
}
