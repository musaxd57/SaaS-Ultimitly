import { describe, it, expect } from "vitest";
import {
  exceedsGuestMessageLimit,
  unansweredExceedsGuestMessageLimit,
  GUEST_MESSAGE_AI_MAX_CHARS,
} from "@/lib/ai/message-length";
import { isSafetyEmergencyText, detectRiskTypes } from "@/lib/ai/fallback";
import { deriveMessageSignal } from "@/modules/intelligence/signals/derive";

// ---------------------------------------------------------------------------
// K10-t (kurucu kararı 09-28): tek misafir mesajı 8.000 karakteri aşarsa yapay zekâ cevap üretmez. Sınır KOD NOKTASI ile
// sayılır; küme cevapsız misafir mesajlarıdır (son giden mesajdan sonrakiler). Bağlantılar `message-too-long.test.ts`.
// ---------------------------------------------------------------------------

describe("uzunluk sınırı — kod noktası", () => {
  it("tam sınır aşmaz, bir fazlası aşar", () => {
    expect(GUEST_MESSAGE_AI_MAX_CHARS).toBe(8000);
    expect(exceedsGuestMessageLimit("a".repeat(8000))).toBe(false);
    expect(exceedsGuestMessageLimit("a".repeat(8001))).toBe(true);
  });

  it("emoji iki UTF-16 birimi ama TEK karakter: 8.000 emoji aşmaz, 8.001 aşar", () => {
    expect(exceedsGuestMessageLimit("\u{1F600}".repeat(8000))).toBe(false);
    expect(exceedsGuestMessageLimit("\u{1F600}".repeat(8001))).toBe(true);
  });

  it("tek başına vekil bir karakter sayılır (for…of ile aynı sayım)", () => {
    expect(exceedsGuestMessageLimit("\uD800".repeat(8000))).toBe(false);
    expect(exceedsGuestMessageLimit("\uD800".repeat(8001))).toBe(true);
    expect([..."\uD800".repeat(8001)]).toHaveLength(8001);
  });

  it("boş / yok aşmaz", () => {
    expect(exceedsGuestMessageLimit("")).toBe(false);
    expect(exceedsGuestMessageLimit(null)).toBe(false);
    expect(exceedsGuestMessageLimit(undefined)).toBe(false);
  });
});

describe("cevapsız misafir mesajları kümesi", () => {
  const long = "a".repeat(8001);
  it("son giden mesajdan SONRAKİ uzun misafir mesajı → aşar", () => {
    expect(unansweredExceedsGuestMessageLimit([{ direction: "outbound", body: "Merhaba" }, { direction: "inbound", body: long }])).toBe(true);
    expect(
      unansweredExceedsGuestMessageLimit([
        { direction: "inbound", body: long },
        { direction: "inbound", body: "kısa soru?" },
      ]),
    ).toBe(true);
  });

  it("KONTROL — cevaplanmış uzun mesaj (ardından giden mesaj var) → aşmaz", () => {
    expect(
      unansweredExceedsGuestMessageLimit([
        { direction: "inbound", body: long },
        { direction: "outbound", body: "Elle cevap" },
        { direction: "inbound", body: "Teşekkürler, bir sorum daha var" },
      ]),
    ).toBe(false);
  });
});

describe("acil sözcük ağı — risk ağıyla TEK kaynak", () => {
  it.each([
    "Dairede gaz kokusu var!",
    "There is smoke in the kitchen",
    "Yangın çıktı",
    "Klima çalışmıyor",
    "Wifi şifresi nedir?",
    "Gastgeber ist sehr nett",
  ])("%s", (m) => {
    expect(isSafetyEmergencyText(m)).toBe(detectRiskTypes(m).includes("safety_emergency"));
  });
});

describe("mülk hafızası: uzun mesaj kelime ağından geçmez", () => {
  const msg = (body: string) => ({
    id: "m1",
    direction: "inbound",
    authorType: "guest",
    body,
    createdAt: new Date("2026-09-28T10:00:00Z"),
    conversation: { id: "c1", propertyId: "p1", reservationId: null },
  });
  it("kısa şikâyet sinyal üretir, aynı şikâyet 8.000 karakteri aşan mesajda üretmez", () => {
    const complaint = "Klima çalışmıyor, çok sıcak.";
    expect(deriveMessageSignal("o1", msg(complaint), null)).not.toBeNull();
    expect(deriveMessageSignal("o1", msg("x ".repeat(4100) + complaint), null)).toBeNull();
  });
});
