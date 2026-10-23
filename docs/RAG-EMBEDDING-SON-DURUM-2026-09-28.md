# RAG ve gömme: rakiplerde ve 2025–2026 uygulamasında olup bizde olmayanlar (28 Eylül 2026)

> Web araştırması, ücretli çağrı yok. Sayfalar ağ politikası yüzünden açılamadı; iddialar arama özetinden, karardan önce elle
> açılmalı. Etiket: **k** satıcı · **m** makale/ön baskı · **3t** üçüncü taraf · **h** haber. Hiçbiri karar değil; müşteriye giden
> cevaba dokunan adım önce/sonra örneğiyle kurucuya sorulur.

## Başlangıç noktası

- Plan tavanı mülk başına 60 kalem; bu boyutta large gömme + geniş blok (hazır, kapalı) dev setinde TR / diğer / iki soru %100 / 99 / 98. 276 kalemde
  hazır bayraklarla 437/441 · 438/441 · 116/120 (`TASARIM-2026-09-26-rag-300-olcek.md` §4c, §6c). §4d: kalan 9 kaybın 4'ü sıralayıcı
  penceresi dışında, 4'ünü sıralayıcı işaretlemedi. Yeni getirme tekniğinin payı bu yüzden küçük; dev seti görüldü, kabul holdout'la.
- Küçük bilgi tabanında asıl kayıp bilginin hiç olmaması. Rakiplerin hiçbiri getirme mimarisini ya da Türkçe ölçümünü yayımlamıyor
  (bu turda da bulunamadı); farkları bilgi tabanını besleme tarafında.

## Sıra (beklenen değer / efor)

| # | Teknik | Hedeflediği kayıp | Yeni alt işleyen | Tasarımda |
|---|---|---|---|---|
| 1 | Konuşmada "eksik bilgi → tek tıkla ekle" | bilgi yok | yok | kısmen |
| 2 | Kalem başına sentetik soru | pencere dışı, yabancı dil | yok | yok |
| 3 | Barındırılan çapraz-kodlayıcı | işaretlenmeyen cevap, gecikme | var | yalnız not |
| 4 | Yapılandırılmış mülk profili alanları | sık konu, çelişki | yok | var |
| 5 | Gömme modeli değişimi | pencere dışı | var | kısmen |
| 6 | HyDE · ColBERT · bağlamsal gömme · yerel model | — | değişir | kısmen |

