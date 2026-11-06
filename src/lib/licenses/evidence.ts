// ---------------------------------------------------------------------------
// KANIT: resmî kayıt okuması (K2) + hak sahipliği bağı (K3) — operatör girdisinin doğrulanması ve onaya hazır olma (Faz 1a; tasarım §3).
// SAF.
//
// · Okuma = YENİDEN ÜRETİLEBİLİR SORGU KAYDI (Opus P2-17): kaynak (kapalı küme) + sorgulanan numara + kayıttan KOPYALANAN alanlar.
//   Eşleşme kodla hesaplanır: numara normalize eşit VE ticari unvan normalize eşit. "Benziyor" puanı YOK — unvan tutmuyorsa operatör
//   ancak yazılı gerekçeyle onaylar (gerekçe olay günlüğünde kalır).
// · Onay şartları (K2 + K3): son 7 gün içinde "geçerli" ve numarası eşleşen bir okuma + vergi numarası teyitli GÜÇLÜ bir hak sahipliği
//   kanıtı. Kayıtlı alan adı (DNS) tek başına GÜÇLÜ sayılmaz (süresi dolup kapılan alan adı, siteyi yöneten ajans — tasarım §3.3).
// · "okunamadı" ve "bulunamadı" hüküm VERMEZ (F16): onay açmaz; doğrulanmış belgeyi de kendiliğinden askıya almaz (askıyı operatör verir).
//   Kayıtta AÇIK iptal ise doğrulanmış belge hemen askıya alınır (çağıran yazıcıda).
// ---------------------------------------------------------------------------

import { AGENCY_GROUPS, isRegistrySourceId, sourceAllowedFor, type LicenseType, type RegistrySourceId } from "./catalog";
import { normalizeLegalName, normalizeLicenseNumber } from "./normalize";

export const READING_OUTCOMES = ["valid", "cancelled", "not_found", "unreadable"] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];

export const PROOF_METHODS = ["esign_declaration", "document_set", "registry_contact", "registered_domain"] as const;
export type ProofMethod = (typeof PROOF_METHODS)[number];
/** Tek başına onay için yeterli yöntemler. */
export const STRONG_PROOF_METHODS: ReadonlySet<ProofMethod> = new Set(["esign_declaration", "document_set", "registry_contact"]);

export const READING_MAX_AGE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReadingFields = {
  legalName?: string;
  agencyName?: string;
  group?: string;
  facilityType?: string;
  starClass?: string;
  city?: string;
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

export type ProofEvidence = { method: ProofMethod; evidenceRef: string; taxIdConfirmed: boolean };

function short(v: unknown, max: number): string | undefined | null {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? null : s;
}

/** Operatörün okuma girdisi → kanıt (eşleşme hesaplanmış) ya da hata kodu. */
export function parseReading(
  license: { type: LicenseType; numberNorm: string; holderNameNorm: string },
  raw: Record<string, unknown>,
): { ok: true; value: ReadingEvidence } | { ok: false; error: "source" | "query" | "outcome" | "fields" | "group" | "note" } {
  const source = raw.source;
  if (!isRegistrySourceId(source) || !sourceAllowedFor(license.type, source)) return { ok: false, error: "source" };
  const query = short(raw.query, 60);
  if (!query) return { ok: false, error: "query" };
  const queryNorm = normalizeLicenseNumber(query);
  if (!queryNorm) return { ok: false, error: "query" };
  const outcome = raw.outcome;
  if (typeof outcome !== "string" || !(READING_OUTCOMES as readonly string[]).includes(outcome)) return { ok: false, error: "outcome" };
  const f = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? (raw.fields as Record<string, unknown>) : {};
  const allowed = new Set(["legalName", "agencyName", "group", "facilityType", "starClass", "city", "statusText"]);
  if (Object.keys(f).some((k) => !allowed.has(k))) return { ok: false, error: "fields" };
  const fields: ReadingFields = {};
  const limits: Record<keyof ReadingFields, number> = {
    legalName: 200,
    agencyName: 200,
    group: 1,
    facilityType: 60,
    starClass: 20,
    city: 40,
    statusText: 60,
  };
  for (const k of Object.keys(limits) as (keyof ReadingFields)[]) {
    const v = short(f[k], limits[k]);
    if (v === null) return { ok: false, error: "fields" };
    if (v) fields[k] = v;
  }
  const found = outcome === "valid" || outcome === "cancelled";
  if (found && !fields.legalName) return { ok: false, error: "fields" };
  if (!found && Object.keys(fields).length > 0) return { ok: false, error: "fields" };
  if (license.type === "agency" && outcome === "valid") {
    if (!fields.group || !(AGENCY_GROUPS as readonly string[]).includes(fields.group)) return { ok: false, error: "group" };
  } else if (fields.group !== undefined && license.type !== "agency") {
    return { ok: false, error: "group" };
  }
  const note = short(raw.note, 500);
  if (note === null) return { ok: false, error: "note" };
  const match = {
    number: queryNorm === license.numberNorm,
    legalName: found && !!fields.legalName && normalizeLegalName(fields.legalName) === license.holderNameNorm,
  };
  return { ok: true, value: { source, query, queryNorm, outcome: outcome as ReadingOutcome, fields, match, ...(note ? { note } : {}) } };
}

export function parseProof(raw: Record<string, unknown>): { ok: true; value: ProofEvidence } | { ok: false; error: "method" | "ref" | "tax" } {
  const method = raw.method;
  if (typeof method !== "string" || !(PROOF_METHODS as readonly string[]).includes(method)) return { ok: false, error: "method" };
  const ref = short(raw.evidenceRef, 500);
  if (!ref || ref.length < 5) return { ok: false, error: "ref" };
  if (typeof raw.taxIdConfirmed !== "boolean") return { ok: false, error: "tax" };
  return { ok: true, value: { method: method as ProofMethod, evidenceRef: ref, taxIdConfirmed: raw.taxIdConfirmed } };
}

export type ApprovalMissing =
  | "reading"
  | "reading_stale"
  | "reading_not_valid"
  | "number_mismatch"
  | "name_mismatch"
  | "proof"
  | "proof_weak"
  | "tax_unconfirmed";

/**
 * Onaya hazır mı: son okuma (en çok 7 günlük, "geçerli", numara eşleşmiş; unvan eşleşmemişse yazılı gerekçe) + son kanıt (güçlü yöntem,
 * vergi numarası teyitli). Eksikler sırayla döner — operatör ekranı ne eksik olduğunu gösterir.
 */
export function approvalReadiness(args: {
  lastReading: { at: Date; value: ReadingEvidence } | null;
  lastProof: { at: Date; value: ProofEvidence } | null;
  now: Date;
  nameOverride?: string | null;
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
    if (!p.value.taxIdConfirmed) missing.push("tax_unconfirmed");
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Askıdan dönüş: son 7 gün içinde "geçerli" ve numarası + unvanı eşleşen okuma şart. */
export function reinstateReadiness(lastReading: { at: Date; value: ReadingEvidence } | null, now: Date): boolean {
  if (!lastReading) return false;
  const v = lastReading.value;
  return (
    now.getTime() - lastReading.at.getTime() <= READING_MAX_AGE_DAYS * DAY_MS && v.outcome === "valid" && v.match.number && v.match.legalName
  );
}
