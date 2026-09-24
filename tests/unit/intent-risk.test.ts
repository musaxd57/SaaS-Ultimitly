import { describe, it, expect, afterEach, vi } from "vitest";
import {
  INTENT_RISK_KINDS,
  INTENT_RISK_REASON,
  evaluateIntentRisk,
  intentPolicyMode,
  intentRiskEvidenceOf,
  understandingRiskOf,
} from "@/lib/ai/semantic/intent-risk";
import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { autoReplyGateFailure } from "@/lib/automation";
import { evaluateEscalation, ESCALATION_REASONS } from "@/lib/guest-chat-gate";
import { ESCALATION_REASON_CODES } from "@/lib/risk-events";
import { buildKbEvidence } from "@/lib/ai/grounding";
import { classifyFallback, detectRiskType } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// ANLAMA KATMANININ RİSK NİYETLERİ → KAPI (09-24). Pinlenen:
//  · yalnız SIKILAŞTIRIR, varsayılan GÖLGE (karar yok, `enforce` kararı her koşuda hesaplanır);
//  · kelime ağının KAÇIRDIĞI dolaylı dil (ölçüldü) yalnız bu sinyalle tutulur;
//  · gerekçe SON kontrol: başka bir kontrol kapattıysa onun gerekçesi yazılır;
//  · insan talebinde modelin KENDİ devir cevabı muaf; acil/şikâyet/iptal muaf DEĞİL;
//  · kanal ve QR kapısı AYNI yüklem; gerekçe kodu RiskEvent kümesinde; kanıt yalnız kapalı küme.
// ---------------------------------------------------------------------------

const nlu = (...intents: string[]): MessageUnderstanding =>
  ({
    language: "en",
    requests: intents.map((intent) => ({ intent, queryTr: "sorgu", queryOriginal: "query" })),
    stay: { requested: false, kind: "none", checkinTime: null, checkoutTime: null },
  }) as unknown as MessageUnderstanding;

