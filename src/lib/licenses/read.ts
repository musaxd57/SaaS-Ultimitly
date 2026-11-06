// ---------------------------------------------------------------------------
// İŞLETME BELGESİ — OKUMA (Faz 1a). Ev sahibi listesi, mülk sayfası işareti, operatör kuyruğu. Okuma YAZMAZ: süresi dolmuş bekleyen
// başvuru `effectiveStatus` ile "Süresi doldu" görünür (kalıcı geçişi ilk yazma yapar).
// · Plan kapısı (kurucu S8): Pro + Business. Faturalandırma zorunlu değilken ve kurucunun işletmesinde açık (bütün paket kapılarının
//   ortak kuralı); deneme sürümünde KAPALI (her başvuru operatör zamanı harcar). Paket düşünce "eşleşti" işareti de görünmez (Opus 11-06
//   P3-15) — belge ve durumu listede kalır.
// · Ev sahibine giden satırda vergi numarası yalnız maskeli; çakışma / operatör ayrıntısı yok.
// ---------------------------------------------------------------------------

import "server-only";
import { prisma } from "@/lib/db";
import { billingEnforced, getEntitlement, isFounderOrg } from "@/lib/billing/subscription";
import { LICENSE_TYPE_INFO, REGISTRY_SOURCES, isLicenseType, isRegistrySourceId, type LicenseType } from "./catalog";
import { effectiveStatus, type LicenseStatus } from "./state";
import { licenseMarks, marksForProperty, MARK_TTL_DAYS, type LicenseMark } from "./capabilities";
import { normalizeLegalName, normalizeLicenseNumber } from "./normalize";
import { EXPIRED_TEXT, LICENSE_STATUS_LABEL, REJECT_REASON_TEXT, SUSPEND_REASON_TEXT, VERIFIED_STALE_LABEL, markText } from "./messages";
import { maskTaxId } from "./tax-id";
import { registryNameStillMatches, type ReadingEvidence, type ProofEvidence } from "./evidence";

export const LICENSE_PLAN_CODES: ReadonlySet<string> = new Set(["pro", "business"]);

export async function licensePlanAllowed(organizationId: string): Promise<boolean> {
  if (isFounderOrg(organizationId) || !billingEnforced()) return true;
  const ent = await getEntitlement(organizationId);
  if (ent.grandfathered) return true;
  if (!ent.active || ent.trialing) return false;
  return LICENSE_PLAN_CODES.has(ent.planCode);
}

export type HostLicenseRow = {
  id: string;
  type: LicenseType;
  typeLabel: string;
  number: string;
  status: LicenseStatus;
  statusLabel: string;
  statusText: string | null;
  group: string | null;
  facilityType: string | null;
  starClass: string | null;
  holder: { kind: string; legalName: string; taxIdMasked: string };
  units: { id: string; name: string }[];
  mark: { text: string; expiresAt: string } | null;
  createdAt: string;
};

function lastReasonOf(events: { reason: string; evidence: unknown }[], status: LicenseStatus): string | null {
  const ev = events.find((e) => e.reason === (status === "rejected" ? "reject" : "suspend"));
  const evd = (ev?.evidence ?? null) as { rejectReason?: string; suspendReason?: string } | null;
  if (status === "rejected" && evd?.rejectReason && evd.rejectReason in REJECT_REASON_TEXT) {
    return REJECT_REASON_TEXT[evd.rejectReason as keyof typeof REJECT_REASON_TEXT];
  }
  if (status === "rejected") return REJECT_REASON_TEXT.other;
  return null;
}

