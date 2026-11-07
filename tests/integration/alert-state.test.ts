import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// GEÇİŞ TABANLI ALARM (09-23 olayının sınıf düzeltmesi) — sözleşme pinleri.
// `reportError` mock'lanır; ölçülen şey "alarm yolu KAÇ KEZ çalıştı".
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));

import { reportError } from "@/lib/report-error";
import { IngestError } from "@/lib/channels/ingest";
import {
  alertOnTransition,
  clearAlertState,
  errorClassOf,
  sweepStaleAlertStates,
  ALERT_RETRY_AFTER_FAILED_SEND_MS,
} from "@/lib/alert-state";

const mockReport = vi.mocked(reportError);
const outage = () => new IngestError("hospitable", "outage", "hospitable ingest outage (HTTP 503)", 503);
const revoked = () => new IngestError("hospitable", "auth_revoked", "hospitable ingest auth_revoked (HTTP 401)", 401);

describe("alertOnTransition", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockReport.mockResolvedValue({ notified: true, throttled: false, configured: true });
  });

  it("🚨 kalıcı arıza: 30 geçişte TEK alarm (eskiden ~her 10 dk'da bir, günde ~130)", async () => {
    const results = [];
    for (let i = 0; i < 30; i++) results.push(await alertOnTransition("k1", "ctx", outage()));
    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(mockReport).toHaveBeenCalledWith("ctx", expect.any(IngestError)); // konu DEĞİŞMEZ
    expect(results.filter((r) => r === "alerted")).toHaveLength(1);
  });

  it("SINIF DEĞİŞİMİ yeniden alarm üretir (kesinti → yetki reddi yeni bir durumdur)", async () => {
    await alertOnTransition("k2", "ctx", outage());
    await alertOnTransition("k2", "ctx", outage());
    await alertOnTransition("k2", "ctx", revoked());
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it("toparlanma (clear) sonrası yeni arıza YENİDEN alarm üretir", async () => {
    await alertOnTransition("k3", "ctx", outage());
    await clearAlertState("k3");
    await alertOnTransition("k3", "ctx", outage());
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it("hatırlatma zamanı gelince aynı durum BİR kez daha bildirilir", async () => {
    const t0 = new Date("2026-09-23T10:00:00Z");
    await alertOnTransition("k4", "ctx", outage(), { remindMs: 60_000, now: t0 });
    await alertOnTransition("k4", "ctx", outage(), { remindMs: 60_000, now: new Date(t0.getTime() + 30_000) });
    expect(mockReport).toHaveBeenCalledTimes(1);
    await alertOnTransition("k4", "ctx", outage(), { remindMs: 60_000, now: new Date(t0.getTime() + 61_000) });
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it("anahtarlar bağımsızdır (bir org'un arızası başka org'un alarmını susturmaz)", async () => {
    await alertOnTransition("org-a", "ctx", outage());
    await alertOnTransition("org-b", "ctx", outage());
    expect(mockReport).toHaveBeenCalledTimes(2);
  });

  it("e-posta GİTMEDİYSE (sağlayıcı hatası) hatırlatma 15 dk'ya çekilir", async () => {
    mockReport.mockResolvedValueOnce({ notified: false, throttled: false, configured: true });
    const t0 = new Date("2026-09-23T10:00:00Z");
    await alertOnTransition("k5", "ctx", outage(), { now: t0 });
    const row = await prisma.systemLock.findUniqueOrThrow({ where: { name: "alert-state:k5" } });
    expect(row.lockedUntil.getTime()).toBe(t0.getTime() + ALERT_RETRY_AFTER_FAILED_SEND_MS);
  });

  it("izleyici: başarı yalnız AKTİF anahtara dokunur, düşen aşama kaydedilir ve aynı geçişte temizlenebilir", async () => {
    const { alertTracker, __alertStateClearCount } = await import("@/lib/alert-state");
    await alertOnTransition("p:a", "ctx", outage()); // önceki geçişten kalan alarm
    const t = await alertTracker("p:");
    const clearsBefore = __alertStateClearCount();
    for (let i = 0; i < 50; i++) await t.ok("b"); // alarmda değil → SORGU YOK (sağlıklı yolun maliyeti)
    expect(__alertStateClearCount(), "sağlıklı yolda koşulsuz silme sorgusu atılıyor").toBe(clearsBefore);
    expect(await prisma.systemLock.count()).toBe(1);
    await t.ok("a"); // alarmdaydı → temizlenir
    expect(await prisma.systemLock.count()).toBe(0);
    await t.fail("c", "ctx", outage()); // bu geçişte düştü
    await t.ok("c"); // aynı izleyici onu biliyor → temizleyebilir
    expect(await prisma.systemLock.count()).toBe(0);
  });

  it("e-posta KISITA takıldıysa (başka anahtar aynı başlığı az önce kullandı) hatırlatma 15 dk'ya çekilir", async () => {
    mockReport.mockResolvedValueOnce({ notified: false, throttled: true, configured: true });
    const t0 = new Date("2026-09-23T10:00:00Z");
    await alertOnTransition("k7", "ctx", outage(), { now: t0 });
    const row = await prisma.systemLock.findUniqueOrThrow({ where: { name: "alert-state:k7" } });
    expect(row.lockedUntil.getTime()).toBe(t0.getTime() + ALERT_RETRY_AFTER_FAILED_SEND_MS);
  });

  it("alarm yolu bozuk bir sonuçla (undefined) geçişi DÜŞÜRMEZ", async () => {
    mockReport.mockResolvedValueOnce(undefined as never);
    await expect(alertOnTransition("k8", "ctx", outage())).resolves.toBe("alerted");
  });

  it("sahipsiz durum satırları 30 gün sonra süpürülür, tazeleri kalır", async () => {
    await alertOnTransition("fresh", "ctx", outage());
    await prisma.$executeRaw`
      INSERT INTO "SystemLock" ("name","lockedUntil","holder","updatedAt")
      VALUES ('alert-state:stale', now(), 'x', now() - interval '31 days')`;
    await prisma.$executeRaw`
      INSERT INTO "SystemLock" ("name","lockedUntil","holder","updatedAt")
      VALUES ('scheduled-sync', now(), 'x', now() - interval '31 days')`;
    expect(await sweepStaleAlertStates()).toBe(1);
    const names = (await prisma.systemLock.findMany({ select: { name: true } })).map((r) => r.name).sort();
    expect(names).toEqual(["alert-state:fresh", "scheduled-sync"]); // başka kilitlere DOKUNMAZ
  });
});

describe("errorClassOf — sınırlı çeşitlilik, mesaj METNİ taşımaz", () => {
  it("ingest hatası tür + durumla sınıflanır", () => {
    expect(errorClassOf(outage())).toBe("ingest:outage:503");
    expect(errorClassOf(new IngestError("hospitable", "outage", "ağ"))).toBe("ingest:outage:-");
  });

  it("mesaj metni (PII taşıyabilir) sınıfa GİRMEZ", () => {
    const e = new Error("Misafir Ahmet Yılmaz +90 555 000 00 00 için kayıt başarısız");
    expect(errorClassOf(e)).toBe("Error");
    const p = Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), { name: "PrismaClientKnownRequestError", code: "P2002" });
    expect(errorClassOf(p)).toBe("PrismaClientKnownRequestError:P2002");
  });
});
