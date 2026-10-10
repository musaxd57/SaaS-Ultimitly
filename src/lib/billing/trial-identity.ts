import "server-only";

import { createHmac, scryptSync } from "crypto";
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

export type TrialIdentityType = "ota_listing" | "ota_calendar";
export interface TrialIdentityKey {
  type: TrialIdentityType;
  /** Normalize edilmiş kimlik metni (özetlenir, SAKLANMAZ). */
  value: string;
}

/** Deneme erken bittiğinde `Subscription.trialEndReason` (kapalı küme). */
export const TRIAL_END_REASON_IDENTITY_REUSED = "identity_reused";

/** Kurucu onaylı müşteri metni (10-10). */
export const TRIAL_IDENTITY_REUSED_MESSAGE = "Bu ilan daha önce bir deneme hesabında kullanıldı. Devam etmek için bir plan seçin.";

/** İz saklama: hesap silindikten bu kadar ay sonra süpürülür (kurucu: "24 ay"). */
export const TRIAL_IDENTITY_RETENTION_MONTHS = 24;

export function trialIdentityEnabled(): boolean {
  return process.env.TRIAL_IDENTITY_ENABLED === "1";
}

/**
 * 🚨 KİMLİK = KANALIN GERÇEK İLAN NUMARASI / TAKVİM JETONU (Haiku incelemesi + kurucu kuralı "Hospitable üzerine kurmuş gibi yapma"):
 * aynı Airbnb ilanı iCal'den de, doğrudan Airbnb bağlantısından da gelse AYNI kimlik (`airbnb:<no>`). Köprü sağlayıcısının (Hospitable)
 * KENDİ mülk kimliği kimlik DEĞİLDİR — köprü kalkınca izler kopardı. Doğrudan kanal sağlayıcısı → rezervasyon kanalı eşlemesi (kapalı küme).
 */
const DIRECT_PROVIDER_PLATFORM: Record<string, string> = {
  airbnb: "airbnb",
  airbnb_direct: "airbnb",
  booking: "booking",
  booking_direct: "booking",
};

/** Rezervasyon kanalının ilan numarası → kimlik (sayısal numarada baştaki sıfırlar atılır). */
export function otaListingKey(platform: string, listingId: string): TrialIdentityKey | null {
  const p = platform.trim().toLowerCase();
  let id = listingId.trim();
  if (!p || !id || id.length > 64) return null;
  if (/^\d+$/.test(id)) id = id.replace(/^0+(?=\d)/, "");
  return { type: "ota_listing", value: `${p}:${id}` };
}

/** Kanal bağlantısının ilan eşlemesi → kimlik. Köprü (Hospitable vb.) ya da tanınmayan sağlayıcı → null. */
export function channelListingIdentityKey(provider: string, externalId: string): TrialIdentityKey | null {
  const platform = DIRECT_PROVIDER_PLATFORM[provider.trim().toLowerCase()];
  return platform ? otaListingKey(platform, externalId) : null;
}

/**
 * iCal adresinden kimlik — YALNIZ tanınan rezervasyon kanalının takvimi (Haiku incelemesi: herkese açık ortak takvim — resmî tatiller vb. —
 * iki ev sahibinde ortak olabilir, kimlik SAYILMAZ):
 *  · Airbnb `/calendar/ical/<ilan no>(.ics)` → ilan numarası (jeton yenilense de aynı; baştaki sıfır / sondaki eğik çizgi fark etmez).
 *  · Booking `?t=<jeton>` → yalnız jeton (ek sorgu parametresi kimliği değiştirmez).
 *  · VRBO / HomeAway `/icalendar/<jeton>.ics` → jeton.
 * Diğer her adres → null (kimlik yok, kural işlemez).
 */