export async function listOrgLicenses(organizationId: string, now = new Date(), planAllowed?: boolean): Promise<HostLicenseRow[]> {
  const showMarks = planAllowed ?? (await licensePlanAllowed(organizationId));
  const rows = await prisma.businessLicense.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      type: true,
      number: true,
      status: true,
      suspendReason: true,
      pendingUntil: true,
      attributes: true,
      lastRegistryOkAt: true,
      lastRegistrySource: true,
      createdAt: true,
      holder: { select: { kind: true, legalName: true, taxIdLast2: true } },
      units: { select: { property: { select: { id: true, name: true } } } },
      events: { where: { reason: { in: ["reject", "suspend"] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { reason: true, evidence: true } },
    },
  });
  const out: HostLicenseRow[] = [];
  for (const r of rows) {
    if (!isLicenseType(r.type)) continue;
    const status = effectiveStatus(r, now);
    const propertyIds = r.units.map((u) => u.property.id);
    const [mark] = licenseMarks(
      [{ id: r.id, type: r.type, number: r.number, status, attributes: r.attributes, lastRegistryOkAt: r.lastRegistryOkAt, lastRegistrySource: r.lastRegistrySource, propertyIds }],
      now,
    );
    const attrs = (r.attributes ?? {}) as Record<string, unknown>;
    let statusText: string | null = null;
    if (status === "suspended") statusText = r.suspendReason && r.suspendReason in SUSPEND_REASON_TEXT ? SUSPEND_REASON_TEXT[r.suspendReason as keyof typeof SUSPEND_REASON_TEXT] : SUSPEND_REASON_TEXT.operator;
    else if (status === "rejected") statusText = lastReasonOf(r.events, status);
    else if (status === "expired") statusText = EXPIRED_TEXT;
    // 🚨 Çakışma yüzünden incelemedeki başvuru ev sahibine "pending" görünür — etiket kadar alan da (Haiku 11-06 #1).
    const hostStatus: LicenseStatus = status === "under_review" ? "pending" : status;
    // Doğrulanmış ama son okuması 30 günü geçmiş belge "Eşleşti" demez (işaret kalktı; Haiku 11-06 #2).
    const statusLabel = hostStatus === "verified" && !mark ? VERIFIED_STALE_LABEL : LICENSE_STATUS_LABEL[hostStatus];
    out.push({
      id: r.id,
      type: r.type,
      typeLabel: LICENSE_TYPE_INFO[r.type].label,
      number: r.number,
      status: hostStatus,
      statusLabel,
      statusText,
      group: typeof attrs.group === "string" ? attrs.group : null,
      facilityType: typeof attrs.facilityType === "string" ? attrs.facilityType : null,
      starClass: typeof attrs.starClass === "string" ? attrs.starClass : null,
      holder: { kind: r.holder.kind, legalName: r.holder.legalName, taxIdMasked: maskTaxId(r.holder.taxIdLast2) },
      units: r.units.map((u) => ({ id: u.property.id, name: u.property.name })),
      mark: mark && showMarks ? { text: markText(mark), expiresAt: mark.expiresAt.toISOString() } : null,
      createdAt: r.createdAt.toISOString(),
    });
  }
  return out;
}

/** Bir işletmenin geçerli işaretleri (yalnız doğrulanmış belgeler; paket kapsamıyorsa hiç). */
export async function orgLicenseMarks(organizationId: string, now = new Date()): Promise<LicenseMark[]> {
  if (!(await licensePlanAllowed(organizationId))) return [];
  const since = new Date(now.getTime() - MARK_TTL_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.businessLicense.findMany({
    where: { organizationId, status: "verified", lastRegistryOkAt: { gt: since } },
    take: 200,
    select: {
      id: true,
      type: true,
      number: true,
      status: true,
      attributes: true,
      lastRegistryOkAt: true,
      lastRegistrySource: true,
      units: { select: { propertyId: true } },
    },
  });
  return licenseMarks(
    rows.map((r) => ({ ...r, propertyIds: r.units.map((u) => u.propertyId) })),
    now,
  );
}

/** Mülk sayfası: bu daireyi kapsayan işaret metinleri. */
export async function propertyLicenseMarkTexts(organizationId: string, propertyId: string, now = new Date()): Promise<string[]> {
  const marks = marksForProperty(await orgLicenseMarks(organizationId, now), propertyId);
  return marks.map((m) => markText(m));
}

// --- Operatör kuyruğu -----------------------------------------------------------------------------------------------------------

export type OperatorLicenseRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  type: LicenseType;
  typeLabel: string;
  number: string;
  status: LicenseStatus;
  attributes: Record<string, unknown>;
  holder: { kind: string; legalName: string; taxIdMasked: string; verifiedElsewhere: boolean };
  /** Başvurudaki daireler — operatör kayıttaki tesisle (ad / adres) eşleştirir (Opus 11-06 P1-3). */
  units: { id: string; name: string; address: string | null; city: string | null }[];
  sources: { id: string; label: string; url: string }[];
  /**
   * Son okuma + eşleşmenin BUGÜNKÜ değeri (Opus 11-06 P3-19): okumadan sonra hak sahibinin unvanı değiştiyse saklanan eşleşme bayattır;
   * doğrulanmış belgede onayda kabul edilen kayıt unvanı da sayılır.
   */
  lastReading: { at: string; value: ReadingEvidence; current: { number: boolean; legalName: boolean } } | null;
  lastProof: { at: string; value: ProofEvidence } | null;
  lastRegistryOkAt: string | null;
  createdAt: string;
};

