import { describe, it, expect } from "vitest";
import {
  ablationCandidates,
  analyzeFailure,
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
  });
  it("ifade çıkarılınca noktalama toparlanır; bulunamazsa / geriye bir şey kalmazsa null", () => {
    expect(removePhrase(H1, "polisi arayacağım")).toBe("Ev sahibi depozitomu vermiyor. Numara ne?");
    expect(removePhrase(H1, "Ev sahibi depozitomu vermiyor")).toBe("polisi arayacağım. Numara ne?");
    expect(removePhrase(H1, "Numara ne")).toBe("Ev sahibi depozitomu vermiyor, polisi arayacağım.");
    expect(removePhrase(H1, "POLİSİ ARAYACAĞIM")).toBe("Ev sahibi depozitomu vermiyor. Numara ne?");
    expect(removePhrase(H1, "jandarma")).toBeNull();
    expect(removePhrase("Numara ne?", "Numara ne")).toBeNull();
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
  it("🚨 kanıt önce: kararsız vakada modelin 'bilgi eksik / kural yok' beyanı model sınırını ezmez (ilk koşuda 'bilgi tabanı' önerilmişti)", () => {
    expect(suggestLayer("flaky", exp({ infoMissing: true, ruleCoverage: "unclear" }))).toBe("model_limit");
    expect(suggestLayer("flaky", exp({ expectationAgrees: false }))).toBe("test_expectation");
  });
  it("düzeltme katmanı sırası: test beklentisi → (kararsız) → bilgi → istem → kod kuralı → model sınırı", () => {
    expect(suggestLayer("trigger", exp({ expectationAgrees: false, infoMissing: true, ruleCoverage: "not_covered" }))).toBe("test_expectation");
    expect(suggestLayer("trigger", exp({ infoMissing: true, ruleCoverage: "not_covered" }))).toBe("knowledge");
    expect(suggestLayer("trigger", exp({ ruleCoverage: "unclear" }))).toBe("prompt");
    expect(suggestLayer("trigger", exp())).toBe("code_rule");
    expect(suggestLayer("context", exp())).toBe("model_limit");
    expect(suggestLayer("flaky", exp())).toBe("model_limit");
    expect(suggestLayer("trigger", null)).toBe("code_rule");
    expect(suggestLayer("context", null)).toBe("unknown");
    expect(suggestLayer("unrunnable", exp())).toBe("unknown");
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
    expect(r.baseline.outputs).toContain("(çağrı başarısız)");
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
    expect(md).toContain("## Doğrulama (4. adım)");
    expect(md).toContain("Kör set");
  });
});
