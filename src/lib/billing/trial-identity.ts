import "server-only";

import { createHash, createHmac, scryptSync } from "crypto";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { reportError } from "@/lib/report-error";
import { isFounderOrg } from "@/lib/billing/subscription";

// ---------------------------------------------------------------------------
// DENEME KİMLİĞİ (kurucu onayı 10-10; `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md` §3–4).
// Sorun: aynı kişi yeni e-postayla yeni hesap açıp aynı ilan / takvimle yeniden 14 gün ücretsiz deneme alabiliyordu.
// Kural: işletmeyi dışarıdan tanımlayan kimlik (ilan / takvim) DAHA ÖNCE başka bir hesapta görüldüyse bu hesap İŞARETLENİR
// (`Organization.trialIdentityReusedAt`) ve operatörün risk listesine düşer. 🚨 K1-B (kurucu 10-17, Codex önerisiyle: "ilan kimliği işletme /
// insan kimliği değildir — yeni yönetici olabilir"): deneme OTOMATİK BİTİRİLMEZ, müşteriye metin GİTMEZ (10-10'daki "deneme o an biter" kuralı
// anahtar hiç açılmadan kaldırıldı). Ödeme yapan / istisnalı / kurucu hesabı işaretlenmez; operatör "denemeyi geri ver" ile işareti kaldırır.
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

/**
 * ESKİ kural (10-10) denemeyi bitirince yazılan `Subscription.trialEndReason`. K1-B'den sonra YENİ yazım yok; yalnız eski satırlar için
 * okunur (risk listesi, "denemeyi geri ver", ayarlar notu).
 */
export const TRIAL_END_REASON_IDENTITY_REUSED = "identity_reused";

/** Kurucu onaylı müşteri metni (10-10) — YALNIZ eski kuralla bitmiş deneme için ayarlarda (K1-B'den sonra yeni hesaba gösterilmez). */
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

/** Rezervasyon kanalının bilinen alan adı uzantıları (kapalı küme; eksik uzantı yalnız kuralı devre dışı bırakır). */
const AIRBNB_SUFFIXES = new Set([
  "com", "com.tr", "co.uk", "de", "fr", "es", "it", "nl", "ie", "ch", "at", "be", "pt", "gr", "pl", "se", "dk", "no", "fi", "cz", "hu",
  "ru", "ca", "com.au", "co.nz", "jp", "co.kr", "com.br", "mx", "com.mx", "com.ar", "cl", "co.in", "com.sg", "com.hk", "ae", "co.za",
]);
const VRBO_SUFFIXES = new Set(["com", "co.uk", "de", "fr", "es", "it", "nl", "pt", "ca", "com.au", "com.br", "com.mx"]);

