import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decideTestDbAdmission, HARNESS_MARK } from "../../scripts/test-db-guard.mjs";

// ---------------------------------------------------------------------------
// TEST DB KAPISI (Codex F08 — P1, geliştirme güvenliği)
//
// 🚨 KAPATILAN AÇIK: `tests/global-setup.ts` HERHANGİ bir `TEST_DATABASE_URL`
// gördüğünde, hedefin atılabilir olduğunu kanıtlamadan
// `prisma db push --accept-data-loss` koşuyordu; sonra `tests/helpers/db.ts`
// her testte bütün tabloları boşaltıyor. Kabuğunda yanlış URL taşıyan biri tek
// `npm test` ile dolu bir DB'yi silebilirdi. Codex bunu sentetik
// `example.invalid/production` hedefiyle yeniden üretti (child-process
// yakalanıp yürütülmedi): setup tehlikeli komuta İLERLİYORDU.
//
// Kanıt burada iki katman: (1) saf karar fonksiyonu, (2) GERÇEK global-setup'ın
// `execSync`'e ulaşıp ulaşmadığı (child_process mock'lu — DB'ye bağlanılmaz,
// hiçbir şey silinmez).
// ---------------------------------------------------------------------------

const REMOTE = "postgresql://user:s3cr3tpass@db.example.invalid:5432/production";
const LOCAL = "postgresql://postgres@localhost:5433/guestops_test?schema=public";

const probeOf = (marked: boolean, userTables: number) =>
  vi.fn(async () => ({ marked, userTables }));
// Karar fonksiyonu `env`i `process.env` tipiyle alır; testte küçük sözlükler yeter.
const envOf = (o: Record<string, string> = {}) => o as unknown as NodeJS.ProcessEnv;

