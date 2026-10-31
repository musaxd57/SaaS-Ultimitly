import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { CI_DB_SHARDS, CI_REQUIRED_JOBS, dbShards, readShardWeights } from "../ci-shards.mjs";
import { listTestFiles, partitionTestFiles } from "../test-partition.mjs";

// ---------------------------------------------------------------------------
// CI İŞ AKIŞI ↔ GRUP KODU UYUMU (kurucu 10-31, `docs/TASARIM-2026-10-31-ci-paralel-test.md`). Uyumsuzluk bugün de KIRMIZI düşer (son kapı
// eksik raporu görür); bu pin onu okunur bir mesajla, push'tan ÖNCE yakalar.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
type Job = { needs?: string[]; if?: string; strategy?: { matrix?: { shard?: number[] } }; steps?: { name?: string; uses?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string>; run?: string }[] };
const wf = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job>; concurrency: { group: string } };

describe("ci.yml grupları", () => {
  it("matris grup sayısı, grup ifadesi ve son kapının beklediği işler koddaki sabitlerle aynı", () => {
    expect(wf.jobs["test-db"].strategy?.matrix?.shard).toEqual(Array.from({ length: CI_DB_SHARDS }, (_, i) => i + 1));
    const testStep = wf.jobs["test-db"].steps?.find((s) => s.env?.TEST_DB_SHARD);
    expect(testStep?.env?.TEST_DB_SHARD).toBe(`\${{ matrix.shard }}/${CI_DB_SHARDS}`);
    expect([...(wf.jobs.verify.needs ?? [])].sort()).toEqual([...CI_REQUIRED_JOBS].sort());
  });
  it("son kapı her raporu AÇIK adla indirir ve iptal dışında her durumda koşar", () => {
    const downloads = (wf.jobs.verify.steps ?? []).filter((s) => s.uses?.startsWith("actions/download-artifact"));
    expect(downloads.map((s) => s.with?.name).sort()).toEqual(
      [...Array.from({ length: CI_DB_SHARDS }, (_, i) => `ci-report-db-${i + 1}`), "ci-report-nodb"].sort(),
    );
    for (const s of downloads) expect(s.if).toBe("${{ !cancelled() }}");
    expect(wf.jobs.verify.if).toMatch(/!cancelled\(\)/);
    const gate = wf.jobs.verify.steps?.find((s) => s.run?.includes("ci-verify.mjs gate"));
    expect(gate?.if).toBe("${{ !cancelled() }}");
    expect(gate?.env?.NEEDS_JSON).toBe("${{ toJSON(needs) }}");
  });
  it("el ile tetiklenen koşu push koşusunu iptal etmez (ayrı eşzamanlılık grubu)", () => {
    expect(wf.concurrency.group).toMatch(/workflow_dispatch/);
    expect(wf.concurrency.group).toMatch(/github\.run_id/);
  });
  it("eski tek sıralı düzen geri dönüş olarak duruyor (`npm test`, aynı koruma)", () => {
    const serial = wf.jobs["verify-serial"];
    expect(serial.if).toMatch(/inputs\.layout == 'serial'/);
    expect(serial.steps?.some((s) => (s.run ?? "").split("\n").some((l) => l.trim() === "npm test"))).toBe(true);
  });
});

describe("dağıtım bu commit'te", () => {
  it("🚨 her veritabanlı dosya TAM BİR gruba düşer; ağırlık dosyası yalnız var olan veritabanlı dosyaları anlatır", () => {
    const db = partitionTestFiles(ROOT).db;
    const groups = dbShards(ROOT, CI_DB_SHARDS);
    const all = groups.flatMap((g) => g.files);
    expect(all.length).toBe(new Set(all).size);
    expect([...all].sort()).toEqual([...db].sort());
    for (const g of groups) expect(g.files.length).toBeGreaterThan(0);
    const stale = Object.keys(readShardWeights(ROOT)).filter((f) => !db.includes(f));
    expect(stale).toEqual([]);
  });
  it("atlanan test tabanı var, biçimi doğru ve yalnız var olan dosyaları anlatır", () => {
    const p = join(ROOT, "tests/ci-skip-baseline.json");
    expect(existsSync(p)).toBe(true);
    const base = JSON.parse(readFileSync(p, "utf8")) as Record<string, number>;
    const files = new Set(listTestFiles(ROOT));
    for (const [f, n] of Object.entries(base)) {
      expect(files.has(f), f).toBe(true);
      expect(Number.isInteger(n) && n > 0, f).toBe(true);
    }
  });
});
