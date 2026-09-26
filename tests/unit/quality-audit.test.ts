import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
    property: "Lale 3",
    at: "2026-07-15T10:00:00.000Z",
    guest: "Wifi şifresi nedir?",
    guestContext: "matched",
    ai: "Wifi şifremiz: guestops2026.",
    aiIntent: "wifi",
    language: "tr",
    threadRisk: null,
      aiSources: null,
  };

  it("örneklemi güvenilmez-veri uyarısıyla ve şema tarifiyle sarar", () => {
    const prompt = buildAuditPrompt([pair]);
    expect(prompt).toContain("GÜVENİLMEZ VERİ");
    expect(prompt).toContain("Wifi şifresi nedir?");
    expect(prompt).toContain('"promptSuggestions"');
    expect(prompt).toContain("1 AI yanıtı");
  });
});

const IDS: ReadonlySet<string> = new Set(["m1", "m2"]);

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
    const r = parseAuditReport(JSON.stringify(valid), IDS);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("high");
    expect(r.promptSuggestions).toHaveLength(1);
  });

  it("kod bloğu/önsöz içine gömülü JSON'u ayıklar", () => {
    const r = parseAuditReport("İşte raporum:\n```json\n" + JSON.stringify(valid) + "\n```\n", IDS);
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
      IDS,
    );
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe("low");
    expect(r.findings[0].criterion).toBe("diger");
    // Düşen bulgu SAYILIR ve rapor eksik sayılır (F15): "1 bulgu" tam değerlendirme değildir.
    expect(r.dropped.invalid).toBe(1);
    expect(r.status).toBe("inconclusive");
  });

  it("JSON olmayan çıktı sessiz boş rapor DEĞİL, açık hatadır", () => {
    expect(() => parseAuditReport("Üzgünüm, değerlendiremem.", IDS)).toThrow(QualityAuditError);
  });
});

// ---------------------------------------------------------------------------
// F15 (Codex denetimi 09-05; düzeltme 09-26): DEĞERLENDİREMEME "BULGU YOK" DEĞİLDİR. Şemanın `.catch` varsayılanları
// `{}` girdisini "0 bulgu" rapora çeviriyordu ve ekran yeşil "incelenen yanıtlar kurallara uygun" diyordu; bozuk ya da
// örneklemde olmayan mesaja ait bulgular sessizce düşüyordu.
// ---------------------------------------------------------------------------
describe("F15 — değerlendirme durumu", () => {
  const report = (o: Record<string, unknown>) => parseAuditReport(JSON.stringify(o), IDS);

  it("🚨 boş nesne ({}) → inconclusive; eksik alanlar adlandırılır, bulgu listesi boş ama 'uygun' DEĞİL", () => {
    const r = report({});
    expect(r.status).toBe("inconclusive");
    expect(r.missing).toEqual(["overall", "findings"]);
    expect(r.findings).toEqual([]);
  });

  it("genel değerlendirme boş/yalnız boşluk ya da bulgu listesi yoksa → inconclusive", () => {
    expect(report({ overall: "   ", findings: [] })).toMatchObject({ status: "inconclusive", missing: ["overall"] });
    expect(report({ overall: "Uygun." })).toMatchObject({ status: "inconclusive", missing: ["findings"] });
    expect(report({ overall: "Uygun.", findings: "yok" })).toMatchObject({ status: "inconclusive", missing: ["findings"] });
  });

  it("tam rapor + bulgusuz → evaluated (yeşil 'uygun' YALNIZ burada)", () => {
    const r = report({ overall: "Kurallara uygun.", findings: [], promptSuggestions: [], testSuggestions: [] });
    expect(r).toMatchObject({ status: "evaluated", missing: [], dropped: { invalid: 0, unknownMessage: 0 } });
  });

  it("🚨 bütün bulgular okunamazsa liste boşalır ama rapor eksik sayılır, düşenler sayılır", () => {
    const r = report({ overall: "x", findings: [{ not: "a finding" }, { messageId: "m1", severity: "high" }] });
    expect(r.findings).toEqual([]);
    expect(r.dropped).toEqual({ invalid: 2, unknownMessage: 0 });
    expect(r.status).toBe("inconclusive");
  });

  it("🚨 incelenen yanıtlarda olmayan mesaja ait bulgu listeye girmez, sayılır; bilinen mesajınki kalır", () => {
    const r = report({
      overall: "x",
      findings: [
        { messageId: "uydurma-id", severity: "high", criterion: "risk", issue: "Uydurma bir mesaja bulgu." },
        { messageId: "m2", severity: "medium", criterion: "dil", issue: "Dil uyuşmuyor." },
      ],
    });
    expect(r.findings.map((f) => f.messageId)).toEqual(["m2"]);
    expect(r.dropped).toEqual({ invalid: 0, unknownMessage: 1 });
    expect(r.status).toBe("inconclusive");
  });

  it("ekran: yeşil 'kurallara uygun' YALNIZ tam değerlendirmede; eksik raporda uyarı (kaynak pini)", () => {
    const src = readFileSync("src/components/admin/quality-audit-card.tsx", "utf8");
    expect(src).toMatch(/result\.status === "evaluated" && result\.sampleSize > 0 \? \(\s*<p[^>]*>Bulgu yok — incelenen yanıtlar kurallara uygun\./);
    expect(src).toMatch(/result\.status === "inconclusive" \?/);
    expect(src).toContain("Değerlendirme eksik");
  });
});
