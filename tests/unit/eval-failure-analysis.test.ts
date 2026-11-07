import { describe, it, expect } from "vitest";
import {
  ablationCandidates,
  analyzeFailure,
  expectationDoubt,
  failureAnalysisMarkdown,
  fixedAll,
  fixedBy,
  judge,
  removePhrase,
  splitClauses,
  suggestLayer,
  type ModelExplanation,
} from "../eval/failure-analysis";

// ---------------------------------------------------------------------------
// ÖLÇÜM HATASI → NEDEN ANALİZİ döngüsünün SAF çekirdeği (kurucu 10-11: "önerdiğin döngü gibi olsun"): parçalara bölme, karşı deneme
// adayları, hüküm (kararsız / tetikleyici / bağlam), düzeltme katmanı önerisi, rapor. Model YOK — sahte koşturucu.
// ---------------------------------------------------------------------------

const H1 = "Ev sahibi depozitomu vermiyor, polisi arayacağım. Numara ne?";
const exp = (over: Partial<ModelExplanation> = {}): ModelExplanation => ({
  influencedBy: [],
  why: "",
  wouldNow: "",
  ruleCoverage: "covered",
  expectationAgrees: true,
  infoMissing: false,
  ...over,
});

describe("splitClauses / removePhrase", () => {
  it("cümle ve virgüllü yan cümle parçaları", () => {
    expect(splitClauses(H1)).toEqual(["Ev sahibi depozitomu vermiyor", "polisi arayacağım", "Numara ne"]);
    expect(splitClauses("Tek parça")).toEqual(["Tek parça"]);
    expect(splitClauses("…!!  ")).toEqual([]);
    // Haiku 3. tur: sayı / sıra noktası bölmez.
    expect(splitClauses("Babam 2.kattan düştü, ambulans numarası ne?")).toEqual(["Babam 2.kattan düştü", "ambulans numarası ne"]);
    expect(splitClauses("Saat 10.30'da geldik. Polis?")).toEqual(["Saat 10.30'da geldik", "Polis"]);
  });
  it("ifade çıkarılınca noktalama toparlanır; bulunamazsa / geriye bir şey kalmazsa null", () => {
    expect(removePhrase(H1, "polisi arayacağım")).toBe("Ev sahibi depozitomu vermiyor. Numara ne?");
    expect(removePhrase(H1, "Ev sahibi depozitomu vermiyor")).toBe("polisi arayacağım. Numara ne?");
    expect(removePhrase(H1, "Numara ne")).toBe("Ev sahibi depozitomu vermiyor, polisi arayacağım.");
    expect(removePhrase(H1, "POLİSİ ARAYACAĞIM")).toBe("Ev sahibi depozitomu vermiyor. Numara ne?");
    expect(removePhrase(H1, "jandarma")).toBeNull();
    expect(removePhrase("Numara ne?", "Numara ne")).toBeNull();
  });
  it("🚨 BÜTÜN geçişler ve yalnız sözcük sınırında çıkar (Haiku 3. tur)", () => {
    expect(removePhrase("Ev sahibi kapıyı açmıyor, ev sahibi telefonu da açmıyor.", "ev sahibi")).toBe("kapıyı açmıyor, telefonu da açmıyor.");
    // Sözcük içi eşleşme çıkarılmaz ("polis" ≠ "polisiye").
    expect(removePhrase("Polisiye dizi izledik.", "polis")).toBeNull();
    expect(removePhrase("Polisi arayacağım.", "polis")).toBeNull();
  });
});

describe("ablationCandidates", () => {
  it("önce modelin andığı ifadeler, sonra parçalar; aynı sonucu veren tekilleşir; tavan", () => {
    const c = ablationCandidates(H1, ["polisi arayacağım", "yok böyle bir şey"]);
    expect(c.map((x) => [x.kind, x.phrase])).toEqual([
      ["claimed", "polisi arayacağım"],
      ["clause", "Ev sahibi depozitomu vermiyor"],
      ["clause", "Numara ne"],
    ]);
    expect(ablationCandidates(H1, [], 2)).toHaveLength(2);
  });
  it("tek parçalı mesajda parça çıkarılmaz", () => {
    expect(ablationCandidates("Polis numarası ne?")).toEqual([]);
  });
});

