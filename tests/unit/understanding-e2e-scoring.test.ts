import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  bindingVerdict,
  matchRequests,
  relationAgreement,
  requestOutcome,
  spanMessageNumber,
  validateUxDataset,
  valueVariants,
  wrongBinding,
  type RequestObservation,
  type UxDataset,
} from "../eval/understanding-e2e-scoring";
import { normalizeQuote, parseAudit, quoteInItem } from "../eval/claim-audit";

// Anlama ölçümünün SAF puanlaması (`tests/eval/understanding-e2e-scoring.ts`, tasarım `docs/TASARIM-2026-10-21-anlama-olcumu.md`).
// Ölçer ücretli koştuğu için puanlama kuralları burada modelsiz sınanır: yanlış bağ, istek eşleme, ilişki uyumu, son sonuç, alıntı doğrulama.

const DEV = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/understanding-e2e-dev.json"), "utf8")) as UxDataset;

const base: RequestObservation = {
  sent: true,
  sentText: "",
  addressed: "answered",
  judgeErrors: 0,
  itemOpen: null,
  conversationOpen: false,
  escalated: false,
  emails: 0,
};

describe("geliştirme seti", () => {
  it("biçim kurallarına uyar (dayanak parçası birebir, değerler bilgi tabanında, çiftler ikili)", () => {
    expect(validateUxDataset(DEV)).toEqual([]);
  });

  it("doğrulayıcı bozuk seti yakalar (anti-vakum)", () => {
    const bad: UxDataset = JSON.parse(JSON.stringify(DEV)) as UxDataset;
    bad.scenarios[0].requests[0].span = "metinde olmayan parça";
    bad.scenarios[1].requests[0].facts = [{ about: ["x"], value: "99:99" }];
    bad.scenarios[2].pair = "TEK";
    const errs = validateUxDataset(bad);
    expect(errs.some((e) => e.includes("dayanak parçası"))).toBe(true);
    expect(errs.some((e) => e.includes("değer bilgi tabanında"))).toBe(true);
    expect(errs.some((e) => e.includes("çift TEK"))).toBe(true);
  });
});

describe("yazılmış bağlar", () => {
  const pool = { about: ["havuz"], value: "20:00" };
  const poolWrong = { about: ["havuz"], value: "22:00" };

  it("komşu tesisin değeri bu tesise bağlanırsa YANLIŞ; ayrı cümlecikte doğru", () => {
    expect(wrongBinding(poolWrong, "Havuz 22:00'de kapanır.")).toBe(true);
    expect(wrongBinding(poolWrong, "Havuz 20:00'de, spor salonu 22:00'de kapanır.")).toBe(false);
    expect(bindingVerdict(pool, "Havuz 20:00'de, spor salonu 22:00'de kapanır.")).toBe("ok");
    expect(bindingVerdict(pool, "Spor salonu 20:00'de kapanır.")).toBe("misattributed");
    expect(bindingVerdict(pool, "Havuz 20:00 değil.")).toBe("negated");
  });

  it("yalnız yazım biçimi eşdeğer sayılır (saat / para)", () => {
    expect(valueVariants("20:00")).toEqual(expect.arrayContaining(["20.00", "8 pm", "8:00 pm"]));
    expect(valueVariants("150 TL")).toEqual(expect.arrayContaining(["150 ₺", "₺150", "150TL"]));
    expect(bindingVerdict({ about: ["pool"], value: "19:00" }, "The pool is open until 7 PM.")).toBe("ok");
    expect(bindingVerdict({ about: ["pool"], value: "19:00" }, "The pool is open until 9 PM.")).toBe("missing");
  });
});

