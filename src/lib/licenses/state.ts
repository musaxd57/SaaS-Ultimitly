// ---------------------------------------------------------------------------
// BELGE DURUM MAKİNESİ — TEK KAYNAK (Faz 1a; tasarım §4, §4.1). SAF.
//
// · Bekleyen başvuru (`pending`) hiçbir şeyi KİLİTLEMEZ (Opus P1-1): paralel, 14 gün süreli, hesap başına en çok 3 açık başvuru.
//   Kilit (bekçi sütunu) yalnız `verified` / `suspended` durumunda — bir belge aynı anda yalnız bir hesapta doğrulanmış olabilir.
// · Süresi dolmuş bekleyen satır TEMBEL değerlendirilir (zamanlayıcı yok): okuyan herkes `effectiveStatus` ile "expired" görür, ilk
//   yazma onu kalıcı olarak `expired`e çeker.
// · Geçiş tablosu kapalıdır: tabloda olmayan her (durum, eylem) çifti reddedilir.
// ---------------------------------------------------------------------------

export const LICENSE_STATUSES = ["pending", "under_review", "verified", "suspended", "rejected", "withdrawn", "expired"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** Bekçi sütunu (`lockKey`, hak sahibinin `verifiedGuard`ı) bu durumlarda dolu. */
export const LOCKING_STATUSES: ReadonlySet<LicenseStatus> = new Set(["verified", "suspended"]);
/** Açık başvuru sayısına girenler (hesap başına sınır). */
export const OPEN_STATUSES: ReadonlySet<LicenseStatus> = new Set(["pending", "under_review"]);
export const TERMINAL_STATUSES: ReadonlySet<LicenseStatus> = new Set(["rejected", "withdrawn", "expired"]);

export const PENDING_TTL_DAYS = 14;
export const MAX_OPEN_APPLICATIONS = 3;
/** Geri çek + yeniden başvur döngüsü operatör kuyruğunu doldurmasın (Opus 11-06 P3-18): işletme başına son 24 saatte açılan başvuru. */
export const MAX_APPLICATIONS_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SUSPEND_REASONS = ["registry_cancelled", "not_found", "mismatch", "operator"] as const;
export type SuspendReason = (typeof SUSPEND_REASONS)[number];

export const REJECT_REASONS = ["not_found", "mismatch", "no_authority", "other"] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export type LicenseAction = "approve" | "reject" | "review" | "suspend" | "reinstate" | "withdraw" | "expire";

const TRANSITIONS: Record<LicenseStatus, Partial<Record<LicenseAction, LicenseStatus>>> = {
  pending: { approve: "verified", reject: "rejected", review: "under_review", withdraw: "withdrawn", expire: "expired" },
  under_review: { approve: "verified", reject: "rejected", withdraw: "withdrawn" },
  verified: { suspend: "suspended", withdraw: "withdrawn" },
  suspended: { reinstate: "verified", reject: "rejected", withdraw: "withdrawn" },
  rejected: {},
  withdrawn: {},
  expired: {},
};

export function isLicenseStatus(v: unknown): v is LicenseStatus {
  return typeof v === "string" && (LICENSE_STATUSES as readonly string[]).includes(v);
}

/** Geçiş tablosundaki hedef durum; geçersiz geçişte null. */
export function nextStatus(current: LicenseStatus, action: LicenseAction): LicenseStatus | null {
  return TRANSITIONS[current][action] ?? null;
}

export function pendingUntilFrom(now: Date): Date {
  return new Date(now.getTime() + PENDING_TTL_DAYS * DAY_MS);
}

/** Bekleyen başvurunun süresi doldu mu (tembel değerlendirme). */
export function isPendingExpired(row: { status: string; pendingUntil: Date | null }, now: Date): boolean {
  return row.status === "pending" && row.pendingUntil !== null && row.pendingUntil.getTime() <= now.getTime();
}

/** Okuyanın görmesi gereken durum: süresi dolmuş bekleyen → "expired". */
export function effectiveStatus(row: { status: string; pendingUntil: Date | null }, now: Date): LicenseStatus {
  if (isPendingExpired(row, now)) return "expired";
  return isLicenseStatus(row.status) ? row.status : "rejected";
}

/** Bekçi anahtarı: kilitleyen durumda `${type}:${numberNorm}`, değilse null. */
export function lockKeyFor(status: LicenseStatus, type: string, numberNorm: string): string | null {
  return LOCKING_STATUSES.has(status) ? `${type}:${numberNorm}` : null;
}
