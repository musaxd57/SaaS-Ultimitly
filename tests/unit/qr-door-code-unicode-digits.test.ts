import { describe, it, expect } from "vitest";
import {
  qrReplyHasDoorCode,
  redactDoorCodes,
  REDACTED_DOOR_CODE,
  withoutQrSecretKbItems,
  withoutSecretKbItems,
} from "@/lib/guest-chat";
import { foldUnicodeDigits } from "@/lib/unicode-digits";

// ---------------------------------------------------------------------------
// Y2 (10-14 dış inceleme): KAPI KODU — UNICODE RAKAM + ÇOK DİLLİ KAPI ADI.
//  (a) "Kapı kodu: ٦١٤٢" / "۶۱۴۲" çıktı taramasından geçiyor, geçmişte maskelenmiyordu; "Kapı: ٦١٤٢" bilgi tabanı süzgecinden de
//      geçiyordu (kalıplar `\d` / `[0-9]`; NFKC bu rakamları çevirmez).
//  (b) Wi-Fi kalemine Arapça kapı etiketiyle yazılmış ASCII kod ("…كلمة مرور الباب: 6142") QR bağlamına giriyordu.
// Meşru Wi-Fi / saat / fiyat / yıl / telefon yanlışlıkla elenmez (aşağıdaki KONTROL'ler).
// ---------------------------------------------------------------------------

describe("foldUnicodeDigits", () => {
  it.each([
    ["٦١٤٢", "6142"],
    ["۶۱۴۲", "6142"],
    ["６１４２", "6142"],
    ["६१४२", "6142"], // Devanagari
    ["𝟔𝟏𝟒𝟐", "6142"], // matematiksel kalın (bitişik Nd blokları)
    ["٠١٢٣٤٥٦٧٨٩", "0123456789"],
    ["Giriş 15:00", "Giriş 15:00"],
  ])("%s → %s", (input, out) => expect(foldUnicodeDigits(input)).toBe(out));
  it("ASCII metin aynen döner (aynı nesne)", () => {
    const s = "Kapı kodu 4590";
    expect(foldUnicodeDigits(s)).toBe(s);
  });
});

describe("(a) Unicode rakamlı kapı kodu", () => {
  const leaks = ["Kapı kodu: ٦١٤٢", "Kapı kodu: ۶۱۴۲", "Door code: ٦١٤٢", "رمز الباب: ٦١٤٢", "Kapı kodunuz ６１４２."];
  it.each(leaks)("🚨 çıktı taraması yakalar: %s", (reply) => expect(qrReplyHasDoorCode(reply, [])).toBe(true));
  it.each(leaks)("🚨 geçmişte değer gizlenir: %s", (m) => {
    const out = redactDoorCodes(m);
    expect(out).toContain(REDACTED_DOOR_CODE);
    expect(foldUnicodeDigits(out)).not.toMatch(/6142/);
  });
  it.each(["Kapı: ٦١٤٢", "Kapı: ۶۱۴۲", "Giriş ٦١٤٢ ile açılır", "Kapı kodu: ٦١٤٢"])("🚨 bilgi tabanı kalemi elenir: %s", (content) => {
    expect(withoutSecretKbItems([{ title: "Giriş", content }])).toHaveLength(0);
    expect(withoutQrSecretKbItems([{ category: "general", title: "Giriş", content }])).toHaveLength(0);
  });
  it("bilgi tabanında VERİLMİŞ bağlamsız sayı Unicode yazımla da sızıntı sayılmaz (mevcut muafiyet korunur)", () => {
    expect(qrReplyHasDoorCode("Kodunuz ٤٥٩٠ olarak kayıtlı.", ["Rezervasyon kodu 4590"])).toBe(false);
  });
});

describe("(a2) rakam görünümlü diğer biçimler ve araya giren görünmez karakter / ayraç (Haiku 10-14)", () => {
  const leaks = [
    "Kapı kodu: ⁶¹⁴²",
    "Kapı kodu: ₆₁₄₂",
    "Kapı kodu: ⑥①④②",
    "Kapı kodu: 61\u200B42",
    "Kapı kodu: 61\u00AD42",
    "Kapı kodu: 6\u00A01\u00A04\u00A02",
    "Kapı kodu: 6.1.4.2",
    "Kapı kodu: 6/1/4/2",
  ];
  it.each(leaks)("🚨 çıktı taraması yakalar: %j", (reply) => expect(qrReplyHasDoorCode(reply, [])).toBe(true));
  it.each(leaks)("🚨 geçmişte değer kalmaz: %j", (m) => {
    const out = redactDoorCodes(m);
    expect(out).toContain(REDACTED_DOOR_CODE);
    expect(out.replace(/\D/g, "")).not.toContain("6142");
  });
  it.each(["Kapı: ⁶¹⁴²", "Kapı: ⑥①④②", "Kapı: 61\u200B42"])("🚨 bilgi tabanı kalemi elenir: %j", (content) => {
    expect(withoutSecretKbItems([{ title: "Giriş", content }])).toHaveLength(0);
  });
  it.each(["Fiyat ²⁰²⁴ değil 2024'te belirlendi.", "Giriş saati 15.00, çıkış 11.00", "Sürüm 1.2.3 yüklü"])(
    "KONTROL: kapı bağlamı yoksa cevap durmaz: %j",
    (reply) => expect(qrReplyHasDoorCode(reply, [])).toBe(false),
  );
});

