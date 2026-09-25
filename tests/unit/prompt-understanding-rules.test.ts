import { describe, it, expect } from "vitest";
import { REPLY_SYSTEM_PROMPT } from "@/lib/ai/prompts";

// ---------------------------------------------------------------------------
// Cevap isteminin ANLAMA kuralları (kurucu 09-25: "kelimeye değil cümlenin anlamına bakması"; netleştirme son çare).
// Metin pinleri — kural bir düzenlemede sessizce kaybolmasın. Davranış (model) eval ile ölçülür, burada yalnız talimatın
// varlığı ve bozulmamış hâli pinlenir.
// ---------------------------------------------------------------------------

describe("netleştirme politikası", () => {
  it("netleştirme son çaredir: önce bağlamdan çöz, olası anlamı öneren TEK soru, genel netleştirme YOK", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("NETLEŞTİRME SON ÇAREDİR");
    expect(REPLY_SYSTEM_PROMPT).toMatch(/EN OLASI\s+anlamı ÖNEREN tek kısa soru/);
    expect(REPLY_SYSTEM_PROMPT).toContain('Genel\n    netleştirme ("Biraz daha açıklar mısınız?", "Could you clarify?") YAZMA.');
    // Mevcut tavan korunur.
    expect(REPLY_SYSTEM_PROMPT).toMatch(/EN FAZLA BİR soru/);
  });
});

describe("çıkış saati çıkarımı — yolculuk ≠ çıkış, düzeltme = yeni saat", () => {
  it("bir yere gitmek çıkış saati değildir (kurucu örneği: '10'da havaalanına çıkacağız')", () => {
    expect(REPLY_SYSTEM_PROMPT).toContain("Bir YERE gitmek çıkış saati DEĞİLDİR → null");
    expect(REPLY_SYSTEM_PROMPT).toContain("10'da havaalanına çıkacağız");
  });

  it("düzeltmede YENİ saat yazılır (kurucu örneği: '10 demiştim ama 11 olacak')", () => {
    expect(REPLY_SYSTEM_PROMPT).toMatch(/DÜZELTME: misafir önceki çıkış saatini değiştiriyorsa \("10 demiştim ama 11 olacak"\) YENİ saati yaz/);
  });
});
