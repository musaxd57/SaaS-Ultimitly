// ---------------------------------------------------------------------------
// İŞLETME BELGESİ — TEK YAZICI (Faz 1a; tasarım §4). Belge, hak sahibi, birim ve olay satırları YALNIZ buradan yazılır.
//
// · Her geçiş: sürüm alanıyla CAS (eski okumaya göre hesaplanmış karar araya giren kararı ezemez) + aynı işlemde yalnız-ekle olay.
// · 🚨 Belgeye dokunan her operatör / ev sahibi işlemi ÖNCE belge satırını kilitler (`FOR UPDATE`), bekçiyi değiştirebilecekler sonra hak
//   sahibi satırını (sıra hep belge → hak sahibi; Opus 11-06 P2-4 / P2-7): eşzamanlı iki işlem (ör. bir belge geri çekilirken aynı şirketin
//   öbür belgesi onaylanırken) bekçiyi yanlış boşaltamaz; okuma / kanıt olayı da araya giren bir kararın eski durumuyla yazılmaz.
// · Bekçiler: belge `lockKey` (verified / suspended) + hak sahibi `verifiedGuard` — bir belge ve bir şirket aynı anda yalnız bir hesapta
//   doğrulanmış olabilir. Çakışma P2002 olarak gelir → başvuru `under_review`a düşer (operatör), ev sahibine fark GÖSTERİLMEZ.
// · Başvuru açma hesap başına danışma kilidiyle sıralanır (en çok 3 açık başvuru ve günde 10 başvuru sınırı eşzamanlı isteklerle aşılamasın).
// · Bekleyen başvurunun süresi tembel dolar: açma ve geri çekme önce süresi geçenleri `expired`e çeker.
// ---------------------------------------------------------------------------

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { encryptSecretBound } from "@/lib/crypto";
import { isUniqueViolation } from "@/lib/db-errors";
import { LICENSE_TYPE_INFO, isHolderKind, isLicenseType, parseAttributes, type HolderKind, type LicenseType } from "./catalog";
import { normalizeLegalName, normalizeLicenseNumber } from "./normalize";
import { parseTaxId, taxIdLast2 } from "./tax-id";
import { licenseSecret, sameTaxIdHash, taxIdAad, taxIdHash } from "./secret";
import {
  LOCKING_STATUSES,
  MAX_APPLICATIONS_PER_DAY,
  MAX_OPEN_APPLICATIONS,
  OPEN_STATUSES,
  REJECT_REASONS,
  SUSPEND_REASONS,
  TERMINAL_STATUSES,
  isLicenseStatus,
  isPendingExpired,
  lockKeyFor,
  nextStatus,
  pendingUntilFrom,
  type LicenseAction,
  type LicenseStatus,
  type RejectReason,
  type SuspendReason,
} from "./state";
import {
  approvalReadiness,
  attributesFromReading,
  containsTcknLike,
  parseProof,
  parseReading,
  registryNameNormOf,
  reinstateReadiness,
  verifiedReadingVerdict,
  type ApprovalMissing,
  type ProofEvidence,
  type ReadingEvidence,
} from "./evidence";

type Tx = Prisma.TransactionClient;

/** Danışma kilidi ad alanı (40–48 başka modüllerde). */
const LICENSE_ORG_LOCK_NS = 49;
const MAX_UNITS = 200;
const EXPIRE_BATCH = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

class CasConflict extends Error {}

/**
 * YALNIZ testler: yazma işleminin SONUNDA (olay yazıldı, işlem henüz kapanmadı) çağrılır — eşzamanlı iki işlem ikisi de yazıp henüz
 * kapanmamışken araya girer; kilitsiz sürümde yarış belirlenimli kırmızı olur (CLAUDE.md "Genel Prisma temsilcisine kurulan casus" dersi).
 */
export const __licenseTestHooks: { beforeCommit?: (op: "withdraw" | "reading" | "decision", licenseId: string) => Promise<void> } = {};

/** Ekranda gösterilecek metin: denetim / görünmez karakter yok, boşluk teke iner. */
function displayText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

async function appendEvent(
  tx: Tx,
  e: {
    licenseId: string;
    organizationId: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string;
    actorKind: "host" | "operator" | "system";
    actorUserId?: string | null;
    evidence?: Prisma.InputJsonValue;
  },
) {
  await tx.licenseEvent.create({
    data: {
      licenseId: e.licenseId,
      organizationId: e.organizationId,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      reason: e.reason,
      actorKind: e.actorKind,
      actorUserId: e.actorUserId ?? null,
      ...(e.evidence !== undefined ? { evidence: e.evidence } : {}),
    },
  });
}

