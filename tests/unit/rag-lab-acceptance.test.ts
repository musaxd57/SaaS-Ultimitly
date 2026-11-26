import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { holdoutVerdict, REPORT_TARGET, ACCEPTANCE_GROUPS, LEAK_GROUPS } from "../eval/rag-lab/acceptance";
import type { LabRow } from "../eval/rag-lab/core";

// ---------------------------------------------------------------------------
// HOLDOUT GEÇERLİLİĞİ + SIZINTI (getirme düzeyi). Kurucu kararı 09-27 (Codex'le): %95 ZORUNLU GEÇME KURALI DEĞİL — oran raporda
// gelişimi gösterir; kabul CEVAP düzeyinde, vaka başına müşteriye giden sonuçla. Burada KIRMIZI yapan yalnız: sızıntılı vaka,
// ölçülmemiş sızıntı (taslak / eski sürüm grupları koşulmadı), eksik koşu (satır eksik, grup eksik, API hatasıyla düşen çağrı).
// ---------------------------------------------------------------------------

const KEY = "scale-holdout|300|prod";

function row(group: string, inBlock: boolean, extra: Partial<LabRow> = {}): LabRow {
  return {
    kb: "scale-holdout",
    size: 300,
    config: "prod",
    qid: `${group}_${Math.random().toString(36).slice(2, 8)}`,
    group,
    cls: group,
    lang: "tr",
    inBlock,
    answers: [],
    fb: "none",
    sem: "ok",
    rr: "ok",
    blockChars: 5000,
    selected: 10,
    negChunks: 0,
    leak: false,
    conflictNote: false,
    rrMs: 900,
    rrChars: 9000,
    rrErrors: 0,
    ...extra,
  };
}

/** Her oran grubunda `n` satır (ilk `miss` tanesi kaçan) + sızıntı gruplarında 4'er satır (taslak / eski sürüm). */
function run(n: number, miss: Partial<Record<string, number>> = {}, extra: (g: string, i: number) => Partial<LabRow> = () => ({})) {
  const rows: LabRow[] = [];
  for (const g of ACCEPTANCE_GROUPS) for (let i = 0; i < n; i++) rows.push(row(g, i >= (miss[g] ?? 0), extra(g, i)));
  for (const g of LEAK_GROUPS) for (let i = 0; i < 4; i++) rows.push(row(g, true, extra(g, i)));
  const fullGroupCounts = new Map([...ACCEPTANCE_GROUPS.map((g) => [g, n] as const), ...LEAK_GROUPS.map((g) => [g, 4] as const)]);
  return { rows, expected: new Map([[KEY, rows.length]]), fullGroupCounts };
}