### 1 · Konuşmada eksik bilgi → tek tıkla ekleme
- **Ne:** cevap bulunamayınca (`absent`) o konuşmada "bilgi tabanına ekle"; ev sahibi elle cevap yazarsa metin taslak kalem olarak önerilir, ev sahibi onaylar.
- **Rakipler:** Hostaway eksik veriyi adıyla söyleyip eklemeyi öneriyor [k](https://changelog.hostaway.com/enhance-your-ai-replies-responses-with-the-new-knowledge-base-331246), ev sahibi mesajlarından olgu çıkarıyor [k](https://support.hostaway.com/hc/en-us/articles/37265258021787-What-is-Hostaway-AI); Jurny mesajı tek tıkla SSS'ye çeviriyor [k](https://blog.jurny.com/smarter-messaging-scalable-knowledge-how-nia-reinvented-templates-and-faqs); Conduit ilanları denetleyip eksikleri gösteriyor [k](https://www.conduit.ai/blog/elevate-your-short-term-rentals-with-host-ais-knowledge-tuning); Enso boşluğu onayla/düzenle/reddet kartıyla sunuyor [k](https://ensoconnect.com/resources/reasoning-ai-for-guest-messaging-in-vacation-rentals); Operto bilgi tamlığını ölçüyor [h](https://www.hotelmanagement.net/tech/operto-launches-coordinated-ai-platform-independent-hotels).
- **Bizde:** `grounding.ts` `absent` üretiyor; gelen kutusunda yalnız "Eksik bilgi: …" yazısı, eylem yok. A3 listesini kurucu kaldırdı → liste değil, bağlamda tek satır. Gönderim anında aynı konuşmada yakalamak Bacak B'nin eşleştirme hatasını büyük ölçüde önler; kayıt mevcut `POST /api/kb` süzgeçlerinden geçer.
- **Maliyet:** model çağrısı, yeni alt işleyen yok; muhtemelen migration'sız.
- **Ölçüm (ücretsiz):** RiskEvent'ten mülk/konu başına haftalık `absent` ve ardından elle cevap oranı; yayından sonra kabul oranı.
- **Tasarımda:** kısmen (RAKİP (c)1/(c)3, Bacak B). Yeni olan gönderim anında yakalama.

### 2 · Kalem başına sentetik soru (HyPE / doc2query)
- **Ne:** kalem kaydedilirken 5–8 misafir tarzı soru (TR + altı dil) üretip ayrı eşleşme kaynağı yapmak; sorular misafire ve cevap modeline gitmez.
- **Kanıt:** HyPE ön baskısı bazı setlerde +42 puan kesinlik, +45 puan geri çağırma bildiriyor, Türkçe ölçüm yok [m](https://arxiv.org/abs/2607.29402). Karşı kanıt: 24 getiricide genişletme zayıf modele yarıyor, güçlü modele çoğu zaman zarar veriyor [m](https://aclanthology.org/2024.findings-eacl.134/).
- **Beklenen:** yabancı dildeki soruyu Türkçe kaleme bağlamak, gömme soğukken sözcüksel yolu güçlendirmek; dev setinde pay küçük.
- **Maliyet:** kalem başına bir OpenAI çağrısı, sorgu anında gecikme yok; üretimde saklama → migration.
- **Ölçüm:** dev setinin 276 kalemi için bir kez üret (<1 $), RAG lab'a ayrı kaynak; `live` ve `FINAL` eşleştirilmiş; yanıtsız grupta blok büyümesi izlenir.

### 3 · Barındırılan çapraz-kodlayıcı sıralayıcı
- **Ne:** soru–kalem çiftini puanlayan servis; gpt-5.1 listesinin yerine ya da yanına.
- **Seçenekler:** Cohere Rerank 4 Fast/Pro (Ara 2025, 100+ dil) [k](https://cohere.com/blog/rerank-4); Voyage rerank-2.5 (Ağu 2025, çok dilli, talimat alır) [k](https://blog.voyageai.com/2025/08/11/rerank-2-5/); zerank-2 (isteklerin %97,3'ü <500 ms) [k](https://zeroentropy.dev/articles/latency-performance-assessment-of-zerank-2/); Vertex Ranking (1.000 sorgu 1 $) [k](https://cloud.google.com/blog/products/ai-machine-learning/launching-our-new-state-of-the-art-vertex-ai-ranking-api).
- **Kanıt:** bağımsız ölçümde (İngilizce setler) ortalama gecikme Voyage 2.5 / Cohere 3.5 ~600 ms, zerank-2 ~265 ms [3t](https://agentset.ai/rerankers). Türkçe ölçüm yok; Cohere 3.5'in öne çıkardığı 10 dilde Türkçe yok [k](https://cohere.com/blog/rerank-3pt5).
- **Bizde:** p50 1,0 / p95 1,7 sn, ~1.000 soruda 9 hata ya da 2,5 sn aşımı, soru başına ~0,5 sent; barındırılanlar arama başına ~0,2 sent ya da altı (arama özeti) [k](https://cohere.com/pricing) [k](https://docs.voyageai.com/docs/pricing). Kazanç: gecikme, maliyet, OpenAI kotasından bağımsızlık (09-27 kredi olayı). Risk: "cevaplıyor/ilgili" ayrımı kaybolur.
- **KVKK:** yeni alt işleyen → sözleşme, alt işleyen listesi, standart sözleşme + 5 iş günü içinde Kurum'a bildirim [k](https://www.kvkk.gov.tr/Icerik/2053/Yurtdisina-Aktarim). Sentetik setle ölçüm kişisel veri taşımaz. Alt işleyensiz tek yol OpenAI vektör deposundaki `ranker`/hibrit ayar [k](https://developers.openai.com/api/docs/guides/retrieval): bilgi tabanını OpenAI'de saklamayı ister, dil/gecikme verisi yok.
- **Ölçüm:** RAG lab'a `rrm:` bağdaştırıcısı; ~1.700 çağrı ≈ Cohere 3–4 $, Voyage ücretsiz kotada; gpt-5.1 tarafı önbellekte.
- **Tasarımda:** yalnız not (09-23); yerel çapraz-kodlayıcının olay döngüsü sorunu burada yok.

### 4 · Yapılandırılmış mülk profili alanları — tasarımda var (RAKİP (c)4, DEĞERLENDİRME 09-08)
- **Ne:** Wi-Fi, otopark, çöp, giriş yöntemi gibi sık konular serbest metin yerine alan.
- **Yeni kanıt:** Breezeway Property Profile [k](https://www.breezeway.io/concierge), Guesty özel alanlar [k](https://www.guesty.com/features/ai-for-short-term-rentals/); Airbnb'nin ICA çalışması bilgiyi niyet/bağlam/eylem biçimine sokmanın doğruluğu artırdığını bildiriyor [m](https://aclanthology.org/2025.coling-industry.42/).
- **Beklenen:** sık konuda arama yerine okuma, boş alanın görünmesi, tek değerle çelişkinin önlenmesi, alan başına sır işareti. Efor yüksek (migration + arayüz).
- **Ölçüm (ücretsiz):** anlama katmanı konu etiketlerinden (yalnız sayı) soruların yüzde kaçı ilk 15 konuya düşüyor.

### 5 · Gömme modeli değişimi
- **Ne:** text-embedding-3-large yerine başka bir çok dilli gömme modeli.
- **Kanıt:** MMTEB çok dilli: Gemini Embedding 68,32 [m](https://arxiv.org/abs/2503.07891), Qwen3-Embedding-8B 70,58 [k](https://qwenlm.github.io/blog/qwen3-embedding/), Gemini Embedding 2 69,9 (arama özeti) [k](https://deepmind.google/models/gemini/embedding/); Cohere embed-v4 [k](https://docs.cohere.com/changelog/embed-multimodal-v4), Voyage-4 [k](https://blog.voyageai.com/2026/01/15/voyage-4/). OpenAI'nin en yenisi hâlâ text-embedding-3; MIRACL setinde Türkçe yok [k](https://openai.com/index/new-embedding-models-and-api-updates/). Türkçe kanıt zayıf: MMTEB'de tek dilli Türkçe getirme görevi bir tane [m](https://arxiv.org/abs/2502.13595); Türkçe RAG çalışmasında (Ağu 2026, 9.000 cevap; model listesi doğrulanamadı) en iyi üç model istatistiksel olarak ayrılamadı, Türkçeye özel model fark vermedi [m](https://arxiv.org/abs/2608.26192); sıralamalar veri seti seçimine duyarlı [m](https://arxiv.org/abs/2605.31142).
- **Bizde:** `EMBEDDING_DIMENSIONS = 1536`; Gemini [k](https://ai.google.dev/gemini-api/docs/embeddings) ve Cohere v4 uyar, Voyage-4 ve BGE-M3 kod değişikliği ister. Sağlayıcı katmanı yalnız OpenAI; eşik yeniden ölçülür.
- **Ölçüm:** dev seti + ~1.000 soru <100 bin token (sentler); RAG lab'da `e3l` yerine yeni vektörler + eşik taraması; OpenAI kotası harcanmaz.

### 6 · Düşük öncelik / yeniden önerilmeyenler
- **Sorgu anında HyDE:** tasarımda (#7); anlama katmanı zaten bağımsız TR + özgün dil sorgusu yazıyor; HyDE çok dilli dört görevde ince ayarlı getiriciyi geçemedi [m](https://arxiv.org/abs/2212.10496).
- **ColBERT:** TurkColBERT çeviri Türkçe setlerde yoğun modelleri geçti [m](https://arxiv.org/abs/2511.16528); barındırılan Jina ColBERT v2 [k](https://jina.ai/models/jina-colbert-v2/), BGE-M3 [k](https://deepinfra.com/BAAI/bge-m3-multi). Kısa kalemlerde kazanç beklentisi düşük.
- **Bağlamsal parça gömmesi** [k](https://blog.voyageai.com/2025/07/23/voyage-context-3/): yalnız uzun rehberde; başlık öneki bizde var.
- **Yerel Türkçe model** [m](https://arxiv.org/abs/2511.07595): alt işleyen yok ama çapraz-kodlayıcıdaki altyapı sorununu taşır; ↑Türkçe RAG çalışması avantaj görmedi.
