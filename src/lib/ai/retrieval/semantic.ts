// ---------------------------------------------------------------------------
// ANLAMSAL KAYNAK — EŞİK + AĞIRLIK (RAG).
//
// 09-23: ÜRETİM YOLU VAR ama ANAHTAR VARSAYILAN KAPALI (`KB_SEMANTIC_RETRIEVAL`,
// `embeddings/semantic-retrieval.ts`). Kapalıyken hiçbir yüzey anlamsal puan vermez
// ve gömme sağlayıcısına tek istek gitmez (davranışsal pin). Açma = E4 ölçümü +
// kurucu onayı. Vektörler bugün süreç belleğinde (kalıcı tablo E2, migration onayı).
//
// 🚨 `SemanticScorer` ARAYÜZÜ SİLİNDİ (inceleme turu, 09-11). İki gerekçe
// ölçüldü: (a) seçici onu HİÇ import etmiyordu — gerçek sözleşme
// `KbSelectInput.semantic: ReadonlyMap<"<id>#<chunkIndex>", 0..1>`, yani
// ÖNCEDEN hesaplanmış bir harita; (b) arayüzün şekli YANLIŞTI: `score(query,
// texts)` metni parametre alıyor, yani her sorguda tüm parça metinleri
// yeniden gönderilir, doküman vektörü ÖNBELLEKLENEMEZ ve dönen dizi sırayla
// eşleşir (parça KİMLİĞİ yok → kırılgan). Ölü ve yanlış bir sözleşmeyi
// "hazır" diye tutmak, gerçek uygulamayı yanlış yöne çeker.
//
// Doğru tasarım korunuyor: ağ çağrısı ÇAĞIRANDA olur, `select.ts` saf +
// SENKRON + DB'siz kalır, ve harita verilmezse davranış bugünküyle BİREBİR
// aynıdır — yani fail-open bir try/catch değil, YAPISAL bir özellik.
// ---------------------------------------------------------------------------

/**
 * 🚨 ANLAMSAL ADAY EŞİĞİ — embedding'den ÖNCE konmak ZORUNDAYDI
 * (inceleme turu, 09-11; bugün etkisi YOK çünkü üretimde `semantic` verilmiyor).
 *
 * Aday şartı (`hasEvidence`) n-gram için `NGRAM_QUALIFY_MIN = 0.3` eşiği
 * kullanıyor ama anlamsal için `> 0` yetiyordu. Kosinüs benzerliği
 * PRATİKTE HER PARÇADA > 0'dır (Türkçe bir KB'de tipik olarak 0,5–0,85), yani
 * gerçek embedding bağlandığı an:
 *   · HER parça `hasEvidence` olur → `no_lexical_hits` geri çekilmesi bir daha
 *     ASLA tetiklenmez (dürüstlük dalı sessizce ölür),
 *   · "yalnız-ipucu" ayrımı (`HINT_ONLY_BONUS`) ölür,
 *   · n-gram gürültüsü tüm parçalara birleşime girer.
 * Değer n-gram emsaliyle aynı mantıkta seçildi ve gerçek embedding ölçümünde
 * (ölçek harness'ı) yeniden kalibre EDİLECEK — bugünkü sayı bir ölçüm değil,
 * bir GÜVENLİK TABANIDIR.
 */
export const SEMANTIC_QUALIFY_MIN = 0.3;

/**
 * Birleşim ağırlıkları.
 * ⚠️ Eski yorum "RRF, ağırlık ↓" diyordu ama `semantic: 1` bm25 ile EŞİTTİ —
 * belge kodla çelişiyordu (inceleme turu). Değer korunuyor, yorum düzeltildi:
 * ağırlıklar harness ile ÖLÇÜLEREK ayarlanır ve semantic bugüne kadar hiç
 * ölçülmedi (üretimde verilmiyor).
 */
export const SOURCE_WEIGHTS = { bm25: 1, ngram: 0.7, semantic: 1 } as const;

/**
 * HAM KOSİNÜS EŞİĞİ — bir parçanın YALNIZ anlamsal benzerlikle aday olabilmesi için gereken
 * kosinüs (09-23, üretim yolu `embeddings/semantic-retrieval.ts`, anahtar varsayılan KAPALI).
 *
 * ⚠️ BU SAYI HENÜZ ÖLÇÜM DEĞİL: E4 (`tests/eval/embedding-e4.eval.test.ts`) 0,30–0,50 aralığını
 * tarar ve anahtar AÇILMADAN önce buraya ölçülen değer yazılır. text-embedding-3 ailesinde ilgisiz
 * kısa metinler tipik olarak 0,1–0,3, aynı konunun parafrazı 0,35–0,6 aralığında — orta nokta
 * başlangıç kabulüdür. Mutlak bir "alaka yüzdesi" DEĞİLDİR (kosinüs kalibre edilmiş olasılık
 * değildir; ajan ölçümü 09-23: sabit mutlak eşik kuralı sözcüksel puanda da ayırt edemiyordu).
 */
export const SEMANTIC_COSINE_THRESHOLD = 0.4;

/**
 * Ham kosinüsü seçicinin ölçeğine taşır: KESİN ARTAN ve `s ≥ t ⇔ s' ≥ SEMANTIC_QUALIFY_MIN`.
 * Böylece eşik seçicinin İÇİNE dokunmadan ayarlanır (aday şartı tek yerde, `hasEvidence`).
 * Negatif/sıfır kosinüs puan üretmez. E4 ölçüm düzeneği AYNI fonksiyonu kullanır (tek kaynak).
 */
export function thresholdTransform(s: number, t: number = SEMANTIC_COSINE_THRESHOLD): number {
  const m = SEMANTIC_QUALIFY_MIN;
  if (!Number.isFinite(s) || s <= 0) return 0;
  if (!(t > 0 && t < 1)) return 0;
  if (Math.abs(t - m) < 1e-12) return Math.min(1, s);
  return s < t ? (m * s) / t : Math.min(1, m + ((1 - m) * (s - t)) / (1 - t));
}
