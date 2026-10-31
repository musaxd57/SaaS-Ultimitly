import { describe, it, expect } from "vitest";
import { relativeTestPath, skippedPerFile, verifyReports } from "../../scripts/ci-verify-core.mjs";
import { assignShards, parseShard, dbShards } from "../ci-shards.mjs";
import { partitionTestFiles } from "../test-partition.mjs";

// ---------------------------------------------------------------------------
// CI GRUPLARI + SON KAPI (kurucu 10-31, `docs/TASARIM-2026-10-31-ci-paralel-test.md`). Kurucunun şartları: bir grup başarısız ya da raporu
// eksikse son kapı KESİNLİKLE kırmızı; hiçbir dosya kaybolmaz; atlanan test artmaz; hız için test atlanmaz / hata yutulmaz.
// ---------------------------------------------------------------------------

const ROOT = "/__w/repo/repo";
const SHA = "abc123";
const file = (name: string, statuses: string[] = ["passed"], status = "passed") => ({
  name: `${ROOT}/${name}`,
  status,
  assertionResults: statuses.map((s) => ({ status: s })),
});
const rep = (label: string, files: ReturnType<typeof file>[], extra: Record<string, unknown> = {}) => ({
  label,
  json: { success: true, numFailedTests: 0, testResults: files, ...extra },
  meta: { sha: SHA },
});
const ok = (reports: ReturnType<typeof rep>[], expected: string[], over: Partial<Parameters<typeof verifyReports>[0]> = {}) =>
  verifyReports({ expectedFiles: expected, reports, skipBaseline: {}, sha: SHA, root: ROOT, ...over });

