// ---------------------------------------------------------------------------
// HİBRİT RETRIEVAL BAYRAĞI — TEK OKUMA NOKTASI (RAG dilim 1, 09-09).
//
// 🚨 YÖN TERSİNE ÇEVRİLDİ (kurucu talimatı 2026-09-11: "RAG EKLE").
// Hibrit artık **VARSAYILAN**. Bayrak bir AÇMA düğmesi değil, bir **ACİL
// DURDURMA** düğmesidir: `KB_RETRIEVAL_MODE=legacy` (ya da off/0/false/no/
// disabled) eski davranışa döner, başka her değer — boş, bilinmeyen, yanlış
// yazılmış — hibrit kalır.
//
// Neden bu yön güvenli (ölçüldü: `docs/olcum/hibrit-yan-etki-2026-09-11.md`):
//   • Gerileme taraması 19.583 soru×boyut çiftinde **%0,11** ve hepsi AYNI
//     tartışmalı soru; hibritin gereken cümleyi düşürüp yerine eşdeğer bir şey
//     KOYMADIĞI tek bir vaka bulunamadı.
//   • Blok boyutu bilgi sorularında legacy'nin %9–%32'si (ürün tavanında 4.508
//     → ~493 karakter).
//   • Hibritin legacy'den ÇOK gönderdiği tek yer olan geri çekilme dalı
//     `cappedForFallback` ile legacy tavanına indirildi (aynı ölçüm turu).
//   • Ek gecikme ürün tavanında soğuk 15 ms / sıcak 1,8 ms — OpenAI çağrısının
//     yanında gürültü.
//
// 🚨 KİLL SWITCH KOLAY VURULMALI: bir olay anında operatörün "kapattım" sanıp
// kapatamaması, bilinmeyen bir değerin yanlışlıkla legacy'ye düşmesinden çok
// daha pahalıdır. O yüzden yaygın "kapalı" yazımlarının hepsi kabul edilir
// (`toLowerCase` yerel-bağımsızdır, Türkçe "I" tuzağı yok — hepsi ASCII).
//
// Çağrı başına okunur (`vi.stubEnv` uyumu, depo idiyomu: `durableOutboxEnabled`).
// Bu dosya yaprak modüldür (import yok) — kb-fetch ve select döngüsüz paylaşır.
// ---------------------------------------------------------------------------

export type KbRetrievalMode = "legacy" | "hybrid";

/** Eski davranışa dönmek için kabul edilen yazımlar (hepsi ASCII, küçük harfe indirilir). */
const OFF_SPELLINGS: ReadonlySet<string> = new Set([
  "legacy",
  "off",
  "0",
  "false",
  "no",
  "disabled",
]);

/** Hibriti AÇIKÇA isteyen yazımlar. Tanınmayan değeri AYIRT ETMEK için gerekir. */
const ON_SPELLINGS: ReadonlySet<string> = new Set([
  "hybrid",
  "on",
  "1",
  "true",
  "yes",
  "enabled",
]);

export function kbRetrievalMode(): KbRetrievalMode {
  const raw = (process.env.KB_RETRIEVAL_MODE ?? "").trim().toLowerCase();
  return OFF_SPELLINGS.has(raw) ? "legacy" : "hybrid";
}

/**
 * Teşhis görünümü: etkin mod + değerin TANINIP TANINMADIĞI.
 *
 * 🚨 DIŞ DENETİM 09-18, BULGU 6 — İDDİA DOĞRU, ÖNERİ REDDEDİLDİ (ölçümle).
 * İddia: `KB_RETRIEVAL_MODE=legcy` yazan operatör kapattığını sanır, sistem
 * hibrit kalır. DOĞRU. Önerilen çözüm ("tanınmayan değer legacy'ye düşsün")
 * ÖLÇÜLDÜ ve REDDEDİLDİ: 20 gerçekçi "RAG açık olsun" değerinden (`true`, `1`,
 * `on`, `enabled`, `acik`, `hibrit`, `rag`…) **12–17'si sessizce legacy'ye
 * düşerdi**, ve sessiz legacy'nin ölçülmüş bedeli host'un yazdığı bilginin
 * YARISININ isteme hiç girmemesidir (inPrompt legacy %51 ↔ hibrit %99–100,
 * `docs/olcum/hibrit-yan-etki-2026-09-11.md`). Yani öneri, kapatmak isteyenin
 * hatasını düzeltirken AÇIK KALSIN diyenin hatasını sessiz bir ürün
 * gerilemesine çeviriyor — daha pahalı hata sınıfı.
 *
 * 🚨 GERÇEK BOŞLUK YÖN DEĞİL, GÖRÜNÜRLÜKTÜ: bugün ne `verify-env` bu bayrağı
 * doğruluyor, ne boot etkin modu yazıyor, ne de `.env.example`'da geçiyor —
 * yani operatörün "kapandı mı" sorusuna bakabileceği TEK yer bir mesaj
 * aktıktan sonraki `RiskEvent.kbEvidenceJson`du. Üçü de kapatıldı; yazım
 * hatası artık boot'ta GÜRÜLTÜLÜ olarak görünür, davranış DEĞİŞMEDEN.
 */
export function kbRetrievalModeInfo(): { mode: KbRetrievalMode; raw: string; recognized: boolean } {
  const raw = (process.env.KB_RETRIEVAL_MODE ?? "").trim().toLowerCase();
  return {
    mode: OFF_SPELLINGS.has(raw) ? "legacy" : "hybrid",
    raw,
    // Boş/ayarsız = varsayılanı KASITLI kabul etmek; yazım hatası değildir.
    recognized: raw === "" || OFF_SPELLINGS.has(raw) || ON_SPELLINGS.has(raw),
  };
}

/**
 * ANLAMSAL (EMBEDDING) ADAY KAYNAĞI ANAHTARI — `KB_SEMANTIC_RETRIEVAL` (09-23).
 *
 * `KB_RETRIEVAL_MODE`un TERSİ yönde: VARSAYILAN KAPALI, yalnız açık bir "aç" yazımı açar. Sebep
 * maliyet/sağlayıcı değil (veri zaten aynı sağlayıcıya gidiyor) ÖLÇÜM: eşik ve birleşim E4 ile
 * kalibre edilmeden açılırsa sözcüksel seçimi BOZABİLİR. Tanınmayan değer KAPALI kalır ve boot'ta
 * gürültülü yazılır. `KB_RETRIEVAL_MODE=legacy` (acil durdurma) bunu da kapatır — seçici legacy'de
 * hiç sıralama yapmaz, anlamsal hazırlık da ağa çıkmaz.
 */
const SEMANTIC_ON = new Set(["1", "on", "true", "yes", "enabled"]);
const SEMANTIC_OFF = new Set(["0", "off", "false", "no", "disabled"]);

export function semanticRetrievalInfo(): { enabled: boolean; raw: string; recognized: boolean } {
  const raw = (process.env.KB_SEMANTIC_RETRIEVAL ?? "").trim().toLowerCase();
  return { enabled: SEMANTIC_ON.has(raw), raw, recognized: raw === "" || SEMANTIC_ON.has(raw) || SEMANTIC_OFF.has(raw) };
}
