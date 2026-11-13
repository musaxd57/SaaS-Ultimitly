import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// UX-12 (kurucu 11-13: "skor henüz kesin değili sil — müşteri böyle tehlikeli, belirsiz bir yazı görmemeli"). Raporlar sayfasındaki az veri
// uyarısı kalktı; skorun hesabı ve dayandığı konuşma sayısı (`sampleConversations`) değişmedi (hesap pinleri reports-score-populations.test.ts).
describe("Raporlar — performans skoru altında 'kesin değil' notu yok", () => {
  it("sayfa kaynağında uyarı metni ve eşik sabiti yok", () => {
    const src = readFileSync("src/app/(app)/reports/page.tsx", "utf8").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(src).not.toContain("kesin değil");
    expect(src).not.toContain("Az veri");
    expect(src).not.toContain("PERF_FEW_CONVERSATIONS");
    // Eşik altında skor hiç gösterilmez (kurucu "öyle yazsın"): tek kaynak sabit, sayfa onu okur.
    expect(src).toContain("score.sampleConversations >= PERF_MIN_CONVERSATIONS");
    // Skor, etiket ve ayrıntı satırları yerinde.
    expect(src).toContain("{score.score}/100");
    expect(src).toContain("{score.label}");
  });
});