describe("son kapı kararı", () => {
  const A = "tests/integration/a.test.ts";
  const B = "tests/integration/b.test.ts";
  const C = "tests/unit/c.test.ts";
  const good = () => [rep("db-1", [file(A)]), rep("db-2", [file(B)]), rep("nodb", [file(C)])];

  it("her şey tam ve geçmişken YEŞİL", () => {
    expect(ok(good(), [A, B, C])).toMatchObject({ ok: true, errors: [], files: 3 });
  });
  it("🚨 bir grubun raporu EKSİK → kırmızı (dosyaları da kayıp sayılır)", () => {
    const r = good();
    r[1] = { label: "db-2", json: null as never, meta: { sha: SHA } };
    const res = ok(r, [A, B, C]);
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(/db-2: rapor eksik/);
    expect(res.errors.join("\n")).toMatch(/b\.test\.ts: hiçbir raporda yok/);
  });
  it("🚨 bir iş başarısız / iptal / atlandı → kırmızı (rapor tam olsa bile)", () => {
    for (const result of ["failure", "cancelled", "skipped"]) {
      const res = ok(good(), [A, B, C], { needs: { "test-db": { result }, "test-nodb": { result: "success" } } });
      expect(res.ok, result).toBe(false);
    }
    expect(ok(good(), [A, B, C], { needs: { "test-db": { result: "success" } } }).ok).toBe(true);
  });
  it("🚨 tutarsız rapor (başarısız test sayısı > 0 ama dosya satırları geçmiş görünüyor) → kırmızı", () => {
    const res = ok([rep("db-1", [file(A)], { numFailedTests: 2 }), rep("db-2", [file(B)]), rep("nodb", [file(C)])], [A, B, C]);
    expect(res.errors.join()).toMatch(/db-1: 2 test başarısız/);
  });
  it("🚨 beklenen işin sonucu HİÇ gelmedi (boş NEEDS) → kırmızı", () => {
    const req = { requiredJobs: ["test-db", "test-nodb"] };
    expect(ok(good(), [A, B, C], { ...req, needs: {} }).errors.join()).toMatch(/iş "test-db" sonucu yok/);
    expect(ok(good(), [A, B, C], { ...req, needs: null }).ok).toBe(false);
    expect(ok(good(), [A, B, C], { ...req, needs: { "test-db": { result: "success" } } }).errors.join()).toMatch(/test-nodb" sonucu yok/);
    expect(ok(good(), [A, B, C], { ...req, needs: { "test-db": { result: "success" }, "test-nodb": { result: "success" } } }).ok).toBe(true);
  });
  it("🚨 atlanan test tabanında artık olmayan dosya → kırmızı (taban sessizce büyümesin); kısmi denetimde (grup) bakılmaz", () => {
    const base = { skipBaseline: { "tests/unit/silindi.test.ts": 1 } };
    expect(ok(good(), [A, B, C], { ...base, checkBaselineFiles: true }).errors.join()).toMatch(/tabanında olmayan dosya: tests\/unit\/silindi/);
    expect(ok(good(), [A, B, C], base).ok).toBe(true);
  });
  it("🚨 kayıp dosya, fazladan dosya, iki grupta birden koşan dosya → kırmızı", () => {
    expect(ok([rep("db-1", [file(A)]), rep("nodb", [file(C)])], [A, B, C]).errors.join()).toMatch(/b\.test\.ts: hiçbir raporda yok/);
    expect(ok(good(), [A, C]).errors.join()).toMatch(/b\.test\.ts: beklenmeyen dosya/);
    expect(ok([...good(), rep("db-3", [file(A)])], [A, B, C]).errors.join()).toMatch(/a\.test\.ts: iki raporda birden/);
  });
  it("🚨 başarısız test, başarısız dosya, vitest 'başarısız' bayrağı (test dışı hata), hiç test koşmayan dosya → kırmızı", () => {
    expect(ok([rep("db-1", [file(A, ["passed", "failed"])]), rep("db-2", [file(B)]), rep("nodb", [file(C)])], [A, B, C]).ok).toBe(false);
    expect(ok([rep("db-1", [file(A, [], "failed")]), rep("db-2", [file(B)]), rep("nodb", [file(C)])], [A, B, C]).ok).toBe(false);
    expect(ok([rep("db-1", [file(A)], { success: false }), rep("db-2", [file(B)]), rep("nodb", [file(C)])], [A, B, C]).ok).toBe(false);
    expect(ok([rep("db-1", [file(A, [])]), rep("db-2", [file(B)]), rep("nodb", [file(C)])], [A, B, C]).errors.join()).toMatch(/hiç test koşmadı/);
  });
  it("🚨 atlanan test dosya başına tabanı aşarsa kırmızı; tabanla eşitse yeşil (bir atlama başkasıyla takas edilemez)", () => {
    const skipping = [rep("db-1", [file(A, ["passed", "pending"])]), rep("db-2", [file(B, ["todo"])]), rep("nodb", [file(C)])];
    expect(ok(skipping, [A, B, C], { skipBaseline: { [A]: 1, [B]: 1 } }).ok).toBe(true);
    expect(ok(skipping, [A, B, C], { skipBaseline: { [A]: 2 } }).errors.join()).toMatch(/b\.test\.ts: atlanan test 1 > taban 0/);
  });
  it("🚨 başka commit'in raporu (bayat yükleme) → kırmızı", () => {
    const r = good();
    r[0] = { ...r[0], meta: { sha: "eski" } };
    expect(ok(r, [A, B, C]).errors.join()).toMatch(/bu commit'in değil/);
  });
  it("hiç rapor yoksa kırmızı", () => {
    expect(ok([], []).ok).toBe(false);
  });
  it("mutlak yol depo-göreli olur; dosya başına atlanan sayılır", () => {
    expect(relativeTestPath(`${ROOT}/tests/unit/x.test.ts`, ROOT)).toBe("tests/unit/x.test.ts");
    expect(relativeTestPath("/elsewhere/repo/tests/unit/x.test.ts", ROOT)).toBe("tests/unit/x.test.ts");
    expect(skippedPerFile({ testResults: [file(A, ["passed", "pending", "todo"]), file(B)] }, ROOT)).toEqual({ [A]: 2 });
  });
});

describe("grup dağıtımı", () => {
  it("her dosya TAM BİR gruba; süresi bilinmeyen dosya da bir gruba düşer; belirlenimci", () => {
    const files = ["a", "b", "c", "d", "e", "f", "g"];
    const groups = assignShards(files, { a: 10, b: 9, c: 1, d: 1, e: 1 }, 3);
    const all = groups.flatMap((g) => g.files);
    expect(all.sort()).toEqual(files);
    expect(new Set(all).size).toBe(files.length);
    expect(assignShards(files, { a: 10, b: 9, c: 1, d: 1, e: 1 }, 3)).toEqual(groups);
  });
  it("eşit ağırlıkta dağıtım girdi sırasından bağımsız (her iş ve son kapı aynı grubu hesaplar)", () => {
    const w = { d: 5, a: 5, c: 5, b: 5, e: 5, f: 5 };
    expect(assignShards(["d", "a", "f", "c", "e", "b"], w, 3)).toEqual(assignShards(["a", "b", "c", "d", "e", "f"], w, 3));
  });
  it("en uzun önce: iki uzun dosya aynı gruba düşmez", () => {
    const g = assignShards(["x", "y", "s1", "s2"], { x: 100, y: 90, s1: 1, s2: 1 }, 3);
    expect(g.find((s) => s.files.includes("x"))?.files).not.toContain("y");
  });
  it("bu deponun veritabanlı dosyaları üç gruba eksiksiz ve kesişimsiz dağılır", () => {
    const db = partitionTestFiles().db;
    const shards = dbShards(process.cwd(), 3);
    const all = shards.flatMap((s) => s.files);
    expect(all.length).toBe(db.length);
    expect(new Set(all)).toEqual(new Set(db));
    for (const s of shards) expect(s.files.length).toBeGreaterThan(0);
  });
  it("grup belirteci geçersizse fırlatır (boş grup sessizce yeşil olmasın)", () => {
    expect(parseShard("2/3")).toEqual({ index: 1, total: 3 });
    for (const bad of [undefined, "", "0/3", "4/3", "a/b", "1"]) expect(() => parseShard(bad)).toThrow();
  });
});
