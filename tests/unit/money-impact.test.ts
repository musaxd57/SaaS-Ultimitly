import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  estimateConflictImpact,
  isValidRate,
  roundDown2,
  roundUp2,
  RATE_MAX,
  RATE_STALE_DAYS,
  type ConflictMoneyInput,
  type NightlyRateRange,
} from "@/modules/intelligence/money/impact";

// ---------------------------------------------------------------------------
// V2 PARA ETKİSİ — değişmez 15 ("sahte kesinlik yok"): her tahmin ARALIK + varsayım + güven + kanıt taşır;
// bilinmeyen durumda HİÇBİR sayısal alan yoktur; güven asla "high" değildir; tutar rezervasyonun kayıtlı
// tutarından/para biriminden DEĞİL ev sahibinin kendi aralığından gelir ve yapay zekâya gitmez.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-24T10:00:00Z");
const DAY = 86_400_000;
const rate = (over: Partial<NightlyRateRange> = {}): NightlyRateRange => ({
  low: 2000,
  high: 3500,
  currency: "TRY",
  enteredAt: new Date(NOW.getTime() - 10 * DAY),
  ...over,
});
const conflict = (over: Partial<ConflictMoneyInput> = {}): ConflictMoneyInput => ({
  overlapNights: 2,
  longestStayNights: 5,
  possibleDuplicate: false,
  heldRequest: false,
  allUnconfirmed: false,
  ...over,
});

describe("bilinmeyen durumda sayı YOK", () => {
  it("aralık yok / geçersiz / bayat / muhtemel kopya → yalnız neden; sayısal alan hiç yok", () => {
    const cases: [Parameters<typeof estimateConflictImpact>, string][] = [
      [[conflict(), null, NOW], "no_rate"],
      [[conflict(), undefined, NOW], "no_rate"],
      [[conflict(), rate({ low: 0 }), NOW], "rate_invalid"],
      [[conflict(), rate({ high: 2000 }), NOW], "rate_invalid"],
      [[conflict(), rate({ low: Number.NaN }), NOW], "rate_invalid"],
      [[conflict(), rate({ high: RATE_MAX + 1 }), NOW], "rate_invalid"],
      [[conflict(), rate({ currency: "XXX" as never }), NOW], "rate_invalid"],
      [[conflict(), rate({ enteredAt: new Date("nope") }), NOW], "rate_invalid"],
      [[conflict(), rate({ enteredAt: new Date(NOW.getTime() - (RATE_STALE_DAYS + 1) * DAY) }), NOW], "rate_stale"],
      [[conflict({ possibleDuplicate: true }), rate(), NOW], "duplicate_likely"],
    ];
    for (const [args, reason] of cases) {
      const out = estimateConflictImpact(...args);
      expect(out, reason).toEqual({ kind: "unknown", reason });
      expect(Object.values(out).some((v) => typeof v === "number"), reason).toBe(false);
    }
  });

  it("bayatlık sınırı: 179 gün tahmin, 181 gün bilinmiyor", () => {
    expect(estimateConflictImpact(conflict(), rate({ enteredAt: new Date(NOW.getTime() - 179 * DAY) }), NOW).kind).toBe("estimate");
    expect(estimateConflictImpact(conflict(), rate({ enteredAt: new Date(NOW.getTime() - 181 * DAY) }), NOW).kind).toBe("unknown");
  });
});

