/* ---------------------------------------------------------------------------
 * BAĞLAMSAL PARÇA METNİ — "bu parça neyin parçası?" (kurucu iş emri 09-12).
 *
 * 🚨 ÇÖZDÜĞÜ ÖLÇÜLMÜŞ BOŞLUK: `KbChunk.text` = `content.slice(...)`. Sözcüksel
 * tarafta bu sorun değil — rerank başlık köklerini AYRI alandan okuyup
 * ödüllendiriyor (`rerank.ts`: başlık 0.15 + tam örtüşme 0.15). Ama EMBEDDING
 * yalnız verilen METNİ görür: uzun bir ev rehberinin ORTA parçası
 * ("…gece 23:00'ten sonra sessizlik…") başlığı olmadan gömülürse "sessiz saat"
 * sorgusuna hak ettiğinden zayıf eşleşir. Bağlamı parçanın KENDİSİNE taşımak
 * bunu kapatır.
 *
 * 🚨 EN KRİTİK AYRIM — `text` DEĞİŞTİRİLMEZ: reponun "parça = `content.slice`,
 * metin DEĞİŞMEZ" pini İSTEME giden metinle ilgilidir (host'un kendi sözleri
 * misafire/modele aynen görünmeli). Burada üretilen metin YALNIZ VEKTÖRE gider.
 * Ne gösterildiği ile ne gömüldüğü AYRI şeylerdir ve öyle kalmalıdır.
 *
 * ⚠️ ÜRETİMDE ÇAĞIRANI YOK. E3'te (gömme yazma yolu) bağlanır; o da E2 vektör
 * tablosunun migration onayına bağlı (`docs/ONAY-E2-…`). Bugün davranış
 * DEĞİŞMEZ ve ücretli servise tek istek gitmez.
 * ------------------------------------------------------------------------- */

import type { KbChunk } from "@/lib/ai/retrieval/chunker";

/**
 * Bağlam ekinin tavanı. Başlık host tarafından yazılır ve uzunluğu sınırsız
 * sayılmamalı: bağlam PARÇAYI BASTIRMAMALI, yalnız yerini işaret etmeli.
 */
const CONTEXT_MAX_CHARS = 120;

/** Toplam tavan — gömme sağlayıcısının girdi sınırının çok altında, ölçülü. */
const TOTAL_MAX_CHARS = 1_200;

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Bir parçanın GÖMÜLECEK metni: `kategori · başlık` bağlamı + parçanın kendisi.
 *
 * 🚨 DETERMİNİSTİK olmak ZORUNDA: gömme önbelleğinin anahtarı bu metnin
 * özetidir (`provider.ts`). Aynı parça iki kez farklı metin üretirse önbellek
 * hiç isabet etmez ve her seferinde yeniden ödenir.
 *
 * 🚨 BAŞLIK İKİ KEZ YAZILMAZ: ilk parça çoğu zaman başlığı metnin içinde
 * tekrarlar ("Otopark" başlığı + "Otopark bina altındadır."). İki kez gömmek o
 * terimi yapay olarak ağırlaştırır ve vektörü çarpıtır (test-pinli).
 */
export function embeddingTextFor(chunk: KbChunk): string {
  const body = collapse(chunk.text);
  const title = collapse(chunk.title).slice(0, CONTEXT_MAX_CHARS);
  const category = collapse(chunk.category);

  const parts: string[] = [];
  if (category) parts.push(category);
  // Başlık gövdenin başında zaten geçiyorsa tekrar etme.
  if (title && !body.toLocaleLowerCase("tr").startsWith(title.toLocaleLowerCase("tr"))) {
    parts.push(title);
  }
  const context = parts.join(" · ");
  const text = context ? `${context}\n${body}` : body;
  return text.slice(0, TOTAL_MAX_CHARS);
}