/** `host` = isteğe bağlı `www.` / dil alt alanı + `<marka>.<listedeki uzantı>`. */
function otaHostMatches(host: string, brand: string, suffixes: ReadonlySet<string>): boolean {
  const m = /^(?:(?:www|[a-z]{2})\.)?([a-z]+)\.([a-z.]+)$/.exec(host);
  return Boolean(m && m[1] === brand && suffixes.has(m[2]));
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
  // Alan adı SIKI + KAPALI uzantı listesi (kendi testimiz `airbnb.com.evil.example`, Haiku `airbnb.io`): listede olmayan uzantı → kimlik
  // yok (kural işlemez; meşru müşteri hiçbir zaman yanlış yere düşmez).
  if (otaHostMatches(host, "airbnb", AIRBNB_SUFFIXES)) {
    const m = /\/calendar\/ical\/(\d{1,20})(?:\.ics)?$/i.exec(path);
    return m ? otaListingKey("airbnb", m[1]) : null;
  }
  if (/(^|\.)booking\.com$/.test(host)) {
    const t = u.searchParams.get("t")?.trim();
    return t && /^[A-Za-z0-9_-]{8,128}$/.test(t) ? { type: "ota_calendar", value: `booking:${t}` } : null;
  }
  if (otaHostMatches(host, "vrbo", VRBO_SUFFIXES) || otaHostMatches(host, "homeaway", VRBO_SUFFIXES)) {
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

/** Özet anahtarının PARMAK İZİ (anahtarın kendisi değil, geri döndürülemez). */
function identityKeyFingerprint(): string {
  return `fp:${createHash("sha256").update(identityKey()).digest("hex").slice(0, 16)}`;
}

type RecordResult = { reused: boolean; flagged: boolean; ok: boolean };

/**
 * Kimlikleri kaydet ve başka hesapta görülmüş olanı bildir. `enforce: false` yalnız kaydeder — kimseyi işaretlemez. Önce HAZIRLIK
 * (`readyForRecording`): anahtar parmak izi uyumu + geri doldurmanın TAM olması; hazır değilse hiçbir şey yazılmaz (`ok: false`). Asla fırlatmaz.
 */
export async function recordTrialIdentities(
  organizationId: string,
  keys: readonly (TrialIdentityKey | null)[],
  opts: { enforce?: boolean; now?: Date } = {},
): Promise<RecordResult> {
  if (!trialIdentityEnabled()) return { reused: false, flagged: false, ok: true };
  const now = opts.now ?? new Date();
  if (!(await readyForRecording(now))) return { reused: false, flagged: false, ok: false };
  return recordKeys(organizationId, keys, { enforce: opts.enforce !== false, now });
}

/** Asıl kayıt (hazırlık YAPILMIŞ varsayılır — geri doldurma ve hazırlık sonrası çağıranlar). */
async function recordKeys(
  organizationId: string,
  keys: readonly (TrialIdentityKey | null)[],
  opts: { enforce: boolean; now: Date },
): Promise<RecordResult> {
  const { now } = opts;
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
    if (!reused || !opts.enforce) return { reused, flagged: false, ok: true };
    return { reused, flagged: await flagReusedIdentity(organizationId, now), ok: true };
  } catch (err) {
    // `ok: false` → çağıran yeniden denenebilir kalır (takvim kaynağının "sayıldı" işareti geri alınır; Haiku: sessiz kayıp).
    void reportError(`trial-identity org=${organizationId}`, err);
    return { reused, flagged: false, ok: false };
  }
}

/**
 * Anahtarın SON açıldığı an (SystemLock satırı; `lockedUntil` bu ANI taşır, açıkken hiç güncellenmez — ilk gözlem kazanır). Anahtar
 * kapalıyken zamanlanmış geçiş bu satırı ve geri doldurma işaretini SİLER (Haiku: kapalıyken eklenen ilan kaybolmasın) → yeniden açılış
 * yeni açılış anı + yeni geri doldurma demektir; o ana kadarki her şey muaf kaydolur.
 */
export const TRIAL_IDENTITY_ENABLED_AT_MARKER = "trial-identity-enabled-at";

/**
 * Özet anahtarının parmak izi (SystemLock `holder`; hiç SİLİNMEZ). Anahtar değişirse (ENCRYPTION_KEY rotasyonu yasak ama AUTH_SECRET'e düşme
 * gibi) eski izler sessizce eşleşmez olurdu → uyuşmazlıkta kayıt DURUR ve alarm verilir (Haiku incelemesi). Bilinçli anahtar değişiminde
 * operatör `TrialIdentity` tablosunu ve bu satırı birlikte temizler.
 */
export const TRIAL_IDENTITY_KEY_FP_MARKER = "trial-identity-key-fp";

/** Açılış anı (yoksa `now` ile yazılır; yarışsız) — parmak izi uyuşmazsa null. */
async function enabledAtIfKeyMatches(now: Date): Promise<Date | null> {
  const fp = identityKeyFingerprint();
  await prisma.systemLock.createMany({
    data: [
      { name: TRIAL_IDENTITY_KEY_FP_MARKER, lockedUntil: new Date("9999-12-31T00:00:00Z"), holder: fp },
      { name: TRIAL_IDENTITY_ENABLED_AT_MARKER, lockedUntil: now },
    ],
    skipDuplicates: true,
  });
  const rows = await prisma.systemLock.findMany({
    where: { name: { in: [TRIAL_IDENTITY_KEY_FP_MARKER, TRIAL_IDENTITY_ENABLED_AT_MARKER] } },
    select: { name: true, lockedUntil: true, holder: true },
  });
  const fpRow = rows.find((r) => r.name === TRIAL_IDENTITY_KEY_FP_MARKER);
  const atRow = rows.find((r) => r.name === TRIAL_IDENTITY_ENABLED_AT_MARKER);
  if (!fpRow || !atRow) return null;
  if (fpRow.holder !== fp) {
    void reportError("trial-identity key-mismatch", new Error("Deneme kimliği özet anahtarı değişmiş — kayıt durduruldu (eski izler eşleşmez)."));
    return null;
  }
  return atRow.lockedUntil;
}

/**
 * KAYIT HAZIRLIĞI: anahtar parmak izi uyumlu VE geri doldurma TAM (Haiku: kısmi geri doldurmada yeni hesap eski hesabın ilanının kalıcı
 * "ilk sahibi" olurdu). Hazırsa açılış anı döner; değilse null — çağıran hiçbir kimlik yazmaz (takvim sonraki okumada yeniden dener).
 */
async function readyForRecording(now: Date): Promise<{ enabledAt: Date } | null> {
  const enabledAt = await enabledAtIfKeyMatches(now);
  if (!enabledAt) return null;
  const backfill = await backfillTrialIdentitiesOnce(now);
  return backfill === "done" || backfill === "skipped" ? { enabledAt } : null;
}

/**
 * 🚨 TAKVİM KİMLİĞİ YALNIZ GERÇEK OKUMADA SAYILIR (kendi incelememiz 10-10): Airbnb ilan numarası herkese açıktır; kimlik eklemede sayılsaydı
 * biri sahte jetonlu bir adresle başkasının ilanını önceden "kapar", gerçek sahip kaydolunca denemesi biterdi. Senkron, sunucu GEÇERLİ bir
 * takvim döndürdüğünde (doğru jeton = takvimin sahibi) bunu çağırır. Kaynak başına BİR KEZ (`trialIdentityCheckedAt` koşullu yazımı —
 * yarışsız; kayıt başarısız olursa işaret GERİ ALINIR, sonraki senkron yeniden dener).
 * 🚨 ANAHTARDAN ÖNCE EKLENMİŞ TAKVİM MUAFTIR (Haiku incelemesi): yalnız kayda geçer, kimsenin denemesini bitirmez — anahtar açıldığı an
 * hata durumunda olup sonra düzelen eski takvim de dahil. Ceza yalnız anahtar açıldıktan SONRA eklenen takvimin okunmasında.
 * Asla fırlatmaz.
 */
export async function recordVerifiedCalendarIdentity(
  source: { id: string; createdAt: Date },
  organizationId: string,
  feedUrl: string,
  now: Date = new Date(),
): Promise<{ reused: boolean; flagged: boolean }> {
  const none = { reused: false, flagged: false };
  if (!trialIdentityEnabled()) return none;
  const key = icalIdentityKey(feedUrl);
  if (!key) return none;
  try {
    // Hazırlık: anahtar parmak izi + TAM geri doldurma (anahtar öncesi kimlikler, en eski hesap ilk). Hazır değilse işaret ALINMAZ.
    const ready = await readyForRecording(now);
    if (!ready) return none;
    const claimed = await prisma.calendarSource.updateMany({
      where: { id: source.id, trialIdentityCheckedAt: null },
      data: { trialIdentityCheckedAt: now },
    });
    if (claimed.count === 0) return none;
    // Açılış anıyla aynı milisaniyede eklenen takvim muaf sayılır (geri doldurmayla aynı sınır, güvenli yön).
    const res = await recordKeys(organizationId, [key], { now, enforce: source.createdAt > ready.enabledAt });
    if (!res.ok) {
      await prisma.calendarSource.updateMany({ where: { id: source.id, trialIdentityCheckedAt: now }, data: { trialIdentityCheckedAt: null } });
      return none;
    }
    return { reused: res.reused, flagged: res.flagged };
  } catch (err) {
    // İşaret geri alınamadıysa kaynak bir daha sayılmaz — kaynak kimliğiyle bildirilir (Haiku: operatöre görünür olsun).
    void reportError(`trial-identity calendar org=${organizationId} source=${source.id}`, err);
    return none;
  }
}

/**
 * K1-B: hesabı İŞARETLE (deneme sürer). Ödeme yapan hesap ve kurucu hesabı işaretlenmez (risk listesi yalnız deneme hesaplarını gösterir; ödeyen
 * müşteriyi "riskli" diye kaydetmenin anlamı yok); istisnalı hesap işaretlenmez. Koşullar UPDATE'in içinde, ilk gözlem kazanır (yarışsız — tek
 * denetim kaydı).
 */
async function flagReusedIdentity(organizationId: string, now: Date): Promise<boolean> {
  if (isFounderOrg(organizationId)) return false;
  const res = await prisma.organization.updateMany({
    where: { id: organizationId, trialIdentityExempt: false, trialIdentityReusedAt: null, subscription: { is: { provider: "trial" } } },
    data: { trialIdentityReusedAt: now },
  });
  if (res.count === 0) return false;
  await writeAudit({ organizationId, action: "trial.identity_reused_flagged" });
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

/** Geri doldurma işareti (SystemLock adı): YALNIZ TAM tamamlanınca yazılır, bir daha koşmaz (anahtar kapanınca silinir). */
export const TRIAL_IDENTITY_BACKFILL_MARKER = "trial-identity-backfill-v1";

/** U37 düzeltmesinden (10-08) önceki okuma "ok"u güvenilmez (HTML hata gövdesi "ok" yazılabiliyordu) → geri doldurma onları saymaz. */
const TRUSTED_READ_SINCE = new Date("2026-10-08T00:00:00Z");

/**
 * İLK AÇILIŞ GERİ DOLDURMASI: anahtar açıldığında, açılıştan ÖNCE var olan ilan eşlemelerini ve GÜVENİLİR okunmuş takvimleri BİR KEZ kaydeder
 * — yoksa anahtar öncesi bağlanmış bir ilanla yeni hesap açan kişi "ilk" sayılırdı. En eski kuruluş önce (ilk görülen hak sahibi odur).
 * YALNIZ KAYDEDER (`enforce: false`). İşletme başına hata yalıtımı (biri bozuksa diğerleri yine kaydedilir; sayı operatöre bildirilir);
 * takvim yalnız kaydı BAŞARILI olunca "sayıldı" işaretlenir. Asla fırlatmaz.
 */
export async function backfillTrialIdentitiesOnce(now: Date = new Date()): Promise<"off" | "skipped" | "done" | "incomplete"> {
  if (!trialIdentityEnabled()) {
    // Kapalıyken açılış anı + geri doldurma işareti sıfırlanır (yeniden açılış = yeni açılış). Parmak izi satırı KALIR. İz satırlarına dokunulmaz.
    await prisma.systemLock
      .deleteMany({ where: { name: { in: [TRIAL_IDENTITY_ENABLED_AT_MARKER, TRIAL_IDENTITY_BACKFILL_MARKER] } } })
      .catch(() => {});
    return "off";
  }
  try {
    if (await prisma.systemLock.findUnique({ where: { name: TRIAL_IDENTITY_BACKFILL_MARKER }, select: { name: true } })) return "skipped";
    const enabledAt = await enabledAtIfKeyMatches(now);
    if (!enabledAt) return "incomplete";
    const { getCalendarSourceUrl } = await import("@/lib/calendar-source-url-core");
    const orgs = await prisma.organization.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
    let unreadable = 0;
    let failedOrgs = 0;
    for (const org of orgs) {
      try {
        const listings = await prisma.channelListing.findMany({
          // `lte`: açılış anıyla AYNI milisaniyede oluşan kayıt "anahtar öncesi" sayılır (güvenli yön; CI 10-10: katı `lt` ile aynı
          // milisaniyedeki eşleme ne önce ne sonra sayılıp kayda HİÇ geçmiyordu).
          where: { organizationId: org.id, createdAt: { lte: enabledAt } },
          select: { externalId: true, connection: { select: { provider: true } } },
        });
        // Yalnız GÜVENİLİR okunmuş takvim (bkz. `recordVerifiedCalendarIdentity`); okunmamış eski kaynak ilk gerçek okumasında muaf kaydolur.
        const sources = await prisma.calendarSource.findMany({
          where: {
            property: { organizationId: org.id },
            createdAt: { lte: enabledAt },
            trialIdentityCheckedAt: null,
            lastStatus: { in: ["ok", "partial"] },
            lastSyncedAt: { gte: TRUSTED_READ_SINCE },
          },
          select: { url: true, urlEnc: true, urlKeyFp: true, id: true },
        });
        const keys: (TrialIdentityKey | null)[] = listings.map((l) => channelListingIdentityKey(l.connection.provider, l.externalId));
        const checked: string[] = [];
        for (const src of sources) {
          const resolved = getCalendarSourceUrl(src, org.id);
          if (resolved.ok) {
            keys.push(icalIdentityKey(resolved.url));
            checked.push(src.id);
          } else unreadable += 1;
        }
        if (keys.length === 0) continue;
        const res = await recordKeys(org.id, keys, { enforce: false, now });
        if (!res.ok) {
          failedOrgs += 1;
          continue;
        }
        if (checked.length > 0) {
          await prisma.calendarSource.updateMany({ where: { id: { in: checked }, trialIdentityCheckedAt: null }, data: { trialIdentityCheckedAt: now } });
        }
      } catch (err) {
        failedOrgs += 1;
        void reportError(`trial-identity backfill org=${org.id}`, err);
      }
    }
    if (unreadable > 0) void reportError("trial-identity backfill", new Error(`${unreadable} takvim adresi okunamadı — kimliği kaydedilmedi`));
    // 🚨 KISMİ GERİ DOLDURMA TAMAMLANMIŞ SAYILMAZ (Haiku üçüncü inceleme): işaret yazılmaz, sonraki geçiş yeniden dener (kayıt tekrarı
    // zararsız); bu arada hiçbir kimlik yazılmaz (`readyForRecording`). Alarm bağlam başına kısılır.
    if (failedOrgs > 0) {
      void reportError("trial-identity backfill", new Error(`${failedOrgs} işletme kaydedilemedi — geri doldurma tamamlanmadı`));
      return "incomplete";
    }
    await prisma.systemLock.createMany({ data: [{ name: TRIAL_IDENTITY_BACKFILL_MARKER, lockedUntil: new Date("9999-12-31T00:00:00Z") }], skipDuplicates: true });
    return "done";
  } catch (err) {
    void reportError("trial-identity backfill", err);
    return "incomplete";
  }
}