/** Belge satırını işlem sonuna kadar kilitler; yoksa (ya da başka işletmenin) null. Hak sahibi kimliği döner (değişmez). */
async function lockLicenseRow(tx: Tx, licenseId: string, organizationId?: string): Promise<string | null> {
  const rows = organizationId
    ? await tx.$queryRaw<{ holderId: string }[]>(
        Prisma.sql`SELECT "holderId" FROM "BusinessLicense" WHERE "id" = ${licenseId} AND "organizationId" = ${organizationId} FOR UPDATE`,
      )
    : await tx.$queryRaw<{ holderId: string }[]>(Prisma.sql`SELECT "holderId" FROM "BusinessLicense" WHERE "id" = ${licenseId} FOR UPDATE`);
  return rows[0]?.holderId ?? null;
}

/** Hak sahibi satırını kilitler — bekçiyi (`verifiedGuard`) değiştirebilecek her işlemde belge kilidinden SONRA. */
async function lockHolderRow(tx: Tx, holderId: string): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "LicenseHolder" WHERE "id" = ${holderId} FOR UPDATE`);
}

type LicenseRow = { id: string; organizationId: string; holderId: string; type: string; numberNorm: string; status: string; version: number };

/** CAS'lı geçiş: durum + sürüm eşitken yazar, bekçiyi hedef duruma göre ayarlar; tutmazsa `CasConflict`. */
async function transition(
  tx: Tx,
  lic: LicenseRow,
  action: LicenseAction,
  patch: Prisma.BusinessLicenseUpdateManyMutationInput = {},
): Promise<LicenseStatus> {
  if (!isLicenseStatus(lic.status)) throw new CasConflict();
  const to = nextStatus(lic.status, action);
  if (!to) throw new CasConflict();
  const res = await tx.businessLicense.updateMany({
    where: { id: lic.id, status: lic.status, version: lic.version },
    data: { ...patch, status: to, version: { increment: 1 }, lockKey: lockKeyFor(to, lic.type, lic.numberNorm) },
  });
  if (res.count !== 1) throw new CasConflict();
  return to;
}

/**
 * Hak sahibi bekçisi: kilitleyen durumda belgesi varsa `taxIdHash`, yoksa NULL. Başka hesaptaki aynı şirket → P2002. Çağıran hak sahibi
 * satırını önceden kilitlemiş olmalı (`lockHolderRow`) — yoksa eşzamanlı iki geçiş birbirinin sayımını görmeden bekçiyi boşaltabilir.
 */
async function syncHolderGuard(tx: Tx, holderId: string) {
  const holder = await tx.licenseHolder.findUnique({ where: { id: holderId }, select: { taxIdHash: true, verifiedGuard: true } });
  if (!holder) return;
  const locked = await tx.businessLicense.count({ where: { holderId, status: { in: [...LOCKING_STATUSES] } } });
  const want = locked > 0 ? holder.taxIdHash : null;
  if (holder.verifiedGuard !== want) await tx.licenseHolder.update({ where: { id: holderId }, data: { verifiedGuard: want } });
}

/**
 * Süresi dolmuş açık başvuruları (bekleyen / incelemedeki) `expired`e çeker (tembel; işletme başına sınırlı parti). Satırlar kimlik
 * sırasıyla güncellenir: eşzamanlı iki süpürme satır kilitlerini aynı sırayla alır, birbirini kilitleyemez (Opus 11-06 ikinci tur P3-11).
 */
export async function expireStalePending(tx: Tx, organizationId: string, now: Date): Promise<number> {
  const stale = await tx.businessLicense.findMany({
    where: { organizationId, status: { in: [...OPEN_STATUSES] }, pendingUntil: { lte: now } },
    orderBy: { id: "asc" },
    select: { id: true, organizationId: true, holderId: true, type: true, numberNorm: true, status: true, version: true },
    take: EXPIRE_BATCH,
  });
  let n = 0;
  for (const lic of stale) {
    const res = await tx.businessLicense.updateMany({
      where: { id: lic.id, status: lic.status, version: lic.version },
      data: { status: "expired", version: { increment: 1 }, lockKey: null },
    });
    if (res.count !== 1) continue;
    await appendEvent(tx, { licenseId: lic.id, organizationId: lic.organizationId, fromStatus: lic.status, toStatus: "expired", reason: "expire", actorKind: "system" });
    n += 1;
  }
  return n;
}

// --- Ev sahibi: başvuru ---------------------------------------------------------------------------------------------------------

export type CreateApplicationInput = {
  organizationId: string;
  userId: string;
  type: unknown;
  number: unknown;
  attributes: unknown;
  holder: { kind: unknown; legalName: unknown; taxId: unknown };
  propertyIds: unknown;
  now?: Date;
};

export type CreateApplicationError =
  | "disabled"
  | "invalid_type"
  | "invalid_holder"
  | "invalid_number"
  | "invalid_name"
  | "invalid_tax_id"
  | "invalid_attributes"
  | "invalid_units"
  | "too_many_open"
  | "too_many_recent"
  | "duplicate";

export async function createLicenseApplication(
  input: CreateApplicationInput,
): Promise<{ ok: true; licenseId: string } | { ok: false; reason: CreateApplicationError }> {
  const secret = licenseSecret();
  if (!secret) return { ok: false, reason: "disabled" };
  if (!isLicenseType(input.type)) return { ok: false, reason: "invalid_type" };
  const type: LicenseType = input.type;
  if (!isHolderKind(input.holder?.kind)) return { ok: false, reason: "invalid_holder" };
  const kind: HolderKind = input.holder.kind;
  const number = displayText(input.number, 60);
  const numberNorm = number ? normalizeLicenseNumber(number) : "";
  if (!number || !numberNorm) return { ok: false, reason: "invalid_number" };
  const legalName = displayText(input.holder.legalName, 200);
  const legalNameNorm = legalName ? normalizeLegalName(legalName) : "";
  if (!legalName || legalName.length < 2 || !legalNameNorm) return { ok: false, reason: "invalid_name" };
  const tax = parseTaxId(kind, input.holder.taxId);
  if (!tax) return { ok: false, reason: "invalid_tax_id" };
  // Ev sahibinin yazdığı alanlarda da TC kimlik numarası saklanmaz (Opus 11-06 ikinci tur P3-2): belge numarası yerine kendi vergi /
  // TC numarasını yazan ya da unvana numara ekleyen başvuru düz metin olarak numara, bekçi anahtarı ve dökümde kalırdı.
  if (numberNorm === tax.digits) return { ok: false, reason: "invalid_number" };
  if (containsTcknLike(legalName)) return { ok: false, reason: "invalid_name" };
  const attrs = parseAttributes(type, input.attributes);
  if (!attrs.ok) return { ok: false, reason: "invalid_attributes" };
  if (Object.values(attrs.value).some((v) => typeof v === "string" && containsTcknLike(v))) return { ok: false, reason: "invalid_attributes" };
  const rawUnits = input.propertyIds ?? [];
  if (!Array.isArray(rawUnits) || rawUnits.some((p) => typeof p !== "string" || !p || p.length > 64)) return { ok: false, reason: "invalid_units" };
  const propertyIds = [...new Set(rawUnits as string[])];
  const scope = LICENSE_TYPE_INFO[type].scope;
  if (scope === "holder" ? propertyIds.length > 0 : propertyIds.length === 0 || propertyIds.length > MAX_UNITS) {
    return { ok: false, reason: "invalid_units" };
  }
  const now = input.now ?? new Date();
  const hash = taxIdHash(secret, tax.digits);
  const { organizationId, userId } = input;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${LICENSE_ORG_LOCK_NS}::int4, hashtext(${organizationId}))`);
    await expireStalePending(tx, organizationId, now);
    if (propertyIds.length) {
      const owned = await tx.property.count({ where: { id: { in: propertyIds }, organizationId } });
      if (owned !== propertyIds.length) return { ok: false as const, reason: "invalid_units" as const };
    }
    const open = await tx.businessLicense.count({ where: { organizationId, status: { in: [...OPEN_STATUSES] } } });
    if (open >= MAX_OPEN_APPLICATIONS) return { ok: false as const, reason: "too_many_open" as const };
    const recent = await tx.businessLicense.count({ where: { organizationId, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
    if (recent >= MAX_APPLICATIONS_PER_DAY) return { ok: false as const, reason: "too_many_recent" as const };
    const dup = await tx.businessLicense.findFirst({
      where: { organizationId, type, numberNorm, status: { in: [...OPEN_STATUSES, ...LOCKING_STATUSES] } },
      select: { id: true },
    });
    if (dup) return { ok: false as const, reason: "duplicate" as const };

    let holder = await tx.licenseHolder.findUnique({
      where: { organizationId_taxIdHash: { organizationId, taxIdHash: hash } },
      select: { id: true, kind: true, legalNameNorm: true, verifiedGuard: true },
    });
    if (!holder) {
      holder = await tx.licenseHolder.create({
        data: {
          organizationId,
          kind,
          legalName,
          legalNameNorm,
          taxIdHash: hash,
          // TCKN hiçbir biçimde geri okunabilir saklanmaz; yalnız VKN şifreli (tasarım §3.3).
          taxIdEnc: tax.form === "vkn" ? encryptSecretBound(tax.digits, taxIdAad(organizationId, hash)) : null,
          taxIdLast2: taxIdLast2(tax.digits),
        },
        select: { id: true, kind: true, legalNameNorm: true, verifiedGuard: true },
      });
    }
    let typedLegalName: string | null = null;
    if (holder.legalNameNorm !== legalNameNorm || holder.kind !== kind) {
      // Doğrulanmış hak sahibinin unvanı başvuruyla DEĞİŞMEZ (kayıtla eşleşmiş ad korunur). Koşul YAZMANIN içinde de: araya giren bir onay
      // bekçiyi doldurduysa bu güncelleme hiçbir satıra dokunmaz (Opus 11-06 P2-4). Değişmediyse yazılan unvan başvuru olayında kalır,
      // operatör kuyrukta görür (Opus 11-06 ikinci tur P3-12: sessizce kayboluyordu).
      const res = holder.verifiedGuard
        ? { count: 0 }
        : await tx.licenseHolder.updateMany({ where: { id: holder.id, verifiedGuard: null }, data: { kind, legalName, legalNameNorm } });
      if (res.count === 0 && holder.legalNameNorm !== legalNameNorm) typedLegalName = legalName;
    }
    const lic = await tx.businessLicense.create({
      data: {
        organizationId,
        holderId: holder.id,
        type,
        number,
        numberNorm,
        attributes: attrs.value as Prisma.InputJsonValue,
        status: "pending",
        pendingUntil: pendingUntilFrom(now),
        createdByUserId: userId,
      },
      select: { id: true },
    });
    if (propertyIds.length) await tx.licenseUnit.createMany({ data: propertyIds.map((propertyId) => ({ licenseId: lic.id, propertyId })) });
    await appendEvent(tx, {
      licenseId: lic.id,
      organizationId,
      fromStatus: null,
      toStatus: "pending",
      reason: "application",
      actorKind: "host",
      actorUserId: userId,
      evidence: { units: propertyIds.length, ...(typedLegalName ? { typedLegalName } : {}) },
    });
    return { ok: true as const, licenseId: lic.id };
  });
}

