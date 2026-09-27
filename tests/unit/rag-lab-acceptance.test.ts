import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { acceptanceFailures, ACCEPTANCE_MIN, ACCEPTANCE_GROUPS } from "../eval/rag-lab/acceptance";
import type { LabRow } from "../eval/rag-lab/core";

// ---------------------------------------------------------------------------
// HOLDOUT KABUL KAPISI (Codex 09-27): holdout koşusu yalnız "satır var mı" diye bakıyordu — eşik altı, sızıntılı ya da yarım
// kalmış koşu YEŞİL çıkıyordu. Kurucu alt sınırı her grupta %95 (iki sorulu mesaj dahil).
// ---------------------------------------------------------------------------

const KEY = "scale-holdout|300|prod";

function row(group: string, inBlock: boolean, extra: Partial<LabRow> = {}): LabRow {
  return {
    kb: "scale-holdout",
    size: 300,
    config: "prod",
    qid: `${group}_${Math.random()}`,
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
    ...extra,
  };
}

/** Her kabul grubunda `n` satır, ilk `miss` tanesi kaçan. */
function run(n: number, miss: Partial<Record<string, number>> = {}, extra: (g: string, i: number) => Partial<LabRow> = () => ({})) {
  const rows: LabRow[] = [];
  for (const g of ACCEPTANCE_GROUPS) for (let i = 0; i < n; i++) rows.push(row(g, i >= (miss[g] ?? 0), extra(g, i)));
  const fullGroupCounts = new Map(ACCEPTANCE_GROUPS.map((g) => [g, n] as const));
  return { rows, expected: new Map([[KEY, rows.length]]), fullGroupCounts };
}

describe("holdout kabul kapısı", () => {
  it("kurucu alt sınırı %95, üç grup: tek soru TR · tek soru diğer diller · iki sorulu mesaj", () => {
    expect(ACCEPTANCE_MIN).toBe(0.95);
    expect([...ACCEPTANCE_GROUPS]).toEqual(["single_tr", "single_xx", "multi"]);
  });

  it("her grup ≥ %95, sızıntı yok, koşu tam → KABUL (boş liste)", () => {
    const r = run(40, { single_tr: 2, single_xx: 2, multi: 2 }); // 38/40 = %95
    expect(acceptanceFailures({ ...r, kb: "scale-holdout" })).toEqual([]);
  });

  it("🚨 iki sorulu mesaj %90 artık KABUL DEĞİL (eski belge 90 diyordu; kurucu alt sınırı 95)", () => {
    const r = run(40, { multi: 4 }); // 36/40 = %90
    const f = acceptanceFailures({ ...r, kb: "scale-holdout" });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(/multi: 36\/40 \(%90\) < %95/);
  });

  it("eşik altındaki TEK grup da reddeder (tek soru diğer diller %92,5)", () => {
    const r = run(40, { single_xx: 3 });
    expect(acceptanceFailures({ ...r, kb: "scale-holdout" })).toEqual([`${KEY} · single_xx: 37/40 (%92.5) < %95`]);
  });

  it("🚨 tek sızıntı bile reddeder — oran tam olsa da (sürüm / taslak grubu dahil)", () => {
    const r = run(40);
    r.rows.push(row("version", true, { leak: true }));
    r.expected.set(KEY, r.rows.length);
    expect(acceptanceFailures({ ...r, kb: "scale-holdout" })).toEqual([`${KEY}: 1 sızıntı (eski sürüm / onaysız / taslak metni blokta)`]);
  });

  it("🚨 eksik koşu reddeder: beklenen satırdan az (yarıda kalma / önbellek alt kümesi)", () => {
    const r = run(40);
    r.rows.pop();
    const f = acceptanceFailures({ ...r, kb: "scale-holdout" });
    expect(f[0]).toBe(`${KEY}: eksik koşu — 119/120 satır`);
  });

  it("🚨 örnekleme / ücretli grup süzgeci kabul değildir: grupta tam holdout'tan az soru ya da hiç soru yok", () => {
    const sampled = run(10);
    const f1 = acceptanceFailures({ ...sampled, fullGroupCounts: new Map(ACCEPTANCE_GROUPS.map((g) => [g, 40] as const)), kb: "scale-holdout" });
    expect(f1).toHaveLength(3);
    expect(f1[0]).toMatch(/grup eksik — 10\/40 soru/);
    const noSingle = run(40);
    const rows = noSingle.rows.filter((r) => r.group === "multi");
    const f2 = acceptanceFailures({ ...noSingle, rows, expected: new Map([[KEY, rows.length]]), kb: "scale-holdout" });
    expect(f2).toEqual([
      `${KEY} · single_tr: grup eksik — 0/40 soru (örnekleme / grup süzgeci kabul değildir)`,
      `${KEY} · single_xx: grup eksik — 0/40 soru (örnekleme / grup süzgeci kabul değildir)`,
    ]);
  });

  it("🚨 düşen yeniden sıralama çağrısı = ölçülen yapılandırma koşmadı → reddeder", () => {
    const r = run(40, {}, (g, i) => (g === "multi" && i === 0 ? { rr: "failed" } : {}));
    expect(acceptanceFailures({ ...r, kb: "scale-holdout" })).toEqual([`${KEY}: 1 yeniden sıralama çağrısı başarısız — koşu eksik sayılır`]);
  });

  it("kabul kümesi hiç koşulmadıysa reddeder; başka kümenin satırları sayılmaz", () => {
    const r = run(40);
    expect(acceptanceFailures({ ...r, expected: new Map([["scale-dev|300|prod", 120]]), kb: "scale-holdout" })).toEqual([
      "scale-holdout: kabul kümesi koşulmadı",
    ]);
  });

  it("birden çok yapılandırma koşulduysa HER biri ayrı kapıdan geçer", () => {
    const r = run(40);
    const other = r.rows.map((x) => ({ ...x, config: "base0926", inBlock: x.group === "multi" ? false : x.inBlock }));
    const expected = new Map([
      [KEY, r.rows.length],
      ["scale-holdout|300|base0926", other.length],
    ]);
    expect(acceptanceFailures({ rows: [...r.rows, ...other], expected, fullGroupCounts: r.fullGroupCounts, kb: "scale-holdout" })).toEqual([
      "scale-holdout|300|base0926 · multi: 0/40 (%0) < %95",
    ]);
  });
});

describe("bağlantı: holdout testi kapıyı KULLANIR (ücretli koşu burada sınanamaz — kaynak pini)", () => {
  it("rag-lab holdout yolu kapının sonucunu boş bekler; `rows.length > 0` tek başına kapı DEĞİL", () => {
    const src = readFileSync(path.resolve(__dirname, "../eval/rag-lab.eval.test.ts"), "utf8");
    const start = src.indexOf('("gerçekçi ayrı olgu seti (dev / holdout)"');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf("it.skipIf(", start + 10);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).toMatch(/acceptance\.push\(\.\.\.acceptanceFailures\(\{ rows, expected, kb: "scale-holdout"/);
    expect(body).toMatch(/expect\(acceptance\)\.toEqual\(\[\]\)/);
    // Beklenen satır sayısı koşudan ÖNCE yazılır (yarıda kalan koşu "eksik" görünsün).
    expect(src).toMatch(/expectedRows\.set\(ek, \(expectedRows\.get\(ek\) \?\? 0\) \+ qs\.length\)/);
  });
});
