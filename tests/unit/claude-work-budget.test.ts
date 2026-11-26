import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stepBlockedByBudget, resolveReserveUsd } from "../../scripts/claude-work/budget";

// ---------------------------------------------------------------------------
// CLAUDE ÇALIŞMA PAKETİ — ZORUNLU ADIMLAR İÇİN AYRILAN PAY (11-13, İE-12). İstek 4'te istem denetimi görev tavanını mercekler ve çürütme
// turunda tüketti; sondaki yeniden tasarım ve kurucu raporu için para kalmadı, rapor hiç üretilmedi. Kural: isteğe bağlı adım, kalan bütçe
// (görevde ve pakette) ayrılan payı aşmıyorsa BAŞLAMAZ; zorunlu adım payı 0 ile sorulur ve eski kuralla çalışır.
// ---------------------------------------------------------------------------

const base = { spentTotal: 0, totalCap: 55, spentTask: 0, taskCap: 50 };

describe("pay 0 — eski kural birebir", () => {
  it("harcama tavanın altındaysa adım çalışır", () => {
    expect(stepBlockedByBudget({ ...base, spentTotal: 10, spentTask: 49.99 })).toBe(false);
  });
  it("görev harcaması görev tavanına EŞİTSE durur (eski `>=`)", () => {
    expect(stepBlockedByBudget({ ...base, spentTask: 50 })).toBe(true);
  });
  it("paket harcaması toplam tavana EŞİTSE durur, görev tavanı boş olsa da", () => {
    expect(stepBlockedByBudget({ ...base, spentTotal: 55, spentTask: 1 })).toBe(true);
  });
  it("reserveUsd verilmemesi 0 ile aynıdır", () => {
    for (const spentTask of [0, 39.99, 40, 49.99, 50, 51]) {
      const a = { ...base, spentTask };
      expect(stepBlockedByBudget(a)).toBe(stepBlockedByBudget({ ...a, reserveUsd: 0 }));
    }
  });
});

describe("pay varken — isteğe bağlı adım durur, zorunlu adım çalışır", () => {
  const reserveUsd = 10;
  it("kalan görev bütçesi payın ÜSTÜNDEYSE isteğe bağlı adım çalışır", () => {
    expect(stepBlockedByBudget({ ...base, spentTask: 39.99, reserveUsd })).toBe(false);
  });
  it("🚨 kalan görev bütçesi paya EŞİTSE isteğe bağlı adım başlamaz", () => {
    expect(stepBlockedByBudget({ ...base, spentTask: 40, reserveUsd })).toBe(true);
  });
  it("aynı noktada zorunlu adım (pay 0) yine çalışır", () => {
    expect(stepBlockedByBudget({ ...base, spentTask: 40 })).toBe(false);
    expect(stepBlockedByBudget({ ...base, spentTask: 49.99 })).toBe(false);
  });
  it("🚨 paketin kalanı payın altına inince de isteğe bağlı adım durur (öteki işler toplamı tüketmiş olabilir)", () => {
    expect(stepBlockedByBudget({ ...base, spentTotal: 45, spentTask: 5, reserveUsd })).toBe(true);
    expect(stepBlockedByBudget({ ...base, spentTotal: 44.99, spentTask: 5, reserveUsd })).toBe(false);
    expect(stepBlockedByBudget({ ...base, spentTotal: 45, spentTask: 5 })).toBe(false);
  });
  it("pay görev tavanından büyükse isteğe bağlı adım hiç başlamaz, zorunlu adım başlar", () => {
    expect(stepBlockedByBudget({ ...base, reserveUsd: 60 })).toBe(true);
    expect(stepBlockedByBudget({ ...base })).toBe(false);
  });
});

describe("toplam tavan aşımı", () => {
  it("toplam tavan aşılmışsa zorunlu adım da başlamaz", () => {
    expect(stepBlockedByBudget({ ...base, spentTotal: 55.5, spentTask: 1 })).toBe(true);
    expect(stepBlockedByBudget({ ...base, spentTotal: 55.5, spentTask: 1, reserveUsd: 10 })).toBe(true);
  });
  it("görev tavanı aşılmışsa zorunlu adım da başlamaz", () => {
    expect(stepBlockedByBudget({ ...base, spentTask: 50.01 })).toBe(true);
  });
});