/** Açık başvurular + yeniden okunması gereken doğrulanmış belgeler (işaret 5 gün içinde kalkacaksa). */
export async function operatorLicenseQueue(now = new Date()): Promise<{ open: OperatorLicenseRow[]; recheck: OperatorLicenseRow[] }> {
  const recheckBefore = new Date(now.getTime() - (MARK_TTL_DAYS - 5) * 24 * 60 * 60 * 1000);
  const rows = await prisma.businessLicense.findMany({
    where: {
      OR: [
        { status: "pending", pendingUntil: { gt: now } },
        { status: "under_review" },
        { status: "suspended" },
        { status: "verified", OR: [{ lastRegistryOkAt: null }, { lastRegistryOkAt: { lte: recheckBefore } }] },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 200,
    select: {
      id: true,
      organizationId: true,
      type: true,
      number: true,
      status: true,
      attributes: true,
      lastRegistryOkAt: true,
      createdAt: true,
      organization: { select: { name: true } },
      registryNameNorm: true,
      numberNorm: true,
      holder: { select: { id: true, kind: true, legalName: true, legalNameNorm: true, taxIdLast2: true, taxIdHash: true } },
      units: { take: 200, select: { property: { select: { id: true, name: true, address: true, city: true } } } },
      // Onay yolunun (`write.ts` lastEvidence) baktığı pencereyle aynı: okuma taşıyan son olay; kanıt AYRI sorguda (Haiku 11-06: ortak
      // 20 olaylık pencerede çok okuma kanıtı ekrandan düşürüyordu, sunucu ise görüyordu).
      events: {
        where: { actorKind: "operator", reason: { in: ["registry_read", "suspend"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 10,
        select: { reason: true, createdAt: true, evidence: true },
      },
    },
  });
  const proofs = rows.length
    ? await prisma.licenseEvent.findMany({
        where: { licenseId: { in: rows.map((r) => r.id) }, actorKind: "operator", reason: "ownership_proof" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { licenseId: true, createdAt: true, evidence: true },
      })
    : [];
  const lastProofOf = new Map<string, { createdAt: Date; evidence: unknown }>();
  for (const p of proofs) if (!lastProofOf.has(p.licenseId)) lastProofOf.set(p.licenseId, p);
  // Aynı şirket (vergi no özeti) başka hesapta doğrulanmış mı — YALNIZ operatöre görünür.
  const hashes = [...new Set(rows.map((r) => r.holder.taxIdHash))];
  const guarded = hashes.length
    ? await prisma.licenseHolder.findMany({ where: { verifiedGuard: { in: hashes } }, select: { id: true, verifiedGuard: true } })
    : [];
  const guardOwner = new Map(guarded.map((g) => [g.verifiedGuard as string, g.id]));
  const open: OperatorLicenseRow[] = [];
  const recheck: OperatorLicenseRow[] = [];
  for (const r of rows) {
    if (!isLicenseType(r.type)) continue;
    const readEv = r.events.find((e) => (e.evidence as { reading?: unknown } | null)?.reading);
    const proofEv = lastProofOf.get(r.id);
    const owner = guardOwner.get(r.holder.taxIdHash);
    const reading = readEv ? (readEv.evidence as { reading: ReadingEvidence }).reading : null;
    const current = reading
      ? {
          number: !!reading.fields?.number && normalizeLicenseNumber(reading.fields.number) === r.numberNorm,
          legalName:
            r.status === "verified" || r.status === "suspended"
              ? registryNameStillMatches(reading, r.registryNameNorm, r.holder.legalNameNorm)
              : !!reading.fields?.legalName && normalizeLegalName(reading.fields.legalName) === r.holder.legalNameNorm,
        }
      : null;
    const row: OperatorLicenseRow = {
      id: r.id,
      organizationId: r.organizationId,
      organizationName: r.organization.name,
      type: r.type,
      typeLabel: LICENSE_TYPE_INFO[r.type].label,
      number: r.number,
      status: effectiveStatus({ status: r.status, pendingUntil: null }, now),
      attributes: (r.attributes ?? {}) as Record<string, unknown>,
      holder: {
        kind: r.holder.kind,
        legalName: r.holder.legalName,
        taxIdMasked: maskTaxId(r.holder.taxIdLast2),
        verifiedElsewhere: owner !== undefined && owner !== r.holder.id,
      },
      units: r.units.map((u) => ({ id: u.property.id, name: u.property.name, address: u.property.address, city: u.property.city })),
      sources: LICENSE_TYPE_INFO[r.type].sources.filter(isRegistrySourceId).map((id) => ({ id, label: REGISTRY_SOURCES[id].label, url: REGISTRY_SOURCES[id].url })),
      lastReading: readEv && reading && current ? { at: readEv.createdAt.toISOString(), value: reading, current } : null,
      lastProof: proofEv ? { at: proofEv.createdAt.toISOString(), value: (proofEv.evidence as { proof: ProofEvidence }).proof } : null,
      lastRegistryOkAt: r.lastRegistryOkAt ? r.lastRegistryOkAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    };
    (r.status === "verified" ? recheck : open).push(row);
  }
  return { open, recheck };
}
