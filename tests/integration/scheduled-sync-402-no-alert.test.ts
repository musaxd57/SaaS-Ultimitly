import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// 402 "ABONELİK PASİF" ALARM E-POSTASI ÜRETMEZ — GERÇEK ADAPTÖR YOLUNDAN (09-23 olayı)
//
// Canlı olay: kurucunun gelen kutusu "⚠️ Lixus AI sistem hatası — scheduled-sync
// org <id>" e-postalarıyla doldu; gövde "IngestError: hospitable ingest unknown
// (HTTP 402)". `scheduled-sync.ts` 402'yi 08-08'den beri SUSTURUYORDU — ama
// `err instanceof HospitableError` diye bakarak. V0.6 (`a2e60fe`, 09-07) okumayı
// ingest adaptörüne taşıdı ve adaptör hatayı `IngestError`a SARIYOR → kontrol o
// günden beri ÖLÜYDÜ ve her geçiş `reportError`a düşüyordu.
//
// 🚨 NEDEN HİÇBİR TEST GÖRMEDİ: kardeş dosya (`alerts-survive-sync-failure`) 402'yi
// TAM bu gerçek yoldan geçiriyor ama `reportError`ı yalnız MOCK'LUYOR, hiç
// SORGULAMIYOR; `scheduled-ical-sync` ise `syncHospitable`ın kendisini mock'layıp
// adaptörü hiç çalıştırmıyor. Yüklem vardı, iddia yoktu.
//
// Bu dosya hatayı TELDE göründüğü biçimde (`HospitableError(402)`) enjekte eder ve
// sarmayı GERÇEK adaptöre bırakır. Anti-vakumluk satırı bu yolun gerçekten
// SARILDIĞINI ayrıca iddia eder — yoksa test sarmal öncesi dünyayı sınardı ve
// bu olayı yine kaçırırdı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return {
    ...actual,
    isHospitableConfigured: () => true,
    listProperties: vi.fn(),
    listReservations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => undefined) };
});
// Uyarı aşamasını tek bir testte düşürebilmek için geçirgen sarmal (varsayılan: gerçek fonksiyon).
const { alertsStage } = vi.hoisted(() => ({ alertsStage: { fail: null as Error | null } }));
vi.mock("@/lib/automation", async (orig) => {
  const actual = await orig<typeof import("@/lib/automation")>();
  return {
    ...actual,
    sendDueAlerts: async (...args: Parameters<typeof actual.sendDueAlerts>) => {
      if (alertsStage.fail) throw alertsStage.fail;
      return actual.sendDueAlerts(...args);
    },
  };
});

import { listProperties, listReservations, HospitableError } from "@/lib/hospitable";
import { reportError } from "@/lib/report-error";
import { IngestError } from "@/lib/channels/ingest";
import { runScheduledSync } from "@/lib/scheduled-sync";
import { syncHospitable } from "@/lib/hospitable-sync";

const mockListProperties = vi.mocked(listProperties);
const mockListReservations = vi.mocked(listReservations);
const mockReport = vi.mocked(reportError);

/** Canlıdaki gerçek hata metni (`hospitable.ts` bu biçimde kuruyor). */
const wire402 = () =>
  new HospitableError('Hospitable API hatası (HTTP 402): {"message":"Subscription not active"}', 402);

async function seedOrg() {
  const org = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com", hospitableTokenEnc: "enc" },
  });
  await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  return org.id;
}

/** Bu org için senkron-hatası alarmı (e-postanın konusu tam olarak bu bağlamdan kurulur). */
const orgAlerts = (orgId: string) => mockReport.mock.calls.filter((c) => c[0] === `scheduled-sync org ${orgId}`);
/** Bağlamdan BAĞIMSIZ: 402'yi taşıyan HERHANGİ bir alarm (başka bir etiketle sızmasın). */
const any402Alert = () =>
  mockReport.mock.calls.filter((c) => (c[1] as { status?: number } | undefined)?.status === 402);

