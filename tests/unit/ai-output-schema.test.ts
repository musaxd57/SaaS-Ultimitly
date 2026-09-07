import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// MODEL ÇIKTISI GÜVENLİK ALANLARI STRICT (Codex F01 — P1)
//
// 🚨 KAPATILAN AÇIK: parser yalnız `reply` metninin varlığına bakıyordu.
// `riskLevel` EKSİKSE `String(undefined ?? "none")` → "none"; `confidence`
// boolean `true` ise `Number(true)` → 1 (string "0.99" da geçiyordu). Kapı
// `riskLevel ∈ {none,low}` + `confidence ≥ 0.75` istiyor → iki güvenlik alanı
// da OLMAYAN bir cevap oto-gönderim izni alıyordu. Codex sentetik
// `{intent:"parking", reply:"…", confidence:true}` ile gerçek parserdan
// `confidence=1, riskLevel=none` çıkardı ve gerçek kapı TRUE döndü.
//
// JSON üretmek ≠ güvenlik sözleşmesini doğrulamak. Artık: `riskLevel` kapalı
// kümeden bir STRING değilse (eksik dahil) → "high" (mevcut "tanınmayan değer"
// konvansiyonu ile AYNI); `confidence` sonlu bir number değilse → 0. İkisi de
// insan incelemesine düşer; şema ihlali `reportError` ile görünür (throttled).
// ---------------------------------------------------------------------------
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { reportError } from "@/lib/report-error";
import { suggestReply } from "@/lib/ai";
import { passesAutoReplySafetyGate } from "@/lib/automation";
import type { SuggestReplyInput } from "@/lib/ai/types";

const mockReportError = vi.mocked(reportError);

const GUEST = "Is there free parking at the building?";
const input: SuggestReplyInput = {
  guestMessage: GUEST,
  property: { name: "Galata Loft", checkInTime: "15:00", checkOutTime: "11:00", address: "Galata", city: "İstanbul" },
  reservation: { guestName: "John Smith", arrivalDate: new Date(), departureDate: new Date(), status: "confirmed" },
  knowledgeBase: [{ category: "general", title: "Otopark", content: "Bina altında ücretsiz otopark var." }],
  tone: "warm",
  language: "en",
};

/** OpenAI'nin döndürdüğü zarf; `content` modelin JSON'u. */
function openAiReturns(content: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }),
          { status: 200 },
        ),
    ),
  );
}

const VALID = {
  intent: "parking",
  confidence: 0.95,
  reply: "Yes, there is free parking under the building.",
  risk: null,
  priority: "standard",
  actionSuggestion: null,
  riskLevel: "none",
  detectedLanguage: "en",
  riskType: null,
  usedSources: ["kb:general"],
  missingInfo: [],
  statedCheckoutTime: null,
};

describe("suggestReply — güvenlik metadatası strict", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    mockReportError.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("🚨 Codex kanıtı: riskLevel EKSİK + confidence:true → oto-gönderim İZNİ YOK", async () => {
    openAiReturns({ intent: "parking", reply: "Yes, there is free parking.", confidence: true });
    const r = await suggestReply(input);
    expect(r.source).toBe("openai"); // fallback'e DÜŞMEDİ — metin host'a taslak olarak kalır
    expect(r.confidence).toBe(0); // ⬅️ ARIZADA: 1
    expect(r.riskLevel).toBe("high"); // ⬅️ ARIZADA: "none"
    expect(passesAutoReplySafetyGate(r, GUEST)).toBe(false); // ⬅️ ARIZADA: true
    expect(mockReportError).toHaveBeenCalledTimes(1);
    expect(mockReportError.mock.calls[0][0]).toContain("schema violation");
  });

  it("🚨 confidence STRING ('0.99') coercion ile geçmez", async () => {
    openAiReturns({ ...VALID, confidence: "0.99" });
    const r = await suggestReply(input);
    expect(r.confidence).toBe(0);
    expect(passesAutoReplySafetyGate(r, GUEST)).toBe(false);
  });

  it("confidence null / eksik → 0, kapı kapalı", async () => {
    for (const confidence of [null, undefined]) {
      const body: Record<string, unknown> = { ...VALID };
      if (confidence === undefined) delete body.confidence;
      else body.confidence = confidence;
      openAiReturns(body);
      const r = await suggestReply(input);
      expect(r.confidence, String(confidence)).toBe(0);
      expect(passesAutoReplySafetyGate(r, GUEST)).toBe(false);
    }
  });

  it("riskLevel EKSİK ama confidence geçerli → yine 'high' (eksik ≠ none)", async () => {
    const body: Record<string, unknown> = { ...VALID };
    delete body.riskLevel;
    openAiReturns(body);
    const r = await suggestReply(input);
    expect(r.riskLevel).toBe("high");
    expect(r.confidence).toBe(0.95); // güven alanı sağlam kaldı — yalnız risk alanı düştü
    expect(passesAutoReplySafetyGate(r, GUEST)).toBe(false);
    // Host ekranda SEBEBİ görür (model kendi `risk` metnini vermediyse).
    expect(r.risk).toMatch(/şema|güvenlik alan/i);
  });

  it("riskLevel tanınmayan STRING ('critical') → 'high' (mevcut konvansiyon korunur)", async () => {
    openAiReturns({ ...VALID, riskLevel: "critical" });
    const r = await suggestReply(input);
    expect(r.riskLevel).toBe("high");
  });

  it("riskLevel string DEĞİLSE (number/obje) → 'high'", async () => {
    for (const riskLevel of [0, { level: "none" }, true]) {
      openAiReturns({ ...VALID, riskLevel });
      expect((await suggestReply(input)).riskLevel, JSON.stringify(riskLevel)).toBe("high");
    }
  });

  it("KONTROL: geçerli, tam cevap AYNEN geçer — ve şema ihlali RAPORLANMAZ", async () => {
    // Bu olmadan "her cevabı reddet" mutasyonu da yeşil geçerdi.
    openAiReturns(VALID);
    const r = await suggestReply(input);
    expect(r.source).toBe("openai");
    expect(r.confidence).toBe(0.95);
    expect(r.riskLevel).toBe("none");
    expect(r.risk).toBeNull();
    expect(passesAutoReplySafetyGate(r, GUEST)).toBe(true);
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it("KONTROL: modelin kendi `risk` metni varsa şema notu onu EZMEZ", async () => {
    openAiReturns({ ...VALID, riskLevel: "medium", risk: "Guest mentions a leak.", confidence: "x" });
    const r = await suggestReply(input);
    expect(r.risk).toBe("Guest mentions a leak.");
  });
});

describe("passesAutoReplySafetyGate — güven değeri sonlu olmak zorunda (ikinci kemer)", () => {
  const base = { intent: "parking", riskLevel: "none", source: "openai", riskType: null };
  it("NaN / Infinity / -Infinity kapıdan GEÇMEZ", () => {
    for (const confidence of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(passesAutoReplySafetyGate({ ...base, confidence }, GUEST), String(confidence)).toBe(false);
    }
  });
  it("KONTROL: 0.9 geçer", () => {
    expect(passesAutoReplySafetyGate({ ...base, confidence: 0.9 }, GUEST)).toBe(true);
  });
});