// --- Ev sahibi: geri çekme ------------------------------------------------------------------------------------------------------

export async function withdrawLicense(input: {
  organizationId: string;
  userId: string;
  licenseId: string;
  now?: Date;
}): Promise<{ ok: true; from: LicenseStatus } | { ok: false; reason: "not_found" | "not_open" | "conflict" }> {
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      await expireStalePending(tx, input.organizationId, now);
      const holderId = await lockLicenseRow(tx, input.licenseId, input.organizationId);
      if (!holderId) return { ok: false as const, reason: "not_found" as const };
      await lockHolderRow(tx, holderId);
      const lic = await tx.businessLicense.findFirst({
        where: { id: input.licenseId, organizationId: input.organizationId },
        select: { id: true, organizationId: true, holderId: true, type: true, numberNorm: true, status: true, version: true },
      });
      if (!lic) return { ok: false as const, reason: "not_found" as const };
      if (!isLicenseStatus(lic.status) || !nextStatus(lic.status, "withdraw")) return { ok: false as const, reason: "not_open" as const };
      const to = await transition(tx, lic, "withdraw", { pendingUntil: null });
      await syncHolderGuard(tx, lic.holderId);
      await appendEvent(tx, { licenseId: lic.id, organizationId: lic.organizationId, fromStatus: lic.status, toStatus: to, reason: "withdraw", actorKind: "host", actorUserId: input.userId });
      await __licenseTestHooks.beforeCommit?.("withdraw", lic.id);
      // Kilit altındaki ESKİ durum: sunucunun cümlesi belge mi başvuru mu geri çekildi diye buna bakar (11-06).
      return { ok: true as const, from: lic.status };
    });
  } catch (err) {
    if (err instanceof CasConflict) return { ok: false, reason: "conflict" };
    throw err;
  }
}