describe("tahmin: aralık + varsayım + güven + kanıt", () => {
  it("formül: alt = çakışan gece × alt fiyat, üst = en uzun konaklama × üst fiyat; DIŞA yuvarlama", () => {
    const out = estimateConflictImpact(conflict({ overlapNights: 2, longestStayNights: 5 }), rate({ low: 1234, high: 2345 }), NOW);
    expect(out).toMatchObject({ kind: "estimate", low: 2400, high: 12_000, currency: "TRY", confidence: "medium" });
    if (out.kind !== "estimate") throw new Error("tahmin bekleniyordu");
    expect(out.evidence).toEqual({ overlapNights: 2, stayNights: 5, rateEnteredAt: rate().enteredAt.toISOString() });
    expect(out.assumptions).toEqual(["value_at_stake_not_loss", "penalties_excluded", "host_typical_rate", "whole_stay_upper_bound"]);
  });

  it("🚨 her kombinasyonda alt < üst, güven asla 'high', en az iki varsayım (kayıp değil + ceza dahil değil)", () => {
    for (const heldRequest of [false, true]) {
      for (const allUnconfirmed of [false, true]) {
        for (const [o, s] of [[1, 1], [1, 7], [3, 3], [2, 14]] as const) {
          for (const [l, h] of [[1, 2], [999, 1000], [2500, 9000], [1, RATE_MAX]] as const) {
            const out = estimateConflictImpact(conflict({ overlapNights: o, longestStayNights: s, heldRequest, allUnconfirmed }), rate({ low: l, high: h }), NOW);
            if (out.kind !== "estimate") throw new Error("tahmin bekleniyordu");
            expect(out.low).toBeLessThan(out.high);
            expect(out.confidence).not.toBe("high");
            expect(out.confidence).toBe(heldRequest || allUnconfirmed ? "low" : "medium");
            expect(out.assumptions).toContain("value_at_stake_not_loss");
            expect(out.assumptions).toContain("penalties_excluded");
            expect(out.assumptions.includes("whole_stay_upper_bound")).toBe(s > o);
          }
        }
      }
    }
  });

  it("para birimi YALNIZ aralıktan gelir (rezervasyonun kayıtlı birimi okunmaz)", () => {
    for (const currency of ["TRY", "EUR", "USD", "GBP"] as const) {
      const out = estimateConflictImpact(conflict(), rate({ currency }), NOW);
      expect(out.kind === "estimate" && out.currency).toBe(currency);
    }
  });

  it("dışa yuvarlama iki anlamlı basamak; aralığı daraltmaz", () => {
    expect(roundDown2(8250)).toBe(8200);
    expect(roundUp2(11_050)).toBe(12_000);
    expect(roundDown2(99)).toBe(99);
    expect(roundUp2(101)).toBe(110);
    expect(roundDown2(0)).toBe(0);
    for (const x of [7, 42, 999, 1234, 55_555, 987_654]) {
      expect(roundDown2(x)).toBeLessThanOrEqual(x);
      expect(roundUp2(x)).toBeGreaterThanOrEqual(x);
    }
    expect(isValidRate(rate())).toBe(true);
  });
});

describe("mimari pinler", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((e) => {
      const rel = `${dir}/${e}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e) ? [rel] : [];
    });

  it("saf modül hiçbir şey import etmez; para modülü rezervasyon tutarını/para birimini OKUMAZ", () => {
    expect(read("src/modules/intelligence/money/impact.ts")).not.toMatch(/^import /m);
    for (const rel of walk("src/modules/intelligence/money")) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/totalAmount|amountDec|reservation\.currency/);
    }
  });

  it("🚨 fiyat aralığı yapay zekâya GİTMEZ: AI katmanı ve misafir rotası para modülünü/anahtarını içermez", () => {
    const files = [...walk("src/lib/ai"), ...walk("src/app/api/chat"), "src/lib/automation.ts", "src/lib/guest-chat.ts"];
    expect(files.length).toBeGreaterThan(20); // anti-vakum
    for (const rel of files) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/intelligence\/money|nightly_rate_range|NIGHTLY_RATE/);
    }
    // Anti-vakum: anahtar gerçekten var ve tek yerde tanımlı.
    expect(read("src/modules/intelligence/money/rates.ts")).toContain('"nightly_rate_range"');
    // git mevcutsa, izlenen dosyalarda anahtarın geçtiği yerler yalnız para modülü + testler + belgeler.
    try {
      const out = execFileSync("git", ["-c", `safe.directory=${ROOT}`, "grep", "-l", "nightly_rate_range"], { cwd: ROOT, encoding: "utf8" });
      for (const f of out.split("\n").filter(Boolean)) {
        expect(f.startsWith("src/modules/intelligence/money/") || f.startsWith("tests/") || f.startsWith("docs/") || f === "CLAUDE.md", f).toBe(true);
      }
    } catch {
      // git yoksa yukarıdaki dosya sistemi taraması yeter (CLAUDE.md: pin git'i ŞART koşmaz).
    }
  });
});
