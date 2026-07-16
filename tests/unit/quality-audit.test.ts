import { describe, it, expect } from "vitest";
import {
  redactForAudit,
  buildAuditPrompt,
  parseAuditReport,
  QualityAuditError,
  type AuditPair,
} from "@/lib/quality-audit";

// Claude gölge denetçisinin saf katmanı. En kritik sözleşme: mesaj gövdesi
// uygulamadan ÇIKMADAN redakte edilir (KVKK) ve model çıktısı kapalı-set
// clamp'lerle doğrulanır (bozuk çıktı = açık hata, sessiz boş rapor değil).

describe("redactForAudit — PII asla Claude'a gitmez", () => {
  it("misafir adını (tam ad + yalnız ilk ad, Türkçe harfli) [Misafir]'e çevirir", () => {
    const out = redactForAudit(
      "Merhaba Şule Ağaoğlu, giriş saat 15:00. Şule için ek havlu bıraktık.",
      ["Şule Ağaoğlu"],
    );
    expect(out).not.toContain("Şule");
    expect(out).not.toContain("Ağaoğlu");
    expect(out).toContain("[Misafir]");
  });

  it("e-posta ve telefonu değer-şekilli olarak siler (ad bilinmese bile)", () => {
    const out = redactForAudit(
      "Bana yilmaz.kaya@example.com adresinden veya +90 532 123 45 67 numarasından ulaşın.",
      [],
    );
    expect(out).not.toContain("yilmaz.kaya@example.com");
    expect(out).not.toContain("532 123 45 67");
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("[PHONE]");
  });

  it("uzun gövdeyi tavanlar, null/boş ad listesine dayanıklıdır", () => {
    const out = redactForAudit("a".repeat(5000), [null, undefined, "  "]);
    expect(out.length).toBeLessThan(800);
    expect(out).toContain("[kısaltıldı]");
  });
});

describe("buildAuditPrompt", () => {
  const pair: AuditPair = {
    messageId: "m1",
    property: "Nuve 3",
    at: "2026-07-15T10:00:00.000Z",
    guest: "Wifi şifresi nedir?",
    ai: "Wifi şifremiz: guestops2026.",
    aiIntent: "wifi",
    language: "tr",
    threadRisk: null,
  };

  it("örneklemi güvenilmez-veri uyarısıyla ve şema tarifiyle sarar", () => {
    const prompt = buildAuditPrompt([pair]);
    expect(prompt).toContain("GÜVENİLMEZ VERİ");
    expect(prompt).toContain("Wifi şifresi nedir?");
    expect(prompt).toContain('"promptSuggestions"');
    expect(prompt).toContain("1 AI yanıtı");
  });
});

describe("parseAuditReport — kapalı-set doğrulama", () => {
  const valid = {
    overall: "Genel olarak kurallara uygun.",
    findings: [
      { messageId: "m1", severity: "high", criterion: "risk", issue: "Şikayete çözüm sözü verilmiş.", suggestion: "Bekletme mesajı olmalıydı." },
    ],
    promptSuggestions: ["Checkout saatinde kaynak belirt."],
    testSuggestions: ["Övgü-tuzağı senaryosu ekle."],
  };

  it("temiz JSON'u aynen çözer", () => {
    const r = parseAuditReport(JSON.stringify(valid));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("high");
    expect(r.promptSuggestions).toHaveLength(1);
  });

  it("kod bloğu/önsöz içine gömülü JSON'u ayıklar", () => {
    const r = parseAuditReport("İşte raporum:\n```json\n" + JSON.stringify(valid) + "\n```\n");
    expect(r.overall).toContain("kurallara uygun");
  });

  it("bilinmeyen severity/criterion kapalı sete CLAMP edilir, bozuk bulgu düşer", () => {
    const r = parseAuditReport(
      JSON.stringify({
        ...valid,
        findings: [
          { messageId: "m1", severity: "catastrophic", criterion: "vibe", issue: "x" },
          { not: "a finding" }, // issue yok → düşer
        ],
      }),
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("low");
    expect(r.findings[0].criterion).toBe("diger");
  });

  it("JSON olmayan çıktı sessiz boş rapor DEĞİL, açık hatadır", () => {
    expect(() => parseAuditReport("Üzgünüm, değerlendiremem.")).toThrow(QualityAuditError);
  });
});