// --- Operatör: kayıt okuması (K2) -----------------------------------------------------------------------------------------------

const LICENSE_SELECT = {
  id: true,
  organizationId: true,
  holderId: true,
  type: true,
  numberNorm: true,
  status: true,
  version: true,
  attributes: true,
  pendingUntil: true,
  registryNameNorm: true,
  holder: { select: { legalNameNorm: true } },
} as const;

export type OperatorError = "not_found" | "not_open" | "invalid" | "conflict";

export type ReadingResult =
  | { ok: true; match: ReadingEvidence["match"]; autoSuspended: boolean; renewed: boolean; markCleared: boolean }
  | { ok: false; reason: OperatorError; field?: string };

export async function recordRegistryReading(input: {
  licenseId: string;
  operatorUserId: string;
  reading: Record<string, unknown>;
  now?: Date;
}): Promise<ReadingResult> {
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockLicenseRow(tx, input.licenseId))) return { ok: false as const, reason: "not_found" as const };
      const lic = await tx.businessLicense.findUnique({ where: { id: input.licenseId }, select: LICENSE_SELECT });
      if (!lic || !isLicenseType(lic.type)) return { ok: false as const, reason: "not_found" as const };
      if (!isLicenseStatus(lic.status) || TERMINAL_STATUSES.has(lic.status)) return { ok: false as const, reason: "not_open" as const };
      // Süresi dolmuş (henüz süpürülmemiş) bekleyen başvuruya kanıt yazılmaz (Haiku 11-06 #4).
      if (isPendingExpired(lic, now)) return { ok: false as const, reason: "not_open" as const };
      const parsed = parseReading({ type: lic.type, numberNorm: lic.numberNorm, holderNameNorm: lic.holder.legalNameNorm }, input.reading);
      if (!parsed.ok) return { ok: false as const, reason: "invalid" as const, field: parsed.error };
      const reading = parsed.value;
      let toStatus: string = lic.status;
      let autoSuspended = false;
      let renewed = false;
      let markCleared: false | "number" | "name" | "group" = false;
      let groupNarrowed = false;
      if (lic.status === "verified") {
        const verdict = verifiedReadingVerdict({
          type: lic.type,
          attributes: lic.attributes,
          acceptedNameNorm: lic.registryNameNorm,
          holderNameNorm: lic.holder.legalNameNorm,
          reading,
        });
        if (verdict.kind === "suspend") {
          // Kayıtta AÇIK iptal (ve numara bu belgenin) → hemen askı (tasarım §4.1). "Bulunamadı" / "okunamadı" hüküm vermez (F16).
          toStatus = await transition(tx, lic, "suspend", { suspendReason: "registry_cancelled" satisfies SuspendReason });
          autoSuspended = true;
        } else if (verdict.kind === "renew" || verdict.kind === "clear") {
          const data: Prisma.BusinessLicenseUpdateManyMutationInput =
            verdict.kind === "renew"
              ? {
                  lastRegistryOkAt: now,
                  lastRegistrySource: reading.source,
                  attributes: verdict.attributes as Prisma.InputJsonValue,
                  registryNameNorm: verdict.registryNameNorm,
                }
              : { lastRegistryOkAt: null };
          const res = await tx.businessLicense.updateMany({
            where: { id: lic.id, status: "verified", version: lic.version },
            data: { ...data, version: { increment: 1 } },
          });
          if (res.count !== 1) throw new CasConflict();
          if (verdict.kind === "renew") {
            renewed = true;
            groupNarrowed = verdict.groupNarrowed;
          } else markCleared = verdict.why;
        }
      }
      await appendEvent(tx, {
        licenseId: lic.id,
        organizationId: lic.organizationId,
        fromStatus: lic.status,
        toStatus,
        reason: autoSuspended ? "suspend" : "registry_read",
        actorKind: "operator",
        actorUserId: input.operatorUserId,
        evidence: {
          reading,
          ...(autoSuspended ? { suspendReason: "registry_cancelled" } : {}),
          ...(renewed ? { renewed: true } : {}),
          ...(groupNarrowed ? { groupNarrowed: true } : {}),
          ...(markCleared ? { markCleared } : {}),
        } as unknown as Prisma.InputJsonValue,
      });
      await __licenseTestHooks.beforeCommit?.("reading", lic.id);
      return { ok: true as const, match: reading.match, autoSuspended, renewed, markCleared: markCleared !== false };
    });
  } catch (err) {
    if (err instanceof CasConflict) return { ok: false, reason: "conflict" };
    throw err;
  }
}