describe("decideTestDbAdmission — saf karar", () => {
  it("🚨 loopback DIŞI URL, açık izin yokken REDDEDİLİR ve DB'ye HİÇ bağlanılmaz", async () => {
    const probe = probeOf(true, 0);
    await expect(decideTestDbAdmission({ url: REMOTE, env: envOf(), probe })).rejects.toMatchObject({
      code: "TEST_DB_REFUSED",
    });
    expect(probe).not.toHaveBeenCalled(); // ağ konumu kararı bağlantıdan ÖNCE
  });

  it("hata mesajı URL'i / parolayı TAŞIMAZ", async () => {
    let msg = "";
    try {
      await decideTestDbAdmission({ url: REMOTE, env: envOf(), probe: probeOf(false, 9) });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("Refusing");
    expect(msg).not.toContain("example.invalid");
    expect(msg).not.toContain("s3cr3tpass");
  });

  it("🚨 loopback + DOLU + işaretsiz DB REDDEDİLİR (URL'de 'test' yazması yetmez)", async () => {
    await expect(
      decideTestDbAdmission({ url: LOCAL, env: envOf(), probe: probeOf(false, 12) }),
    ).rejects.toMatchObject({ code: "TEST_DB_REFUSED" });
  });

  it("loopback + BOŞ DB sahiplenilir → adopt:true (işaret yazılacak)", async () => {
    await expect(decideTestDbAdmission({ url: LOCAL, env: envOf(), probe: probeOf(false, 0) })).resolves.toEqual({
      admitted: true,
      adopt: true,
    });
  });

  it("KONTROL: işaretli loopback DB kabul edilir, yeniden işaretlenmez", async () => {
    // Bu olmadan "her şeyi reddet" mutasyonu da yeşil geçerdi.
    await expect(decideTestDbAdmission({ url: LOCAL, env: envOf(), probe: probeOf(true, 40) })).resolves.toEqual({
      admitted: true,
      adopt: false,
    });
  });

  it("TEST_DB_ADOPT=1 dolu+işaretsiz DB'yi BİLİNÇLİ sahiplenir (tek seferlik kaçış)", async () => {
    await expect(
      decideTestDbAdmission({ url: LOCAL, env: envOf({ TEST_DB_ADOPT: "1" }), probe: probeOf(false, 12) }),
    ).resolves.toEqual({ admitted: true, adopt: true });
  });

  it("uzak DB: TEST_DB_ALLOW_REMOTE=1 TEK BAŞINA yetmez — işaret de gerekir", async () => {
    await expect(
      decideTestDbAdmission({ url: REMOTE, env: envOf({ TEST_DB_ALLOW_REMOTE: "1" }), probe: probeOf(false, 12) }),
    ).rejects.toMatchObject({ code: "TEST_DB_REFUSED" });
    await expect(
      decideTestDbAdmission({ url: REMOTE, env: envOf({ TEST_DB_ALLOW_REMOTE: "1" }), probe: probeOf(true, 12) }),
    ).resolves.toEqual({ admitted: true, adopt: false });
  });

  it("ayrıştırılamayan / boş URL reddedilir", async () => {
    for (const bad of ["", "not-a-url", undefined]) {
      await expect(
        decideTestDbAdmission({ url: bad as string, env: envOf(), probe: probeOf(true, 0) }),
      ).rejects.toMatchObject({ code: "TEST_DB_REFUSED" });
    }
  });

  it("işaret sabiti sürümlü ve DB yorumu biçiminde", () => {
    expect(HARNESS_MARK).toMatch(/^lixus-test-harness:v\d+$/);
  });
});

// ---------------------------------------------------------------------------
// GERÇEK global-setup — kapı `prisma db push`tan ÖNCE koşar.
// `node:child_process` mock'lu: hiçbir alt süreç yürütülmez, DB'ye bağlanılmaz.
// `probeTestDb`/`markTestDb` sahte (Prisma'ya gidilmez); KARAR gerçek.
// ---------------------------------------------------------------------------
const { execSync } = vi.hoisted(() => ({ execSync: vi.fn() }));
vi.mock("node:child_process", () => ({ execSync }));

const { probeTestDb, markTestDb } = vi.hoisted(() => ({
  probeTestDb: vi.fn(),
  markTestDb: vi.fn<(url: string) => Promise<void>>(async () => {}),
}));
vi.mock("../../scripts/test-db-guard.mjs", async (orig) => {
  const actual = await orig<typeof import("../../scripts/test-db-guard.mjs")>();
  return {
    ...actual,
    probeTestDb,
    markTestDb,
    // guardTestDatabase gerçek kalır ama sahte probe/mark'ı görsün diye yeniden kurulur.
    guardTestDatabase: async (url: string, env = process.env) => {
      const d = await actual.decideTestDbAdmission({ url, env, probe: probeTestDb });
      if (d.adopt) await markTestDb(url);
      return d;
    },
  };
});

describe("tests/global-setup.ts — harici TEST_DATABASE_URL yolu kapılı", () => {
  beforeEach(() => {
    execSync.mockReset();
    probeTestDb.mockReset();
    markTestDb.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 uzak/prod-benzeri hedefte `prisma db push --accept-data-loss` HİÇ ÇALIŞMAZ", async () => {
    vi.stubEnv("TEST_DATABASE_URL", REMOTE);
    vi.stubEnv("TEST_DB_ALLOW_REMOTE", "");
    const { default: setup } = await import("../global-setup");
    // `(async () => setup())()`: eski senkron setup da bir Promise'e sarılır ki
    // kırmızı sebebi "reddetmedi" olsun, "Promise değil" değil.
    await expect((async () => setup())()).rejects.toMatchObject({ code: "TEST_DB_REFUSED" });
    // ⬅️ ARIZADA: execSync("npx prisma db push --accept-data-loss …") ÇAĞRILIYORDU.
    expect(execSync).not.toHaveBeenCalled();
    expect(probeTestDb).not.toHaveBeenCalled(); // bağlantı bile açılmadı
  });

  it("🚨 loopback ama DOLU+işaretsiz hedefte de push YOK", async () => {
    vi.stubEnv("TEST_DATABASE_URL", LOCAL);
    vi.stubEnv("TEST_DB_ADOPT", "");
    probeTestDb.mockResolvedValue({ marked: false, userTables: 7 });
    const { default: setup } = await import("../global-setup");
    await expect((async () => setup())()).rejects.toMatchObject({ code: "TEST_DB_REFUSED" });
    expect(execSync).not.toHaveBeenCalled();
  });

  it("KONTROL: işaretli loopback DB'de harness normal çalışır — kapı, sonra push", async () => {
    vi.stubEnv("TEST_DATABASE_URL", LOCAL);
    probeTestDb.mockResolvedValue({ marked: true, userTables: 40 });
    const { default: setup } = await import("../global-setup");
    const teardown = await setup();
    expect(typeof teardown).toBe("function");
    expect(execSync).toHaveBeenCalledTimes(1);
    const cmd = String(execSync.mock.calls[0][0]);
    expect(cmd).toContain("prisma db push");
    // Sıra: beyan okuması push'tan ÖNCE.
    expect(probeTestDb.mock.invocationCallOrder[0]).toBeLessThan(execSync.mock.invocationCallOrder[0]);
    expect(markTestDb).not.toHaveBeenCalled(); // zaten işaretli
  });

  it("KONTROL: BOŞ loopback DB sahiplenilir — önce işaret, sonra push", async () => {
    vi.stubEnv("TEST_DATABASE_URL", LOCAL);
    probeTestDb.mockResolvedValue({ marked: false, userTables: 0 });
    const { default: setup } = await import("../global-setup");
    await setup();
    expect(markTestDb).toHaveBeenCalledTimes(1);
    expect(execSync).toHaveBeenCalledTimes(1);
    expect(markTestDb.mock.invocationCallOrder[0]).toBeLessThan(execSync.mock.invocationCallOrder[0]);
  });
});