describe("judge / suggestLayer", () => {
  const abl = (phrase: string, correct: number, kind: "clause" | "claimed" = "clause") => ({ kind, phrase, text: "", correct, runs: 2, outputs: [] });
  it("kararsız: özgün mesaj yeniden koşunca çoğunlukla doğru", () => {
    expect(judge({ correct: 1, runs: 2 }, [abl("x", 2)], []).kind).toBe("flaky");
  });
  it("tetikleyici: çıkarılınca BÜTÜN tekrarlarda düzelen ifade; yarısında düzelen KISMİ etki; modelin iddiası sınanır", () => {
    const v = judge(
      { correct: 0, runs: 2 },
      [abl("polisi arayacağım", 2, "claimed"), abl("Kapı kodu", 1, "claimed"), abl("Numara ne", 0)],
      ["polisi arayacağım", "Kapı kodu", "Numara ne", "yok"],
    );
    expect(v.kind).toBe("trigger");
    expect(v.triggers).toEqual(["polisi arayacağım"]);
    expect(v.partial).toEqual(["Kapı kodu"]);
    expect(v.claimChecks).toEqual([
      { phrase: "polisi arayacağım", result: "confirmed" },
      { phrase: "Kapı kodu", result: "partial" },
      { phrase: "Numara ne", result: null },
      { phrase: "yok", result: null },
    ]);
  });
  it("🚨 yalnız kısmi etki varsa tetikleyici YOK → bağlam (ilk koşuda 1/2 tetikleyici sayılıyordu)", () => {
    const v = judge({ correct: 0, runs: 2 }, [abl("a", 1), abl("b", 0)], []);
    expect(v.kind).toBe("context");
    expect(v.triggers).toEqual([]);
    expect(v.partial).toEqual(["a"]);
  });
  it("🚨 payda PLANLANAN tekrar: başarısız çağrı 1/1'i 'bütün tekrarlar' yapmaz; özgün mesajda tek doğru çoğunluk sayılmaz (Haiku 3. tur)", () => {
    const one = { kind: "clause" as const, phrase: "x", text: "", correct: 1, runs: 1, planned: 2, outputs: [] };
    const v = judge({ correct: 0, runs: 2, planned: 2 }, [one], []);
    expect(v.kind).toBe("context");
    expect(v.triggers).toEqual([]);
    expect(v.partial).toEqual(["x"]);
    expect(judge({ correct: 1, runs: 1, planned: 2 }, [], []).kind).toBe("flaky");
    expect(judge({ correct: 0, runs: 1, planned: 3 }, [], []).kind).toBe("context");
    // 3 tekrarın 2'si başarısız, 1 doğru: "çoğunluk doğru" DEĞİL (mutasyon F2).
    expect(judge({ correct: 1, runs: 1, planned: 3 }, [], []).kind).toBe("context");
    expect(fixedAll(1, 1, 2)).toBe(false);
    expect(fixedAll(2, 2, 2)).toBe(true);
  });
  it("bağlam: hiçbir tek ifade düzeltmiyor; koşulamadı: çağrı yok", () => {
    expect(judge({ correct: 0, runs: 2 }, [abl("a", 0), abl("b", 0)], []).kind).toBe("context");
    expect(judge({ correct: 0, runs: 0 }, [], []).kind).toBe("unrunnable");
    expect(fixedBy(1, 2)).toBe(true);
    expect(fixedBy(0, 2)).toBe(false);
    expect(fixedBy(0, 0)).toBe(false);
    expect(fixedAll(2, 2)).toBe(true);
    expect(fixedAll(1, 2)).toBe(false);
    expect(fixedAll(0, 0)).toBe(false);
  });
  it("🚨 KANIT ÖNCE: modelin beyanı katmanı ezmez (Haiku 3. tur) — kararsız → model sınırı; tetikleyici → kod kuralı / istem", () => {
    expect(suggestLayer("flaky", exp({ infoMissing: true, ruleCoverage: "unclear", expectationAgrees: false }))).toBe("model_limit");
    expect(suggestLayer("trigger", exp({ expectationAgrees: false }))).toBe("code_rule");
    expect(suggestLayer("trigger", exp({ infoMissing: true }))).toBe("code_rule");
    expect(suggestLayer("trigger", exp({ ruleCoverage: "not_covered" }))).toBe("prompt");
    expect(suggestLayer("trigger", null)).toBe("code_rule");
  });
  it("bağlam (tek ifade suçlanamaz): bilgi eksik → bilgi tabanı; kural yok → istem; kural var → model sınırı", () => {
    expect(suggestLayer("context", exp({ infoMissing: true }))).toBe("knowledge");
    expect(suggestLayer("context", exp({ ruleCoverage: "unclear" }))).toBe("prompt");
    expect(suggestLayer("context", exp())).toBe("model_limit");
    expect(suggestLayer("context", null)).toBe("unknown");
    expect(suggestLayer("unrunnable", exp())).toBe("unknown");
  });
  it("'beklentiye katılmıyorum' AYRI uyarı (katmanı değiştirmez); açıklama yoksa uyarı yok", () => {
    expect(expectationDoubt(exp({ expectationAgrees: false }))).toBe(true);
    expect(expectationDoubt(exp())).toBe(false);
    expect(expectationDoubt(null)).toBe(false);
  });
});

