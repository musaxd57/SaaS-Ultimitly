import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
// ⚠️ SIRA ÖNEMLİ: `validators` import edilir edilmez `installTurkishZodErrors`
// modül seviyesinde koşar. Bu testin tamamı o kurulumun GERÇEKTEN olduğunu
// varsayar; ayrı bir `install` çağrısı YOK — çünkü üretimde de yok.
import { zodFieldErrors, registerSchema, kbSchema, leadSchema, reservationSchema } from "@/lib/validators";

// ---------------------------------------------------------------------------
// ZOD VARSAYILAN HATA METİNLERİ TÜRKÇE (denetim, 08-06)
//
// 🚨 KAPATILAN AÇIK: özel mesajı OLMAYAN her zod kuralı İNGİLİZCE varsayılanı
// basıyordu ve o metin doğrudan müşterinin ekranına çıkıyordu:
//   "String must contain at most 20000 character(s)"
//   "Invalid enum value. Expected 'airbnb' | 'booking', received 'x'"
//   "Required" · "Expected string, received number"
// Ulaşılabilir: bilgi tabanına uzun metin yapıştırmak, mülk adresi >300,
// notlar >5000, checklist >60 madde. İstemci formlarında `maxLength` YOK.
// ---------------------------------------------------------------------------

/** Bir şemayı bozup ilk hata mesajını döndürür. */
function mesaj(schema: z.ZodType, value: unknown): string {
  const r = schema.safeParse(value);
  expect(r.success, "şema beklenmedik şekilde GEÇTİ — test bir şey ölçmüyor").toBe(false);
  return zodFieldErrors((r as { error: z.ZodError }).error)._ ?? "";
}

