import { z } from "zod";

// ---------------------------------------------------------------------------
// ZOD VARSAYILAN HATA METİNLERİ — TÜRKÇE (denetim, 08-06)
//
// 🚨 KAPATILAN AÇIK: `zodFieldErrors` (validators.ts) `issue.message`'ı HAM
// döndürüyor. Şemalarımızın çoğunda özel Türkçe mesaj var, AMA özel mesajı
// OLMAYAN her kural zod'un İNGİLİZCE varsayılanını basıyordu ve o metin
// doğrudan müşterinin ekranına çıkıyordu. Ölçüldü (zod 3.25):
//
//   "String must contain at most 5 character(s)"
//   "Invalid enum value. Expected 'airbnb' | 'booking', received 'x'"
//   "Required" · "Expected string, received number"
//   "Array must contain at most 2 element(s)"
//
// Ulaşılabilir yollar: bilgi tabanına 20.000 karakterden uzun metin yapıştırmak,
// mülk adresi >300, notlar >5000, görev başlığı >300, checklist >60 madde,
// bozuk kanal/durum/öncelik değeri. İstemci formlarında `maxLength` YOK
// (grep: 0) → sınırı ancak sunucu yakalıyor, yani bu metinler GERÇEKTEN çıkıyor.
//
// ⚠️ NEDEN `errorMap`, NEDEN `zodFieldErrors` İÇİNDE ÇEVİRİ DEĞİL: şemalarımızın
// içindeki ÖZEL Türkçe mesajlar ("Mülk adı gerekli", "Şifre en az 8 karakter
// olmalıdır" …) korunmak ZORUNDA. `zodFieldErrors` içinde çeviri yapmak, özel
// mesajı varsayılandan ayırt etmeyi gerektirirdi ve tek yol zod'un default
// metnini string olarak taklit etmek olurdu — kütüphane sürümüne bağlı, kırılgan.
// `errorMap` bu ayrımı KÜTÜPHANE seviyesinde yapıyor: şema-içi `message`
// DAİMA error map'i EZER (ampirik doğrulandı, `tests/unit/zod-tr.test.ts`).
//
// ⚠️ TEK YERDE KURULUR: **`validators.ts` modül seviyesinde** — orada, çünkü
// kullanıcıya görünen zod hatasını biçimleyen tek fonksiyon (`zodFieldErrors`)
// o modülde ve 19 rota onu kullanıyor; yani bir zod hatası bu modül yüklenmeden
// kullanıcıya ULAŞAMAZ. `instrumentation.ts`'in `register()`'ı UYGUN DEĞİLDİ —
// dev'de ve `INTERNAL_CRON_DISABLED=1` iken ERKEN DÖNÜYOR, kurulum atlanırdı.
// `setErrorMap` global bir yan etkidir; İKİNCİ bir çağrı eklemeyin.
//
// ⚠️ BİLİNEN SINIR (denetim ajanı, 08-06): üç modül zod'u `validators`'ı import
// ETMEDEN kullanıyor — `api/admin/leads/[id]/route.ts`, `lib/quality-audit.ts`,
// `lib/email-identity.ts`. Bugün üçü de zod metnini kullanıcıya BASMIYOR (kendi
// Türkçe metinlerini ya da boolean döndürüyorlar), ama dördüncü bir modül
// eklenir ve `issue.message`'ı ekrana verirse İngilizce metin sessizce geri
// döner. O gün yapılacak şey: o modüle de `validators`'ı (ya da bu modülü)
// import ettirmek.
// ---------------------------------------------------------------------------

/** İnsan diline yakın alan adı: "en fazla 5 karakter" gibi cümleler için. */
function birim(type: string): string {
  if (type === "array") return "öğe";
  if (type === "string") return "karakter";
  return "";
}

const TIP_ADI: Record<string, string> = {
  string: "metin",
  number: "sayı",
  boolean: "doğru/yanlış değeri",
  array: "liste",
  object: "nesne",
  date: "tarih",
};

/**
 * Zod'un VARSAYILAN hata metinlerini Türkçeleştirir. Şema içinde özel bir
 * `message` verilmişse zod onu tercih eder — bu harita hiç çağrılmaz.
 */
export const turkishZodErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      // `received: "undefined"` = alan HİÇ gönderilmedi → "Required".
      if (issue.received === "undefined" || issue.received === "null") {
        return { message: "Bu alan gerekli." };
      }
      const beklenen = TIP_ADI[String(issue.expected)] ?? String(issue.expected);
      return { message: `Geçersiz değer — ${beklenen} bekleniyor.` };
    }
    case z.ZodIssueCode.too_big: {
      const b = birim(String(issue.type));
      if (b) return { message: `Çok uzun — en fazla ${issue.maximum} ${b} olabilir.` };
      return { message: `Değer çok büyük — en fazla ${issue.maximum} olabilir.` };
    }
    case z.ZodIssueCode.too_small: {
      // 🚨 "en az 0 karakter" saçmadır: boş bir zorunlu alan `min(1)` ile
      // gelir ve kullanıcıya "1 karakter" demek yardımcı değil, "gerekli" der.
      if (String(issue.type) === "string" && Number(issue.minimum) <= 1) {
        return { message: "Bu alan boş bırakılamaz." };
      }
      const b = birim(String(issue.type));
      if (b) return { message: `Çok kısa — en az ${issue.minimum} ${b} olmalı.` };
      return { message: `Değer çok küçük — en az ${issue.minimum} olmalı.` };
    }
    case z.ZodIssueCode.invalid_enum_value:
      // ⚠️ Seçenekler LİSTELENMEZ: kullanıcı bu değeri arayüzden seçiyor, elle
      // yazmıyor — yani buraya düşmek bir istemci hatası ya da elle istek
      // demektir. Geçerli değerleri saymak hem gürültü hem gereksiz bilgi.
      return { message: "Geçersiz seçim." };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === "email") return { message: "Geçerli bir e-posta adresi girin." };
      if (issue.validation === "url") return { message: "Geçerli bir bağlantı girin." };
      if (issue.validation === "uuid") return { message: "Geçersiz kimlik." };
      return { message: "Geçersiz biçim." };
    case z.ZodIssueCode.invalid_date:
      return { message: "Geçerli bir tarih girin." };
    case z.ZodIssueCode.not_multiple_of:
      return { message: `Değer ${issue.multipleOf} katı olmalı.` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: "Tanınmayan alan gönderildi." };
    default:
      // ⚠️ Bilinmeyen kod: zod'un kendi metnine DÜŞME (İngilizce olurdu).
      // `ctx.defaultError` de İngilizce — bilinçli olarak KULLANILMIYOR.
      return { message: ctx.defaultError === "Required" ? "Bu alan gerekli." : "Geçersiz değer." };
  }
};

/** Kur (idempotent). `instrumentation.ts` boot'ta bir kez çağırır. */
export function installTurkishZodErrors(): void {
  z.setErrorMap(turkishZodErrorMap);
}