/** Kapının geri kalanının GEÇİRDİĞİ bir taslak (model: düşük risk, yüksek güven). */
const OK = {
  intent: "general",
  riskLevel: "low",
  confidence: 0.92,
  source: "openai",
  riskType: null,
  reply: "Thank you for letting us know.",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("saf politika", () => {
  it("en ağır risk niyeti: acil > şikâyet > iptal/iade > insan; risk niyeti yoksa ya da katman yoksa null", () => {
    expect(understandingRiskOf(nlu("wifi", "human_request", "complaint_issue"))).toBe("complaint_issue");
    expect(understandingRiskOf(nlu("cancellation_refund", "emergency"))).toBe("emergency");
    expect(understandingRiskOf(nlu("human_request", "cancellation_refund"))).toBe("cancellation_refund");
    expect(understandingRiskOf(nlu("human_request"))).toBe("human_request");
    expect(understandingRiskOf(nlu("wifi", "parking", "payment_invoice", "greeting_thanks"))).toBeNull();
    expect(understandingRiskOf(null)).toBeNull();
    expect(understandingRiskOf(undefined)).toBeNull();
    expect(INTENT_RISK_KINDS).toEqual(["emergency", "complaint_issue", "cancellation_refund", "human_request"]);
  });

  it("🚨 varsayılan GÖLGE: karar yok ama `enforce` kararı HER ZAMAN hesaplanır", () => {
    const e = evaluateIntentRisk("complaint_issue", { modelIntent: "general" });
    expect(e).toEqual({ reason: null, enforceReason: INTENT_RISK_REASON, kind: "complaint_issue" });
    expect(evaluateIntentRisk("complaint_issue", { modelIntent: "general", mode: "enforce" }).reason).toBe(INTENT_RISK_REASON);
    expect(evaluateIntentRisk(null, { modelIntent: "general", mode: "enforce" })).toEqual({ reason: null, enforceReason: null, kind: null });
  });

  it("insan talebi: modelin KENDİ devir cevabı muaf; acil/şikâyet/iptal devir cevabında da muaf DEĞİL", () => {
    expect(evaluateIntentRisk("human_request", { modelIntent: "human_request", mode: "enforce" }).enforceReason).toBeNull();
    expect(evaluateIntentRisk("human_request", { modelIntent: "general", mode: "enforce" }).reason).toBe(INTENT_RISK_REASON);
    for (const kind of ["emergency", "complaint_issue", "cancellation_refund"] as const) {
      expect(evaluateIntentRisk(kind, { modelIntent: "human_request", mode: "enforce" }).reason, kind).toBe(INTENT_RISK_REASON);
    }
  });

  it("kip: yalnız `enforce` açar (harf/kenar boşluğu esnek); başka her değer gölge", () => {
    expect(intentPolicyMode()).toBe("shadow");
    for (const [v, want] of [
      ["enforce", "enforce"],
      [" ENFORCE ", "enforce"],
      ["Enforce", "enforce"],
      ["1", "shadow"],
      ["true", "shadow"],
      ["on", "shadow"],
      ["", "shadow"],
    ] as const) {
      vi.stubEnv("AI_INTENT_POLICY", v);
      expect(intentPolicyMode(), v).toBe(want);
    }
    vi.stubEnv("AI_INTENT_POLICY", "enforce");
    expect(evaluateIntentRisk("emergency", { modelIntent: "general" }).reason).toBe(INTENT_RISK_REASON);
  });

  it("kanıt özeti yalnız kapalı-küme kodlar", () => {
    expect(intentRiskEvidenceOf(evaluateIntentRisk("emergency", { modelIntent: "general", mode: "shadow" }))).toEqual({
      v: "-",
      ev: "understanding_risk",
      k: "emergency",
    });
    expect(intentRiskEvidenceOf(evaluateIntentRisk(null, { modelIntent: "general", mode: "enforce" }))).toEqual({ v: "-", ev: "-", k: "-" });
  });
});

describe("kanal kapısı (`autoReplyGateFailure`)", () => {
  /** Kelime ağının KAÇIRDIĞI dolaylı dil (09-24 ölçümü): ne `classifyFallback` ne `detectRiskType` engelliyor. */
  const MISSED: [string, "emergency" | "complaint_issue" | "cancellation_refund" | "human_request"][] = [
    ["My daughter cut her hand badly, where is the nearest hospital?", "emergency"],
    ["Kapının kilidi takılıyor, dışarıda kaldık.", "emergency"],
    ["There are ants all over the kitchen counter.", "complaint_issue"],
    ["Komşular gece boyunca bağırdı, hiç uyuyamadık.", "complaint_issue"],
    ["I would like to get back the amount for the last two nights.", "cancellation_refund"],
    ["Can I speak with the owner directly please?", "human_request"],
    ["Ev sahibiyle bizzat konuşabilir miyim?", "human_request"],
  ];

  it("KONTROL (anti-vakum): bu mesajlar sinyalsiz kapıdan GEÇİYOR — kelime ağı gerçekten kaçırıyor", () => {
    for (const [msg] of MISSED) {
      const fb = classifyFallback(msg);
      expect(fb.isComplaint || ["refund", "early_departure", "human_request"].includes(fb.intent), msg).toBe(false);
      expect(detectRiskType(msg), msg).toBeNull();
      expect(autoReplyGateFailure(OK, msg, {}), msg).toBeNull();
    }
  });

  it("🚨 `enforce`: anlama katmanının risk niyeti taslağı TUTAR (gerekçe `understanding_risk`); gölge kipte geçer", () => {
    for (const [msg, kind] of MISSED) {
      expect(autoReplyGateFailure(OK, msg, { understandingRisk: kind, intentMode: "enforce" }), msg).toBe("understanding_risk");
      expect(autoReplyGateFailure(OK, msg, { understandingRisk: kind, intentMode: "shadow" }), msg).toBeNull();
    }
  });

  it("gerekçe SON kontrol: başka bir kontrol kapattıysa onun gerekçesi yazılır (düşük güven → `blocked`)", () => {
    const msg = MISSED[2][0];
    expect(autoReplyGateFailure({ ...OK, confidence: 0.5 }, msg, { understandingRisk: "complaint_issue", intentMode: "enforce" })).toBe("blocked");
    expect(autoReplyGateFailure({ ...OK, confidence: Number.NaN }, msg, { understandingRisk: "complaint_issue", intentMode: "enforce" })).toBe(
      "blocked",
    );
  });

  it("devir cevabı insan talebinde GİDER; aynı devir cevabı acil durumda TUTULUR", () => {
    const handoff = { ...OK, intent: "human_request", reply: "Mesajınız kaydedildi; ev sahibiniz görebilir." };
    const msg = "Can I speak with the owner directly please?";
    expect(autoReplyGateFailure(handoff, msg, { understandingRisk: "human_request", intentMode: "enforce" })).toBeNull();
    expect(autoReplyGateFailure(handoff, msg, { understandingRisk: "emergency", intentMode: "enforce" })).toBe("understanding_risk");
  });

  it("varsayılan kip `AI_INTENT_POLICY`den (verilmezse gölge)", () => {
    const msg = MISSED[0][0];
    expect(autoReplyGateFailure(OK, msg, { understandingRisk: "emergency" })).toBeNull();
    vi.stubEnv("AI_INTENT_POLICY", "enforce");
    expect(autoReplyGateFailure(OK, msg, { understandingRisk: "emergency" })).toBe("understanding_risk");
  });
});

describe("QR kapısı (`evaluateEscalation`) — AYNI yüklem", () => {
  const msg = "There are ants all over the kitchen counter.";

  it("KONTROL: sinyalsiz geçer; 🚨 `enforce` + risk niyeti → devir (`understanding_risk`); gölge kipte geçer", () => {
    expect(evaluateEscalation(OK, msg, null, [], {})).toEqual({ escalate: false, reason: null });
    expect(evaluateEscalation(OK, msg, null, [], { understandingRisk: "complaint_issue", intentMode: "enforce" })).toEqual({
      escalate: true,
      reason: "understanding_risk",
    });
    expect(evaluateEscalation(OK, msg, null, [], { understandingRisk: "complaint_issue", intentMode: "shadow" })).toEqual({
      escalate: false,
      reason: null,
    });
  });

  it("🚨 bilgi bandı (bayrak açık, güven 0.45–0.75) da risk niyetini atlayamaz: `enforce` → devir; gölge → bant cevabı", () => {
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    const band = { ...OK, confidence: 0.6, usedSources: ["kb:Genel"] };
    // Anti-vakum: sinyalsiz bant cevabı gerçekten GEÇİYOR (bant yolu bu testte canlı).
    expect(evaluateEscalation(band, msg, null, [], {})).toEqual({ escalate: false, reason: "informational_low_confidence" });
    expect(evaluateEscalation(band, msg, null, [], { understandingRisk: "complaint_issue", intentMode: "enforce" })).toEqual({
      escalate: true,
      reason: "understanding_risk",
    });
    expect(evaluateEscalation(band, msg, null, [], { understandingRisk: "complaint_issue", intentMode: "shadow" }).escalate).toBe(false);
  });

  it("gerekçe SON kontrol: düşük güvende `low_confidence` yazılır", () => {
    expect(evaluateEscalation({ ...OK, confidence: 0.3 }, msg, null, [], { understandingRisk: "complaint_issue", intentMode: "enforce" }).reason).toBe(
      "low_confidence",
    );
  });

  it("gerekçe kodu kapalı kümelerde (QR birliği + RiskEvent REASONS) — sessizce NULL'a düşmez", () => {
    expect(ESCALATION_REASONS).toContain("understanding_risk");
    expect(ESCALATION_REASON_CODES.has("understanding_risk")).toBe(true);
  });
});

describe("kanıt (`kbEvidenceJson.ir`)", () => {
  it("yalnız kapalı-küme değerler taşınır; verilmezse alan HİÇ yok (biçim eskisiyle aynı)", () => {
    const withIr = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: ["x"], intentRisk: { v: "-", ev: "understanding_risk", k: "complaint_issue" } })));
    expect(withIr.ir).toEqual({ v: "-", ev: "understanding_risk", k: "complaint_issue" });
    const without = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: ["x"] })));
    expect("ir" in without).toBe(false);
    for (const bad of [
      { v: "maybe", ev: "-", k: "-" },
      { v: "-", ev: "-", k: "Ayşe Yılmaz +90 532 123 45 67" },
      { v: "-", ev: "understanding_risk", k: "wifi" },
    ]) {
      const j = JSON.parse(String(buildKbEvidence({ retrieved: [], usedLabels: ["x"], intentRisk: bad })));
      expect("ir" in j, JSON.stringify(bad)).toBe(false);
    }
    // Yalnız risk kanıtı olsa da kayıt üretilir (ölçüldü ≠ ölçülmedi).
    expect(buildKbEvidence({ retrieved: [], usedLabels: [], intentRisk: { v: "-", ev: "-", k: "-" } })).not.toBeNull();
  });
});
