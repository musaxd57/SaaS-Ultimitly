import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// 4.12 KAPI (kurucu kararı 10-28: "Evet, doğrulanmış parça gitsin"): parça kipinde giden metin yalnız doğrulanmış parçalardan oluşuyorsa
// (`verifiedPartsOnly`, üretimde `verifiedPartsWaiver`) modelin genel güveni (< 0,75) tek başına tutma sebebi DEĞİLDİR. Öteki BÜTÜN kapılar
// aynen önde: risk düzeyi / etiketi, güven sayı değilse, "bilgim yok", anlama katmanının risk niyeti, kelime ağı.
// ---------------------------------------------------------------------------
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { autoReplyGateVerdict } from "@/lib/automation";

const base = {
  intent: "general",
  riskLevel: "none",
  confidence: 0.72,
  source: "openai",
  riskType: null as string | null,
  reply: "Bisiklet kilidinin şifresi 5190.",
};
const Q = "Bahçedeki bisikletlerin kilit şifresi ne? Yakınlarda kuaför var mı?";

describe("4.12 — doğrulanmış parça genel güvene takılmaz", () => {
  it("🚨 güven 0,72 + işaret → geçer; işaret yoksa bugünkü gibi low_confidence", () => {
    expect(autoReplyGateVerdict({ ...base, verifiedPartsOnly: true }, Q)).toBeNull();
    expect(autoReplyGateVerdict(base, Q)).toEqual({ reason: "blocked", detail: "low_confidence" });
  });

  it("🚨 öteki kapılar aynen önde: risk düzeyi, yüksek riskli etiket, güven sayı değil, 'bilgim yok', anlama riski, kelime ağı", () => {
    const w = { ...base, verifiedPartsOnly: true as const };
    expect(autoReplyGateVerdict({ ...w, riskLevel: "medium" }, Q)?.reason).toBe("blocked");
    expect(autoReplyGateVerdict({ ...w, riskType: "complaint" }, Q)?.reason).toBe("blocked");
    expect(autoReplyGateVerdict({ ...w, confidence: Number.NaN }, Q)).toEqual({ reason: "blocked", detail: "confidence_invalid" });
    expect(autoReplyGateVerdict({ ...w, reply: "Bu konuda bilgim yok." }, Q)?.reason).toBe("blocked");
    expect(autoReplyGateVerdict(w, Q, { understandingRisk: { emergency: true, complaint: false, refund: false, human: false } } as never)).not.toBeNull();
    expect(autoReplyGateVerdict(w, "Mutfakta duman var, bisiklet şifresi ne?")).toEqual({ reason: "blocked", detail: "lexical_risk" });
  });

  it("işaret ancak gerçek `true` ile muafiyet verir (eski / bozuk alan değil)", () => {
    expect(autoReplyGateVerdict({ ...base, verifiedPartsOnly: "true" as never }, Q)).toEqual({ reason: "blocked", detail: "low_confidence" });
  });
});