describe("zod varsayılan hataları Türkçe", () => {
  it("hiçbir varsayılan metin İngilizce kalmadı", () => {
    // Her biri zod'un ayrı bir varsayılan şablonu. İngilizce kalan olursa
    // burada yakalanır — tek tek metin eşleştirmek yerine YASAKLI kelimeler
    // aranıyor: metni iyileştirmek testi kırmasın, DİL değişimi kırsın.
    // zod 3 kalıpları + zod 4 kalıpları (4.15 geçişi, ölçüldü: "Too big: expected string to have <=5 characters", "Invalid input: expected
    // string, received number", "Invalid option: …", "Unrecognized key: …"). Yalnız zod 3 kalıpları aransaydı zod 4'te harita HİÇ
    // kurulmasa da bu test geçerdi.
    const YASAK =
      /String must|Array must|Number must|Invalid|Expected |expected|received|Required|Too (big|small)|Unrecognized|must (be|match)|characters?\b|items?\b|element\(s\)/;
    const vakalar: [string, z.ZodType, unknown][] = [
      ["metin çok uzun", z.string().max(5), "abcdefgh"],
      ["metin çok kısa", z.string().min(3), "a"],
      ["zorunlu alan boş", z.string().min(1), ""],
      ["geçersiz seçim", z.enum(["airbnb", "booking"]), "x"],
      ["yanlış tip", z.string(), 123],
      ["dizi çok uzun", z.array(z.string()).max(2), ["a", "b", "c"]],
      ["sayı çok küçük", z.number().min(5), 1],
      ["sayı çok büyük", z.number().max(5), 9],
      ["geçersiz e-posta", z.string().email(), "abc"],
      ["geçersiz bağlantı", z.string().url(), "abc"],
      ["kalıp dışı", z.string().regex(/^a$/), "b"],
      ["geçersiz tarih", z.date(), new Date("x")],
      ["literal", z.literal(true), false],
      ["kat değil", z.number().multipleOf(5), 3],
      ["tanınmayan alan", z.object({ a: z.string() }).strict(), { a: "x", b: 1 }],
      ["birleşim", z.union([z.string(), z.number()]), true],
      ["tam sayı değil", z.number().int(), 1.5],
      ["sonsuz sayı", z.number(), Infinity],
      ["bilinmeyen anahtar (kısmi kayıt)", z.partialRecord(z.enum(["a"]), z.number()), { b: 1 }],
    ];
    for (const [ad, schema, deger] of vakalar) {
      const m = mesaj(schema, deger);
      expect(m, `${ad}: metin boş`).not.toBe("");
      expect(m, `${ad}: hâlâ İngilizce → "${m}"`).not.toMatch(YASAK);
    }
  });

  it("eksik alan 'Bu alan gerekli.' der ('Required' DEĞİL)", () => {
    const r = z.object({ ad: z.string() }).safeParse({});
    expect(r.success).toBe(false);
    expect(zodFieldErrors((r as { error: z.ZodError }).error).ad).toBe("Bu alan gerekli.");
  });

  it("zod 4 sorun kodları birebir Türkçe metne iner (4.15 geçişi: invalid_value · invalid_format · invalid_type/date · origin)", () => {
    const beklenen: [z.ZodType, unknown, string][] = [
      [z.string().max(5), "abcdefgh", "Çok uzun — en fazla 5 karakter olabilir."],
      [z.array(z.string()).min(2), ["a"], "Çok kısa — en az 2 öğe olmalı."],
      [z.set(z.string()).max(1), new Set(["a", "b"]), "Çok uzun — en fazla 1 öğe olabilir."],
      [z.number().max(5), 9, "Değer çok büyük — en fazla 5 olabilir."],
      [z.number().min(5), 1, "Değer çok küçük — en az 5 olmalı."],
      [z.string(), 123, "Geçersiz değer — metin bekleniyor."],
      [z.number().int(), 1.5, "Geçersiz değer — tam sayı bekleniyor."],
      [z.bigint(), 1, "Geçersiz değer."],
      [z.date(), new Date("x"), "Geçerli bir tarih girin."],
      [z.literal(true), false, "Geçersiz seçim."],
      [z.string().email(), "abc", "Geçerli bir e-posta adresi girin."],
      [z.string().url(), "abc", "Geçerli bir bağlantı girin."],
      [z.string().uuid(), "abc", "Geçersiz kimlik."],
      [z.string().regex(/^a$/), "b", "Geçersiz biçim."],
      [z.number().multipleOf(5), 3, "Değer 5 katı olmalı."],
      [z.object({ a: z.string() }).strict(), { a: "x", b: 1 }, "Tanınmayan alan gönderildi."],
      [z.union([z.string(), z.number()]), true, "Geçersiz değer."],
      // Fark testinde (zod 3 ↔ 4, 115 bin girdi) bulunan metin eşitlemeleri:
      [z.enum(["a", "b"]), null, "Bu alan gerekli."],
      [z.literal(true), null, "Bu alan gerekli."],
      [z.partialRecord(z.enum(["a"]), z.number()), "", "Geçersiz değer — nesne bekleniyor."],
      [z.number().int().max(1440), 2 ** 53 + 2, "Değer çok büyük."],
      [z.number().int().min(0), -(2 ** 53 + 2), "Değer çok küçük."],
      // Enum'a yanlış TİPTE değer: zod 3 seçenekleri listeliyordu ("'warm' | 'formal' … bekleniyor") — haritanın kuralına aykırıydı.
      [z.enum(["warm", "formal"]), 0, "Geçersiz seçim."],
    ];
    for (const [schema, deger, metin] of beklenen) expect(mesaj(schema, deger)).toBe(metin);
    const bos = z.object({ ad: z.string() }).safeParse({ ad: null });
    expect(zodFieldErrors((bos as { error: z.ZodError }).error).ad, "null = gönderilmemiş").toBe("Bu alan gerekli.");
  });

  it("min(1) 'en az 1 karakter' DEMEZ — 'boş bırakılamaz' der", () => {
    // "en az 1 karakter olmalı" teknik olarak doğru ama kullanıcıya yardımcı
    // değil; boş bir zorunlu alanın gerçek anlamı budur.
    expect(mesaj(z.string().min(1), "")).toBe("Bu alan boş bırakılamaz.");
  });

  it("geçersiz seçimde SEÇENEKLER listelenmez (gürültü + gereksiz bilgi)", () => {
    const m = mesaj(z.enum(["airbnb", "booking", "other"]), "x");
    expect(m).toBe("Geçersiz seçim.");
    expect(m).not.toContain("airbnb");
  });

  it("ŞEMA İÇİ ÖZEL TÜRKÇE MESAJLAR EZİLMEZ (asıl risk buydu)", () => {
    // 🚨 Bu test olmasaydı error map'i tüm mesajları düzleyen bir mutasyon
    // sessizce geçerdi ve ürünün ÖZENLE yazılmış alan mesajları kaybolurdu.
    const r = registerSchema.safeParse({ email: "a@b.com", password: "12345678", name: "", organizationName: "X", consent: true });
    expect(r.success).toBe(false);
    const f = zodFieldErrors((r as { error: z.ZodError }).error);
    // `validators.ts` bu alana özel bir mesaj yazmış — aynen çıkmalı.
    expect(Object.values(f).join(" ")).toMatch(/gerekli|karakter|zorunlu|girin/i);
  });

  it("demo formu (KVKK) onay kutusu: işaretlenmemiş ya da hiç gönderilmemiş onay ÖZEL metni verir (zod 4: `errorMap` → `error`)", () => {
    const temel = { name: "Ayşe", email: "a@b.com" };
    for (const consent of [false, undefined, "true"]) {
      const r = leadSchema.safeParse({ ...temel, consent });
      expect(r.success, `consent=${String(consent)} kabul edildi`).toBe(false);
      expect(zodFieldErrors((r as { error: z.ZodError }).error).consent).toBe("Devam etmek için onay kutusunu işaretleyin.");
    }
    expect(leadSchema.safeParse({ ...temel, consent: true }).success).toBe(true);
  });

  it("rezervasyon tarihleri: şemanın kendi metni çıkar (zod 3'te bu metin hiç devreye girmiyordu — 'Geçerli bir tarih girin.' çıkıyordu)", () => {
    const r = reservationSchema.safeParse({ propertyId: "p1", guestName: "Ayşe", arrivalDate: "", departureDate: "" });
    expect(r.success).toBe(false);
    const f = zodFieldErrors((r as { error: z.ZodError }).error);
    expect(f.arrivalDate).toBe("Giriş tarihi gerekli");
    expect(f.departureDate).toBe("Çıkış tarihi gerekli");
    const ok = reservationSchema.safeParse({ propertyId: "p1", guestName: "Ayşe", arrivalDate: "2026-11-01", departureDate: "2026-11-03" });
    expect(ok.success).toBe(true);
  });

  it("özel mesajlı bir kural varsayılana DÜŞMEZ (kb içerik sınırı)", () => {
    const r = kbSchema.safeParse({ propertyId: "p1", category: "wifi", title: "", content: "x" });
    expect(r.success).toBe(false);
    const f = zodFieldErrors((r as { error: z.ZodError }).error);
    // Şemadaki özel metin: "Başlık gerekli"
    expect(f.title).toBe("Başlık gerekli");
  });
});