describe("istek eşleme + ilişki", () => {
  const s = DEV.scenarios.find((x) => x.id === "d-two-msgs-tr")!;

  it("dayanak parçasının mesaj numarası cevapsız pencereden", () => {
    expect(spanMessageNumber(s, "Klima çok ses yapıyor, uyuyamıyoruz")).toBe(1);
    expect(spanMessageNumber(s, "en yakın market nerede")).toBe(2);
  });

  it("niyet + mesaj numarasıyla eşler; fazla istek ayrı", () => {
    const { matches, extra } = matchRequests(s, [
      { intent: "complaint_issue", queryOriginal: "klima ses", queryTr: "klima ses", message: 1, relation: "own_topic" },
      { intent: "local_recommendations", queryOriginal: "yakın market", queryTr: "yakın market", message: 2, relation: "own_topic" },
      { intent: "wifi", queryOriginal: "wifi", queryTr: "wifi", message: 2, relation: "own_topic" },
    ]);
    expect(matches.map((m) => m.extraction)).toEqual(["found", "found"]);
    expect(matches[1].traceable).toBe(true);
    expect(extra).toEqual([2]);
  });

  it("yanlış mesaja bağlanan istek eşlenmez", () => {
    const { matches } = matchRequests(s, [{ intent: "local_recommendations", queryOriginal: "market", queryTr: "market", message: 1 }]);
    expect(matches[1].extraction).toBe("missed");
  });

  it("bağlı soru asıl talebe katıldıysa birleşik sayılır", () => {
    const t = DEV.scenarios.find((x) => x.id === "d-noise-again-tr")!;
    const { matches } = matchRequests(t, [{ intent: "complaint_issue", queryOriginal: "gürültü", queryTr: "gürültü", message: 1, relation: "own_topic" }]);
    expect(matches.map((m) => m.extraction)).toEqual(["found", "merged"]);
    expect(relationAgreement("dependent", matches[1])).toBe("agree");
  });

  it("bağlı istekte 'kendi konusu' güvensiz ayrılık; bağımsızda 'bağlı' güvenli ayrılık", () => {
    const m = (rel: string) => ({ id: "r", extraction: "found" as const, modelIndex: 0, modelIntent: "x", modelRelation: rel, traceable: true });
    expect(relationAgreement("dependent", m("own_topic"))).toBe("unsafe_disagree");
    expect(relationAgreement("dependent", m("fix_request"))).toBe("agree");
    expect(relationAgreement("independent", m("follow_up"))).toBe("safe_disagree");
    expect(relationAgreement("ambiguous", m("unclear"))).toBe("agree");
    expect(relationAgreement("none", m("own_topic"))).toBe("not_scored");
  });
});

describe("son sonuç", () => {
  const ans = { expect: "answer" as const, facts: [{ about: ["havuz"], value: "20:00" }], wrong: [{ about: ["havuz"], value: "22:00" }] };

  it("cevap: doğru / yanlış bağ / denetçi hatası / doğrulanmamış olgu", () => {
    expect(requestOutcome(ans, { ...base, sentText: "Havuz 20:00'ye kadar açık." }).outcome).toBe("ok");
    expect(requestOutcome(ans, { ...base, sentText: "Havuz 22:00'ye kadar açık." }).outcome).toBe("wrong_info");
    expect(requestOutcome(ans, { ...base, sentText: "Havuz 20:00'ye kadar açık.", judgeErrors: 1 }).outcome).toBe("wrong_info");
    expect(requestOutcome(ans, { ...base, sentText: "Havuz akşam sekize kadar açık." }).outcome).toBe("ok_unverified");
  });

  it("cevap beklenen ama gitmedi: ev sahibinde açıksa açık, değilse sessiz düştü", () => {
    expect(requestOutcome(ans, { ...base, sent: false, sentText: null, addressed: null, conversationOpen: true }).outcome).toBe("held_open");
    expect(requestOutcome(ans, { ...base, addressed: "absent", sentText: "Wi-Fi şifresi lale2026.", itemOpen: false }).outcome).toBe("held_dropped");
    expect(requestOutcome(ans, { ...base, addressed: "deferred", sentText: "Kontrol edip dönüyoruz.", itemOpen: true }).outcome).toBe("held_open");
  });

  it("tutulması beklenen: içerik olarak cevaplandıysa sızıntı; erteleme sızıntı değil", () => {
    const hold = { expect: "hold" as const };
    expect(requestOutcome(hold, { ...base, sentText: "Sokağa park edebilirsiniz." }).outcome).toBe("leaked");
    expect(requestOutcome(hold, { ...base, addressed: "deferred", sentText: "Ev sahibinize ilettik.", itemOpen: true }).outcome).toBe("held_open");
    expect(requestOutcome(hold, { ...base, addressed: "absent", sentText: "Çöp girişin sağında.", itemOpen: null }).outcome).toBe("held_dropped");
  });

  it("asıl talep (şikâyet): açık kalması doğru; onaylı tarif değinmesi sızıntı değil, anlam hatası sızıntı", () => {
    const complaint = { expect: "hold" as const, relation: "none" as const, intents: ["complaint_issue", "appliance_help"] };
    expect(requestOutcome(complaint, { ...base, sentText: "Klima için MODE tuşuyla kar tanesini seçin.", itemOpen: true }).outcome).toBe("held_open");
    expect(requestOutcome(complaint, { ...base, sentText: "Teknisyen yarın gelecek.", itemOpen: true, judgeErrors: 1 }).outcome).toBe("leaked");
    expect(requestOutcome(complaint, { ...base, sentText: "Klima için MODE tuşuyla kar tanesini seçin.", itemOpen: false }).outcome).toBe("held_dropped");
    // Bağlı soru (çapa değil) içerikle cevaplanırsa sızıntı.
    const dependent = { expect: "hold" as const, relation: "dependent" as const, intents: ["parking"] };
    expect(requestOutcome(dependent, { ...base, sentText: "Sokağa park edebilirsiniz.", itemOpen: true }).outcome).toBe("leaked");
  });

  it("acil: Sorunlu + e-posta, içerik gitmedi", () => {
    const em = { expect: "emergency" as const };
    expect(requestOutcome(em, { ...base, sent: false, sentText: null, addressed: null, escalated: true, emails: 1 }).outcome).toBe("emergency_ok");
    expect(requestOutcome(em, { ...base, sent: false, sentText: null, addressed: null, escalated: false, emails: 0 }).outcome).toBe("emergency_missed");
    expect(requestOutcome(em, { ...base, sentText: "Söndürücü mutfak kapısının arkasında." }).outcome).toBe("emergency_leak");
  });
});

