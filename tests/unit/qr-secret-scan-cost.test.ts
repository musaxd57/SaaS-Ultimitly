import { describe, it, expect } from "vitest";
import { withoutSecretKbItems, scrubStyleProfileForPublic, redactDoorCodes, qrReplyHasDoorCode } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR SIR TARAYICISI MALİYETİ — DAVRANIŞSAL (DENETIM 08-09 #34, 10-12 gece). Kardeş yapısal tarama
// (`audit-2026-08-07-round2.test.ts`) yalnız "/…/i," ya da "/…/i;" ile biten tek satırlık kalıpları görür; başka bayrakla, çok satırlı
// ya da `new RegExp(...)` ile kurulan yeni bir kalıp ona görünmez. Bu dosya kalıbın NASIL yazıldığına bakmaz: tarama sınırının hemen
// altındaki (24.000) düşmanca girdilerle dört giriş noktasını süreyle sınar. Ölçüm (10-12): çağrı başına en yavaşı ~100 ms; kod
// sözcüğü kalıbında (`CODE_WORD_VALUE`) sınırsız `\w*` mutantı bitişik tekrar vakalarında 87–147 SANİYE sürdü (kırmızı doğrulandı; tek
// boşluklu tekrar onu yakalamıyordu) — 1 sn eşiği yavaş CI'da da güvenli. Isınma: düzenli ifade derlemesi süreç başına bir kez ödenir —
// pin karesel işi ölçer, derlemeyi değil.
// ---------------------------------------------------------------------------

const N = 23_900;
const CASES: [string, string][] = [
  ["wifi + uzun sözcük", "wifi" + "a".repeat(N)],
  ["şifre + boşluk dizisi", "şifre" + " ".repeat(N) + "x"],
  ["kod sözcüğü tekrarı", "kod ".repeat(N / 4)],
  ["kod sözcüğü bitişik tekrarı", "kod".repeat(Math.floor(N / 3))],
  ["şifre sözcüğü bitişik tekrarı (ASCII)", "sifre".repeat(Math.floor(N / 5))],
  ["şifre sözcüğü bitişik tekrarı (Türkçe)", "şifre".repeat(Math.floor(N / 5))],
  ["kapı kodu + rakam-tire", "kapı kodu " + "1-".repeat(N / 2)],
  // Sonda "x": stil profili taraması `trim()` eder — yalnız boşlukla biten girdi orada boşa düşerdi (Haiku 10-12).
  ["password + sekme dizisi", "password" + "\t".repeat(N) + "x"],
  ["şifre: tekrarı", "şifre: ".repeat(Math.floor(N / 7))],
  ["kod + uzun rakam", "kod " + "1".repeat(N)],
  ["kod + rakam boşluk", "kod " + "1 ".repeat(N / 2)],
  ["wifi + harf boşluk", "wifi " + "a ".repeat(N / 2)],
];

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

describe("QR sır tarayıcısı — düşmanca girdide sınırlı süre", () => {
  it("girdiler tarama sınırının ALTINDA (fail-closed kısa devresi ölçümü boşa düşürmesin)", () => {
    for (const [ad, t] of CASES) {
      expect(t.length, ad).toBeLessThan(24_000);
      expect(t.length, ad).toBeGreaterThan(20_000);
    }
  });

  it.each(CASES)("%s → dört giriş noktası 1 sn altında", (_ad, t) => {
    for (let i = 0; i < 2; i++) {
      withoutSecretKbItems([{ title: "T", content: "wifi şifre kod 1234 " + "a ".repeat(500) }]);
      redactDoorCodes("kapı kodu 4590 " + "a ".repeat(500));
    }
    expect(ms(() => withoutSecretKbItems([{ title: "T", content: t }]))).toBeLessThan(1_000);
    expect(ms(() => scrubStyleProfileForPublic(t))).toBeLessThan(1_000);
    expect(ms(() => redactDoorCodes(t))).toBeLessThan(1_000);
    expect(ms(() => qrReplyHasDoorCode(t, []))).toBeLessThan(1_000);
  });

  it("KONTROL: hüküm aynı — uzun dolgunun sonundaki kapı kodu yine yakalanır", () => {
    const content = "a ".repeat(10_000) + "Kapı kodu: 4590";
    expect(withoutSecretKbItems([{ title: "T", content }])).toEqual([]);
    expect(qrReplyHasDoorCode(content, [])).toBe(true);
  });
});
