import { describe, it, expect } from "vitest";
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
