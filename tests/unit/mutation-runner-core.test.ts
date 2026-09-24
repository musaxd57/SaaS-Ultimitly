import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyMutant, concurrentVitest, insideDir, summarize, validateSpec } from "../../scripts/mutation/core.mjs";

// ---------------------------------------------------------------------------
// Mutasyon koşucusu (`scripts/mutation-run.mjs`) — SAF kararlar. Koruma betik çalıştırılarak değil bu fonksiyonlarla
// sınanır (CLAUDE.md). Dış inceleme 09-24: mutasyon ana çalışma ağacında koşuyordu → yazılan kodla yarış.
// ---------------------------------------------------------------------------

const VALID = {
  tests: ["tests/unit/a.test.ts"],
  mutants: [{ id: "M1", file: "src/lib/a.ts", old: "x === 1", new: "x === 2" }],
};

describe("spesifikasyon doğrulaması", () => {
  it("geçerli spec hata üretmez", () => {
    expect(validateSpec(VALID)).toEqual([]);
    expect(validateSpec({ ...VALID, mutants: [{ ...VALID.mutants[0], tests: ["tests/unit/b.test.ts"] }] })).toEqual([]);
  });

  it("depo DIŞI yol, tekrar eden kimlik, boş çapa ve etkisiz mutasyon reddedilir", () => {
    const m = VALID.mutants[0];
    const errs = (mutants: unknown[]) => validateSpec({ ...VALID, mutants }).join(" | ");
    expect(errs([{ ...m, file: "/etc/passwd" }])).toContain("göreli yol");
    expect(errs([{ ...m, file: "../outside.ts" }])).toContain("göreli yol");
    expect(errs([{ ...m, file: "src/../../x.ts" }])).toContain("göreli yol");
    expect(errs([m, { ...m }])).toContain("tekrar ediyor");
    expect(errs([{ ...m, old: "" }])).toContain("old boş");
    expect(errs([{ ...m, new: m.old }])).toContain("mutasyon yok");
    expect(errs([{ ...m, tests: [] }])).toContain("tests verildiyse");
    expect(validateSpec({ mutants: [m] }).join(" | ")).toContain("tests:");
    expect(validateSpec(null)).toEqual(["spec bir nesne değil"]);
  });
});

describe("çapa TAM BİR KEZ", () => {
  it("tek geçiş uygulanır; yok ya da çok geçiş reddedilir (sahte 'öldürüldü' üretmesin)", () => {
    expect(applyMutant("a = x === 1;", "x === 1", "x === 2")).toEqual({ ok: true, count: 1, out: "a = x === 2;" });
    expect(applyMutant("a = 1;", "x === 1", "x === 2")).toEqual({ ok: false, count: 0 });
    expect(applyMutant("x === 1 || x === 1", "x === 1", "x === 2")).toEqual({ ok: false, count: 2 });
  });
});

describe("eşzamanlı vitest (PG 5433 paylaşılıyor)", () => {
  const PS = [
    "  PID ARGS",
    "  101 node (vitest 1)",
    "  202 /bin/bash -c npx vitest run tests/unit/x.test.ts",
    "  303 node scripts/mutation-run.mjs spec.json",
    "  404 grep vitest",
    "  505 node /usr/bin/next dev",
  ].join("\n");

  it("başka vitest süreçleri bulunur; koşucunun kendisi, grep ve ilgisiz süreçler sayılmaz", () => {
    expect(concurrentVitest(PS, [])).toEqual(["101 node (vitest 1)", "202 /bin/bash -c npx vitest run tests/unit/x.test.ts"]);
    expect(concurrentVitest(PS, [101, 202])).toEqual([]);
    expect(concurrentVitest("  PID ARGS\n  505 node /usr/bin/next dev", [])).toEqual([]);
  });
});

describe("yazma yalnız adanmış worktree İÇİNE", () => {
  it("iç yol kabul; kardeş önek, üst dizine çıkış ve dizinin kendisi reddedilir", () => {
    expect(insideDir("/tmp/lixus-mut-1/wt", "/tmp/lixus-mut-1/wt/src/lib/a.ts")).toBe(true);
    expect(insideDir("/tmp/lixus-mut-1/wt/", "/tmp/lixus-mut-1/wt/src/a.ts")).toBe(true);
    expect(insideDir("/tmp/lixus-mut-1/wt", "/tmp/lixus-mut-1/wt2/src/a.ts")).toBe(false);
    expect(insideDir("/tmp/lixus-mut-1/wt", "/tmp/lixus-mut-1/wt/../../home/user/src/a.ts")).toBe(false);
    expect(insideDir("/tmp/lixus-mut-1/wt", "/tmp/lixus-mut-1/wt")).toBe(false);
    expect(insideDir("", "/home/user/src/a.ts")).toBe(false);
  });
});

describe("özet ve çıkış kodu", () => {
  it("yaşayan mutant çıkışı 1 yapar", () => {
    expect(summarize([{ id: "M1", outcome: "killed" }])).toEqual({ killed: 1, total: 1, survived: [], exitCode: 0 });
    expect(summarize([{ id: "M1", outcome: "killed" }, { id: "M2", outcome: "survived" }])).toMatchObject({ survived: ["M2"], exitCode: 1 });
  });
});

describe("koşucu betiği — yapısal sözleşme", () => {
  const src = readFileSync(join(process.cwd(), "scripts/mutation-run.mjs"), "utf8");
  it("ana ağaca yazan bir yol yok: her yazma worktree denetiminden sonra, worktree ayrık (detached) kurulur", () => {
    expect(src).toContain('git("worktree", "add", "--detach", wt, sha)');
    const firstWrite = src.indexOf("writeFileSync(target");
    expect(firstWrite).toBeGreaterThan(-1);
    expect(src.lastIndexOf("insideDir(wt, target)", firstWrite)).toBeGreaterThan(-1);
    // M0 kontrol koşusu mutantlardan ÖNCE ve kırmızıysa mutantlara geçilmez.
    expect(src.indexOf("const m0 = runTests")).toBeLessThan(firstWrite);
    expect(src).toContain("exitCode = 2");
  });
});