describe("bozuk girdi — şüphede başlama", () => {
  const bad = [Number.NaN, Number.POSITIVE_INFINITY, -1, "5" as unknown as number, undefined as unknown as number];
  it.each(["spentTotal", "totalCap", "spentTask", "taskCap"] as const)("%s bozuksa adım başlamaz", (k) => {
    for (const v of bad) expect(stepBlockedByBudget({ ...base, [k]: v }), `${k}=${String(v)}`).toBe(true);
  });
  it("pay bozuksa (NaN, sonsuz, negatif, metin) adım başlamaz", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, "3" as unknown as number]) {
      expect(stepBlockedByBudget({ ...base, reserveUsd: v }), String(v)).toBe(true);
    }
  });
  it("tavan 0 ise hiçbir adım başlamaz (eski davranış: 0 >= 0)", () => {
    expect(stepBlockedByBudget({ ...base, totalCap: 0 })).toBe(true);
    expect(stepBlockedByBudget({ ...base, taskCap: 0 })).toBe(true);
  });
});

describe("istekten pay okuma", () => {
  it("anahtar yoksa varsayılan", () => {
    expect(resolveReserveUsd(undefined, 10)).toEqual({ usd: 10, invalid: false });
  });
  it("geçerli sayı (0 dahil) aynen alınır", () => {
    expect(resolveReserveUsd(4.5, 10)).toEqual({ usd: 4.5, invalid: false });
    expect(resolveReserveUsd(0, 10)).toEqual({ usd: 0, invalid: false });
  });
  it("bozuk değer varsayılana düşer ve işaretlenir (sessiz değil)", () => {
    for (const v of [-1, Number.NaN, "5", null, Number.POSITIVE_INFINITY, {}]) {
      expect(resolveReserveUsd(v, 10), String(v)).toEqual({ usd: 10, invalid: true });
    }
  });
});

// Bağlantı pini (kaynak taraması — tek yönlü; `run.ts` içe aktarılınca koşuyu başlattığı için davranışsal sınanamıyor): saf kararın
// gerçekten kullanıldığı, isteğe bağlı adımların payı koruduğu ve iki zorunlu adımın payla ÇAĞRILMADIĞI.
describe("run.ts bağlantısı", () => {
  const src = readFileSync(path.join(__dirname, "../../scripts/claude-work/run.ts"), "utf8");
  const fn = (start: string, end: string): string => {
    const a = src.indexOf(start);
    const b = src.indexOf(end, a);
    expect(a, start).toBeGreaterThan(-1);
    expect(b, end).toBeGreaterThan(a);
    return src.slice(a, b);
  };
  it("overBudget kararı saf fonksiyona bırakır ve çağrı payı iletir", () => {
    expect(fn("function overBudget(", "\n}\n")).toContain("stepBlockedByBudget({");
    expect(fn("async function call(", "const userContent")).toContain("overBudget(o.task, o.reserveUsd ?? 0)");
  });
  it("mercekler, ikincil istemler ve çürütme parçaları isteğe bağlı yoldan geçer", () => {
    const audit = fn("async function promptAudit(", "// Bulgu özeti (rapor ve yeniden tasarım ortak girdisi");
    expect(audit).toContain("optionalCall(`mercek ${lens.id}`");
    expect(audit).toContain('skipOptional("ikincil istemler")');
    expect(audit).toContain("optionalCall(`çürütme parçası");
    expect(audit).toMatch(/task: "prompt_audit",\s+reserveUsd,/);
    expect(audit).toContain("truncatedLenses: truncated, skipped, findings: all");
    // Doğrudan (paysız) `call(` yalnız ikincil istemlerde, ve orada da pay iletiliyor.
    expect(audit.split("await call({").length - 1).toBe(1);
  });
  it("🚨 iki zorunlu adım paysız; kurucu raporu yeniden tasarımdan ÖNCE çağrılır (öncelik sırayla — pay koşan çağrıyı bilemez)", () => {
    const tail = fn("// Bulgu özeti (rapor ve yeniden tasarım ortak girdisi", "// ── İş: ham model kolu");
    const report = tail.indexOf("const report = await call({");
    const redesign = tail.indexOf("const redesign = await call({");
    expect(report).toBeGreaterThan(-1);
    expect(redesign).toBeGreaterThan(report);
    expect(tail).not.toContain("reserveUsd");
    expect(tail).not.toContain("optionalCall");
    // Rapor yeniden tasarımın çıktısını kullanmaz (sırayı değiştirmek raporu fakirleştirmez).
    expect(tail.slice(report, redesign)).not.toContain("redesign");
  });
});