describe("holdout — oran BİLGİ, kapı değil (kurucu kararı 09-27)", () => {
  it("hedef çizgisi %95; oran grupları tek soru TR · diğer diller · iki soru; sızıntı grupları taslak · eski sürüm", () => {
    expect(REPORT_TARGET).toBe(0.95);
    expect([...ACCEPTANCE_GROUPS]).toEqual(["single_tr", "single_xx", "multi"]);
    expect([...LEAK_GROUPS]).toEqual(["draft", "version"]);
  });

  it("🚨 %95 ALTINDAKİ oran KIRMIZI yapmaz — rapora 'ALTINDA (bilgi, kapı değil)' diye yazılır", () => {
    const r = run(40, { multi: 4, single_xx: 3 }); // multi %90, xx %92,5
    const v = holdoutVerdict({ ...r, kb: "scale-holdout" });
    expect(v.failures).toEqual([]);
    expect(v.rates).toEqual([
      `${KEY} · single_tr: 40/40 (%100) — hedef %95 üstünde (bilgi, kapı değil)`,
      `${KEY} · single_xx: 37/40 (%92.5) — hedef %95 ALTINDA (bilgi, kapı değil)`,
      `${KEY} · multi: 36/40 (%90) — hedef %95 ALTINDA (bilgi, kapı değil)`,
    ]);
  });

  it("🚨 sızıntılı VAKA kırmızı — oranlar tam olsa da; vaka kimliği yazılır", () => {
    const r = run(40);
    r.rows.push(row("version", true, { leak: true, qid: "v_leak_1" }));
    r.expected.set(KEY, r.rows.length);
    r.fullGroupCounts.set("version", 5);
    expect(holdoutVerdict({ ...r, kb: "scale-holdout" }).failures).toEqual([`${KEY}: sızıntılı vaka 1 (v_leak_1)`]);
  });

  it("🚨 sızıntı grupları koşulmadıysa \"sızıntı 0\" boş iddiadır → kırmızı (A9 09-27)", () => {
    const r = run(40);
    const rows = r.rows.filter((x) => x.group !== "draft");
    const v = holdoutVerdict({ ...r, rows, expected: new Map([[KEY, rows.length]]), kb: "scale-holdout" });
    expect(v.failures).toEqual([`${KEY} · draft: sızıntı ölçülmedi — 0/4 soru (grup koşulmadı)`]);
  });

  it("🚨 eksik koşu kırmızı: beklenen satırdan az (yarıda kalma / önbellek alt kümesi)", () => {
    const r = run(40);
    r.rows.pop();
    expect(holdoutVerdict({ ...r, kb: "scale-holdout" }).failures[0]).toBe(`${KEY}: eksik koşu — 127/128 satır`);
  });

  it("🚨 örnekleme / ücretli grup süzgeci = eksik koşu (oran grubu tam holdout'tan az ya da yok)", () => {
    const sampled = run(10);
    const full40 = new Map([...ACCEPTANCE_GROUPS.map((g) => [g, 40] as const), ...LEAK_GROUPS.map((g) => [g, 4] as const)]);
    const f1 = holdoutVerdict({ ...sampled, fullGroupCounts: full40, kb: "scale-holdout" }).failures;
    expect(f1).toHaveLength(3);
    expect(f1[0]).toMatch(/grup eksik — 10\/40 soru/);
  });

  it("🚨 API / biçim hatasıyla düşen yeniden sıralama çağrısı = eksik koşu (kısmi arıza dahil)", () => {
    const r = run(40, {}, (g, i) => (g === "multi" && i === 0 ? { rr: "failed", rrErrors: 1 } : g === "single_tr" && i === 0 ? { rrErrors: 1 } : {}));
    expect(holdoutVerdict({ ...r, kb: "scale-holdout" }).failures).toEqual([`${KEY}: 2 satırda yeniden sıralama çağrısı hatayla düştü — koşu eksik sayılır`]);
  });

  it("sıcak yol TAVANINI aşan çağrı eksik koşu DEĞİL (üretimde de bugünkü sıra) — A9 09-27", () => {
    const r = run(40, {}, (g, i) => (g === "multi" && i < 2 ? { rr: "deadline" } : {}));
    expect(holdoutVerdict({ ...r, kb: "scale-holdout" }).failures).toEqual([]);
  });

  it("🚨 holdout'ta sızıntı grubu HİÇ yoksa (tam sayı 0) da \"sızıntı ölçülmedi\" (mutasyon 09-27, H5)", () => {
    const r = run(40);
    const rows = r.rows.filter((x) => x.group !== "version");
    const counts = new Map([...r.fullGroupCounts].filter(([g]) => g !== "version"));
    const v = holdoutVerdict({ rows, expected: new Map([[KEY, rows.length]]), fullGroupCounts: counts, kb: "scale-holdout" });
    expect(v.failures).toEqual([`${KEY} · version: sızıntı ölçülmedi — 0/0 soru (grup koşulmadı)`]);
  });

  it("tam %95 hedefin ÜSTÜNDE sayılır (sınır dahil; mutasyon 09-27, H6)", () => {
    const r = run(40, { multi: 2 }); // 38/40 = %95
    expect(holdoutVerdict({ ...r, kb: "scale-holdout" }).rates).toContain(`${KEY} · multi: 38/40 (%95) — hedef %95 üstünde (bilgi, kapı değil)`);
  });

  it("küme koşulmadıysa kırmızı; başka kümenin satırları sayılmaz", () => {
    const r = run(40);
    expect(holdoutVerdict({ ...r, expected: new Map([["scale-dev|300|prod", 120]]), kb: "scale-holdout" }).failures).toEqual(["scale-holdout: küme koşulmadı"]);
  });
});

describe("bağlantı: holdout testi hükmü KULLANIR (ücretli koşu burada sınanamaz — kaynak pini)", () => {
  it("rag-lab holdout yolu yalnız geçerlilik + sızıntıyı kırmızı bekler; oranlar rapora", () => {
    const src = readFileSync(path.resolve(__dirname, "../eval/rag-lab.eval.test.ts"), "utf8");
    const start = src.indexOf('("gerçekçi ayrı olgu seti (dev / holdout)"');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("it.skipIf(", start + 10);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/const v = holdoutVerdict\(\{ rows, expected, kb: "scale-holdout"/);
    expect(body).toMatch(/expect\(holdout\.failures\)\.toEqual\(\[\]\)/);
    expect(src).toMatch(/expectedRows\.set\(ek, \(expectedRows\.get\(ek\) \?\? 0\) \+ qs\.length\)/);
    expect(src).toMatch(/"holdout oranları \(bilgi, kapı değil — kabul cevap düzeyinde\)": holdout\.rates/);
  });
});
