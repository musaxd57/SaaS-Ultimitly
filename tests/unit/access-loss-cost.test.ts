import { describe, it, expect } from "vitest";
import { detectRiskTypes, isAccessLossText } from "@/lib/ai/fallback";

// ---------------------------------------------------------------------------
// ERİŞİM KAYBI AĞI — SÜRE PİNİ (ReDoS kuralı, CLAUDE.md "misafir metnine uygulanan kalıpta karesel iş yok"). Kanal mesajında uzunluk
// tavanı yok; ağ her cevapsız misafir mesajında (kapı + uyarı geçişi + QR) koşar. Nesne kalıbı sabit genişlikli geriye bakış + düz
// alternatif listesi; cümle bölme ve alt dize araması doğrusal. Uzun tek sözcük / boşluk dizisi / tekrarlanan nesne + fiil kökü.
// ---------------------------------------------------------------------------

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("erişim kaybı ağı — uzun girdide sınırlı süre", () => {
  it.each([
    ["50.000 harflik tek sözcük", "a".repeat(50_000), false],
    ["anahtar + 50.000 boşluk + x", "anahtar" + " ".repeat(50_000) + "x", false],
    ["'anahtar ' × 6.000 (nesne var, fiil yok)", "anahtar ".repeat(6_000), false],
    ["'key ' × 10.000", "key ".repeat(10_000), false],
    ["'kaybett' × 7.000 (fiil var, nesne yok)", "kaybett ".repeat(7_000), false],
    ["'anahtar kaybet. ' × 3.000 (çok cümle, varsayım biçimi)", "anahtar kaybet. ".repeat(3_000), false],
    ["'locked ' × 8.000", "locked ".repeat(8_000), false],
    ["uzun metnin SONUNDA kayıp", "Merhaba, ".repeat(5_000) + "anahtarı kaybettim", true],
  ])("%s → 400 ms altında, hüküm doğru", (_ad, girdi, beklenen) => {
    isAccessLossText("ısınma: anahtarı kaybettim");
    let r = !beklenen;
    expect(ms(() => (r = isAccessLossText(girdi)))).toBeLessThan(400);
    expect(r).toBe(beklenen);
  });

  it("bütün risk ağları birlikte 20.000 karakterlik tekrarda sınırlı", () => {
    const girdi = "anahtar key schlüssel ключ ".repeat(800);
    expect(ms(() => detectRiskTypes(girdi))).toBeLessThan(1_500);
  });
});
