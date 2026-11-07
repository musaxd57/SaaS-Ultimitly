import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildGuestMessageBody } from "@/lib/auto-messages/render";

// Tur 7 S7-5 (kurucu 11-05 "tamamını yap"): Ayarlar yardım metni "aynen gider" diyordu; {isim} yoksa selam + imza ekleniyor.
// Metin gerçek davranışla aynı olmalı — ikisi birlikte pinli.
describe("Ayarlar — otomatik mesaj yardım metni gerçek davranışı söyler", () => {
  const page = readFileSync("src/app/(app)/settings/page.tsx", "utf8");

  it("'aynen gider' iddiası yok; selam + imza eklendiği yazıyor", () => {
    expect(page).not.toMatch(/bölümüne yazdığınız metin aynen gider/);
    expect(page.match(/sonuna imzanız eklenir/g)?.length).toBe(2);
  });

  it("davranış: {isim} yoksa başa selam + sona imza; varsa yalnız metin", () => {
    expect(buildGuestMessageBody("Daireniz hazır.", "Ayşe", "Sevgiler,\nAli")).toBe("Merhaba Ayşe,\n\nDaireniz hazır.\n\nSevgiler,\nAli");
    expect(buildGuestMessageBody("Merhaba {isim}, daireniz hazır.", "Ayşe", "Sevgiler,\nAli")).toBe("Merhaba Ayşe, daireniz hazır.");
  });
});
