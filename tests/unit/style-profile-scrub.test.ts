import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { scrubStyleProfileForPublic } from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// STİL REHBERİ HALKA AÇIK QR YÜZEYİNE HAM GİREMEZ (derin denetim, 2026-08-01).
//
// `guest-chat.ts` dosyasının kendi değişmezi şudur: erişim SIRLARI bağlamdan
// TAMAMEN çıkarılır — "modele söyleriz reddeder" DEĞİL — öyle ki kusursuz bir
// prompt injection'ın bile sızdıracak bir şeyi olmasın.
//
// `aiStyleProfile` bu değişmezi deliyordu: rehber, ev sahibinin GEÇMİŞ MİSAFİR
// CEVAPLARINDAN (40 örneğe kadar) bir modelle damıtılıyor ve o cevaplar rutin
// olarak Wi-Fi şifresi, kapı kodu ve adres içeriyor. Damıtma isteminde
// "bunları ASLA koyma" YAZILI (`ai/index.ts`) — ama bu bir MODEL RİCASIDIR,
// deterministik garanti değil. Rehber QR yoluna olduğu gibi geçiyordu, yani
// bilgi tabanı için kurulan tüm sır-eleme çabası yan kapıdan atlanabiliyordu.
//
// Bu dosya iki şeyi pinler: eleme GERÇEKTEN çalışıyor mu, ve QR rotası ham
// rehberi geçirmiyor mu.
// ---------------------------------------------------------------------------

describe("stil rehberi — sır-benzeri satırlar elenir", () => {
  it("Wi-Fi şifresi taşıyan satır DÜŞER, üslup satırları KALIR", () => {
    const profile = [
      "TARZ: Samimi ve kısa yazar, 'Merhaba' ile başlar.",
      "SIK SORULAN: Wi-Fi şifresi 12345678 diye cevaplıyor.",
      "SIK SORULAN: Otopark için bina altını tarif ediyor.",
    ].join("\n");
    const out = scrubStyleProfileForPublic(profile);
    expect(out).not.toContain("12345678");
    expect(out).toContain("Samimi ve kısa");
    expect(out).toContain("Otopark");
  });

  it("kapı/anahtar kutusu kodu taşıyan satır DÜŞER", () => {
    const profile = ["TARZ: Resmî bir dil kullanır.", "Kapı kodu 4590, girişte tuşluyorsunuz."].join(
      "\n",
    );
    const out = scrubStyleProfileForPublic(profile);
    expect(out).not.toContain("4590");
    expect(out).toContain("Resmî bir dil");
  });

  it("anahtar kelimesiz ama değer taşıyan Wi-Fi cümlesi de DÜŞER", () => {
    // Sır detektörünün en zor dalı: "şifre" kelimesi geçmiyor.
    const profile = 'İnternet ağımız "LaleEv", bağlanmak için 87654321 girin.';
    expect(scrubStyleProfileForPublic(profile)).toBeNull();
  });

  it("TAMAMI sır olan rehber null döner (boş string DEĞİL)", () => {
    // null olmasi onemli: `styleProfile?.trim()` bos string'i de eler ama
    // sozlesmeyi acik tutmak icin tek bir "yok" degeri kullaniyoruz.
    expect(scrubStyleProfileForPublic("Wi-Fi şifresi: abc123")).toBeNull();
  });

  it("temiz rehber DEĞİŞMEDEN geçer (aşırı eleme yok)", () => {
    const clean = [
      "TARZ: Kısa cümleler, emoji kullanmıyor, 'İyi tatiller' ile bitiriyor.",
      "SIK SORULAN: Geç çıkışa müsaitse olumlu yaklaşıyor.",
    ].join("\n");
    expect(scrubStyleProfileForPublic(clean)).toBe(clean);
  });

  it("boş / null girdi null döner", () => {
    expect(scrubStyleProfileForPublic(null)).toBeNull();
    expect(scrubStyleProfileForPublic(undefined)).toBeNull();
    expect(scrubStyleProfileForPublic("   ")).toBeNull();
  });
});

describe("QR rotası ham rehberi GEÇİRMEZ (kaynak-tarama pini)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../src/app/api/chat/[token]/route.ts"),
    "utf8",
  );

  it("halka açık rota temizleyiciden geçiriyor", () => {
    // F13 (09-26): tek giriş `styleProfileForPrompt` (sürüm kuralı + sır süzgeci).
    expect(src).toContain("styleProfileForPrompt(org?.aiStyleProfile)");
    expect(src).not.toContain("scrubStyleProfileForPublic(org");
  });

  it("ham `aiStyleProfile` doğrudan modele verilmiyor", () => {
    // Bu satır geri gelirse değişmez yeniden delinir.
    expect(src).not.toMatch(/styleProfile:\s*org\?\.aiStyleProfile\s*\?\?\s*null/);
  });
});