describe("iddia denetçisi — alıntı doğrulama (kod)", () => {
  const kb = [{ id: "gym", category: "general", title: "Spor salonu", content: "Spor salonu 07:00–22:00 arası açıktır.  Misafirler için ücretsizdir." }];

  it("alıntı kalemde birebir (büyük/küçük harf, boşluk, sondaki nokta hariç) geçmeli", () => {
    expect(quoteInItem(kb, "gym", "spor salonu 07:00–22:00 arası açıktır")).toBe(true);
    expect(quoteInItem(kb, "gym", "Misafirler için ücretsizdir.")).toBe(true);
    expect(quoteInItem(kb, "gym", "Havuz 07:00–22:00 arası açıktır")).toBe(false);
    expect(quoteInItem(kb, "pool", "Spor salonu 07:00–22:00 arası açıktır")).toBe(false);
    expect(normalizeQuote("A  “b”’c. ")).toBe('a "b"\'c');
  });

  it("alıntısı doğrulanmayan 'destekli' iddia 'doğrulanmadı' olur; hata sınıfları korunur", () => {
    const parsed = parseAudit(
      {
        requests: [{ id: "r1", addressed: "answered", explanation: "" }, { id: "zz", addressed: "answered", explanation: "" }],
        claims: [
          { request_id: "r1", text: "x", subject: "gym", relation: "time", value: "22:00", condition: "", support: "supported", kb_id: "gym", kb_quote: "Spor salonu 07:00–22:00 arası açıktır", explanation: "" },
          { request_id: "r1", text: "y", subject: "pool", relation: "time", value: "22:00", condition: "", support: "supported", kb_id: "gym", kb_quote: "Havuz 22:00", explanation: "" },
          { request_id: "r1", text: "z", subject: "pool", relation: "time", value: "22:00", condition: "", support: "misbound", kb_id: "gym", kb_quote: "uydurma", explanation: "" },
        ],
      },
      kb,
      ["r1"],
    );
    expect(parsed?.requests.map((r) => r.id)).toEqual(["r1"]);
    expect(parsed?.claims.map((c) => c.support)).toEqual(["supported", "unverified", "misbound"]);
  });
});
