import { describe, it, expect } from "vitest";
import { summarizeUnion, unionMetricsLines, type UnionRow } from "../eval/stay-metrics";

// Dilim 9: eval raporunun karar ölçüleri (tehlikeli kaçak · gereksiz inceleme · bilgi sorusu ↔ izin · bilinmiyor ·
// katman gerekliliği) SAF bir özetleyiciden gelir — gerçek model koşusu yokken de doğruluğu buradan pinlenir.

const row = (over: Partial<UnionRow>): UnionRow => ({
  kind: "none",
  lexical: false,
  lexicalKinds: [],
  guard: false,
  nlu: false,
  intents: [],
  concrete: false,
  ...over,
});

describe("konaklama eval karar ölçüleri", () => {
  it("tehlikeli kaçak türüyle sayılır; tutulan istek kaçak değildir", () => {
    const m = summarizeUnion([
      row({ kind: "early" }),
      row({ kind: "early", nlu: true }),
      row({ kind: "late" }),
      row({ kind: "extend", guard: true, lexical: true }),
    ]);
    expect(m.requests).toBe(4);
    expect(m.misses).toBe(2);
    expect(m.missesByKind).toEqual({ early: 1, late: 1 });
  });

  it("gereksiz inceleme = istek yokken HERHANGİ bir katmanın tutuşu (birleşim)", () => {
    const m = summarizeUnion([row({}), row({ lexical: true }), row({ guard: true }), row({ nlu: true })]);
    expect(m.none).toBe(4);
    expect(m.falseAlarms).toBe(3);
  });

  it("model düşen satır BİLİNMİYOR sayılır, birleşime girmez (kaçak ya da temiz sayılmaz)", () => {
    const m = summarizeUnion([row({ kind: "early", guard: null }), row({ nlu: null }), row({ kind: "late", guard: null, nlu: null })]);
    expect(m.unknown).toEqual({ guard: 2, nlu: 2, rows: 3 });
    expect(m.requests + m.none).toBe(0);
  });

  it("katman gerekliliği: YALNIZ tek katmanın yakaladığı gerçek istekler", () => {
    const m = summarizeUnion([
      row({ kind: "early", lexical: true }),
      row({ kind: "early", guard: true }),
      row({ kind: "late", nlu: true }),
      row({ kind: "late", nlu: true, guard: true }), // iki katman → sayılmaz
      row({ nlu: true }), // istek yok → sayılmaz
    ]);
    expect(m.onlyLeg).toEqual({ lexical: 1, guard: 1, nlu: 1 });
  });

  it("bilgi sorusu: erken giriş KONULU 'none' — incelemeye düşen ve politika metnine uygun olan ayrı sayılır", () => {
    const m = summarizeUnion([
      // "Erken giriş ücretli mi?" — kelime ağı konuyu yakalar, modeller istek görmez, saat yok → uygun (ama inceleme)
      row({ lexical: true, lexicalKinds: ["early"], intents: ["early_checkin"] }),
      // saat/gün var → uygun değil
      row({ lexical: true, lexicalKinds: ["early"], concrete: true }),
      // kelime ağı BAŞKA tür de görüyor → uygun değil
      row({ lexical: true, lexicalKinds: ["early", "late"] }),
      // model istek gördü → uygun değil
      row({ intents: ["early_checkin"], guard: true }),
      // hiçbir katman tutmadı (konu yalnız anlama etiketinde) → uygun, inceleme yok
      row({ intents: ["early_checkin"] }),
      // bavul deposu sorusu erken giriş bilgi sorusu SAYILMAZ (politika yolu yalnız erken giriş)
      row({ intents: ["luggage"] }),
      // konusu erken giriş değil → bilgi sorusu sayılmaz
      row({ intents: ["wifi"] }),
    ]);
    expect(m.info).toEqual({ questions: 5, flagged: 4, policyEligible: 2 });
  });

  it("rapor satırları yalnız SAYI taşır (metin yok) ve boş payda '—'", () => {
    const lines = unionMetricsLines("Karar ölçüleri", summarizeUnion([row({ kind: "early" })]));
    expect(lines.join("\n")).toContain("| Tehlikeli kaçak (istek → tutulmadı) | 1/1 (100%) — early 1 |");
    expect(lines.join("\n")).toContain("| Gereksiz inceleme (istek yok → tutuldu) | — |");
  });
});
