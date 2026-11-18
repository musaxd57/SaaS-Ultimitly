import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// EV SAHİBİ SÖZÜ — GELİŞTİRME SETİ + SÖZCÜK AĞININ BUGÜNKÜ SONUCU (kurucu 11-18 akşam). Model ve kredi GEREKMEZ.
//
// (1) Setin biçimi ve dengesi pinlenir (kimlikler tekil, üç beklenti de temsil ediliyor). (2) Puanlama çekirdeği pinlenir. (3) Bugünkü sözcük
// ağının (`detectHostPromises`) bu setteki sonucu ÖLÇÜLÜR ve sabitlenir: sayı bir hedef değil, "bugün nerede" kaydıdır. Sözcük ağı değişirse
// bu test kırılır ve sayı bilinçli güncellenir. Modelin sonucu burada yoktur (kredi gelince `tests/eval/host-commitment-report.ts`).
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

import { detectHostPromises } from "@/lib/ai-suggestions/core";
import { decisionOfLexicalPromises } from "@/lib/ai/semantic/host-commitment-verdict";
import { armSummaryTr, errorKindOf, scoreArm, type Decision } from "../eval/host-commitment-score";

interface DevCase {
  id: string;
  lang: string;
  message: string;
  expect: Decision;
  note: string;
}
const set = JSON.parse(readFileSync(join(process.cwd(), "evals/host-commitment-dev.json"), "utf8")) as { cases: DevCase[] };

describe("ev sahibi sözü — geliştirme seti", () => {
  it("biçim: kimlikler tekil, beklenti kapalı kümeden, mesaj boş değil; üç beklenti de yeterince temsil ediliyor", () => {
    expect(new Set(set.cases.map((c) => c.id)).size).toBe(set.cases.length);
    for (const c of set.cases) {
      expect(["auto", "card", "none"]).toContain(c.expect);
      expect(c.message.trim().length).toBeGreaterThan(0);
    }
    const count = (e: Decision) => set.cases.filter((c) => c.expect === e).length;
    expect({ auto: count("auto"), card: count("card"), none: count("none") }).toEqual({ auto: 14, card: 9, none: 14 });
  });

  it("puanlama: hata YÖNÜNE göre ayrılır (yanlış görev en pahalısı)", () => {
    expect(errorKindOf("auto", "auto")).toBeNull();
    expect(errorKindOf("none", "auto")).toBe("wrong_task");
    expect(errorKindOf("card", "auto")).toBe("wrong_task");
    expect(errorKindOf("auto", "card")).toBe("missed_task");
    expect(errorKindOf("auto", "none")).toBe("missed_task");
    expect(errorKindOf("none", "card")).toBe("card_noise");
    expect(errorKindOf("card", "none")).toBe("card_missed");
    const score = scoreArm([
      { id: "x1", expect: "auto", got: "auto" },
      { id: "x2", expect: "none", got: "auto" },
      { id: "x3", expect: "card", got: "none" },
    ]);
    expect(score).toMatchObject({ total: 3, correct: 1, errors: { wrong_task: ["x2"], card_missed: ["x3"], missed_task: [], card_noise: [] } });
    expect(armSummaryTr(score)).toBe("3 vakanın 1'i doğru · yanlış görev 1 · kaçan görev 0 · gereksiz kart 0 · kaçan kart 1");
  });

  it("🚨 ÖLÇÜM: bugünkü sözcük ağının bu setteki sonucu (hedef değil, kayıt) — yanlış görev açtığı vakalar adıyla", () => {
    const lexical = scoreArm(set.cases.map((c) => ({ id: c.id, expect: c.expect, got: decisionOfLexicalPromises(detectHostPromises(c.message)) })));
    // Sayı değişirse bilinçli güncellenir; yön sabit: sözcük ağı sözün SAHİBİNİ okuyamadığı için yanlış görev açıyor.
    expect({ summary: armSummaryTr(lexical), errors: lexical.errors }).toMatchInlineSnapshot(`
      {
        "errors": {
          "card_missed": [
            "c01",
            "c02",
            "c03",
            "c04",
            "c05",
          ],
          "card_noise": [],
          "missed_task": [
            "a10",
            "a11",
            "a12",
            "a13",
          ],
          "wrong_task": [
            "c07",
            "c08",
            "n01",
            "n03",
            "n04",
          ],
        },
        "summary": "37 vakanın 23'i doğru · yanlış görev 5 · kaçan görev 4 · gereksiz kart 0 · kaçan kart 5",
      }
    `);
  });
});
