import { describe, it, expect } from "vitest";
import { TEST_EMAIL_FOOTNOTE } from "@/lib/test-email-copy";
import { SETTINGS_NAV, CONNECTION_VIEW_ID } from "@/lib/settings-nav";
import { qrEscalationEmail, trialEndedEmail } from "@/lib/email-templates";

// ---------------------------------------------------------------------------
// Tur 4 (11-05, ölçüldü): test e-postasının dipnotu düğmenin yerini "Ayarlar › Bağlantılar" diye gösteriyordu (düğme ve uyarı adresi
// alanı İşletme Ayarları › Genel'de); düz metin parçasında "&rsaquo; &ldquo; &rdquo;" çözülmeden kalıyordu. Ortak e-posta alt bilgisi
// "Lütfen yanıtlamayınız." — kurucu kuralı (09-23) hitap "-in", "-iniz" değil.
// ---------------------------------------------------------------------------

const label = (id: string) => SETTINGS_NAV.flatMap((g) => g.items).find((i) => i.id === id)!.label;

describe("test e-postası dipnotu", () => {
  it("düğmenin bulunduğu görünümü (Genel) adlandırır, Bağlantılar'ı değil", () => {
    expect(TEST_EMAIL_FOOTNOTE).toContain(`Ayarlar › ${label("genel")}`);
    expect(TEST_EMAIL_FOOTNOTE).not.toContain(label(CONNECTION_VIEW_ID));
  });

  it("adlandırılmış HTML varlığı taşımaz (düz metin parçası çözmez)", () => {
    expect(TEST_EMAIL_FOOTNOTE).not.toMatch(/&[a-z]+;/i);
    expect(TEST_EMAIL_FOOTNOTE).toContain("“Test e-postası gönder”");
  });
});

describe("ortak e-posta alt bilgisi hitabı", () => {
  it("'Lütfen yanıtlamayın.' — '-ınız' değil", () => {
    for (const html of [qrEscalationEmail("Lale 3", "ai_escalated", "https://x.test/guest-chats"), trialEndedEmail("https://x.test/settings")]) {
      expect(html).toContain("Lütfen yanıtlamayın.");
      expect(html).not.toMatch(/yanıtlamayınız/);
    }
  });
});
