import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validSkipBaseline } from "../../scripts/ci-verify-core.mjs";
import { gateExitCode, LOCAL_ARMS, verifyLocalGate } from "../../scripts/test-gate-verify.mjs";
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

  it("kollar: veritabanlı · veritabanısız · süre ölçen (rapor adları kapının yazdığı adlar)", () => {
    expect(LOCAL_ARMS).toEqual(["db", "nodb", "timing"]);
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

describe("kapı betiği denetimi gerçekten çağırıyor (bağlantı pini)", () => {
  const gate = readFileSync(path.join(process.cwd(), "scripts", "test-gate.mjs"), "utf8");
  it("her kol JSON raporu yazar (koşula bağlı değil) ve çıkış kodu denetimin sonucunu taşır", () => {
    expect(gate).toContain('const reporters = ["--reporter=default", "--reporter=json", `--outputFile.json=${REPORT_DIR}/${label}.json`];');
    expect(gate).toContain("const verify = verifyLocalGate({ reportDir: REPORT_DIR, root, expectedFiles: listTestFiles(root), baselinePath: join(root, \"tests/ci-skip-baseline.json\") });");
    expect(gate).toContain("process.exit(gateExitCode(results, verify));");
    expect(gate.match(/process\.exit\(/g)?.length).toBe(2);
  });
});