// --- Operatör: hak sahipliği kanıtı (K3) ----------------------------------------------------------------------------------------

/**
 * Kanıt: yöntem + kısa kayıt + operatörün belgeden (vergi levhası / e-imza sertifikası) yazdığı vergi numarası. Numara başvurudakiyle
 * ÖZETİ üzerinden karşılaştırılır; saklanan yalnız sonuç (`taxIdMatched`) — kutu işaretlemek yetmez (Opus 11-06 P1-2).
 */
export async function recordOwnershipProof(input: {
  licenseId: string;
  operatorUserId: string;
  proof: Record<string, unknown>;
  now?: Date;
}): Promise<{ ok: true; taxIdMatched: boolean } | { ok: false; reason: OperatorError; field?: string }> {
  const secret = licenseSecret();
  if (!secret) return { ok: false, reason: "invalid", field: "tax" };
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    if (!(await lockLicenseRow(tx, input.licenseId))) return { ok: false as const, reason: "not_found" as const };
    const lic = await tx.businessLicense.findUnique({
      where: { id: input.licenseId },
      select: { id: true, organizationId: true, status: true, pendingUntil: true, holder: { select: { kind: true, taxIdHash: true } } },
    });
    if (!lic) return { ok: false as const, reason: "not_found" as const };
    if (!isLicenseStatus(lic.status) || TERMINAL_STATUSES.has(lic.status)) return { ok: false as const, reason: "not_open" as const };
    if (isPendingExpired(lic, now)) return { ok: false as const, reason: "not_open" as const };
    if (!isHolderKind(lic.holder.kind)) return { ok: false as const, reason: "invalid" as const, field: "tax" };
    const parsed = parseProof(input.proof, lic.holder.kind);
    if (!parsed.ok) return { ok: false as const, reason: "invalid" as const, field: parsed.error };
    const taxIdMatched = sameTaxIdHash(taxIdHash(secret, parsed.value.taxDigits), lic.holder.taxIdHash);
    const proof: ProofEvidence = { method: parsed.value.method, evidenceRef: parsed.value.evidenceRef, taxIdMatched };
    await appendEvent(tx, {
      licenseId: lic.id,
      organizationId: lic.organizationId,
      fromStatus: lic.status,
      toStatus: lic.status,
      reason: "ownership_proof",
      actorKind: "operator",
      actorUserId: input.operatorUserId,
      evidence: { proof } as unknown as Prisma.InputJsonValue,
    });
    return { ok: true as const, taxIdMatched };
  });
}

