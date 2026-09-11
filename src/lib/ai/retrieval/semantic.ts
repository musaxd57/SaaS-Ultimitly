// ---------------------------------------------------------------------------
// ANLAMSAL KAYNAK — EŞİK + AĞIRLIK (RAG).
//
// Bugün ÜRETİMDE ANLAMSAL RETRIEVAL YOK: hiçbir yüzey seçiciye `semantic`
// vermiyor (pin: `kb-retrieval-evidence-prompt.test.ts`). Gömme (embedding)
// ücretli servis + kalıcı vektör için migration ister.
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