describe("(b2) kapı adı sözcük İÇİNDE değil (Haiku 10-14: 'importe 2500' / 'soporte 2024')", () => {
  it.each([
    "Le total importe 2500 TL pour la nuit.",
    "Importe total: 2500 TL",
    "Soporte 2024 incluido.",
    "Shabab 2024",
  ])("bilgi tabanı kalemi KALIR: %j", (content) => {
    expect(withoutSecretKbItems([{ title: "Bilgi", content }])).toHaveLength(1);
  });
  it("Wi-Fi kaleminde Arapça sözcük içindeki 'باب' (شباب) iz sayılmaz", () => {
    expect(withoutQrSecretKbItems([{ category: "wifi", title: "Wi-Fi", content: "Wi-Fi: LaleNet, şifre lale2024. شباب" }])).toHaveLength(1);
  });
});

describe("(b) Wi-Fi kaleminde başka dilde kapı etiketi", () => {
  it.each([
    "Wi-Fi şifresi: lale2024. كلمة مرور الباب: 6142",
    "Wi-Fi şifresi: lale2024. الباب: 6142",
    "Wi-Fi şifresi: lale2024. كلمة مرور الباب: ٦١٤٢",
    "Wi-Fi: LaleNet / lale2024. Дверь: 6142",
    "Wi-Fi: LaleNet / lale2024. Código de la puerta 6142",
    "WLAN: LaleNet / lale2024. Haustür 6142",
  ])("🚨 Wi-Fi kalemi QR bağlamına GİRMEZ: %s", (content) => {
    expect(withoutQrSecretKbItems([{ category: "wifi", title: "Wi-Fi", content }])).toHaveLength(0);
  });
  it.each(["كلمة مرور الباب: 6142", "الباب: 6142", "Дверь: 6142"])("🚨 çıktı taraması yakalar: %s", (reply) =>
    expect(qrReplyHasDoorCode(reply, [])).toBe(true),
  );
});

describe("KONTROL — meşru içerik elenmez / sızıntı sayılmaz", () => {
  it.each([
    "Wi-Fi ağı: LaleNet, şifre: lale2024",
    "Wi-Fi ağı: TurkcellSuperonline_5G, şifre: 61428899",
    "Her tür cihaz Wi-Fi'ye bağlanabilir. Şifre: lale2024",
    "Wi-Fi: LaleNet. Captive portal yok, şifre lale2024",
    "شبكة الواي فاي: LaleNet، كلمة المرور: lale2024",
  ])("Wi-Fi kalemi QR'a girer: %s", (content) => {
    expect(withoutQrSecretKbItems([{ category: "wifi", title: "Wi-Fi", content }])).toHaveLength(1);
  });
  it.each([
    "Giriş 15:00, çıkış 11:00",
    "Otopark 150 TL",
    "Bina 2024 yılında yenilendi",
    "Kapıcı 0532 111 2233",
    "الدخول ١٥:٠٠ والخروج ١١:٠٠",
    "Puerta 3, piso 2",
  ])("bilgi tabanı kalemi KALIR: %s", (content) => {
    expect(withoutSecretKbItems([{ title: "Bilgi", content }])).toHaveLength(1);
  });
  it.each(["Giriş saati ١٥:٠٠.", "Otopark ٢٥٠ TL.", "Wi-Fi şifresi lale2024."])("cevap sızıntı sayılmaz: %s", (reply) =>
    expect(qrReplyHasDoorCode(reply, [])).toBe(false),
  );
});

describe("süre — Unicode rakam katlaması doğrusal", () => {
  it("50.000 Arap rakamı + kapı adı < 1500 ms", () => {
    const t0 = performance.now();
    qrReplyHasDoorCode(`Kapı ${"٦".repeat(1999)}`, []);
    redactDoorCodes(`الباب ${"٦١ ".repeat(7000)}`);
    withoutSecretKbItems([{ title: "x", content: `Kapı ${"𝟔".repeat(10_000)}` }]);
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