describe("scheduled-sync — Hospitable 402 (abonelik pasif) alarm üretmez", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("🚨 402 → ALARM YOK — tek geçişte de, art arda üç geçişte de (canlı olay)", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire402());

    for (let i = 0; i < 3; i++) {
      const res = await runScheduledSync();
      expect(res.ok, `geçiş ${i + 1}`).toBe(true);
    }

    expect(orgAlerts(orgId), "402 her geçişte alarm e-postası üretiyor").toEqual([]);
    expect(any402Alert(), "402 başka bir etiketle alarma sızdı").toEqual([]);
    // Görünmez DEĞİL: durum log'a yazılır (08-08'deki davranışın kendisi).
    expect(
      warn.mock.calls.some((c) => /subscription not active/i.test(String(c[0]))),
      "402 hiç iz bırakmıyor — sessiz yutma ile bilinçli susma ayırt edilemez",
    ).toBe(true);
  });

  it("402 DIŞINDAKİ sağlayıcı arızası (500) HÂLÂ alarm üretir — susturma DAR", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 500): x", 500));

    await runScheduledSync();

    const calls = orgAlerts(orgId);
    expect(calls).toHaveLength(1);
    // ANTİ-VAKUMLUK: bu test GERÇEK sarma yolunu sınıyor — alarma giden hata
    // adaptörün ürettiği `IngestError`dır, telde enjekte ettiğimiz `HospitableError`
    // DEĞİL. Bu satır düşerse test sarmal öncesi dünyayı sınıyor demektir.
    expect(calls[0][1]).toBeInstanceOf(IngestError);
    expect((calls[0][1] as IngestError).kind).toBe("outage");
    expect((calls[0][1] as IngestError).status).toBe(500);
  });

  it("401 (yetki reddi) HÂLÂ alarm üretir — eyleme dönük: bağlantı yeniden kurulmalı", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));

    await runScheduledSync();

    const calls = orgAlerts(orgId);
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as IngestError).kind).toBe("auth_revoked");
  });

  it("sağlayıcı DIŞI hata (ör. DB) HÂLÂ alarm üretir", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(new Error("boom"));

    await runScheduledSync();

    expect(orgAlerts(orgId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AYNI SINIF, İKİNCİ OKUYUCU: `syncHospitable`ın mülk başına hata dalı.
// `noteHospitableError` 401/403'ü ayırıp host'a "yeniden bağlan" alarmı üretir. O dal
// da sarmaldan geçen hatayı okuyor; 09-23 turunun mutasyon koşusu (M6) durum okumasını
// komple silen mutantın HAYATTA KALDIĞINI ölçtü — yani bu dal hiç pinli değildi.
// ---------------------------------------------------------------------------
describe("syncHospitable — mülk başına okuma hatası SARILMIŞ hâlde de doğru sınıflanır", () => {
  const authAlerts = (orgId: string) => mockReport.mock.calls.filter((c) => c[0] === `hospitable-auth org:${orgId}`);

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockListProperties.mockResolvedValue([{ id: "h-prop-1", name: "Lale 7" }] as never);
  });
  afterEach(() => {
    mockListReservations.mockResolvedValue([]); // sonraki dosya/testlere sızmasın
  });

  it("401 (rezervasyon okuması) → 'yeniden bağlan' alarmı TEK kez, sarılmış hatayla", async () => {
    const orgId = await seedOrg();
    mockListReservations.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));

    await syncHospitable(orgId);

    const calls = authAlerts(orgId);
    expect(calls, "yetki reddi sarmaldan sonra tanınmıyor").toHaveLength(1);
    expect(calls[0][1]).toBeInstanceOf(IngestError); // anti-vakumluk: gerçek sarma yolu
  });

  it("500 (rezervasyon okuması) → 'yeniden bağlan' DEĞİL; toplu fetch alarmına düşer", async () => {
    const orgId = await seedOrg();
    mockListReservations.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 500)", 500));

    await syncHospitable(orgId);

    expect(authAlerts(orgId), "sunucu arızası 'yeniden bağlan' diye raporlandı").toEqual([]);
    expect(mockReport.mock.calls.some((c) => c[0] === `hospitable-fetch org:${orgId}`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SINIF DÜZELTMESİ: KALICI ARIZA GEÇİŞ TABANLI ALARM ÜRETİR (09-23)
//
// 402 yalnız o günün TETİĞİYDİ. Asıl mekanizma: `reportError`ın kısıtı süreç
// belleğinde, context başına 10 dk → 2 dakikalık döngüde HERHANGİ bir kalıcı arıza
// (Hospitable kesintisi, env token'ına kalıcı 401, deterministik DB hatası) günde
// ~130 e-posta. Bu dosyadaki mock kısıtsızdır → eski kod her geçişte alarm verir;
// ölçülen şey "durum DEĞİŞMEDEN alarm tekrarlanıyor mu".
// ---------------------------------------------------------------------------
describe("scheduled-sync — kalıcı arıza geçiş tabanlı alarm üretir", () => {
  const wire500 = () => new HospitableError("Hospitable API hatası (HTTP 500): x", 500);

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.mocked(console.warn).mockRestore();
    mockListProperties.mockReset();
  });

  it("🚨 kalıcı 500: 5 geçişte TEK alarm (eskiden her geçişte bir)", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    for (let i = 0; i < 5; i++) expect((await runScheduledSync()).ok).toBe(true);
    expect(orgAlerts(orgId)).toHaveLength(1);
  });

  it("toparlanma durumu temizler → sonraki arıza YENİDEN ve hemen bildirilir", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    await runScheduledSync();
    mockListProperties.mockResolvedValue([] as never); // başarılı senkron
    await runScheduledSync();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    expect(orgAlerts(orgId)).toHaveLength(2);
  });

  it("SINIF DEĞİŞİMİ yeni bir durumdur: kesinti (500) → yetki reddi (401) yeniden alarm", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    mockListProperties.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    await runScheduledSync();
    await runScheduledSync();
    const calls = orgAlerts(orgId);
    expect(calls).toHaveLength(2);
    expect((calls[1][1] as IngestError).kind).toBe("auth_revoked");
  });

  it("402 bilinen bir dış durumdur: aşamanın alarm durumunu TEMİZLER (yenilenince gelen kesinti yeniden bildirilir)", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    mockListProperties.mockRejectedValue(wire402());
    await runScheduledSync();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    expect(orgAlerts(orgId)).toHaveLength(2);
    expect(any402Alert()).toEqual([]);
  });

  it("org'lar BAĞIMSIZ: bir org'un bastırılmış arızası başka org'un ilk alarmını yutmaz", async () => {
    const a = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    await runScheduledSync();
    const b = await seedOrg();
    await runScheduledSync();
    expect(orgAlerts(a)).toHaveLength(1);
    expect(orgAlerts(b)).toHaveLength(1);
  });

  it("aşamalar BAĞIMSIZ: senkron alarmdayken uyarı aşamasının YENİ arızası da bildirilir", async () => {
    const orgId = await seedOrg();
    mockListProperties.mockRejectedValue(wire500());
    alertsStage.fail = new TypeError("uyarı geçişi düştü");
    try {
      await runScheduledSync();
      await runScheduledSync();
    } finally {
      alertsStage.fail = null;
    }
    const calls = orgAlerts(orgId);
    // Senkron (IngestError) bir kez + uyarı aşaması (TypeError) bir kez; ikinci geçiş ikisini de bastırır.
    expect(calls.map((c) => (c[1] as Error).constructor.name).sort()).toEqual(["IngestError", "TypeError"]);
  });
});

describe("syncHospitable — toplulaştırılmış alarmlar da geçiş tabanlı", () => {
  const authAlerts = (orgId: string) => mockReport.mock.calls.filter((c) => c[0] === `hospitable-auth org:${orgId}`);

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockListProperties.mockResolvedValue([{ id: "h-prop-1", name: "Lale 7" }] as never);
  });
  afterEach(() => {
    mockListReservations.mockResolvedValue([]);
    mockListProperties.mockReset();
  });

  it("🚨 kalıcı mülk-başına 401: üç koşuda TEK 'yeniden bağlan' alarmı; 401 kalkınca temizlenir", async () => {
    const orgId = await seedOrg();
    mockListReservations.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    for (let i = 0; i < 3; i++) await syncHospitable(orgId);
    expect(authAlerts(orgId)).toHaveLength(1);

    mockListReservations.mockResolvedValue([]);
    await syncHospitable(orgId); // düzeldi → durum temizlenir
    mockListReservations.mockRejectedValue(new HospitableError("Hospitable API hatası (HTTP 401)", 401));
    await syncHospitable(orgId);
    expect(authAlerts(orgId)).toHaveLength(2);
  });
});
