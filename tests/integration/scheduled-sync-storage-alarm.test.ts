import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeStorageAdapter } from "../helpers/fake-storage";
import { enqueueStorageDeletions } from "@/lib/storage/deletion-queue";

// ---------------------------------------------------------------------------
// 15 ajan A11 (10-01): başarısız depo silmesi zamanlanmış geçişin GEÇİŞ TABANLI alarmına gider. Eskiden kuyruk her başarısız
// geçişte doğrudan `reportError` çağırıyor, geçiş ise `ok("storage-deletions")` yazıyordu → kalıcı sağlayıcı arızasında 2 dakikada
// bir e-posta (günde ~144) ve alarm durumu hiç "arızalı" olmuyordu. Bu dosya BAĞLANTIYI sınar: kuyruğun sayısı geçişin alarmına.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));
let fake = new FakeStorageAdapter();
vi.mock("@/lib/storage/adapter", () => ({ getStorageAdapter: () => fake }));

import { runScheduledSync } from "@/lib/scheduled-sync";
import { reportError } from "@/lib/report-error";

// Kuyruk yalnız sağlayıcı yapılandırılmışken boşalır (`storageConfigured`); sağlayıcı yine sahte.
const STORAGE_ENV = {
  STORAGE_ENDPOINT: "https://acc.r2.cloudflarestorage.com",
  STORAGE_BUCKET: "lixus-photos",
  STORAGE_ACCESS_KEY_ID: "AKIDEXAMPLE",
  STORAGE_SECRET_ACCESS_KEY: "provider-secret",
};
const STATE = "alert-state:scheduled-sync:storage-deletions";
const CONTEXT = "scheduled-sync storage-deletions";
const storageAlarms = () => vi.mocked(reportError).mock.calls.filter(([context]) => context === CONTEXT);
const makeDue = () => prisma.storageDeletion.updateMany({ data: { availableAt: new Date(Date.now() - 60_000) } });

describe("runScheduledSync × depo silme kuyruğu alarmı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    fake = new FakeStorageAdapter();
    for (const [k, v] of Object.entries(STORAGE_ENV)) vi.stubEnv(k, v);
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });

  it("🚨 kalıcı silme arızası: ilk geçişte TEK alarm + 'arızalı' durumu; sonraki başarısız geçiş yeni e-posta YAZMAZ; düzelince durum temizlenir", async () => {
    await makeOrgWithProperty();
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png"]);
    fake.failDeletes = true;

    expect((await runScheduledSync()).ok).toBe(true);
    expect(fake.deletes).toHaveLength(1); // kuyruk gerçekten koştu
    expect(await prisma.systemLock.count({ where: { name: STATE } })).toBe(1);
    expect(storageAlarms()).toHaveLength(1);

    // Aynı arıza sürüyor (satır yeniden vadeye çekilir): yeni alarm e-postası yok, durum korunur.
    await makeDue();
    expect((await runScheduledSync()).ok).toBe(true);
    expect(fake.deletes).toHaveLength(2);
    expect(storageAlarms()).toHaveLength(1);
    expect(await prisma.systemLock.count({ where: { name: STATE } })).toBe(1);

    // Sağlayıcı düzeldi: satır silinir, alarm durumu kalkar.
    fake.failDeletes = false;
    await makeDue();
    expect((await runScheduledSync()).ok).toBe(true);
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("deleted");
    expect(await prisma.systemLock.count({ where: { name: STATE } })).toBe(0);
    expect(storageAlarms()).toHaveLength(1);
  });

  it("KONTROL: başarılı silme ve boş kuyruk alarm üretmez, durum yazmaz", async () => {
    await makeOrgWithProperty();
    expect((await runScheduledSync()).ok).toBe(true);
    await enqueueStorageDeletions(prisma, "o", ["org/o/task/t/a.png"]);
    expect((await runScheduledSync()).ok).toBe(true);
    expect((await prisma.storageDeletion.findFirstOrThrow()).status).toBe("deleted");
    expect(storageAlarms()).toHaveLength(0);
    expect(await prisma.systemLock.count({ where: { name: STATE } })).toBe(0);
  });
});
