import { describe, it, expect } from "vitest";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { evaluateEscalation } from "@/lib/guest-chat-gate";

// ---------------------------------------------------------------------------
// K10 İKİNCİ TUR (Codex 10-01): iki nokta eklenince makbuzsuz eylem iddiası gönderim kapısından geçiyordu —
// "Mesajınızı ev sahibine iletiyorum." tutuluyor, "Mesajınızı ev sahibine iletiyorum: giriş solda." geçiyordu (QR kararında da:
// risksiz otopark sorusu, güven 0.95, eylem beyanı yokken `escalate: false`). Meşru duyuru istisnası ("Sizi bilgilendiriyoruz:
// havuz kapalı") ALICISI üçüncü kişi olan iletmeye uygulanmaz. Noktalı ve iki noktalı iddia birlikte tutulur; duyuru serbest.
// ---------------------------------------------------------------------------

const CLAIMS = [
  "Mesajınızı ev sahibine iletiyorum.",
  "Mesajınızı ev sahibine iletiyorum: giriş solda.",
  "Talebinizi ekibimize aktarıyorum: otopark binanın arkasında.",
  "Durumu temizlikçimize bildiriyorum: havlular dolapta.",
  "Talebinizi iletiyorum: geç çıkış için ev sahibinizin onayı gerekir.",
  "I'll forward your message to the host: check-in is on the left.",
  "I'll let the host know: parking is behind the building.",
  "I will ask the host: the code is on the way.",
];

const ANNOUNCEMENTS = [
  "Sizi bilgilendiriyoruz: havuz yarın kapalı.",
  "Önemli bir bilgiyi iletiyorum: havuz yarın kapalı.",
  "I'll answer each of your questions below: check-in is at 15:00.",
  "I'll respond to each question: parking is free.",
];

describe("K10 — iki noktalı iletme iddiası tutulur, duyuru serbest", () => {
  it.each(CLAIMS)("iddia tutulur: %s", (reply) => {
    expect(vetoOutgoingReply(reply)).toBe("unverified_commitment");
  });
  it.each(ANNOUNCEMENTS)("duyuru geçer: %s", (reply) => {
    expect(vetoOutgoingReply(reply)).toBeNull();
  });
});

describe("K10 — QR karar fonksiyonu (Codex yeniden üretimi)", () => {
  const parking = {
    intent: "parking",
    riskLevel: "none",
    confidence: 0.95,
    source: "openai",
    riskType: null,
    usedSources: ["kb:parking"],
  };
  it("🚨 risksiz otopark sorusu, güven 0.95, eylem beyanı yok: iki noktalı iletme iddiası DEVREDER", () => {
    expect(
      evaluateEscalation({ ...parking, reply: "Mesajınızı ev sahibine iletiyorum: otopark binanın arkasında." }, "Otopark nerede?"),
    ).toEqual({ escalate: true, reason: "unverified_commitment" });
  });
  it("KONTROL: aynı soruya düz bilgi cevabı geçer", () => {
    expect(evaluateEscalation({ ...parking, reply: "Otopark binanın arkasında." }, "Otopark nerede?")).toMatchObject({ escalate: false });
  });
});