// ---------------------------------------------------------------------------
// 🚨 zod 4 DAVRANIŞ FARKLARI — KAYNAK PİNİ (4.15 geçişi, 10-28). Davranış `tests/integration/zod4-partial-patch.test.ts`'te; bu pin
// YENİ bir şemanın aynı tuzağa düşmesini önler (kaynak taraması tek yönlüdür — davranış testi asıl kanıt):
//  · `.partial()` zod 4'te alanların `.default()`unu UYGULAR → kısmi güncellemede gönderilmeyen alan varsayılana ezilir. Kısmi şema
//    YALNIZ `patchSchemaOf` (validators.ts) ile türetilir.
//  · enum anahtarlı `z.record` zod 4'te BÜTÜN anahtarları zorunlu kılar → alt küme için `z.partialRecord`.
// ---------------------------------------------------------------------------
function kaynakDosyalari(dir: string): string[] {
  const out: string[] = [];
  for (const ad of readdirSync(dir)) {
    const yol = join(dir, ad);
    if (statSync(yol).isDirectory()) out.push(...kaynakDosyalari(yol));
    else if (/\.(ts|tsx)$/.test(ad)) out.push(yol);
  }
  return out;
}

describe("zod 4 tuzakları — kaynak pini", () => {
  const dosyalar = kaynakDosyalari(join(process.cwd(), "src"));

  it("tarama boş değil (anti-vakum: validators.ts bulunur ve yardımcıyı taşır)", () => {
    const v = dosyalar.find((f) => f.endsWith(join("lib", "validators.ts")));
    expect(v, "validators.ts bulunamadı — tarama hiçbir şey ölçmüyor").toBeDefined();
    expect(readFileSync(v!, "utf8")).toMatch(/export function patchSchemaOf/);
  });

  it("🚨 doğrudan `.partial(` yalnız `patchSchemaOf` içinde", () => {
    const ihlal: string[] = [];
    for (const f of dosyalar) {
      const satirlar = readFileSync(f, "utf8").split("\n");
      satirlar.forEach((satir, i) => {
        if (!/\.partial\(/.test(satir) || /^\s*(\/\/|\*)/.test(satir)) return;
        const yardimci = f.endsWith(join("lib", "validators.ts")) && /schema\.extend\(.*\)\.partial\(\)/.test(satir);
        if (!yardimci) ihlal.push(`${f}:${i + 1}`);
      });
    }
    expect(ihlal, "kısmi şemayı `patchSchemaOf` ile türetin").toEqual([]);
  });

  it("🚨 enum anahtarlı `record(` yok (alt küme için `partialRecord`)", () => {
    const ihlal = dosyalar.filter((f) => /\.record\(\s*z\.(enum|nativeEnum|literal|union)\(/.test(readFileSync(f, "utf8")));
    expect(ihlal).toEqual([]);
  });
});
