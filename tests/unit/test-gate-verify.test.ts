import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validSkipBaseline } from "../../scripts/ci-verify-core.mjs";
import { gateExitCode, LOCAL_ARMS, runGate, secretScanLine, secretScanSkipReason, verifyLocalGate } from "../../scripts/test-gate-verify.mjs";
import { listTestFiles } from "../test-partition.mjs";

// ---------------------------------------------------------------------------
// YEREL KAPININ RAPOR DENETİMİ (11-13, CI 1797). Olay: yeni bir test "ortam değişkeni yoksa atla" diye yazıldı; yerel `npm test` yeşildi,
// CI son kapısı "atlanan test 1 > taban 0" ile kırmızı çıktı — CI'ın rapor denetimini yerel kapı koşmuyordu. Artık `npm test` üç kol bitince
// CI ile AYNI karar fonksiyonunu çağırır; testler yeşil olsa bile denetim kırmızıysa kapı kırmızıdır.
// ---------------------------------------------------------------------------

const A = "tests/integration/a.test.ts";
const B = "tests/unit/b.test.ts";
const C = "tests/unit/c-cost.test.ts";

let dir = "";
let root = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gate-verify-"));
  root = path.join(dir, "repo");
  mkdirSync(path.join(root, "tests"), { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const file = (name: string, statuses: string[] = ["passed"]) => ({ name: `${root}/${name}`, status: "passed", assertionResults: statuses.map((s) => ({ status: s })) });
function writeReport(arm: string, files: ReturnType<typeof file>[], extra: Record<string, unknown> = {}) {
  writeFileSync(path.join(dir, `${arm}.json`), JSON.stringify({ success: true, numFailedTests: 0, testResults: files, ...extra }));
}
function writeBaseline(value: unknown) {
  writeFileSync(path.join(root, "tests", "ci-skip-baseline.json"), typeof value === "string" ? value : JSON.stringify(value));
}
function writeGood() {
  writeReport("db", [file(A)]);
  writeReport("nodb", [file(B)]);
  writeReport("timing", [file(C)]);
}
const run = (expected = [A, B, C]) => verifyLocalGate({ reportDir: dir, root, expectedFiles: expected, baselinePath: path.join(root, "tests", "ci-skip-baseline.json") });

describe("yerel kapı — rapor denetimi", () => {
  it("üç kolun raporu tam ve geçmişken YEŞİL", () => {
    writeBaseline({});
    writeGood();
    expect(run()).toEqual({ ok: true, errors: [], files: 3, tests: 3, skipped: 0 });
  });

  it("🚨 CI 1797: yeni atlanan test (taban 0) → kırmızı; tabandaki kadar atlama yeşil, bir fazlası kırmızı", () => {
    writeBaseline({});
    writeGood();
    writeReport("nodb", [file(B, ["passed", "skipped"])]);
    const res = run();
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual([`${B}: atlanan test 1 > taban 0`]);

    writeBaseline({ [B]: 1 });
    expect(run()).toMatchObject({ ok: true, skipped: 1 });
    writeReport("nodb", [file(B, ["passed", "skipped", "pending"])]);
    expect(run().errors).toEqual([`${B}: atlanan test 2 > taban 1`]);
  });

  it("🚨 bir kolun raporu yok / okunamıyor → kırmızı (dosyaları da kayıp sayılır)", () => {
    writeBaseline({});
    writeGood();
    rmSync(path.join(dir, "timing.json"));
    const missing = run();
    expect(missing.ok).toBe(false);
    expect(missing.errors.join("\n")).toMatch(/timing: rapor eksik ya da okunamıyor/);
    expect(missing.errors.join("\n")).toContain(`${C}: hiçbir raporda yok (kayıp dosya)`);

    writeFileSync(path.join(dir, "timing.json"), "{ yarım");
    expect(run().errors.join("\n")).toMatch(/timing: rapor eksik ya da okunamıyor/);
  });

  it("🚨 taban dosyası yok / bozuk → kırmızı ('taban yok' = 'hiç atlama yok' sayılmaz)", () => {
    writeGood();
    expect(run()).toMatchObject({ ok: false, files: 0 });
    expect(run().errors[0]).toMatch(/ci-skip-baseline\.json yok ya da bozuk/);
    for (const bad of ["{ yarım", "[]", "null", JSON.stringify({ [B]: -1 }), JSON.stringify({ [B]: 1.5 }), JSON.stringify({ [B]: "1" })]) {
      writeBaseline(bad);
      expect(run().ok, bad).toBe(false);
      expect(run().errors[0], bad).toMatch(/yok ya da bozuk/);
    }
  });

  it("🚨 kayıp dosya, fazladan dosya, hiç test koşmayan dosya, başarısız test, tabanda artık olmayan dosya → kırmızı", () => {
    writeBaseline({});
    writeGood();
    expect(run([A, B, C, "tests/unit/d.test.ts"]).errors).toEqual(["tests/unit/d.test.ts: hiçbir raporda yok (kayıp dosya)"]);
    expect(run([A, B]).errors).toEqual([`${C}: beklenmeyen dosya`]);

    writeReport("nodb", [file(B, [])]);
    expect(run().errors).toEqual([`${B}: hiç test koşmadı (yükleme hatası olabilir)`]);

    writeReport("nodb", [file(B, ["failed"])], { success: false, numFailedTests: 1 });
    expect(run().ok).toBe(false);
    expect(run().errors.join("\n")).toContain(`${B}: başarısız`);

    writeGood();
    writeBaseline({ "tests/unit/silinen.test.ts": 1 });
    expect(run().errors).toEqual(["atlanan test tabanında olmayan dosya: tests/unit/silinen.test.ts"]);
  });
});

describe("yerel kapı — çıkış kodu", () => {
  const green = [{ code: 0 }, { code: 0 }, { code: 0 }];
  it("bütün kollar yeşil + denetim yeşil → 0", () => {
    expect(gateExitCode(green, { ok: true })).toBe(0);
  });
  it("🚨 testler yeşil ama rapor denetimi kırmızı → 1", () => {
    expect(gateExitCode(green, { ok: false })).toBe(1);
  });
  it("🚨 denetim yeşil ama bir kol kırmızı → 1 (yakalanmamış istisna raporda görünmez, çıkış kodunda görünür)", () => {
    expect(gateExitCode([{ code: 0 }, { code: 1 }, { code: 0 }], { ok: true })).toBe(1);
  });
  it("hiç kol koşmadıysa → 1", () => {
    expect(gateExitCode([], { ok: true })).toBe(1);
  });

  it("🚨 sır taraması (CI 1801): sızıntı (1) ya da taranamama (2) → 1; temiz ya da gerekçeli atlama → 0", () => {
    const green = [{ code: 0 }];
    expect(gateExitCode(green, { ok: true }, { code: 0 })).toBe(0);
    expect(gateExitCode(green, { ok: true }, { code: 1 })).toBe(1);
    expect(gateExitCode(green, { ok: true }, { code: 2 })).toBe(1);
    expect(gateExitCode(green, { ok: true }, { code: 0, skipped: "CI'da ayrı iş (secret-scan)" })).toBe(0);
    expect(gateExitCode(green, { ok: true }, null)).toBe(0);
  });
});

describe("sır taraması — ne zaman atlanır (saf karar)", () => {
  it("CI'da atlanır (ayrı iş var); CI boş / 0 / false ise koşar", () => {
    expect(secretScanSkipReason({ ci: "true", platform: "linux", arch: "x64" })).toMatch(/CI'da ayrı iş/);
    for (const ci of [undefined, "", "0", "false", "FALSE"]) expect(secretScanSkipReason({ ci, platform: "linux", arch: "x64" }), String(ci)).toBeNull();
  });

  it("linux x64 dışında atlanır ve sebebi söylenir (ikili o platform için indirilir)", () => {
    expect(secretScanSkipReason({ platform: "darwin", arch: "arm64" })).toMatch(/^darwin\/arm64: .*linux x64/);
    expect(secretScanSkipReason({ platform: "win32", arch: "x64" })).toMatch(/^win32\/x64/);
    expect(secretScanSkipReason({ platform: "linux", arch: "arm64" })).toMatch(/^linux\/arm64/);
  });

  it("özet satırı: yeşil · sızıntı · taranamadı · atlandı ayrı yazılır", () => {
    expect(secretScanLine({ code: 0, seconds: 12 })).toBe("sır     yeşil  12 sn");
    expect(secretScanLine({ code: 1, seconds: 12 })).toMatch(/^sır {5}KIRMIZI \(sızıntı bulundu; çıkış 1\)/);
    expect(secretScanLine({ code: 2, seconds: 0 })).toMatch(/^sır {5}KIRMIZI \(tarama YAPILAMADI — temiz sayılmaz; çıkış 2\)/);
    expect(secretScanLine({ code: 0, seconds: 0, skipped: "x" })).toBe("sır     atlandı (x)");
  });
});

describe("taban geçerliliği (CI ve yerel kapı aynı kuralı kullanır)", () => {
  it("dosya → negatif olmayan tam sayı; başka her şey geçersiz", () => {
    expect(validSkipBaseline({})).toBe(true);
    expect(validSkipBaseline({ a: 0, b: 3 })).toBe(true);
    for (const bad of [null, undefined, [], "x", 3, { a: -1 }, { a: 1.5 }, { a: "1" }, { a: null }]) expect(validSkipBaseline(bad), JSON.stringify(bad)).toBe(false);
  });

  it("bu deponun tabanı geçerli ve yalnız var olan test dosyalarını anlatıyor", () => {
    const repo = process.cwd();
    const baseline = JSON.parse(readFileSync(path.join(repo, "tests", "ci-skip-baseline.json"), "utf8")) as Record<string, number>;
    expect(validSkipBaseline(baseline)).toBe(true);
    const known = new Set(listTestFiles(repo));
    expect(Object.keys(baseline).filter((f) => !known.has(f))).toEqual([]);
  });
});

describe("kapının akışı (runGate — kollar sahte, akış gerçek)", () => {
  const arm = (label: string, code = 0) => ({ label, code, signal: null, seconds: 1 });
  const gate = (runArm: (label: string) => Promise<ReturnType<typeof arm>>, lines: string[] = []) =>
    runGate({ runArm, reportDir: dir, root, expectedFiles: [A, B, C], baselinePath: path.join(root, "tests", "ci-skip-baseline.json"), log: (l: string) => lines.push(l) });
  const files: Record<string, ReturnType<typeof file>[]> = {};
  beforeEach(() => {
    files.db = [file(A)];
    files.nodb = [file(B)];
    files.timing = [file(C)];
  });
  const writing = (codes: Record<string, number> = {}) => async (label: string) => {
    writeReport(label, files[label]);
    return arm(label, codes[label] ?? 0);
  };

  it("üç kol yeşil + raporlar tam → çıkış 0; özet her kolu ve rapor satırını yazar", async () => {
    writeBaseline({});
    const lines: string[] = [];
    const res = await gate(writing(), lines);
    expect(res.code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain("── Test kapısı özeti ──");
    for (const label of LOCAL_ARMS) expect(text).toMatch(new RegExp(`^${label}\\s+yeşil`, "m"));
    expect(text).toMatch(/^rapor {3}yeşil {2}dosya 3 · test 3 · atlanan 0/m);
  });

  it("🚨 CI 1797 uçtan uca: kollar 0 ile çıktı ama raporda yeni atlanan test var → çıkış 1 ve sebep yazılır", async () => {
    writeBaseline({});
    files.nodb = [file(B, ["passed", "skipped"])];
    const lines: string[] = [];
    const res = await gate(writing(), lines);
    expect(res.code).toBe(1);
    expect(lines.join("\n")).toMatch(/^rapor {3}KIRMIZI/m);
    expect(lines).toContain(`  ✗ ${B}: atlanan test 1 > taban 0`);
  });

  it("🚨 bir kol kırmızı çıktıysa (rapor temiz görünse de) çıkış 1; kalan kollar yine koşar", async () => {
    writeBaseline({});
    const ran: string[] = [];
    const res = await gate(async (label) => {
      ran.push(label);
      return writing({ db: 1 })(label);
    });
    expect(res.code).toBe(1);
    expect(ran.sort()).toEqual(["db", "nodb", "timing"]);
  });

  it("🚨 bayat rapor: önceki koşunun raporu duruyorken bir kol rapor YAZMADAN 0 ile çıkarsa kırmızı (eski rapor 'bu koşu' sayılmaz)", async () => {
    writeBaseline({});
    writeGood();
    const res = await gate(async (label) => {
      if (label !== "nodb") writeReport(label, files[label]);
      return arm(label);
    });
    expect(res.code).toBe(1);
    expect(res.verify.errors.join("\n")).toMatch(/nodb: rapor eksik ya da okunamıyor/);
    expect(existsSync(path.join(dir, "nodb.json"))).toBe(false);
  });

  it("🚨 sır taraması kırmızıysa (testler ve rapor yeşil olsa da) çıkış 1 ve özet satırı yazılır; süre ölçen kol taramayı bekler", async () => {
    writeBaseline({});
    const lines: string[] = [];
    const events: string[] = [];
    let finishScan: (v: { code: number; seconds: number }) => void = () => {};
    const res = runGate({
      runArm: async (label: string) => {
        events.push(`start:${label}`);
        return writing()(label);
      },
      reportDir: dir,
      root,
      expectedFiles: [A, B, C],
      baselinePath: path.join(root, "tests", "ci-skip-baseline.json"),
      log: (l: string) => lines.push(l),
      secretScan: () => {
        events.push("start:scan");
        return new Promise((resolve) => (finishScan = resolve));
      },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(events.slice().sort()).toEqual(["start:db", "start:nodb", "start:scan"]);
    finishScan({ code: 1, seconds: 3 });
    const out = await res;
    expect(out.code).toBe(1);
    expect(events.indexOf("start:timing")).toBeGreaterThan(events.indexOf("start:scan"));
    expect(lines.join("\n")).toMatch(/^sır {5}KIRMIZI \(sızıntı bulundu; çıkış 1\)/m);
    expect(lines.join("\n")).toMatch(/^rapor {3}yeşil/m);
  });

  it("sıra: veritabanlı + veritabanısız kol AYNI ANDA başlar; süre ölçen kol ikisi de bitince tek başına", async () => {
    writeBaseline({});
    const events: string[] = [];
    const release: Record<string, () => void> = {};
    const res = gate(async (label) => {
      events.push(`start:${label}`);
      if (label !== "timing") await new Promise<void>((resolve) => (release[label] = resolve));
      events.push(`end:${label}`);
      writeReport(label, files[label]);
      return arm(label);
    });
    await new Promise((r) => setTimeout(r, 20));
    // İkisi de başladı, hiçbiri bitmedi; süre ölçen kol henüz başlamadı.
    expect(events.slice().sort()).toEqual(["start:db", "start:nodb"]);
    release.nodb();
    await new Promise((r) => setTimeout(r, 20));
    expect(events).not.toContain("start:timing");
    release.db();
    expect((await res).code).toBe(0);
    expect(events.indexOf("start:timing")).toBeGreaterThan(Math.max(events.indexOf("end:db"), events.indexOf("end:nodb")));
  });
});

// ── Betiğin kendisi: sahte `vitest` / `prisma` ikilileriyle geçici bir depoda GERÇEK süreç olarak koşar ───────────────────────────────────
describe("kapı betiği (scripts/test-gate.mjs — gerçek süreç, sahte ikililer)", () => {
  const SCRIPT = path.join(process.cwd(), "scripts", "test-gate.mjs");
  const FAKE_VITEST = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const out = (args.find((a) => a.startsWith("--outputFile.json=")) || "").split("=")[1];
const arm = args[args.indexOf("-c") + 1].split(".")[1];
fs.appendFileSync("calls.log", arm + " " + args.join(" ") + "\\n");
const plan = JSON.parse(fs.readFileSync("plan.json", "utf8"))[arm];
if (plan.report && out) fs.writeFileSync(out, JSON.stringify(plan.report));
console.log("sahte kol " + arm);
process.exit(plan.code);
`;
  const fakePrisma = (code: number) => `#!/usr/bin/env node\nrequire("fs").appendFileSync("calls.log", "prisma " + process.argv.slice(2).join(" ") + "\\n");\nprocess.exit(${code});\n`;

  function repo(opts: { prismaCode?: number; skipIn?: string; codes?: Record<string, number>; noReport?: string[]; scanCode?: number } = {}) {
    // Sahte sır taraması: çağrıldığını yazar, verilen kodla çıkar (gerçeği ağdan gitleaks indirir).
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(
      path.join(root, "scripts", "secret-scan.mjs"),
      `import { appendFileSync } from "node:fs";\nappendFileSync("calls.log", "secret-scan\\n");\nconsole.log("sahte tarama");\nprocess.exit(${opts.scanCode ?? 0});\n`,
    );
    const bin = path.join(root, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "vitest"), FAKE_VITEST);
    writeFileSync(path.join(bin, "prisma"), fakePrisma(opts.prismaCode ?? 0));
    chmodSync(path.join(bin, "vitest"), 0o755);
    chmodSync(path.join(bin, "prisma"), 0o755);
    for (const f of [A, B, C]) {
      mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      writeFileSync(path.join(root, f), "// kurgusal test dosyası\n");
    }
    writeBaseline({});
    const byArm: Record<string, string> = { db: A, nodb: B, timing: C };
    const plan = Object.fromEntries(
      Object.entries(byArm).map(([arm, f]) => [
        arm,
        {
          code: opts.codes?.[arm] ?? 0,
          report: opts.noReport?.includes(arm) ? null : { success: true, numFailedTests: 0, testResults: [file(f, opts.skipIn === arm ? ["passed", "skipped"] : ["passed"])] },
        },
      ]),
    );
    writeFileSync(path.join(root, "plan.json"), JSON.stringify(plan));
  }
  const runScript = (env: Record<string, string> = {}) => {
    const base = { ...process.env };
    delete base.TEST_REPORT_DIR;
    delete base.CI; // CI'da sır taraması atlanır; bu testler iki durumu da açıkça verir.
    return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8", env: { ...base, ...env } });
  };
  /** Özetin "rapor" satırındaki dizin yolu. */
  const reportDirOf = (stdout: string) => /^rapor .*\((.+)\)$/m.exec(stdout)?.[1] ?? "";
  const calls = () => (existsSync(path.join(root, "calls.log")) ? readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n") : []);

  it("her şey yeşil → çıkış 0; önce prisma generate, sonra üç kol kendi yapılandırmasıyla ve JSON raporuyla çağrılır", () => {
    repo();
    const r = runScript();
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const log = calls();
    expect(log[0]).toBe("prisma generate");
    expect(log.filter((l) => l === "secret-scan")).toHaveLength(1);
    const arms = log.slice(1).filter((l) => l !== "secret-scan");
    expect(arms.map((l) => l.split(" ")[0]).sort()).toEqual(["db", "nodb", "timing"]);
    expect(arms[arms.length - 1].startsWith("timing ")).toBe(true);
    expect(log.indexOf("secret-scan")).toBeLessThan(log.findIndex((l) => l.startsWith("timing ")));
    expect(r.stdout).toContain("[sır] sahte tarama");
    expect(r.stdout).toMatch(/^sır {5}yeşil/m);
    for (const arm of ["db", "nodb", "timing"]) {
      const line = log.find((l) => l.startsWith(`${arm} `))!;
      expect(line).toContain(`run -c vitest.${arm}.config.ts --reporter=default --reporter=json --outputFile.json=`);
      expect(line.endsWith(`/${arm}.json`)).toBe(true);
    }
    expect(r.stdout).toContain("[nodb] sahte kol nodb");
    expect(r.stdout).toMatch(/^rapor {3}yeşil {2}dosya 3 · test 3 · atlanan 0/m);
    // Kapının kendi açtığı geçici rapor dizini yeşil koşuda silinir.
    expect(existsSync(reportDirOf(r.stdout))).toBe(false);
  }, 30_000);

  it("🚨 `TEST_REPORT_DIR` VERİLMEDEN de rapor denetimi koşar: yeni atlanan test → çıkış 1 (kollar 0 ile çıksa da)", () => {
    repo({ skipIn: "nodb" });
    const r = runScript();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^nodb {4}yeşil/m);
    expect(r.stdout).toContain(`  ✗ ${B}: atlanan test 1 > taban 0`);
    // Kırmızıda raporlar yerinde kalır (yol özet satırında); test kendi artığını temizler.
    const kept = reportDirOf(r.stdout);
    expect(existsSync(path.join(kept, "nodb.json"))).toBe(true);
    rmSync(kept, { recursive: true, force: true });
  }, 30_000);

  it("`TEST_REPORT_DIR` verilirse raporlar oraya yazılır (olmayan dizin açılır); bir kol kırmızıysa çıkış 1", () => {
    repo({ codes: { db: 1 } });
    const reports = path.join(dir, "raporlar", "ic");
    const r = runScript({ TEST_REPORT_DIR: reports });
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^db {6}KIRMIZI \(çıkış 1\)/m);
    for (const arm of ["db", "nodb", "timing"]) expect(existsSync(path.join(reports, `${arm}.json`))).toBe(true);
    expect(reportDirOf(r.stdout)).toBe(reports);
  }, 30_000);

  it("verilen `TEST_REPORT_DIR` yeşil koşuda SİLİNMEZ (CI onu yükler)", () => {
    repo();
    const reports = path.join(dir, "raporlar");
    const r = runScript({ TEST_REPORT_DIR: reports });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    for (const arm of ["db", "nodb", "timing"]) expect(existsSync(path.join(reports, `${arm}.json`))).toBe(true);
  }, 30_000);

  it("🚨 bir kol rapor yazmadıysa (0 ile çıksa bile) çıkış 1", () => {
    repo({ noReport: ["timing"] });
    const r = runScript();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("timing: rapor eksik ya da okunamıyor");
    rmSync(reportDirOf(r.stdout), { recursive: true, force: true });
  }, 30_000);

  it("🚨 sır taraması sızıntı bulursa (bütün kollar yeşil) çıkış 1", () => {
    repo({ scanCode: 1 });
    const r = runScript();
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^sır {5}KIRMIZI \(sızıntı bulundu; çıkış 1\)/m);
    expect(r.stdout).toMatch(/^rapor {3}yeşil/m);
    rmSync(reportDirOf(r.stdout), { recursive: true, force: true });
  }, 30_000);

  it("CI'da sır taraması koşmaz (ayrı iş var) ve özette 'atlandı' yazar", () => {
    repo({ scanCode: 1 });
    const r = runScript({ CI: "true" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(calls()).not.toContain("secret-scan");
    expect(r.stdout).toMatch(/^sır {5}atlandı \(CI'da ayrı iş/m);
  }, 30_000);

  it("prisma generate düşerse kapı onun koduyla durur; hiçbir kol başlamaz", () => {
    repo({ prismaCode: 3 });
    const r = runScript();
    expect(r.status).toBe(3);
    expect(calls()).toEqual(["prisma generate"]);
  }, 30_000);
});
