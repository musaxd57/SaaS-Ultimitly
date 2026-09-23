import { describe, it, expect, vi, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import {
  hashPassword,
  verifyPassword,
  verifyPasswordForLogin,
  dummyVerifyPassword,
  newPasswordProblem,
  PASSWORD_MAX_BYTES,
  PASSWORD_TOO_LONG_MESSAGE,
} from "@/lib/auth/password";

// ---------------------------------------------------------------------------
// ③ PAROLA NFC + 72 BAYT (kurucu onayı 09-23) · ④ maliyet-12 yükseltme sinyali.
//
// Aynı görünen parola iki farklı bayt dizisiyle gelebilir: "ş" tek karakter (NFC,
// Türkçe klavyelerin ürettiği) ya da "s" + birleşen çengel (NFD — kopyala-yapıştır,
// bazı macOS kaynakları). bcrypt baytlara bakar → iki yazım ESKİDEN iki ayrı parola
// sayılıyordu ve kullanıcı "doğru" parolasıyla kilitlenebiliyordu.
//
// ⚠️ İki yazım aşağıda `.normalize()` ile KODDAN üretilir — kaynağa görünmez
// karakter/kaçış dizisi yazılmaz (dosyalar bunları okunmaz hâle getiriyordu).
// ---------------------------------------------------------------------------

const NFC = "Kuş-şifre-2026".normalize("NFC");
const NFD = NFC.normalize("NFD");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parola Unicode normalizasyonu (③)", () => {
  it("anti-vakum: iki yazım gerçekten FARKLI bayt dizisi", () => {
    expect(NFD).not.toBe(NFC);
    expect(Buffer.byteLength(NFD, "utf8")).toBeGreaterThan(Buffer.byteLength(NFC, "utf8"));
  });

  it("yeni hash NFC biçiminden alınır → İKİ yazım da doğrulanır", async () => {
    const h = await hashPassword(NFD);
    expect(await verifyPassword(NFC, h)).toBe(true);
    expect(await verifyPassword(NFD, h)).toBe(true);
  });

  it("KONTROL: yanlış parola iki yazımda da reddedilir", async () => {
    const h = await hashPassword(NFC);
    expect(await verifyPassword("Kus-sifre-2026", h)).toBe(false);
    expect(await verifyPassword(NFC + "!", h)).toBe(false);
  });

  it("ESKİ hash (ham NFD baytları) hâlâ girer ve yükseltme İSTER", async () => {
    // Bu düzeltmeden ÖNCE kaydedilmiş bir parolanın saklanan biçimi.
    const legacy = await bcrypt.hash(NFD, 12);
    expect(await verifyPasswordForLogin(NFD, legacy)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword(NFD, legacy)).toBe(true);
  });

  it("bilinen sınır (gerileme DEĞİL): eski ham-NFD hash'e NFC yazımla girilemez — bugün de girilemiyordu", async () => {
    const legacy = await bcrypt.hash(NFD, 12);
    expect(await verifyPassword(NFC, legacy)).toBe(false);
  });

  it("zamanlama paritesi: NFC olmayan girdide gerçek ve sahte yol AYNI sayıda bcrypt karşılaştırması yapar", async () => {
    const h = await hashPassword("tamamen-baska-parola");
    const spy = vi.spyOn(bcrypt, "compare");

    await verifyPassword(NFD, h); // yanlış parola, NFC olmayan girdi
    const realNonNfc = spy.mock.calls.length;
    spy.mockClear();
    await dummyVerifyPassword(NFD);
    const dummyNonNfc = spy.mock.calls.length;
    spy.mockClear();

    await verifyPassword("ascii-yanlis", h);
    const realAscii = spy.mock.calls.length;
    spy.mockClear();
    await dummyVerifyPassword("ascii-yanlis");
    const dummyAscii = spy.mock.calls.length;

    expect(realNonNfc).toBe(2);
    expect(dummyNonNfc).toBe(realNonNfc);
    expect(realAscii).toBe(1);
    expect(dummyAscii).toBe(realAscii);
  });
});

describe("maliyet yükseltme sinyali (④)", () => {
  it("maliyet-10 hash: DOĞRU parolada yükseltme ister", async () => {
    const h10 = await bcrypt.hash("correct-horse", 10);
    expect(await verifyPasswordForLogin("correct-horse", h10)).toEqual({ ok: true, needsRehash: true });
  });

  it("maliyet-10 hash: YANLIŞ parolada yükseltme istemez (yetkisiz yazma yok)", async () => {
    const h10 = await bcrypt.hash("correct-horse", 10);
    expect(await verifyPasswordForLogin("yanlis-parola", h10)).toEqual({ ok: false, needsRehash: false });
  });

  it("KONTROL: güncel (maliyet-12, NFC) hash yükseltme istemez", async () => {
    const h12 = await hashPassword("correct-horse");
    expect(bcrypt.getRounds(h12)).toBe(12);
    expect(await verifyPasswordForLogin("correct-horse", h12)).toEqual({ ok: true, needsRehash: false });
  });
});

describe("yeni parola politikası — 72 bayt (③)", () => {
  it("bcrypt'in kendisi 72 bayttan sonrasını YOK SAYIYOR (sınırın gerekçesi — kütüphane karakterizasyonu)", async () => {
    const base = "a".repeat(72);
    const h = await bcrypt.hash(base + "X", 4);
    // 73. bayt farklı olduğu hâlde karşılaştırma TUTUYOR: fazlası sessizce kesiliyor.
    expect(await bcrypt.compare(base + "Y", h)).toBe(true);
  });

  it("sınır sabiti 72", () => {
    expect(PASSWORD_MAX_BYTES).toBe(72);
  });

  it("🚨 müşteriye giden metin SADE: teknik terim yok (kurucu 09-23)", () => {
    expect(PASSWORD_TOO_LONG_MESSAGE).not.toMatch(/bayt|byte|utf|nfc|bcrypt|karakter sayı/i);
    // Ne yapması gerektiğini söyler.
    expect(PASSWORD_TOO_LONG_MESSAGE).toMatch(/daha kısa/);
  });

  it("uzunluk: 8 karakter altı reddedilir, 8 kabul", () => {
    expect(newPasswordProblem("a".repeat(7))).toMatch(/en az 8/);
    expect(newPasswordProblem("a".repeat(8))).toBeNull();
  });

  it("ASCII: 72 bayt kabul, 73 bayt reddedilir", () => {
    expect(newPasswordProblem("a".repeat(72))).toBeNull();
    expect(newPasswordProblem("a".repeat(73))).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });

  it("Türkçe harf 2 bayt sayılır: 36 × ş = 72 bayt kabul, 37 × ş reddedilir", () => {
    expect(newPasswordProblem("ş".repeat(36))).toBeNull();
    expect(newPasswordProblem("ş".repeat(37))).toBe(PASSWORD_TOO_LONG_MESSAGE);
  });

  it("ölçü SAKLANAN biçimdir (NFC): NFD yazımın fazladan baytı parolayı reddettirmez", () => {
    const nfd = "ş".repeat(36).normalize("NFD");
    expect(Buffer.byteLength(nfd, "utf8")).toBeGreaterThan(72); // anti-vakum
    expect(newPasswordProblem(nfd)).toBeNull();
  });
});
