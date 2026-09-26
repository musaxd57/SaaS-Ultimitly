import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { normalizeEmail, canonicalMailbox } from "@/lib/email-identity";
import { registerSchema, loginSchema } from "@/lib/validators";

// ---------------------------------------------------------------------------
// KİMLİK SÖZLEŞMESİ (Unicode benzer-karakter turu).
//
// Hesap kimliği e-posta adresidir. İki bağımsız savunma var ve ikisi de bugün
// TESADÜFEN doğru çalışıyor — bu dosya ikisini de sözleşmeye çeviriyor:
//
//  1) Şema ASCII-dışını REDDEDİYOR. `z.string().email()` içindeki regex, tam-genişlik
//     harfi, sıfır-genişlik boşluğu, Kiril "а"sını, noktasız "ı"yı ve RTL override'ı
//     kabul etmiyor → "gözle ayırt edilemeyen ikinci hesap" saldırısı daha giriş
//     kapısında bitiyor. Bu koruma bizim yazdığımız bir kural DEĞİL, bağımlılığın
//     davranışı: zod sürümü yükseltilir ya da doğrulayıcı gevşetilirse SESSİZCE
//     kaybolur. Aşağıdaki testler o an kırmızıya döner.
//  2) Normalizasyon TEK NOKTADAN yapılıyor. Beş giriş noktası (kayıt, giriş,
//     doğrulama-tekrar, şifre-sıfırlama, operatör müşteri-ekleme) aynı fonksiyonu
//     çağırıyor; ayrışırlarsa kimlik uzayı ikiye bölünür.
// ---------------------------------------------------------------------------

const CONFUSABLES: [string, string][] = [
  ["tam-genişlik m", "ｍusa@gmail.com"],
  ["sıfır-genişlik boşluk", "musa​@gmail.com"],
  ["noktasız ı (alan adı)", "musa@gmaıl.com"],
  ["Kiril а", "musа@gmail.com"],
  ["RTL override", "musa‮@gmail.com"],
  ["Türkçe İ", "MUSAİ@gmail.com"],
];

describe("e-posta kimliği — ASCII-dışı adres kabul EDİLMEZ", () => {
  for (const [label, email] of CONFUSABLES) {
    it(`kayıt şeması reddeder: ${label}`, () => {
      const r = registerSchema.safeParse({
        organizationName: "Lale",
        name: "Musa Cinar",
        email,
        password: "yeterince-uzun-sifre",
      });
      expect(r.success).toBe(false);
    });

    it(`giriş şeması reddeder: ${label}`, () => {
      expect(loginSchema.safeParse({ email, password: "x" }).success).toBe(false);
    });
  }

  it("düz ASCII adres (büyük harfli olsa da) kabul edilir — meşru kullanıcı engellenmez", () => {
    const r = registerSchema.safeParse({
      organizationName: "Lale",
      name: "Musa Cinar",
      email: "MUSA@GMAIL.COM",
      password: "yeterince-uzun-sifre",
    });
    expect(r.success).toBe(true);
  });
});

describe("normalizeEmail — tek normalizasyon noktası", () => {
  it("kırpar ve küçültür", () => {
    expect(normalizeEmail("  MUSA@Gmail.COM  ")).toBe("musa@gmail.com");
  });

  it("locale'den bağımsız: 'I' DAİMA 'i' olur (Türkçe yerelde 'ı' olsaydı kimlik kayardı)", () => {
    expect(normalizeEmail("MUSAI@GMAIL.COM")).toBe("musai@gmail.com");
  });

  it("adresin kendisini DEĞİŞTİRMEZ — nokta ve +etiket kimliğin parçasıdır", () => {
    expect(normalizeEmail("m.usa+lixus@gmail.com")).toBe("m.usa+lixus@gmail.com");
  });
});

describe("SÖZLEŞME PİNİ: e-postayla kullanıcı arayan her yol tek normalizasyondan geçer", () => {
  // Denetim bulgusu: "beş yol da aynı fonksiyonu çağırıyor" DOĞRUYDU ama hiçbir
  // test bunu korumuyordu — biri yarın `register`'ı `.toLowerCase()`'e geri
  // çevirse tek bir test bile kırmızıya dönmezdi. Kaynak taraması bu boşluğu
  // kapatıyor (aynı commit'teki diğer iki pin testinin deseniyle).
  const API_DIR = path.resolve(__dirname, "../../src/app/api");

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (entry === "route.ts") out.push(full);
    }
    return out;
  }

  const routes = walk(API_DIR).map((f) => ({
    rel: path.relative(API_DIR, f).split(path.sep).join("/"),
    src: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""),
  }));

  it("`where: { email` yazan HER rota normalizeEmail'i çağırıyor", () => {
    // `emailVerifyTokenHash` gibi alanlar `\bemail\b` sınırına takılmaz.
    const byEmail = routes.filter((r) => /where:\s*\{\s*email\b/.test(r.src));
    expect(byEmail.length).toBeGreaterThanOrEqual(5);
    const missing = byEmail.filter((r) => !/normalizeEmail\s*\(/.test(r.src)).map((r) => r.rel);
    expect(missing).toEqual([]);
  });

  it("kimlik yollarında ELDE normalizasyon kalmadı (tek hakem)", () => {
    // `data.email.trim().toLowerCase()` gibi satır-içi kopyalar zamanla ayrışır.
    const inline = routes
      .filter((r) => /\bemail\b[^\n;]*\.toLowerCase\(\)/.test(r.src))
      .map((r) => r.rel)
      // leads = pazarlama CRM'i; kimlik/oturum yolu değil (giriş yapılamaz).
      .filter((rel) => rel !== "leads/route.ts");
    expect(inline).toEqual([]);
  });
});

describe("canonicalMailbox — YALNIZ analiz içindir", () => {
  it("gmail nokta ve +etiket varyantları tek kutuya iner", () => {
    const box = "musa@gmail.com";
    expect(canonicalMailbox("musa+lixus@gmail.com")).toBe(box);
    expect(canonicalMailbox("m.u.s.a@gmail.com")).toBe(box);
    expect(canonicalMailbox("M.Usa+2@GoogleMail.com")).toBe("musa@googlemail.com");
  });

  it("tanınmayan alan adında nokta kuralı UYGULANMAZ (yanlış eşleşme üretmesin)", () => {
    expect(canonicalMailbox("m.usa+x@sirket.com.tr")).toBe("m.usa@sirket.com.tr");
  });

  it("bozuk girdi normalize edilmiş hâliyle döner, patlamaz", () => {
    expect(canonicalMailbox("  BOZUK  ")).toBe("bozuk");
    expect(canonicalMailbox("@gmail.com")).toBe("@gmail.com");
  });
});
