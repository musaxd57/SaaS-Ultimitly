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

export function kbRetrievalMode(): KbRetrievalMode {
  const raw = (process.env.KB_RETRIEVAL_MODE ?? "").trim().toLowerCase();
  return OFF_SPELLINGS.has(raw) ? "legacy" : "hybrid";
}
