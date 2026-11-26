import { describe, it, expect } from "vitest";
import { complaintEscalationEmail } from "@/lib/email-templates";

// 15 ajan A13 (10-01): misafir alıntısı UTF-16 birimiyle `slice(0, 600)` kesiliyordu — 600. birim bir emoji vekil çiftinin ortasına
// denk gelince e-postada yalnız yüksek vekil (\ud83d) kalıyordu. Artık KOD NOKTASIYLA kırpılır.
const conversation = { id: "c1", guestIdentifier: "Misafir", channel: "airbnb", priority: "standard" };
const property = { name: "Lale" };

describe("şikâyet e-postası misafir alıntısı", () => {
  it("🚨 vekil çift bölünmez; uzun metin '…' ile biter", () => {
    const message = `${"a".repeat(599)}😀😀😀`;
    const html = complaintEscalationEmail(conversation, message, property, "Org");
    // Eşi olmayan yüksek vekil (bölünmüş emoji) yok.
    expect(/\ud83d(?!\ude00)/.test(html)).toBe(false);
    expect(html).toContain(`${"a".repeat(599)}😀…`);
  });
  it("KONTROL: kısa metin aynen, '…' yok", () => {
    const html = complaintEscalationEmail(conversation, "Kısa 😀", property, "Org");
    expect(html).toContain("Kısa 😀");
    expect(html).not.toContain("Kısa 😀…");
  });
});
