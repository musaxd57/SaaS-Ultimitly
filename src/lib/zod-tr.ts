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
// ⚠️ NEDEN GENEL HARİTA (zod 4: `z.config({ customError })`), NEDEN `zodFieldErrors` İÇİNDE ÇEVİRİ DEĞİL: şemalarımızın
// içindeki ÖZEL Türkçe mesajlar ("Mülk adı gerekli", "Şifre en az 8 karakter
// olmalıdır" …) korunmak ZORUNDA. `zodFieldErrors` içinde çeviri yapmak, özel
// mesajı varsayılandan ayırt etmeyi gerektirirdi ve tek yol zod'un default
// metnini string olarak taklit etmek olurdu — kütüphane sürümüne bağlı, kırılgan.
// Genel harita bu ayrımı KÜTÜPHANE seviyesinde yapıyor: şema-içi `message`
// DAİMA error map'i EZER (ampirik doğrulandı, `tests/unit/zod-tr.test.ts`).
//
// ⚠️ TEK YERDE KURULUR: **`validators.ts` modül seviyesinde** — orada, çünkü
// kullanıcıya görünen zod hatasını biçimleyen tek fonksiyon (`zodFieldErrors`)
// o modülde ve 19 rota onu kullanıyor; yani bir zod hatası bu modül yüklenmeden
// kullanıcıya ULAŞAMAZ. `instrumentation.ts`'in `register()`'ı UYGUN DEĞİLDİ —
// dev'de ve `INTERNAL_CRON_DISABLED=1` iken ERKEN DÖNÜYOR, kurulum atlanırdı.
// `z.config` global bir yan etkidir; İKİNCİ bir çağrı eklemeyin.
//
// ⚠️ BİLİNEN SINIR (denetim ajanı, 08-06): üç modül zod'u `validators`'ı import
// ETMEDEN kullanıyor — `api/admin/leads/[id]/route.ts`, `lib/quality-audit.ts`,
// `lib/email-identity.ts`. Bugün üçü de zod metnini kullanıcıya BASMIYOR (kendi
// Türkçe metinlerini ya da boolean döndürüyorlar), ama dördüncü bir modül
// eklenir ve `issue.message`'ı ekrana verirse İngilizce metin sessizce geri
// döner. O gün yapılacak şey: o modüle de `validators`'ı (ya da bu modülü)
// import ettirmek.
// ---------------------------------------------------------------------------

/** İnsan diline yakın alan adı: "en fazla 5 karakter" gibi cümleler için (zod 4: `origin`). */
function birim(origin: string): string {
  if (origin === "array" || origin === "set") return "öğe";
  if (origin === "string") return "karakter";
  return "";
}

const TIP_ADI: Record<string, string> = {
  string: "metin",
  number: "sayı",
  boolean: "doğru/yanlış değeri",
  array: "liste",
  object: "nesne",
  date: "tarih",
  // zod 4 `.int()` → `expected: "int"` (zod 3: "integer"); ikisi de ekrana İngilizce sözcük basıyordu ("int bekleniyor").
  int: "tam sayı",
  integer: "tam sayı",
  // zod 4 `z.record` / `z.partialRecord` → `expected: "record"` (zod 3: "object"; sarf profili alanı).
  record: "nesne",
};

/** zod 4 `.int()` güvenli tam sayı aralığını da denetler → "en fazla 9007199254740991" gibi anlamsız sınır ekrana basılmasın. */
const GUVENLI_SINIR = (n: unknown) => Math.abs(Number(n)) >= Number.MAX_SAFE_INTEGER;

/**
 * Zod'un VARSAYILAN hata metinlerini Türkçeleştirir. Şema içinde özel bir `message` / `error` verilmişse zod onu tercih eder — bu harita
 * hiç çağrılmaz (zod 4 önceliği: şema > ayrıştırma çağrısı > `z.config` > dil paketi).
 *
 * zod 4 geçişi (kurucu kararı 4.15, 10-28 — "açılıştan önce"): sorun kodları ve alanları değişti — `invalid_enum_value` + literal →
 * `invalid_value`; `invalid_string` → `invalid_format` (`format`); `invalid_date` → `invalid_type` (`expected: "date"`); büyüklük
 * kodlarında `type` → `origin`; eksik alan artık `received: "undefined"` değil `input === undefined`. Metinler birebir korundu.
 */
export const turkishZodErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case "invalid_type": {
      // Alan HİÇ gönderilmedi (ya da null) → "Required"ın karşılığı.
      if (issue.input === undefined || issue.input === null) return { message: "Bu alan gerekli." };
      if (issue.expected === "date") return { message: "Geçerli bir tarih girin." };
      // Bilinmeyen tip adı ekrana BASILMAZ (İngilizce sözcük olurdu: "bigint", "symbol" …) → genel metin.
      const beklenen = TIP_ADI[String(issue.expected)];
      return { message: beklenen ? `Geçersiz değer — ${beklenen} bekleniyor.` : "Geçersiz değer." };
    }
    case "too_big": {
      if (GUVENLI_SINIR(issue.maximum)) return { message: "Değer çok büyük." };
      const b = birim(String(issue.origin));
      if (b) return { message: `Çok uzun — en fazla ${issue.maximum} ${b} olabilir.` };
      return { message: `Değer çok büyük — en fazla ${issue.maximum} olabilir.` };
    }
    case "too_small": {
      // 🚨 "en az 0 karakter" saçmadır: boş bir zorunlu alan `min(1)` ile
      // gelir ve kullanıcıya "1 karakter" demek yardımcı değil, "gerekli" der.
      if (String(issue.origin) === "string" && Number(issue.minimum) <= 1) {
        return { message: "Bu alan boş bırakılamaz." };
      }
      if (GUVENLI_SINIR(issue.minimum)) return { message: "Değer çok küçük." };
      const b = birim(String(issue.origin));
      if (b) return { message: `Çok kısa — en az ${issue.minimum} ${b} olmalı.` };
      return { message: `Değer çok küçük — en az ${issue.minimum} olmalı.` };
    }
    case "invalid_value":
      // zod 4: enum / literal alanına `null` (ya da hiç) gelince sorun `invalid_type` DEĞİL `invalid_value` → zod 3'teki "Bu alan
      // gerekli." metni korunur (fark testi, 10-28).
      if (issue.input === undefined || issue.input === null) return { message: "Bu alan gerekli." };
      // ⚠️ Seçenekler LİSTELENMEZ: kullanıcı bu değeri arayüzden seçiyor, elle
      // yazmıyor — yani buraya düşmek bir istemci hatası ya da elle istek
      // demektir. Geçerli değerleri saymak hem gürültü hem gereksiz bilgi.
      return { message: "Geçersiz seçim." };
    case "invalid_format":
      if (issue.format === "email") return { message: "Geçerli bir e-posta adresi girin." };
      if (issue.format === "url") return { message: "Geçerli bir bağlantı girin." };
      if (issue.format === "uuid" || issue.format === "guid") return { message: "Geçersiz kimlik." };
      return { message: "Geçersiz biçim." };
    case "not_multiple_of":
      return { message: `Değer ${String(issue.divisor)} katı olmalı.` };
    case "unrecognized_keys":
      return { message: "Tanınmayan alan gönderildi." };
    default:
      // ⚠️ Bilinmeyen kod: zod'un kendi metnine DÜŞME (İngilizce olurdu).
      return { message: "Geçersiz değer." };
  }
};

/** Kur (idempotent). `validators.ts` modül seviyesinde bir kez çağırır. */
export function installTurkishZodErrors(): void {
  z.config({ customError: turkishZodErrorMap });
}
