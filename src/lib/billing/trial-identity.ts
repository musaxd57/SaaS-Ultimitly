import "server-only";

import { createHmac, scryptSync } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";
import { isFounderOrg } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// DENEME KİMLİĞİ (kurucu onayı 10-10; `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md` §3–4).
// Sorun: aynı kişi yeni e-postayla yeni hesap açıp aynı ilan / takvimle yeniden 14 gün ücretsiz deneme alabiliyordu.
// Kural: işletmeyi dışarıdan tanımlayan kimlik (ilan / takvim) DAHA ÖNCE başka bir hesapta görüldüyse bu hesabın DENEMESİ o an biter
// (ücretsiz sürümle devam eder; ödeme yapan hesaplar etkilenmez); operatör "denemeyi geri ver" ile istisna tanır.
// 🚨 SAĞLAYICIDAN BAĞIMSIZ (kurucu: "ilerde Hospitable gidecek, Hospitable üzerine kurmuş gibi yapma"): kimlik = kanal adı + ilan numarası
// (`ChannelListing`), iCal adresinden çıkarılan Airbnb ilan numarası, diğer iCal adresleri normalize biçimiyle — hesap / jeton değil.
// İz GERİ DÖNDÜRÜLEMEZ özettir (HMAC, deneme kimliğine özel türetilmiş anahtar); URL / ad / e-posta saklanmaz. Hesap silinince iz kalır
// (`firstOrganizationId` boşa çekilir), son görülmeden 24 ay sonra süpürülür (kurucu: "24 ay").
// Varsayılan KAPALI (`TRIAL_IDENTITY_ENABLED`): yeni bir veri işleme — aydınlatma metni güncellenmeden açılmaz. Her hata fail-OPEN (kayıt /
// takvim / senkron akışı asla düşmez; deneme bitirilmez).
// ---------------------------------------------------------------------------

export type TrialIdentityType = "listing" | "ical_listing" | "ical_url";
export interface TrialIdentityKey {
  type: TrialIdentityType;
  /** Normalize edilmiş kimlik metni (özetlenir, SAKLANMAZ). */
  value: string;
}

/** Deneme erken bittiğinde `Subscription.trialEndReason` (kapalı küme). */
export const TRIAL_END_REASON_IDENTITY_REUSED = "identity_reused";

/** Kurucu onaylı müşteri metni (10-10). */
export const TRIAL_IDENTITY_REUSED_MESSAGE = "Bu ilan daha önce bir deneme hesabında kullanıldı. Devam etmek için bir plan seçin.";

/** İz saklama: son görülmeden bu kadar ay sonra süpürülür (kurucu: "24 ay"). */
export const TRIAL_IDENTITY_RETENTION_MONTHS = 24;

export function trialIdentityEnabled(): boolean {
  return process.env.TRIAL_IDENTITY_ENABLED === "1";
}

/** İlan kimliği: kanal adı + kanalın ilan numarası (sağlayıcıdan bağımsız biçim). */
export function listingIdentityKey(provider: string, externalId: string): TrialIdentityKey | null {
  const p = provider.trim().toLowerCase();
  const id = externalId.trim();
  if (!p || !id) return null;
  return { type: "listing", value: `${p}:${id}` };
}

/**
 * iCal adresinden kimlik. Airbnb takvim adresi ilan numarasını taşır (`/calendar/ical/<numara>.ics`) — ev sahibi bağlantıyı yenilese de
 * numara aynı kalır. Diğer adresler (Booking, VRBO, …) yalnız gizli jeton taşır → normalize edilmiş adresin kendisi (küçük harf ana makine,
 * yol, sıralı sorgu; parça ve `www.` atılır). Geçersiz adres → null.
 */
export function icalIdentityKey(rawUrl: string): TrialIdentityKey | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const airbnb = /(^|\.)airbnb\.[a-z.]+$/.test(host) ? /\/calendar\/ical\/(\d{3,20})\.ics$/i.exec(u.pathname) : null;
  if (airbnb) return { type: "ical_listing", value: `airbnb:${airbnb[1]}` };
  const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  return { type: "ical_url", value: `${host}${u.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}` };
}

let derivedKey: Buffer | null = null;
function identityKey(): Buffer {
  if (derivedKey) return derivedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new Error("ENCRYPTION_KEY (veya AUTH_SECRET) tanımlı değil — deneme kimliği özetlenemiyor.");
  // Şifreleme anahtarından AYRI türetilir (farklı tuz) — özet şifreli verilerin anahtarı hakkında hiçbir şey söylemez.
  derivedKey = scryptSync(secret, "lixus-trial-identity-v1", 32);
  return derivedKey;
}

/** Geri döndürülemez özet (tür alanı içine katılır: aynı metin farklı türde farklı özet). */
export function hashTrialIdentity(key: TrialIdentityKey): string {
  return `v1:${createHmac("sha256", identityKey()).update(`${key.type}\u0000${key.value}`).digest("hex")}`;
}

/** TEST KANCASI. */
export function __resetTrialIdentityKey(): void {
  derivedKey = null;
}

/**
 * Kimlikleri kaydet ve başka hesapta görülmüş olanı bildir. `enforce: false` (ilk açılış geri doldurması) yalnız kaydeder — kimsenin
 * denemesini bitirmez. Dönen değer: yeniden kullanım görüldü mü ve deneme bitirildi mi. Asla fırlatmaz.
 */