describe("analyzeFailure — uçtan uca (sahte koşturucu)", () => {
  // Sahte "model": mesajda "polisi" varsa yalnız acil der (yanlış), yoksa şikâyet etiketini de koyar.
  const run = async (t: string) => (/polisi/i.test(t) ? ["emergency"] : ["complaint_issue", "emergency"]);
  const isCorrect = (o: string[]) => o.includes("complaint_issue");

  it("tetikleyici bulunur, modelin iddiası doğrulanır, katman önerilir, çağrı sayısı doğru", async () => {
    let explained = 0;
    const r = await analyzeFailure(
      { id: "h1", text: H1, observed: ["emergency"], expected: "hold" },
      {
        run,
        isCorrect,
        show: (o) => o.join(","),
        explain: async () => {
          explained++;
          return exp({ influencedBy: ["polisi arayacağım", "Numara ne?"], ruleCoverage: "unclear" });
        },
        reps: 2,
      },
    );
    expect(explained).toBe(1);
    expect(r.kind).toBe("trigger");
    expect(r.triggers).toEqual(["polisi arayacağım"]);
    expect(r.claimChecks).toEqual([
      { phrase: "polisi arayacağım", result: "confirmed" },
      { phrase: "Numara ne?", result: "not" },
    ]);
    expect(r.partial).toEqual([]);
    expect(r.layer).toBe("prompt");
    // açıklama 1 + 2 × (özgün 1 + aday 3: iki iddia + bir kalan parça)
    expect(r.ablations.map((a) => a.phrase)).toEqual(["polisi arayacağım", "Numara ne?", "Ev sahibi depozitomu vermiyor"]);
    expect(r.calls).toBe(1 + 2 * (1 + 3));
  });

  it("başarısız çağrı sayılmaz; açıklayıcı patlarsa açıklamasız sürer", async () => {
    let n = 0;
    const r = await analyzeFailure(
      { id: "x", text: H1, observed: ["emergency"], expected: "hold" },
      {
        run: async (t) => (n++ % 2 === 0 ? null : await run(t)),
        isCorrect,
        show: (o) => o.join(","),
        explain: async () => {
          throw new Error("ağ");
        },
        reps: 2,
      },
    );
    expect(r.explanation).toBeNull();
    expect(r.baseline.runs).toBe(1);
    expect(r.baseline.planned).toBe(2);
    expect(r.baseline.outputs).toContain("(çağrı başarısız)");
    // Her adayda bir çağrı başarısız → hiçbiri "bütün tekrarlarda düzeldi" sayılamaz (mutasyon F10: payda düşerse 1/1 tetikleyici olurdu).
    expect(r.ablations.every((a) => a.planned === 2 && a.runs === 1)).toBe(true);
    expect(r.triggers).toEqual([]);
  });

  it("rapor: kanıt, katman, modelin iddiasının sınanması ve doğrulama adımı yazılır", async () => {
    const r = await analyzeFailure(
      { id: "h1", text: H1, observed: ["emergency"], expected: "hold" },
      { run, isCorrect, show: (o) => o.join(","), explain: async () => exp({ influencedBy: ["polisi arayacağım"] }), reps: 2 },
    );
    const md = failureAnalysisMarkdown("Başlık", "Kaynak", [r]);
    expect(md).toContain("TETİKLEYİCİ İFADE");
    expect(md).toContain('"polisi arayacağım" → DOĞRULANDI');
    expect(md).toContain("Önerilen düzeltme katmanı: KOD KURALI");
    expect(md).not.toContain("KATILMIYOR — senaryonun");
    const doubt = failureAnalysisMarkdown("B", "K", [{ ...r, explanation: exp({ expectationAgrees: false }) }]);
    expect(doubt).toContain("⚠️ Model test beklentisine KATILMIYOR");
    expect(md).toContain("## Doğrulama (4. adım)");
    expect(md).toContain("Kör set");
  });
});
