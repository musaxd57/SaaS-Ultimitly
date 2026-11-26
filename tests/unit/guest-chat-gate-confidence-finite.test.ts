import { describe, it, expect, afterEach, vi } from "vitest";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// QR kapısı — sonlu olmayan güven "yüksek güven" değildir (10-01, 15 ajan incelemesi A05). Kanal kapısı `!Number.isFinite` ile
// `confidence_invalid` tutuyor (F01); QR kapısında `NaN < 0.75` yanlış olduğu için NaN / Infinity / eksik güven kapıyı GEÇİYORDU.
// Yapay zekâ katmanı bugün güveni sonlu sayıya zorluyor — kapı ona güvenmez (savunma derinliği, kanal paritesi).
// ---------------------------------------------------------------------------

const base = { intent: "parking", riskLevel: "low", source: "openai", reply: "Otopark binanın arkasında, ücretsiz." };

describe("QR kapısı — güven sonlu sayı olmalı", () => {
  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["eksik", undefined as unknown as number],
  ])("🚨 güven %s → devir (low_confidence)", (_ad, confidence) => {
    expect(evaluateEscalation({ ...base, confidence }, "Otopark var mı?")).toEqual({ escalate: true, reason: "low_confidence" });
  });

  it("KONTROL: sonlu yüksek güven geçer, düşük güven bugünkü gibi devredilir", () => {
    expect(evaluateEscalation({ ...base, confidence: 0.92 }, "Otopark var mı?")).toEqual({ escalate: false, reason: null });
    expect(evaluateEscalation({ ...base, confidence: 0.4 }, "Otopark var mı?")).toEqual({ escalate: true, reason: "low_confidence" });
  });
});

// ---------------------------------------------------------------------------
// UZUNLUK ENGELİ (Codex 11-10 Q1 + Haiku incelemesi 11-11). Kesilmiş / tavanı aşan cevabın güveni 0,5'e çekilir. QR "bilgi bandı" açıkken
// (`QR_INFORMATIONAL_BAND_ENABLED=1`: 0,45 ≤ güven < 0,75 gönderilir) o cevap misafire gidebiliyordu. Engel artık açık işarettir.
// ---------------------------------------------------------------------------
describe("QR kapısı — uzunluk engeli bilgi bandından geçemez", () => {
  afterEach(() => vi.unstubAllEnvs());
  const sourced = { ...base, usedSources: ["kb:parking"], confidence: 0.5 };

  it("🚨 bant AÇIK + uzunluk engeli → devir (bant bu cevabı gönderemez)", () => {
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    expect(evaluateEscalation({ ...sourced, lengthHeld: true }, "Otopark var mı?")).toEqual({ escalate: true, reason: "low_confidence" }); // ⬅️ ESKİDE gönderiliyordu
  });

  it("KONTROL: bant AÇIK, uzunluk engeli YOK → aynı 0,5 güvenli kaynaklı bilgi cevabı bantla gider (bant bozulmadı)", () => {
    vi.stubEnv("QR_INFORMATIONAL_BAND_ENABLED", "1");
    expect(evaluateEscalation(sourced, "Otopark var mı?")).toEqual({ escalate: false, reason: "informational_low_confidence" });
  });

  it("bant KAPALI (varsayılan): uzunluk engelli cevap bugünkü gibi devredilir; yüksek güven de engeli aşamaz", () => {
    expect(evaluateEscalation({ ...sourced, lengthHeld: true }, "Otopark var mı?")).toEqual({ escalate: true, reason: "low_confidence" });
    expect(evaluateEscalation({ ...sourced, confidence: 0.95, lengthHeld: true }, "Otopark var mı?")).toEqual({ escalate: true, reason: "low_confidence" });
  });
});
