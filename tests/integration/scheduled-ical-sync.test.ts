import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ZAMANLANMIŞ iCal GEÇİŞİ (08-08) — kapatılan açığın davranışsal pini.
//
// 🚨 AÇIK: `runScheduledSync` takvim modülünden HİÇBİR ŞEY import etmiyordu.
// `syncAllSourcesForOrg`'un tek çağıranı oturum-kapılı `/api/calendar/sync`
// (üstelik ön yüzde çağıranı YOK), `syncCalendarSource`'unki ise "Senkronla"
// düğmesiydi. Yani host Airbnb iCal bağlantısını ekliyor, bir kez tıklıyor ve
// besleme ORADA DONUYORDU: ertesi gün gelen rezervasyon panelde görünmüyor,
// temizlik görevi doğmuyor, doluluk yanlış → ÇİFTE REZERVASYON.
//
// Bu dosya davranışsal: `runScheduledSync()` GERÇEKTEN çağrılır ve rezervasyonun
// DB'ye düşüp düşmediğine bakılır. Kaynak taraması bilinçli KULLANILMADI (bu
// depoda tek yönlü olduğu defalarca ölçüldü).
//
// ⚠️ Feed HTTP katmanı (`fetchFeedText`: node:https + pinned lookup + 15 sn
// toplam deadline + 10 MB tavan) burada MOCK'lanır — kardeş dosyalarda
// (`pinned-fetch.test.ts`, `calendar-sync.test.ts`) zaten sınanıyor. Burada
// sınanan şey ZAMANLAMA ve BÜTÇE.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-sync", () => ({ syncHospitable: vi.fn() }));
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
  HospitableError: class HospitableError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  redactSensitive: (s: string) => s,
}));

import { syncHospitable } from "@/lib/hospitable-sync";
import { HospitableError } from "@/lib/hospitable";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { runScheduledSync } from "@/lib/scheduled-sync";

const mockHospitable = vi.mocked(syncHospitable);
const mockFeed = vi.mocked(fetchFeedText);

/** `SyncResult` şeklinde boş sonuç. */
const ZERO = {
  properties: 0,
  reservations: 0,
  conversations: 0,
  messages: 0,
  threads: 0,
  skipped: 0,
  propertiesCapped: 0,
  reservationsUnwritable: 0,
  messagesUnimportable: 0,
};

// Tarihler DİNAMİK: sabit tarihler, geçmişe düştükleri gün testi kod
// değişmeden bozar (kardeş dosyanın öğrendiği ders).
const DAY = 86_400_000;
const icsDate = (daysFromToday: number) =>
  new Date(Date.now() + daysFromToday * DAY).toISOString().slice(0, 10).replace(/-/g, "");