export function icalIdentityKey(rawUrl: string): TrialIdentityKey | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");
  // Alan adı SIKI (kendi testimiz: `airbnb.com.evil.example` Airbnb sayılmamalı): isteğe bağlı tek alt alan + airbnb + ülke uzantısı.
  if (/^(?:[a-z]{2,3}\.)?airbnb\.(?:com|[a-z]{2})(?:\.[a-z]{2})?$/.test(host)) {
    const m = /\/calendar\/ical\/(\d{1,20})(?:\.ics)?$/i.exec(path);
    return m ? otaListingKey("airbnb", m[1]) : null;
  }
  if (/(^|\.)booking\.com$/.test(host)) {
    const t = u.searchParams.get("t")?.trim();
    return t && /^[A-Za-z0-9_-]{8,128}$/.test(t) ? { type: "ota_calendar", value: `booking:${t}` } : null;
  }
  if (/^(?:[a-z0-9-]+\.)*(?:vrbo|homeaway)\.(?:com|[a-z]{2})(?:\.[a-z]{2})?$/.test(host)) {
    const m = /\/icalendar\/([A-Za-z0-9]{8,128})\.ics$/i.exec(path);
    return m ? { type: "ota_calendar", value: `vrbo:${m[1]}` } : null;
  }
  return null;
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
  // Anahtar açıldıktan sonraki İLK kayıt: önce mevcut hesapların geri doldurması (Haiku incelemesi — yoksa saatlik iş koşana kadar yeni
  // hesap "ilk" sayılırdı). Geri doldurmanın kendi çağrıları `enforce: false` taşır → özyineleme yok.
  if (opts.enforce !== false) await backfillTrialIdentitiesOnce(now);
  let reused = false;
  try {
    for (const key of keys) {
      if (!key) continue;
      const keyHash = hashTrialIdentity(key);
      // Çakışmada sessiz ekleme (ON CONFLICT DO NOTHING): yarışsız ve her yeniden kullanımda hata günlüğü üretmez.
      const created = await prisma.trialIdentity.createMany({
        data: [{ keyHash, keyType: key.type, firstOrganizationId: organizationId, firstSeenAt: now, lastSeenAt: now }],
        skipDuplicates: true,
      });
      if (created.count === 1) continue;
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

/**
 * 🚨 TAKVİM KİMLİĞİ YALNIZ GERÇEK OKUMADA SAYILIR (kendi incelememiz 10-10): Airbnb ilan numarası herkese açıktır; kimlik eklemede sayılsaydı
 * biri sahte jetonlu bir adresle başkasının ilanını önceden "kapar", gerçek sahip kaydolunca denemesi biterdi. Senkron, sunucu GEÇERLİ bir
 * takvim döndürdüğünde (doğru jeton = takvimin sahibi) bunu çağırır. Kaynak başına BİR KEZ (`trialIdentityCheckedAt` koşullu yazımı —
 * yarışsız): sonraki senkronlar tekrar saymaz, anahtar açılmadan önce iki hesapta zaten bulunan takvim her senkronda cezalandırılmaz.
 * Asla fırlatmaz.
 */
export async function recordVerifiedCalendarIdentity(
  sourceId: string,
  organizationId: string,
  feedUrl: string,
  now: Date = new Date(),
): Promise<{ reused: boolean; trialEnded: boolean }> {
  const none = { reused: false, trialEnded: false };
  if (!trialIdentityEnabled()) return none;
  const key = icalIdentityKey(feedUrl);
  if (!key) return none;
  try {
    // Önce geri doldurma: anahtar açılmadan önce okunmuş takvimler (bu kaynak dahil) kayda geçer, işaretlenir → bu kaynak eskiyse aşağıdaki
    // koşullu yazım boşa düşer (ceza yok); yeniyse ilk kez sayılır.
    await backfillTrialIdentitiesOnce(now);
    const claimed = await prisma.calendarSource.updateMany({
      where: { id: sourceId, trialIdentityCheckedAt: null },
      data: { trialIdentityCheckedAt: now },
    });
    if (claimed.count === 0) return none;
    return await recordTrialIdentities(organizationId, [key], { now });
  } catch (err) {
    void reportError(`trial-identity calendar org=${organizationId}`, err);
    return none;
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
    let unreadable = 0;
    for (const org of orgs) {
      const listings = await prisma.channelListing.findMany({
        where: { organizationId: org.id },
        select: { externalId: true, connection: { select: { provider: true } } },
      });
      // Yalnız en az bir kez BAŞARIYLA okunmuş takvim (bkz. `recordVerifiedCalendarIdentity`); hiç okunmamış kaynak ilk gerçek okumasında sayılır.
      const sources = await prisma.calendarSource.findMany({
        where: { property: { organizationId: org.id }, trialIdentityCheckedAt: null, lastStatus: { in: ["ok", "partial"] } },
        select: { url: true, urlEnc: true, urlKeyFp: true, id: true },
      });
      const keys: (TrialIdentityKey | null)[] = listings.map((l) => channelListingIdentityKey(l.connection.provider, l.externalId));
      const checked: string[] = [];
      for (const s of sources) {
        const resolved = getCalendarSourceUrl(s, org.id);
        if (resolved.ok) {
          keys.push(icalIdentityKey(resolved.url));
          checked.push(s.id);
        } else unreadable += 1;
      }
      if (keys.length > 0) await recordTrialIdentities(org.id, keys, { enforce: false, now });
      if (checked.length > 0) {
        await prisma.calendarSource.updateMany({ where: { id: { in: checked }, trialIdentityCheckedAt: null }, data: { trialIdentityCheckedAt: now } });
      }
    }
    // Takvim adresi okunamayan kaynak sessizce kaybolmasın (Haiku incelemesi): işaret yine yazılır ama operatör haberdar olur.
    if (unreadable > 0) void reportError("trial-identity backfill", new Error(`${unreadable} takvim kaynağının adresi okunamadı — kimliği kaydedilmedi`));
    await prisma.systemLock.createMany({ data: [{ name: TRIAL_IDENTITY_BACKFILL_MARKER, lockedUntil: new Date("9999-12-31T00:00:00Z") }], skipDuplicates: true });
    return "done";
  } catch (err) {
    void reportError("trial-identity backfill", err);
    return "skipped";
  }
}
