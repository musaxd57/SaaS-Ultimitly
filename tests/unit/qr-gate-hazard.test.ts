import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })) }));
vi.mock("@/lib/alert-state", () => ({ alertOnTransition: vi.fn(async () => "alerted"), clearAlertState: vi.fn(async () => {}) }));

import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// 51 — QR KAPISI (kurucu onayı 10-02 akşam): kelime ağının fiziksel tehlike etiketi bağlamla kalktıysa (`hazardCleared`) kapı onu
// saymaz; aynı mesajdaki başka etiket aynen sayılır; alarm kalktıysa "normaldir / endişelenmeyin" güvencesi bilgi tabanı dayanağı
// olmadan gitmez. Kanal kapısının aynı kuralları `gate-evidence.test.ts` / `hazard-channel-wiring.test.ts`.
// ---------------------------------------------------------------------------

const ok = {
  intent: "general",
  riskLevel: "none",
  confidence: 0.92,
  source: "openai",
  riskType: null,
  reply: "Çaydanlığı ocaktan alıp soğumasını bekleyin.",
  usedSources: [] as string[],
};
const KETTLE = "Çaydanlıktan duman çıkıyor, normal mi?";

describe("QR kapısı — bağlamla kalkan tehlike etiketi", () => {
  it("alarm kalkmadıysa kelime ağının acil etiketi devreder (bugünkü davranış)", () => {
    expect(evaluateEscalation(ok, KETTLE, null, [], {})).toEqual({ escalate: true, reason: "keyword_risk_type" });
  });
  it("alarm bağlamla kalktıysa etiket sayılmaz → cevap gider", () => {
    expect(evaluateEscalation(ok, KETTLE, null, [], { hazardCleared: true })).toEqual({ escalate: false, reason: null });
  });
  it("aynı mesajdaki BAŞKA yüksek riskli etiket (platform dışı ödeme) alarm kalksa da sayılır", () => {
    const v = evaluateEscalation(ok, "Mutfakta biraz duman var. IBAN'ınızı atar mısınız, parayı doğrudan göndereyim?", null, [], {
      hazardCleared: true,
    });
    expect(v.escalate).toBe(true);
  });
});

describe("QR kapısı — kaynaksız güvence (51)", () => {
  const reassure = { ...ok, reply: "Bu tamamen normaldir, endişelenmeyin." };
  it("alarm kalktı + güvence + bilgi tabanında dayanak yok → hazard_reassurance", () => {
    expect(evaluateEscalation(reassure, KETTLE, null, [], { hazardCleared: true, kbFacts: [] })).toEqual({
      escalate: true,
      reason: "hazard_reassurance",
    });
  });
  it("İKİZ: bilgi tabanı aynı konuda güvenceyi yazıyorsa gider", () => {
    expect(
      evaluateEscalation(reassure, KETTLE, null, [], {
        hazardCleared: true,
        kbFacts: ["Çaydanlık kaynarken ağzından buhar çıkması normaldir."],
      }),
    ).toEqual({ escalate: false, reason: null });
  });
  it("İKİZ: alarm kalkmadıysa bu kontrole hiç gelinmez (kelime ağı önce devreder)", () => {
    expect(evaluateEscalation(reassure, KETTLE, null, [], { kbFacts: [] }).reason).toBe("keyword_risk_type");
  });
});