function icsEvent(uid: string, name: string, from: number, to: number): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${icsDate(from)}`,
    `DTEND;VALUE=DATE:${icsDate(to)}`,
    `SUMMARY:${name}`,
    "END:VEVENT",
  ].join("\n");
}

function ics(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Airbnb//Hosting Calendar//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\n");
}

const TWO_STAYS = ics(
  icsEvent("uid-1@airbnb.com", "Ahmet Yilmaz", 5, 9),
  icsEvent("uid-2@airbnb.com", "Jane Doe", 11, 13),
);
const ONE_STAY = ics(icsEvent("uid-1@airbnb.com", "Ahmet Yilmaz", 5, 9));

async function orgWithProperty(name: string) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: `P-${name}` },
  });
  return { orgId: org.id, propertyId: property.id };
}

async function addSource(propertyId: string, opts?: { url?: string; lastSyncedAt?: Date | null }) {
  return prisma.calendarSource.create({
    data: {
      propertyId,
      label: "Airbnb",
      url: opts?.url ?? "https://example.com/cal.ics",
      lastSyncedAt: opts?.lastSyncedAt ?? null,
    },
  });
}

describe("runScheduledSync — iCal (Kanal Takvimleri) bacağı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockHospitable.mockResolvedValue(ZERO as never);
    mockFeed.mockResolvedValue(TWO_STAYS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1) ÇEKİRDEK: zamanlanmış geçiş beslemeyi GERÇEKTEN çeker.
  //    MUTASYON (kaldır → kırmızı): `scheduled-sync.ts`'teki
  //    `syncDueCalendarSourcesForOrg` çağrısını sil → 0 rezervasyon.
  // ───────────────────────────────────────────────────────────────────────────
  it("host hiçbir düğmeye basmadan besleme senkronlanır (kapatılan AÇIK)", async () => {
    const { propertyId } = await orgWithProperty("A");
    const source = await addSource(propertyId);

    const totals = await runScheduledSync();

    expect(totals.ok).toBe(true);
    expect(mockFeed).toHaveBeenCalledTimes(1);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    expect(totals.icalSources).toBe(1);
    expect(totals.icalImported).toBe(2);
    // Damga ilerledi → kadans penceresi bu kaynağı bir süre TEKRAR çekmez.
    const row = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(row.lastSyncedAt).not.toBeNull();
    expect(row.lastStatus).toBe("ok");
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2) KADANS. İki yön birden: taze kaynak ÇEKİLMEZ, bayat kaynak ÇEKİLİR.
  //    MUTASYON (koşulsuz yap → kırmızı): vade filtresindeki OR'u kaldırıp her
  //    kaynağı "vadesi gelmiş" say → ilk assertion (0 çağrı) kırmızıya döner.
  // ───────────────────────────────────────────────────────────────────────────
  it("kadans: yeni senkronlanmış kaynak TEKRAR ÇEKİLMEZ, bayat olan ÇEKİLİR", async () => {
    const { propertyId } = await orgWithProperty("A");
    const source = await addSource(propertyId, { lastSyncedAt: new Date(Date.now() - 60_000) });

    const first = await runScheduledSync();
    expect(mockFeed).not.toHaveBeenCalled();
    expect(first.icalSources).toBeUndefined();

    // Pencereyi (varsayılan 15 dk) aş → aynı kaynak artık vadesi gelmiş.
    await prisma.calendarSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date(Date.now() - 20 * 60_000) },
    });
    const second = await runScheduledSync();
    expect(mockFeed).toHaveBeenCalledTimes(1);
    expect(second.icalSources).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) BESLEMESİ OLMAYAN KİRACI: sıfır iş, sıfır hata.
  // ───────────────────────────────────────────────────────────────────────────
  it("takvim kaynağı olmayan kiracıda sıfır iş, sıfır hata", async () => {
    await orgWithProperty("A");

    const totals = await runScheduledSync();

    expect(totals.ok).toBe(true);
    expect(totals.error).toBeUndefined();
    expect(mockFeed).not.toHaveBeenCalled();
    expect(totals.icalSources).toBeUndefined();
    expect(totals.icalDeferred).toBeUndefined();
    expect(totals.icalOrgsDeferred).toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4) HOSPITABLE ARIZASI iCal'İ DURDURMAZ.
  //    Bu, Nuve'nin BUGÜNKÜ hâli (Hospitable aboneliği 402). iCal `syncOk`
  //    kapısının ARKASINDA bırakılsaydı düzeltme tam da en gerekli vakada
  //    işlemezdi.
  //    MUTASYON (koşullu yap → kırmızı): iCal çağrısını `if (syncOk)` bloğunun
  //    içine al ya da `if (!syncOk) continue;` biçimini geri getir → 0 rezervasyon.
  // ───────────────────────────────────────────────────────────────────────────
  it("Hospitable 402 fırlatsa bile takvim beslemesi senkronlanır", async () => {
    const { propertyId } = await orgWithProperty("A");
    await addSource(propertyId);
    mockHospitable.mockRejectedValue(new HospitableError("Subscription not active", 402));

    const totals = await runScheduledSync();

    expect(totals.ok).toBe(true);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    expect(totals.icalSources).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5) BÜTÇE: kırpma GERÇEK, GÖRÜNÜR ve GERİ ALINABİLİR.
  //    · geçiş bütçesi dolunca YENİ kaynak BAŞLATILMAZ,
  //    · ertelenen kaynak kaybolmaz — damgası NULL kalır, sonraki geçiş alır,
  //    · tek satırlık `[scheduled-sync] ical:` WARN'ı sayıyı ve bütçeyi basar.
  //    MUTASYON (kaldır → kırmızı): `syncDueCalendarSourcesForOrg` döngüsündeki
  //    `if (Date.now() >= opts.deadline) break;` satırını sil → iki kaynak da
  //    senkronlanır, `deferred` 0 olur, WARN hiç basılmaz.
  // ───────────────────────────────────────────────────────────────────────────
  it("bütçe: fazla besleme SESSİZCE kırpılmaz, ertelenir ve loglanır", async () => {
    vi.stubEnv("ICAL_PASS_BUDGET_MS", "40");
    const { propertyId } = await orgWithProperty("A");
    await addSource(propertyId, { url: "https://example.com/a.ics" });
    await addSource(propertyId, { url: "https://example.com/b.ics" });
    // Her besleme bütçeden UZUN sürer → ikincisi başlatılamaz.
    mockFeed.mockImplementation(
      async () => new Promise<string>((r) => setTimeout(() => r(TWO_STAYS), 70)),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const totals = await runScheduledSync();

    expect(totals.icalSources).toBe(1);
    expect(totals.icalDeferred).toBe(1);
    expect(mockFeed).toHaveBeenCalledTimes(1);
    // Kırpma GÖRÜNÜR: tek satır, sayı + bütçe içinde.
    const line = warnSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("ical:"));
    expect(line).toBeDefined();
    expect(line).toContain("ertelenen kaynak: 1");
    expect(line).toContain("bütçe: geçiş 40 ms");

    // İŞ KAYBOLMADI: ertelenen kaynağın damgası hâlâ NULL → hâlâ vadesi gelmiş.
    const pending = await prisma.calendarSource.count({
      where: { propertyId, lastSyncedAt: null },
    });
    expect(pending).toBe(1);

    // Sonraki geçiş (bütçe normal) ertelenmiş kaynağı alır → kalıcı açlık YOK.
    vi.stubEnv("ICAL_PASS_BUDGET_MS", "");
    mockFeed.mockResolvedValue(TWO_STAYS);
    const next = await runScheduledSync();
    expect(next.icalSources).toBe(1);
    expect(next.icalDeferred).toBeUndefined();
    expect(await prisma.calendarSource.count({ where: { propertyId, lastSyncedAt: null } })).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6) 🚨 ZAMANLAMA, KAYBOLMA-UZLAŞTIRMASINI AÇMAZ.
  //    `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` DEFAULT KAPALI ve öyle KALMALI
  //    (geçmişte gerçek rezervasyonları toplu iptal etti). Zamanlı geçiş artık
  //    beslemeyi düzenli çektiği için bu kapının açık kalması ŞART.
  //    MUTASYON (koşulsuz yap → kırmızı): `feedReconcileEnabled()`'ı `true`
  //    döndür → kaybolan UID `feedMissingCount=1` alır ve `lastReconcileAt`
  //    yazılır; iki assertion da kırmızıya döner.
  // ───────────────────────────────────────────────────────────────────────────
  it("zamanlama uzlaştırmayı AÇMAZ: kaybolan UID iptal edilmez, sayaç yazılmaz", async () => {
    const { propertyId } = await orgWithProperty("A");
    const source = await addSource(propertyId);

    await runScheduledSync(); // iki konaklama içeri
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);

    // UID-2 beslemeden KAYBOLDU + kaynak yeniden vadesi gelmiş hâle getirildi.
    mockFeed.mockResolvedValue(ONE_STAY);
    await prisma.calendarSource.update({
      where: { id: source.id },
      data: { lastSyncedAt: new Date(Date.now() - 20 * 60_000) },
    });
    await runScheduledSync();

    const vanished = await prisma.reservation.findFirstOrThrow({
      where: { propertyId, sourceReference: "uid-2@airbnb.com" },
    });
    expect(vanished.status).toBe("confirmed"); // İPTAL EDİLMEDİ
    expect(vanished.feedMissingCount ?? 0).toBe(0); // sayaç HİÇ yazılmadı
    const src = await prisma.calendarSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(src.lastReconcileAt).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7) İZOLASYON: bozuk bir besleme sağlam olanı düşürmez.
  // ───────────────────────────────────────────────────────────────────────────
  it("bir besleme patlarsa diğeri yine senkronlanır ve geçiş ok kalır", async () => {
    const { propertyId } = await orgWithProperty("A");
    const bad = await addSource(propertyId, { url: "https://example.com/bad.ics" });
    const good = await addSource(propertyId, { url: "https://example.com/good.ics" });
    mockFeed.mockImplementation(async (url: string) => {
      if (url.includes("bad")) throw new Error("HTTP 500");
      return TWO_STAYS;
    });

    const totals = await runScheduledSync();

    expect(totals.ok).toBe(true);
    expect(totals.icalSources).toBe(2);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    const badRow = await prisma.calendarSource.findUniqueOrThrow({ where: { id: bad.id } });
    const goodRow = await prisma.calendarSource.findUniqueOrThrow({ where: { id: good.id } });
    expect(badRow.lastStatus).toBe("error");
    expect(goodRow.lastStatus).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// 🚨 BOŞ GEÇİŞ BOŞ OLMALI (08-08, ölçülerek bulundu).
//
// Bu yol her eşleşen rezervasyona KOŞULSUZ `updateMany` yazıyordu. Hiçbir şey
// değişmeyen bir geçiş ölçüldüğünde 43.252 Prisma işlemi / 7.104 UPDATE /
// 61,6 sn ediyordu — ve takvim senkronu cron'a bağlandığı için bu her 15
// dakikada tekrarlanan KALICI bir yük demekti (org bütçesi her geçişte aşılır,
// 15 dk'lık SystemLock TTL'ine doğru itilir → kilit kaybı → paralel geçiş).
// ---------------------------------------------------------------------------
describe("iCal: değişmeyen besleme İKİNCİ geçişte hiçbir satır YAZMAZ", () => {
  it("aynı feed iki kez senkronlanınca ikinci geçişte updated=0 olur", async () => {
    const { syncCalendarSource } = await import("@/lib/import/sync");
    const { propertyId } = await orgWithProperty("noop-pass");
    const feed = (summary: string) =>
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:degismeyen-1@airbnb.com",
        "DTSTART;VALUE=DATE:20260901",
        "DTEND;VALUE=DATE:20260904",
        `SUMMARY:${summary}`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n");

    vi.mocked(fetchFeedText).mockResolvedValue(feed("Deniz") as never);
    const source = await addSource(propertyId);

    const first = await syncCalendarSource(source.id);
    expect(first.imported).toBe(1);

    // İKİNCİ geçiş: feed BİREBİR aynı → hiçbir satır yazılmamalı.
    const second = await syncCalendarSource(source.id);
    expect(second.imported).toBe(0);
    expect(second.updated).toBe(0);

    // KONTROL: feed GERÇEKTEN değişirse yazma YİNE olmalı — yoksa bu test
    // "senkronu komple kapat" mutasyonunu da yeşil geçerdi.
    vi.mocked(fetchFeedText).mockResolvedValue(feed("Deniz Yılmaz") as never);
    const third = await syncCalendarSource(source.id);
    expect(third.updated).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 🚨 "DEĞİŞMEDİ → YAZMA" ATLAMASI GÖREV ONARIMINI ÖLDÜRMEMELİ (08-08).
//
// Eski koşulsuz UPDATE'in YAN ETKİSİ olarak her geçişte `createReservationTasks`
// çağrılıyordu ve bu, görev otomasyonundan ÖNCE içeri girmiş satırların
// görevlerini geriye dönük açan TEK yoldu. Yazmayı atlayınca onarım da
// atlanıyordu → satır sonsuza dek görevsiz kalıyordu.
// Onarım geri getirildi ama BİTMEMİŞ konaklamalarla sınırlandı.
// ---------------------------------------------------------------------------
describe("iCal bacağının KAPATMA ANAHTARI", () => {
  it("ICAL_SCHEDULED_SYNC_DISABLED=1 iken takvim bacağı HİÇ koşmaz, Hospitable bacağı KOŞAR", async () => {
    const { propertyId } = await orgWithProperty("killswitch");
    await addSource(propertyId);
    vi.mocked(fetchFeedText).mockResolvedValue(TWO_STAYS as never);

    vi.stubEnv("ICAL_SCHEDULED_SYNC_DISABLED", "1");
    const off = await runScheduledSync();
    vi.unstubAllEnvs();

    expect(off.icalSources ?? 0).toBe(0);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);

    // KONTROL: bayrak YOKKEN aynı kurulum GERÇEKTEN senkronluyor. Bu olmadan test,
    // takvim bacağını komple bozan bir mutasyonu da yeşil geçerdi.
    const on = await runScheduledSync();
    expect(on.icalSources ?? 0).toBeGreaterThan(0);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBeGreaterThan(0);
  });
});

describe("iCal: değişmemiş satırda görev onarımı", () => {
  it("görevleri silinmiş GELECEK konaklama, ikinci geçişte görevlerini geri alır", async () => {
    const { syncCalendarSource } = await import("@/lib/import/sync");
    const { propertyId } = await orgWithProperty("heal-tasks");
    const start = new Date(Date.now() + 10 * 86400_000);
    const end = new Date(Date.now() + 13 * 86400_000);
    const k = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const feed = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:heal-1@airbnb.com",
      `DTSTART;VALUE=DATE:${k(start)}`,
      `DTEND;VALUE=DATE:${k(end)}`,
      "SUMMARY:Deniz",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    vi.mocked(fetchFeedText).mockResolvedValue(feed as never);

    const source = await addSource(propertyId);
    await syncCalendarSource(source.id);
    const created = await prisma.task.count({ where: { propertyId } });
    expect(created).toBeGreaterThan(0);

    // Görevler kayboldu (create sırasında geçici hata / eski kayıt senaryosu).
    await prisma.task.deleteMany({ where: { propertyId } });

    // İkinci geçiş: satır DEĞİŞMEDİ (yazma olmamalı) ama görevler geri gelmeli.
    const second = await syncCalendarSource(source.id);
    expect(second.updated).toBe(0); // yazma YOK — atlama hâlâ çalışıyor
    expect(await prisma.task.count({ where: { propertyId } })).toBe(created);
  });

  // ⚠️ BURADA BİR TEST VARDI ve VACUOUS ÇIKTI — silindi, dersi kalsın.
  // "Konaklaması bitmiş satır için onarım koşmaz" diye asserte ediyordu ve
  // `task.count === 0` bekliyordu. Mutasyonla sınandı: `healTasks` koşulunu
  // KALDIRINCA da YEŞİL kaldı. Sebep ölçüldü — `createReservationTasks` geçmiş
  // tarihli konaklamaya zaten görev AÇMIYOR, yani sınırın davranışsal bir
  // karşılığı YOK. `healTasks` saf bir MALİYET korumasıdır (bitmiş konaklama
  // başına ~3 boşa sorgu engeller) ve maliyeti bu harness'ta gözlenemez.
  // Vacuous bir testi tutmak, olmayan bir korumayı var sanmaktır.

});