export async function recordTrialIdentities(
  organizationId: string,
  keys: readonly (TrialIdentityKey | null)[],
  opts: { enforce?: boolean; now?: Date } = {},
): Promise<{ reused: boolean; trialEnded: boolean }> {
  if (!trialIdentityEnabled()) return { reused: false, trialEnded: false };
  const now = opts.now ?? new Date();
  let reused = false;
  try {
    for (const key of keys) {
      if (!key) continue;
      const keyHash = hashTrialIdentity(key);
      try {
        await prisma.trialIdentity.create({ data: { keyHash, keyType: key.type, firstOrganizationId: organizationId, firstSeenAt: now, lastSeenAt: now } });
        continue;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      }
      const existing = await prisma.trialIdentity.update({ where: { keyHash }, data: { lastSeenAt: now }, select: { firstOrganizationId: true } });
      // Aynı hesap kendi kimliğini yeniden bağlıyor → kullanım değil. Başka hesap (ya da SİLİNMİŞ hesap: null) → yeniden kullanım.
      if (existing.firstOrganizationId !== organizationId) reused = true;
    }
    if (!reused || opts.enforce === false) return { reused, trialEnded: false };
    return { reused, trialEnded: await endTrialForReusedIdentity(organizationId, now) };
  } catch (err) {
    void reportError(`trial-identity org=${organizationId}`, err);
    return { reused, trialEnded: false };
  }
}

/** Yalnız SÜREN deneme biter (ödeme yapan / bitmiş / istisnalı / kurucu hesabı etkilenmez). Koşullar UPDATE'in içinde (yarışsız). */
async function endTrialForReusedIdentity(organizationId: string, now: Date): Promise<boolean> {
  if (isFounderOrg(organizationId)) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { trialIdentityExempt: true } });
  if (!org || org.trialIdentityExempt) return false;
  const res = await prisma.subscription.updateMany({
    where: { organizationId, provider: "trial", trialEndsAt: { gt: now } },
    data: { trialEndsAt: now, trialEndReason: TRIAL_END_REASON_IDENTITY_REUSED },
  });
  if (res.count === 0) return false;
  await writeAudit({ organizationId, action: "trial.ended_identity_reused" });
  return true;
}

/**
 * Saklama süpürgesi (kurucu: "hesap silindikten sonra 24 ay"): YALNIZ sahibi silinmiş (`firstOrganizationId` boş) ve son görülmesi 24 aydan
 * eski izler silinir — hesap silinirken son görülme o ana çekilir (`markTrialIdentitiesOrphaned`). Yaşayan hesabın izi silinmez (ilanı hiç
 * değişmeyen hesap 24 ay sonra korumasız kalmasın). Anahtar kapalıyken de koşar (eski iz kalmasın).
 */
export async function sweepTrialIdentities(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - TRIAL_IDENTITY_RETENTION_MONTHS);
  const res = await prisma.trialIdentity.deleteMany({ where: { firstOrganizationId: null, lastSeenAt: { lt: cutoff } } });
  return res.count;
}

/** Hesap silme işleminin İÇİNDE (kuruluş silinmeden önce): izlerin son görülmesi silinme anına çekilir → 24 ay buradan sayılır. */
export async function markTrialIdentitiesOrphaned(
  tx: { trialIdentity: { updateMany: (args: { where: { firstOrganizationId: string }; data: { lastSeenAt: Date } }) => Promise<unknown> } },
  organizationId: string,
  now: Date = new Date(),
): Promise<void> {
  await tx.trialIdentity.updateMany({ where: { firstOrganizationId: organizationId }, data: { lastSeenAt: now } });
}

/** Geri doldurma işareti (SystemLock adı): tamamlanınca yazılır, bir daha koşmaz. */
export const TRIAL_IDENTITY_BACKFILL_MARKER = "trial-identity-backfill-v1";

/**
 * İLK AÇILIŞ GERİ DOLDURMASI: anahtar açıldığında mevcut kuruluşların ilan + takvim kimliklerini BİR KEZ kaydeder — yoksa anahtar açılmadan
 * önce bağlanmış bir ilanla yeni hesap açan kişi "ilk" sayılırdı. En eski kuruluş önce (ilk görülen hak sahibi odur). YALNIZ KAYDEDER:
 * kimsenin denemesi bitirilmez (`enforce: false`). Takvim adresi okunamayan satır atlanır. Asla fırlatmaz.
 */
export async function backfillTrialIdentitiesOnce(now: Date = new Date()): Promise<"off" | "skipped" | "done"> {
  if (!trialIdentityEnabled()) return "off";
  try {
    if (await prisma.systemLock.findUnique({ where: { name: TRIAL_IDENTITY_BACKFILL_MARKER }, select: { name: true } })) return "skipped";
    const { getCalendarSourceUrl } = await import("@/lib/calendar-source-url-core");
    const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
    for (const org of orgs) {
      const listings = await prisma.channelListing.findMany({
        where: { organizationId: org.id },
        select: { externalId: true, connection: { select: { provider: true } } },
      });
      const sources = await prisma.calendarSource.findMany({
        where: { property: { organizationId: org.id } },
        select: { url: true, urlEnc: true, urlKeyFp: true, id: true },
      });
      const keys: (TrialIdentityKey | null)[] = listings.map((l) => listingIdentityKey(l.connection.provider, l.externalId));
      for (const s of sources) {
        const resolved = getCalendarSourceUrl(s, org.id);
        if (resolved.ok) keys.push(icalIdentityKey(resolved.url));
      }
      if (keys.length > 0) await recordTrialIdentities(org.id, keys, { enforce: false, now });
    }
    await prisma.systemLock.createMany({ data: [{ name: TRIAL_IDENTITY_BACKFILL_MARKER, lockedUntil: new Date("9999-12-31T00:00:00Z") }], skipDuplicates: true });
    return "done";
  } catch (err) {
    void reportError("trial-identity backfill", err);
    return "skipped";
  }
}
