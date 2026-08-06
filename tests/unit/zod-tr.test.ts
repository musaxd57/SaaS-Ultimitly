import { describe, it, expect } from "vitest";
import { z } from "zod";
// ⚠️ SIRA ÖNEMLİ: `validators` import edilir edilmez `installTurkishZodErrors`
// modül seviyesinde koşar. Bu testin tamamı o kurulumun GERÇEKTEN olduğunu
// varsayar; ayrı bir `install` çağrısı YOK — çünkü üretimde de yok.
import { zodFieldErrors, registerSchema, kbSchema } from "@/lib/validators";

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
function mesaj(schema: z.ZodTypeAny, value: unknown): string {
  const r = schema.safeParse(value);
  expect(r.success, "şema beklenmedik şekilde GEÇTİ — test bir şey ölçmüyor").toBe(false);
  return zodFieldErrors((r as { error: z.ZodError }).error)._ ?? "";
}

describe("zod varsayılan hataları Türkçe", () => {
  it("hiçbir varsayılan metin İngilizce kalmadı", () => {
    // Her biri zod'un ayrı bir varsayılan şablonu. İngilizce kalan olursa
    // burada yakalanır — tek tek metin eşleştirmek yerine YASAKLI kelimeler
    // aranıyor: metni iyileştirmek testi kırmasın, DİL değişimi kırsın.
    const YASAK = /String must|Array must|Number must|Invalid enum|Expected |Required|character\(s\)|element\(s\)/;
    const vakalar: [string, z.ZodTypeAny, unknown][] = [
      ["metin çok uzun", z.string().max(5), "abcdefgh"],
      ["metin çok kısa", z.string().min(3), "a"],
      ["zorunlu alan boş", z.string().min(1), ""],
      ["geçersiz seçim", z.enum(["airbnb", "booking"]), "x"],
      ["yanlış tip", z.string(), 123],
      ["dizi çok uzun", z.array(z.string()).max(2), ["a", "b", "c"]],
      ["sayı çok küçük", z.number().min(5), 1],
      ["sayı çok büyük", z.number().max(5), 9],
      ["geçersiz e-posta", z.string().email(), "abc"],
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

  it("özel mesajlı bir kural varsayılana DÜŞMEZ (kb içerik sınırı)", () => {
    const r = kbSchema.safeParse({ propertyId: "p1", category: "wifi", title: "", content: "x" });
    expect(r.success).toBe(false);
    const f = zodFieldErrors((r as { error: z.ZodError }).error);
    // Şemadaki özel metin: "Başlık gerekli"
    expect(f.title).toBe("Başlık gerekli");
  });
});