// --- Operatör: karar ------------------------------------------------------------------------------------------------------------

type ReadingAt = { at: Date; value: ReadingEvidence };

/**
 * Son kayıt okuması, SON ASKIDAN SONRAKİ okuma ve son hak sahipliği kanıtı (operatör olaylarından; okuma kendiliğinden askıya alan
 * olayda da taşınır). En yeni okuma / askı olayı bir askıysa askıdan sonra okuma YOK sayılır (Opus 11-06 P3-11).
 */
async function lastEvidence(tx: Tx, licenseId: string) {
  const [reads, proof] = await Promise.all([
    tx.licenseEvent.findMany({
      where: { licenseId, actorKind: "operator", reason: { in: ["registry_read", "suspend"] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { reason: true, createdAt: true, evidence: true },
    }),
    tx.licenseEvent.findFirst({
      where: { licenseId, actorKind: "operator", reason: "ownership_proof" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true, evidence: true },
    }),
  ]);
  const readingOf = (e: { createdAt: Date; evidence: unknown } | undefined): ReadingAt | null => {
    const v = (e?.evidence as { reading?: ReadingEvidence } | null | undefined)?.reading;
    return e && v ? { at: e.createdAt, value: v } : null;
  };
  const proofValue = (proof?.evidence as { proof?: ProofEvidence } | null)?.proof;
  const latest = reads[0];
  return {
    lastReading: readingOf(reads.find((e) => (e.evidence as { reading?: unknown } | null)?.reading)),
    readingSinceSuspend: latest && latest.reason === "registry_read" ? readingOf(latest) : null,
    lastProof: proof && proofValue ? { at: proof.createdAt, value: proofValue } : null,
  };
}

export type DecisionInput = {
  licenseId: string;
  operatorUserId: string;
  action: "approve" | "reject" | "suspend" | "reinstate" | "review";
  reason?: unknown;
  nameOverride?: unknown;
  note?: unknown;
  /** Tesis belgesi onayında: operatörün kayıttaki tesisle eşleştirdiği daireler (başvurudakilerin alt kümesi; Opus 11-06 P1-3). */
  confirmedUnitIds?: unknown;
  now?: Date;
};

export type DecisionResult =
  | { ok: true; status: LicenseStatus }
  | { ok: false; reason: OperatorError | "not_ready" | "lock_conflict"; missing?: ApprovalMissing[] };

/** Teyit edilen daireler: dizi, tekrarsız, her biri başvurudaki dairelerden biri. Eksik / boş → teyit yok; yabancı kimlik → geçersiz. */
function confirmedUnits(raw: unknown, current: string[]): { keep: string[]; remove: string[] } | "invalid" {
  if (raw === undefined || raw === null) return { keep: [], remove: current };
  if (!Array.isArray(raw) || raw.length > MAX_UNITS || raw.some((x) => typeof x !== "string")) return "invalid";
  const set = new Set(raw as string[]);
  if ([...set].some((id) => !current.includes(id))) return "invalid";
  return { keep: current.filter((id) => set.has(id)), remove: current.filter((id) => !set.has(id)) };
}

export async function decideLicense(input: DecisionInput): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  const note = input.note === undefined || input.note === null || input.note === "" ? null : displayText(input.note, 500);
  if (input.note && !note) return { ok: false, reason: "invalid" };
  if (note && containsTcknLike(note)) return { ok: false, reason: "invalid" };
  if (typeof input.nameOverride === "string" && containsTcknLike(input.nameOverride)) return { ok: false, reason: "invalid" };
  try {
    return await prisma.$transaction(async (tx) => {
      const holderId = await lockLicenseRow(tx, input.licenseId);
      if (!holderId) return { ok: false as const, reason: "not_found" as const };
      await lockHolderRow(tx, holderId);
      const lic = await tx.businessLicense.findUnique({ where: { id: input.licenseId }, select: LICENSE_SELECT });
      if (!lic || !isLicenseType(lic.type) || !isLicenseStatus(lic.status)) return { ok: false as const, reason: "not_found" as const };
      if (!nextStatus(lic.status, input.action)) return { ok: false as const, reason: "not_open" as const };
      // Süresi dolmuş bekleyen başvuruya karar verilmez (tembel süre).
      if (isPendingExpired(lic, now)) return { ok: false as const, reason: "not_open" as const };
      const ev = await lastEvidence(tx, lic.id);
      let patch: Prisma.BusinessLicenseUpdateManyMutationInput = {};
      let evidence: Record<string, unknown> = {};
      if (input.action === "approve") {
        const nameOverride = typeof input.nameOverride === "string" ? displayText(input.nameOverride, 300) : null;
        // Unvan eşleşmesi KARAR ANINDA yeniden hesaplanır: okumadan sonra (doğrulanmamış) hak sahibinin unvanı başka bir başvuruyla
        // değiştiyse eski eşleşme geçmez (Haiku 11-06 #3).
        const lastReading = ev.lastReading
          ? {
              ...ev.lastReading,
              value: {
                ...ev.lastReading.value,
                match: {
                  ...ev.lastReading.value.match,
                  legalName: !!ev.lastReading.value.fields.legalName && normalizeLegalName(ev.lastReading.value.fields.legalName) === lic.holder.legalNameNorm,
                },
              },
            }
          : null;
        // Tesis belgesi: kapsam operatörün kayıttaki tesisle eşleştirdiği dairelere daralır; teyitsiz daire işaret almaz.
        let units: { keep: string[]; remove: string[] } | null = null;
        if (LICENSE_TYPE_INFO[lic.type].scope === "units") {
          const current = (await tx.licenseUnit.findMany({ where: { licenseId: lic.id }, select: { propertyId: true } })).map((u) => u.propertyId);
          const parsed = confirmedUnits(input.confirmedUnitIds, current);
          if (parsed === "invalid") return { ok: false as const, reason: "invalid" as const };
          units = parsed;
        } else if (input.confirmedUnitIds !== undefined && input.confirmedUnitIds !== null && !(Array.isArray(input.confirmedUnitIds) && input.confirmedUnitIds.length === 0)) {
          return { ok: false as const, reason: "invalid" as const };
        }
        const ready = approvalReadiness({ lastReading, lastProof: ev.lastProof, now, nameOverride, unitsConfirmed: units ? units.keep.length > 0 : undefined });
        if (!ready.ok) return { ok: false as const, reason: "not_ready" as const, missing: ready.missing };
        const reading = ev.lastReading!.value;
        if (units && units.remove.length) await tx.licenseUnit.deleteMany({ where: { licenseId: lic.id, propertyId: { in: units.remove } } });
        // Teyit anındaki daire adı / adresi olayda kalır: sonradan değişirse (Faz 1b ilan öncesi) karşılaştırılabilsin (Opus 11-06 ikinci tur P3-8).
        const confirmedSnapshot = units?.keep.length
          ? await tx.property.findMany({ where: { id: { in: units.keep } }, orderBy: { id: "asc" }, select: { id: true, name: true, address: true, city: true } })
          : null;
        patch = {
          // Resmî kayıttaki nitelik kazanır (ev sahibi A yazdı, kayıt C diyorsa C).
          attributes: attributesFromReading(lic.type, lic.attributes, reading) as Prisma.InputJsonValue,
          registryNameNorm: registryNameNormOf(reading.fields),
          verifiedAt: now,
          lastRegistryOkAt: ev.lastReading!.at,
          lastRegistrySource: reading.source,
          pendingUntil: null,
          suspendReason: null,
        };
        evidence = {
          nameOverride: lastReading!.value.match.legalName ? null : nameOverride,
          proofMethod: ev.lastProof!.value.method,
          ...(units ? { units: { confirmed: units.keep, removed: units.remove, confirmedSnapshot } } : {}),
        };
      } else if (input.action === "reject") {
        if (typeof input.reason !== "string" || !(REJECT_REASONS as readonly string[]).includes(input.reason)) return { ok: false as const, reason: "invalid" as const };
        patch = { pendingUntil: null };
        evidence = { rejectReason: input.reason as RejectReason };
      } else if (input.action === "suspend") {
        if (typeof input.reason !== "string" || !(SUSPEND_REASONS as readonly string[]).includes(input.reason)) return { ok: false as const, reason: "invalid" as const };
        patch = { suspendReason: input.reason };
        evidence = { suspendReason: input.reason as SuspendReason };
      } else if (input.action === "reinstate") {
        const r = ev.readingSinceSuspend;
        if (!reinstateReadiness(r, now, lic.registryNameNorm, lic.holder.legalNameNorm)) {
          return { ok: false as const, reason: "not_ready" as const, missing: ["reading"] as ApprovalMissing[] };
        }
        // Açık operatör kararı: nitelikler (genişleyen grup dahil) ve kayıt unvanı yeni okumadan.
        patch = {
          suspendReason: null,
          attributes: attributesFromReading(lic.type, lic.attributes, r!.value) as Prisma.InputJsonValue,
          registryNameNorm: registryNameNormOf(r!.value.fields) ?? lic.registryNameNorm,
          lastRegistryOkAt: r!.at,
          lastRegistrySource: r!.value.source,
        };
      }
      const to = await transition(tx, lic, input.action, patch);
      await syncHolderGuard(tx, lic.holderId);
      await appendEvent(tx, {
        licenseId: lic.id,
        organizationId: lic.organizationId,
        fromStatus: lic.status,
        toStatus: to,
        reason: input.action,
        actorKind: "operator",
        actorUserId: input.operatorUserId,
        evidence: { ...evidence, ...(note ? { note } : {}) } as Prisma.InputJsonValue,
      });
      await __licenseTestHooks.beforeCommit?.("decision", lic.id);
      return { ok: true as const, status: to };
    });
  } catch (err) {
    if (err instanceof CasConflict) return { ok: false, reason: "conflict" };
    if (input.action === "approve" && (isUniqueViolation(err, ["lockKey"]) || isUniqueViolation(err, ["verifiedGuard"]))) {
      await markLockConflict(input.licenseId, input.operatorUserId, isUniqueViolation(err, ["lockKey"]) ? "license" : "holder");
      return { ok: false, reason: "lock_conflict" };
    }
    throw err;
  }
}

/** Bekçi çakışması: belge / şirket başka hesapta doğrulanmış → başvuru operatöre (`under_review`), ev sahibine fark gösterilmez. */
async function markLockConflict(licenseId: string, operatorUserId: string, on: "license" | "holder") {
  await prisma.$transaction(async (tx) => {
    if (!(await lockLicenseRow(tx, licenseId))) return;
    const lic = await tx.businessLicense.findUnique({
      where: { id: licenseId },
      select: { id: true, organizationId: true, holderId: true, type: true, numberNorm: true, status: true, version: true },
    });
    if (!lic) return;
    let to = lic.status;
    if (lic.status === "pending") {
      try {
        to = await transition(tx, lic, "review");
      } catch (err) {
        if (!(err instanceof CasConflict)) throw err;
      }
    }
    await appendEvent(tx, {
      licenseId: lic.id,
      organizationId: lic.organizationId,
      fromStatus: lic.status,
      toStatus: to,
      reason: "lock_conflict",
      actorKind: "operator",
      actorUserId: operatorUserId,
      evidence: { on },
    });
  });
}

export const __licenseWriteInternals = { LICENSE_ORG_LOCK_NS, CasConflict };
export type { LicenseStatus, SuspendReason, RejectReason };
