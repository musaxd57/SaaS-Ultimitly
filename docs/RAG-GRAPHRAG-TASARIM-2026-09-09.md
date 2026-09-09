# RAG / GraphRAG — somut tasarım + yerel dilimler 1–3 (2026-09-09)

> Kurucu/Codex talebi: mevcut kaynak/onay/kanıt altyapısını kullanarak retrieval tasarımı + **bağımsız ve mevcut
> yetki içindeki dilimlerin yerelde uygulanması**. Migration, yeni ücretli servis ve güvenlik/gönderim politikası
> değişiklikleri **ayrı onaya** (§5, somut kapsamla). Canlıya alma YOK: bayrak `KB_RETRIEVAL_MODE` varsayılan KAPALI.
> Gerçek model eval'ini kurucu koşar. **P5 (kanıtsız iddia için kod kapısı) AÇIK kalır — RAG bu açığı kapatmaz (§7).**
> Dilim 2 (Codex turu 2): arama yöntemlerinin açıklaması (§2.1) · gerçek retrieval yolunda 30/100/300 ölçek ölçümü (§3b)
> · kelime+n-gram(+gömme sözleşmesi) aday birleşimi · yeniden sıralama · sürüm/tazelik/çelişki · host graf katmanı (§6).
> **Dilim 3 (Codex turu 3, 09-09): dört bulgu düzeltildi (§2.3) · anlamsal sözleşmenin dürüst tanımı (§2.2 — ANLAMSAL
> RETRIEVAL YOK) · n-gram ayrı ölçüm + varsayılan gerekçesi (§3b) · güvenlik filtreleri yeni yolda doğrulandı (§3c) ·
> eşleştirilmiş legacy/hibrit gerçek-model eval hazırlığı (§3d, kurucu koşar) · sentetik GraphRAG kıyas verisi (§6.3).**
> Sentetik retrieval sonuçları (§3/3b: kaynak bloğa girdi mi) ile gerçek cevap kalitesi (§3d: cevap doğru mu) AYRI tutulur.

---

## 0. Kısa hüküm

| Soru | Cevap |
|---|---|
| Bugün neden retrieval yok? | Bilgi tabanı mülk-kapsamlı ve küçük; `kb-fetch` en yeni 30 kalemi çekiyor, `packKnowledgeBase` 24k karakterde kesiyor. Küçük KB'de bu doğru. Sorun **uzun rehber metni** ve **30+ kalem**de: ilgili cümle ya tavandan düşüyor ya 7k karakterin ortasında kayboluyor. **Ölçüldü (§3b):** 100 kalemde legacy doğru kaynağı soruların yalnız %51'inde bloğa alıyor; hibrit %99. |
| Ne kodlandı? | **LLM'siz, deterministik hibrit seçici** (`src/lib/ai/retrieval/`): bağlam koruyan parçalama + BM25 (kök + alan sözlüğü + yazım toleransı) + karakter n-gram ikinci kaynağı (yalnız Türkçe sorguda, ölçümle) + büyüklük koruyan birleşim (CombSUM; RRF de var, ölçümle ikinci) + yeniden sıralama (ipucu/başlık/kalıp; tazelik yalnız yakın-eşitlik bozucu) + sürüm kuralı + **alan bazlı** çelişki koruma (sığmayan çelişki modele açıkça bildirilir) + çok soru + konuşma bağlamı + PII'siz kanıt. Yetki/onay/sır filtreleri **retrieval'ın ÖNÜNDE** (yapısal + davranışsal pin, §3c). |
| Vektör/embedding? | **YOK. Anlamsal retrieval yapılmıyor.** `semantic.ts` yalnız bir SÖZLEŞME (arayüz + no-op); üretimde hiçbir yüzey seçiciye anlamsal puan vermez, kanıttaki `srcs` üretimde yalnız `bm25`/`ngram` olabilir (pin). n-gram = yazım benzerliği, anlamsal DEĞİL. Gerçek puanlayıcı **ücretli servis** → onay (§5). Ayrıntı §2.2. |
| GraphRAG? | LLM'li varlık çıkarımı (LightRAG/HippoRAG) **uygulanmadı** (ücretli model çağrısı → onay, §6 protokol). **DB-gerçek ilişkilerden host graf katmanı KODLANDI** (`modules/intelligence/graph`): kenar = kaynak + zaman; şikâyet ≠ doğrulanmış arıza; misafir yoluna taşınmaz (pin). |
| Canlı etkisi? | Bayrak kapalıyken seçici **aynı dizi referansını** döndürür (kimlik), `kb-fetch` aynı `take`, istem aynı metin; test-pinli. |

---

## 1. Mevcut yapı (doğrulanmış)

- **Kaynak/onay:** `KnowledgeBaseItem.source/reviewState/approvedAt/supersededById`; AI yolu **yalnız** `fetchKnowledgeBaseForPrompt`
  (`KB_APPROVAL_GATE_WHERE` çağıranla `AND`'lenir; taslak modele gitmez; `count` aynı filtre).
- **Kapasite:** `KB_ITEM_CAP=30` (SQL `take`, `updatedAt desc`), `KB_CHAR_BUDGET=24_000` (`packKnowledgeBase`, açgözlü).
- **Sır elemesi (yüzey başına, retrieval'dan önce):** QR `QR_SECRET_CATEGORIES` (WHERE) + `withoutSecretKbItems`
  (tam tarama, 24k üstü fail-closed); oto-yanıt onaysız konaklamada aynı iki bacak; inbox öneri/test kartı süzmez (host yüzeyi).
- **Kanıt (A2):** `RiskEvent.kbRetrieved/kbDropped/kbPendingApproval/kbNewestUpdatedAt/kbEvidenceJson/srcDeclared/srcVerified`;
  `buildKbEvidence` = `{retrieved:[{type:"kb_item",id,v}], used:[…]}` (PII yok); yazan yüzeyler QR + oto-yanıt.
- **Türkçe metin araçları (önce):** `foldTurkishLower/Tr/Ascii`, görünmez sınıf, kesme = kelime sınırı. Kök alıcı / eşanlam /
  durak / BM25 / arama kütüphanesi **YOKTU**.
- **Graf ilişkileri (DB-gerçek FK):** Property→Reservation/Conversation/KnowledgeBaseItem/Task/Signal/PropertyMemory,
  Conversation→Message/Reservation, Signal→Property/Reservation/Conversation. **Opak kimlikler (FK yok):**
  `RiskEvent.triggerId/conversationId`, `Signal.sourceEntityId`, `IngestEvent.entityId`, `Task.sourceMessageId`,
  `KnowledgeBaseItem.sourceRef/supersededById`.

---

## 2. Bileşenler (dilim 1+2 — KODLANDI, bayrak kapalı)

```
src/lib/ai/retrieval/
  flag.ts         KB_RETRIEVAL_MODE tek okuma noktası (yaprak)
  text.ts         normalize (NFKC + görünmez sınıf + ASCII-Türkçe katlama + kesme = sınır), tokenize (SS:DD),
                  durak kelimeler, ek sökücü (TR + EN, simetrik; ünsüz yumuşaması geri alma), bigram Dice
  lexicon.ts      ~45 DAR kavram (terms = tespit+genişletme · detectOnly = yalnız tespit) → sorgu genişletme (0.5) + kategori ipucu
  chunker.ts      deterministik parçalayıcı: cümle sınırı, hedef 600 / tavan 900; parça = content.slice (bitişik)
  bm25.ts         Okapi BM25 (k1 1.2, b 0.75), başlık ×2, BM25+ IDF; OSA düzenleme uzaklığıyla yazım toleransı
  sources.ts      karakter 3-gram TF-IDF kosinüsü — kökten bağımsız İKİNCİ aday kaynağı (anlamsal DEĞİL)
  fusion.ts       CombSUM (büyüklük koruyan, VARSAYILAN — ölçüldü) + RRF (k=60)
  rerank.ts       ipucu (0.35 / yalnız-ipucu 0.2) · başlık (0.15; tam örtüşme +0.15; genişletmeyle ×0.5) · bigram (0.10)
                  · tazelik PUANA GİRMEZ (sıralamada 0.01 içinde yakın-eşitlikte yeni önde) · sürüm kuralı (supersededById)
                  · saat→ALAN atfı (extractFieldTimes: cümlecik kavramı → başlık kavramı → hiçbiri) · ALAN BAZLI çelişki koruma
  semantic.ts     SemanticScorer sözleşmesi + no-op + kaynak ağırlıkları — üretimde KULLANILMIYOR; gerçek puanlayıcı ONAY ister
  index-cache.ts  LRU 64 / TTL 10 dk; anahtar = küme parmak izi (id + updatedAt + içerik özeti) — max(updatedAt) DEĞİL;
                  parça başına alan→saat haritası burada hesaplanır
  select.ts       selectKbForPrompt: sürüm → küçük-KB passthrough → alt sorgular → kaynaklar → birleşim → rerank → eşik
                  → round-robin → çelişki koruma → bütçe (6k / 12 parça) → sığmayan çelişki = notes + confDropped
                  → droppedItems + PII'siz kanıt
src/modules/intelligence/graph/property-graph.ts   host graf katmanı (§6) — misafir yolundan yapısal olarak ayrı
```

### 2.1 Hibrit modun arama yöntemleri (Codex sorusu: "önce açıkla")

1. **Normalizasyon** (`text.ts`): NFKC → `\p{Default_Ignorable_Code_Point}`+U+2800 silinir → ASCII-Türkçe katlama
   (İ/I/ı/i tek harf; ç→c, ş→s, ğ→g, ö→o, ü→u) → kesme işareti kelime sınırı → bileşikler tek anahtar (wi-fi→wifi,
   check in→checkin) → belirteçler (`\p{L}\p{N}`+, SS:DD saat belirteci korunur).
2. **Kök sökme** (simetrik, kural tabanlı): en uzun eşleşen Türkçe/İngilizce ek, ≤3 tur, kök ≥2 harf (İngilizce ek ≥3);
   ek söküldüyse ünsüz yumuşaması geri alınır (uçağa→uçak, köpeğimi→köpek). Durak kelimeler elenir; "var/yok" bilgi taşır.
3. **Alan sözlüğü**: sorgu köklerinde ~45 dar kavram aranır (tek kelime ya da kalıp). Eşleşen kavramın tek kelimelik
   terimleri sorguya 0.5 ağırlıkla eklenir; kavram bir KB kategorisine bağlıysa o kategoriye ipucu verilir.
4. **Alt sorgular**: `?`, satır, `;`, `,`, "ve/ayrıca/and/also" ile bölünür (≤4); nezaket parçaları düşer. İnce sorguda
   (<2 kök) son 2 MİSAFİR mesajının kökleri 0.5 ağırlıkla taşınır (bizim cevaplarımız sorgu olmaz).
5. **Aday kaynakları** (alt sorgu başına): **BM25** (k1 1.2, b 0.75; başlık ×2; derlemde olmayan kök için OSA uzaklığı
   ≤1/≤2 ile fuzzy) · **karakter 3-gram TF-IDF kosinüsü** (yalnız GÜÇLÜ belirteçlerden; yalnız sorgu TÜRKÇE algılanırsa —
   `ngram:"auto"`, §3b ölçümü) · **anlamsal** — ÜRETİMDE YOK (§2.2; yalnız harness'ta hazır harita ile).
6. **Aday şartı**: güçlü kök isabeti YA DA kategori ipucu YA DA n-gram ≥0.3 YA DA anlamsal >0. "var/yok/lazım/…" gibi
   ZAYIF kökler tek başına aday yapmaz — "Jakuzi var mı?" tam kümeyle geri çekilsin diye (E1 dürüstlüğü).
7. **Birleşim**: CombSUM = Σ ağırlık × (puan/max) (bm25 1.0, ngram 0.7, semantic 1.0). RRF seçenek olarak duruyor;
   ölçümde iki terimli kesin isabetin kısa çeldiriciye kaybetmesine yol açtı (sıra farkını 1/61–1/62'ye sıkıştırır).
8. **Yeniden sıralama**: base (0..1) + ipucu + başlık (+tam örtüşme) + bigram. **Tazelik puana GİRMEZ**: sıralamada puan
   0.01 adımına yuvarlanıp eşitse yeni kalem önde (yakın-eşitlik bozucu; Codex 09-09 düzeltmesi, test-pinli). Eşik:
   max(0.1, 0.25·en iyi).
9. **Seçim**: alt sorgular arası round-robin (kalem başına ≤3 parça) → **alan bazlı çelişki koruma** (aynı SAAT ALANINDA —
   çıkış/giriş/havuz/sessiz saat/spor salonu/temizlik — çapadan farklı saat taşıyan parça, kategorisi ne olursa olsun,
   çapanın hemen arkasına) → bütçe 6k karakter / 12 parça (isabet varken ≥1 parça) → bir çelişkinin tüm tarafları sığmadıysa
   istem notu ("… farklı değerler var (11:00 / 12:00); tamamı sığmadı. Kesin saat SÖYLEME — insana devret") + `confDropped`.
10. **Geri çekilme**: küçük KB (≤12 kalem ve ≤6k) · içerik köksüz mesaj · hiç aday yok · hata → TAM küme (legacy).
11. **Kanıt**: `kbEvidenceJson.retrieved[].{id,v,c}` + `.retrieval{q,fb,sel,cand,ms,srcs,sup,conf,confDropped}`; PII yok.

### 2.2 Anlamsal sözleşme — ne VAR, ne YOK (Codex turu 3: "embedding yoksa anlamsal retrieval diye raporlama")

| | Durum |
|---|---|
| Var olan | `SemanticScorer { name; score(query, texts) → number[] \| null }` arayüzü + `noopSemanticScorer` (daima null) + `SOURCE_WEIGHTS` (`semantic: 1`). Seçici, **önceden hesaplanmış** bir `Map<parçaAnahtarı, 0..1>` alırsa onu üçüncü kaynak olarak birleşime katar (`srcs` içine "semantic" yazar). |
| Ölçüme katkısı | Yalnız **boru hattının** çalıştığını kanıtlar: harness'ta elle verilen harita, sözcüksel isabeti olmayan bir parçayı seçtirir (`kb-retrieval-select` "anlamsal puanlar üçüncü kaynak" testi). Bu bir RETRIEVAL KALİTESİ ölçümü DEĞİLDİR — puanlar sentetiktir. |
| Olmayan | Gömme (embedding) hesaplayan hiçbir kod, hiçbir dış çağrı, hiçbir vektör tablosu. Dört üretim yüzeyinin hiçbiri seçiciye `semantic` vermez (yapısal pin); `semantic.ts` içinde `fetch`/HTTP yok (pin); seçici hiçbir puanlayıcıyı ÇAĞIRMAZ (pin). |
| Sonuç | Üretimde retrieval = **BM25 + karakter n-gram + kurallı yeniden sıralama**. Raporlarda "anlamsal/semantic retrieval" ifadesi KULLANILMAZ; n-gram için "yazım benzerliği" denir. Gömme kaynağı §5 #3 onayıyla, aynı sözleşmeye takılır. |

### 2.3 Codex turu 3 — dört bulgu ve düzeltmeleri (hepsi test-pinli, iki yönlü mutasyon §3b)

| # | Bulgu | Eski davranış | Düzeltme |
|---|---|---|---|
| 1 | Saat çelişkisi kontrolü fazla geniş / fazla dar | Aynı KATEGORİDE saat taşıyan her parça karşılaştırılıyordu: "Genel" altında havuz 09:00 ile kahvaltı 08:00 çelişki sayılır, farklı kategorideki aynı çıkış bilgisi karşılaştırılmaz, bitişiklik bütçeye sığmayı garanti etmezdi | **Alan bazlı:** her saat, içinde geçtiği CÜMLECİĞİN saat-alanı kavramına (yoksa başlığın alanına; belirsizde hiçbirine) atfedilir (`extractFieldTimes`); yalnız aynı alanın saatleri karşılaştırılır, kategori önemsiz. Bütçe tamamını almazsa seçici çelişkiyi AÇIKÇA bildirir (`notes` → istemde `[NOT]`, kanıtta `confDropped`), sessizce yutmaz |
| 2 | Graf "tamamlanan görev" bilgisini yanlış ilişkilendirebilir | Kategorideki HERHANGİ bir done görev `task_done` kanıtı sayılıyordu (başka konaklamanın eski işi dahil) | Bildirim ↔ görev bağı kuruldu: (a) `Task.sourceMessageId = Signal.sourceEntityId` → **observed**; (b) aynı konaklama + aynı kategori (pencere içi bildirim) → **inferred**. Kanıt sınıfı YALNIZ bağlı görevlerden; `linkedOpenTasks / linkedDoneTasks / unlinkedTasks / reportsWithoutTask / linkCertainty` AYRI raporlanır; pencere dışı bildirime bağlı görev sayılmaz |
| 3 | Ölçüm canlı akışın tamamını ölçmüyordu | 300'lük testte seçiciye 336 kalemin tamamı veriliyordu (canlı `kb-fetch` tavanı 200); "inPrompt" kalem KİMLİĞİNE bakıyordu | **CANLI yapılandırması** (en yeni 200 sonra seçici) eklendi; **inPrompt(metin)** = cevap için gerekli cümle blokta mı (`needles`), kimlik ölçüsü kıyas için yanında; hedefli test: tek kalemi tavan dışında kalan konu canlıda ULAŞILAMAZ (dürüst geri çekilme + "alınmadı" notu) |
| 4 | "Tazelik yalnız eşitlik bozucu" kodla uyuşmuyordu | Tazelik puana EKLENİYORDU (≤0.05) | Puandan çıkarıldı; `sortCandidates` puanı 0.01 adımına yuvarlar, eşitse yeni önde. Pin: aynı parçaya farklı `updatedAt` ile AYNI puan; 0.04 farkta eski-ilgili önde; 0.003 farkta yeni önde |

### Veri akışı (hibrit AÇIK)

```
kb-fetch (mülk + isActive + ONAY KAPISI; take 200, updatedAt desc; supersededById seçilir)
  → yüzeyin sır elemesi (QR: kategori + içerik; oto-yanıt: onaysız konaklamada aynı)   ← DEĞİŞMEDİ, seçicinin ÖNÜNDE
  → selectKbForPrompt(items, guestMessage, history)  [§2.1 adımları]
  → suggestReply(knowledgeBase = parçalar, knowledgeBaseDropped += seçilmeyen, knowledgeBaseSelection="retrieved",
                 knowledgeBaseNotes = seçicinin dürüst notları)
      istem notu: "[NOT] … SORUYA GÖRE SEÇİLDİ; N kalem alınmadı. Sorulan konu yukarıda yoksa 'bilgi yok' DEME — insana devret."
      (+ varsa "[NOT] Kaynaklarda çıkış saati için farklı değerler var (11:00 / 12:00); tamamı bu yanıta sığmadı. Kesin saat SÖYLEME …")
  → RiskEvent: kbRetrieved = parça sayısı, kbDropped = toplam düşen, kbEvidenceJson (yukarıda, confDropped dahil)
```

### Değişmezler (test-pinli; iki yönlü mutasyon: dilim 1 20/20, dilim 2 17/17, dilim 3 §3b'de)

- Bayrak kapalı = **kimlik**. Retrieval modülü **DB'ye erişmez, kalem ekleyemez, metni değiştiremez** (parça = `content.includes`).
- Yetki/mülk/onay/sır filtreleri **retrieval'ın önünde**; önbellek süzülmüş kümenin parmak izini anahtarlar (§3c davranışsal).
- **Hibrit legacy'den az bilgi taşımaz** (geri çekilme sınıfları). **Çelişki gizlenmez** (alan bazlı saat kuralı; sığmayan
  çelişki modele bildirilir).
- **Sürüm kuralı**: halefi kümede olan kalem düşer; halefi olmayan (pasif/silinmiş) korunur. **Tazelik** puana girmez, yalnız
  yakın-eşitlik (0.01) bozucu.
- **Anlamsal kaynak üretimde YOK** (§2.2); kanıt `srcs` üretimde yalnız bm25/ngram.
- Silinen/pasif/onaydan düşen kalem indekste yaşayamaz; içerik değişince (misafir adı ikamesi) parmak izi değişir.
- Kanıt PII'siz; misafire dönen gövde kanıt taşımaz. Bayrak **tek** yerde okunur (`retrieval/flag.ts`).
- **Host graf katmanı misafir yoluna taşınmaz** (retrieval modülü + QR rotası + guest-chat onu import etmez, pin).

---

## 3. Baseline ölçümü (model YOK) — `docs/olcum/kb-retrieval-baseline-2026-09-09.md`

13 Codex senaryosu (uzun metin ortası ×2, eşanlam, EN, yanlış kategori, çok soru, çelişki, kötü niyetli kaynak, yazım hatası,
bağlam, büyük harf, selamlaşma, isabet yok): legacy `long_middle_oldest` ❌ → hibrit ✅; isabetli senaryolarda blok
2.9k–7.8k → 0.2k–0.9k karakter; gürültü 20–30 → 0–2; geri çekilmede blok legacy ile birebir; 3–23 ms.

## 3b. Ölçek ölçümü — 30 / 100 / 300 kalem, GERÇEK retrieval yolu — `docs/olcum/kb-retrieval-scale-2026-09-09.md`

Sentetik mülk KB'leri (38 konu × 3 TR paraphrase + EN; konu başına TR / eşanlam / yazım hatası / **ek varyasyonu (morph)** / EN
sorusu; n/10 çeldirici; her 50 kaleme 7k rehber + 3 gömülü gerçek; `updatedAt` 400 güne tohumlu). Üretici
`tests/unit/kb-retrieval-scale.test.ts` (CI'da kapı). **Dilim 3 ölçüsü:** inPrompt = **CEVAP İÇİN GEREKLİ CÜMLE** blokta mı
(kalem kimliği değil; kimlik ölçüsü raporda kıyas için yanında). **CANLI** = `kb-fetch` tavanı (en yeni 200) uygulanmış hibrit.

| n | Yapılandırma | havuz | hit@1 | hit@3 | inPrompt (metin) | gürültü | karakter | soğuk ms | ılık p95 |
|---|---|---|---|---|---|---|---|---|---|
| 30 | legacy | 30 | — | — | 90% | 29.1 | 4371 | — | — |
| 30 | hibrit bm25 (n-gram kapalı) | 34 | 92% | 97% | 99% | 1.6 | 455 | 18.1 | 3.5 |
| 30 | hibrit n-gram AÇIK | 34 | 93% | 97% | 99% | 1.5 | 507 | 8.2 | 3.1 |
| 30 | hibrit RRF | 34 | 92% | 97% | 99% | 2.5 | 778 | 7.2 | 3.1 |
| 30 | **hibrit VARSAYILAN (n-gram auto, CombSUM)** | 34 | 93% | 97% | 99% | 1.5 | 482 | 6.1 | 3.0 |
| 30 | hibrit CANLI (tavan 200) | 34 | 93% | 97% | 99% | 1.5 | 482 | 6.7 | 3.1 |
| 100 | legacy | 30 | — | — | **51%** | 29.3 | 4513 | — | — |
| 100 | hibrit bm25 (n-gram kapalı) | 112 | 91% | 95% | 98% | 3.5 | 825 | 16.5 | 4.9 |
| 100 | hibrit n-gram AÇIK | 112 | 92% | 95% | 98% | 3.1 | 834 | 16.1 | 5.6 |
| 100 | hibrit RRF | 112 | 89% | 93% | 98% | 5.7 | 1486 | 20.4 | 5.1 |
| 100 | **hibrit VARSAYILAN** | 112 | 92% | 95% | 98% | 2.9 | 778 | 21.8 | 5.8 |
| 100 | hibrit CANLI (tavan 200) | 112 | 92% | 95% | 98% | 2.9 | 778 | 16.6 | 5.4 |
| 300 | legacy | 30 | — | — | **60%** | 29.2 | 2925 | — | — |
| 300 | hibrit bm25 (n-gram kapalı) | 336 | 90% | 92% | 98% | 6.4 | 1425 | 55.6 | 6.8 |
| 300 | hibrit n-gram AÇIK | 336 | 92% | 94% | 98% | 4.9 | 1389 | 53.2 | 7.5 |
| 300 | hibrit RRF | 336 | 90% | 91% | 97% | 5.7 | 1537 | 53.6 | 7.5 |
| 300 | **hibrit VARSAYILAN** | 336 | 92% | 94% | 97% | 4.7 | 1312 | 49.5 | 7.2 |
| 300 | **hibrit CANLI (tavan 200)** | **200** | 92% | 94% | 98% | 4.3 | 1076 | 29.9 | 5.9 |

Güncelleme sonrası yeni metin 10/10, silme sonrası geri gelmeme 10/10 (her boyut).

**N-gram AYRI ÖLÇÜM (Codex turu 3) — soru türüne göre inPrompt(metin) / ortalama gürültü (kapalı → auto → açık):**

| n | typo | morph (ek varyasyonu) | en | syn |
|---|---|---|---|---|
| 30 | 30/30 · .83 → .80 → .80 | 29/30 · **5.03 → 3.90** → 3.90 | 30/30 · .50 → .50 → **.70** | 30/30 · .93 → 1.37 → 1.33 |
| 100 | 38/38 · 2.32 → 2.08 → 2.08 | 35/38 · **8.11 → 5.11** → 5.11 | 38/38 · 2.03 → 2.03 → **2.76** | 37/38 · 2.92 → 3.11 → 3.05 |
| 300 | 38/38 · 2.63 → 2.61 → 2.71 | 35/38 · **19.95 → 11.16** → 11.16 | 38/38 · 2.74 → 2.74 → **3.63** | 38/38 → 37/38 → 37/38 · 3.74 → 3.84 → 3.84 |

**Okumalar (dürüst):**
- Legacy'nin açığı ölçekle büyür: 100+ kalemde cevap cümlesi soruların yarısında modele gitmiyor.
- **n-gram'ın işi isabet değil gürültü:** yazım hatasında katkı yok (OSA fuzzy zaten kapsıyor); ek varyasyonunda gürültüyü
  %23–44 azaltıyor (isabet aynı); İngilizce sorguda AÇIK olmak isabet kazandırmıyor, gürültü ekliyor (+0.2/+0.7/+0.9);
  eşanlamda 300'de bir soru kaybettiriyor. **Varsayılan bu yüzden `auto` = yalnız Türkçe algılanan sorguda** (İngilizcede
  kapalıyla birebir). Toplam isabet kapalıya göre en fazla bir soru geride, blok daha küçük. Eşikler bu sayılara pinli.
- **CombSUM ≥ RRF** her boyutta (aynı kaynaklarla hit@1 +1–3 puan, gürültü daha az, blok daha küçük). Varsayılan ölçümle seçildi.
- **CANLI tavan (200):** 30/100'de varsayılanla birebir; 300'de havuz 336→200 ama isabet DÜŞMÜYOR — çünkü sentetik sette her
  konunun ~8 varyantı var ve en yeni 200'de her konudan en az biri kalıyor. Bu tavanın zararsız olduğunun kanıtı DEĞİLDİR:
  hedefli test, TEK kalemi tavan dışında kalan konunun canlıda ULAŞILAMADIĞINI gösterir (geri çekilme + "N kalem alınmadı"
  notu → model 'bilgi yok' demez, insana devreder). 300 kalem plan tavanının (60/mülk) çok üstünde; canlıda tavana çarpan
  mülk yok — ama ölçüm canlı yolu ölçer, idealize etmez.
- **Kimlik ≠ metin:** uzun kalemin başka parçası seçilince kalem kimliği blokta olup cevap cümlesi olmayabilir (test-pinli);
  rapor iki ölçüyü de verir, eşikler METİN ölçüsüne bağlı.
- **Mutasyon turu (dilim 2):** 14 mutasyon + kontrol koşusu. İlk turda kontrol koşusu KIRMIZIYDI (fixture hatası) → 6 "yakalandı"
  sahteydi; düzeltildi, tur tekrarlandı. Son tur: kontrol yeşil, 17 mutasyonun tamamı yakalandı.
- **Mutasyon turu (dilim 3):** kontrol yeşil → 20 mutasyon (alan atfı ×3, çelişki birleşimi/taşıma/tamlık, not/confDropped,
  yuvarlama/sıra/tazelik-puan, graf bağ kuralları ×6, indeks alan-saat, istem notu, n-gram auto) → **20/20 yakalandı**,
  geri alma sonrası kontrol yeşil.
- **"Cevabın kaynakla desteklenmesi" burada ÖLÇÜLMEZ** — modelsiz harness yalnız "doğru kaynak modele gitti mi"yi ölçer.
  Cevap doğruluğu için eşleştirilmiş gerçek-model eval'i (§3d).

## 3c. Güvenlik filtreleri yeni retrieval yolunda AYNEN (Codex turu 3: "eksikse pilotu hazır sayma")

Doğrulama davranışsaldır (DB'li integration, `tests/integration/kb-retrieval-secret-scope.test.ts`, bayrak AÇIK):

| Yüzey | Kontrol | Sonuç |
|---|---|---|
| QR (misafir) | `QR_SECRET_CATEGORIES` (wifi/checkin/…) + `withoutSecretKbItems` (içerik sezgiseli) + taslak (`reviewState: draft`) seçicinin ÖNÜNDE | Hibrit AÇIKKEN sır kalemleri ne isteme ne kanıta (`kbEvidenceJson`) girer; taslak asla |
| Oto-yanıt (kanal) | Onaysız konaklamada aynı iki bacak; onaylı konaklamada giriş notu ürünün kendisi | Onaysız: sır yok; onaylı: "Giriş notu" gider (davranış AYNI); taslak asla |
| Önbellek | Anahtar = süzülmüş kümenin parmak izi | Başka mülk / onaydan düşen kalem indeksi bu kümeye SIZMAZ (`kb-retrieval-select` kapsam testi: iki küme, aynı soru, yalnız kendi kalemi; küme değişince parça dönmez) |
| Yeniden sıralama | Saf fonksiyon; yetki alanı OKUMAZ, girdinin dışına çıkamaz | "BAŞKA MÜLK" testi: seçilen her parça girdideki bir kalemin bitişik dilimi |
| Graf | Saf modül; yalnız girdideki düğümleri bağlar | Yabancı kimlikli (başka mülkün) rezervasyon/konuşma düğüm/kenar üretmez (test) |

Yapısal pinler ek: retrieval modülü DB/Prisma/Hospitable import etmez; bayrak tek yerde okunur; graf misafir yoluna import edilmez.

## 3d. Eşleştirilmiş legacy / hibrit gerçek-model eval'i — HAZIR, koşuyu kurucu yapar

`evals/kb-retrieval-paired.json` (v1, anonim, 8 senaryo) + `tests/eval/kb-retrieval-paired.eval.test.ts` (aynı `npm run eval`,
aynı iki kapı). Her senaryo AYNI bilgi tabanıyla iki modda koşar (`kb-fetch` aynası: legacy en yeni 30, hibrit en yeni 200 +
seçici; blok `packKnowledgeBase` ile ÜRETİMLE aynı). Rapor `docs/olcum/eval-retrieval-<tarih>[-koşu].md` (aynı gün ezmez).

| # | Senaryo | Kalem yaşı | Çevrimdışı pin (gold istemde: legacy / hibrit) |
|---|---|---|---|
| R1 | 7k rehberin ortasında otopark | en eski | ✗ / ✓ |
| R2 | yazım hatası "otopakr" | en eski | ✗ / ✓ |
| R3 | İngilizce soru, Türkçe kalem | en eski | ✗ / ✓ |
| R4 | çok soru (otopark + çöp) | en yeni | ✓ / ✓ |
| R5 | çelişkili çıkış saati (11:00 / 12:00; mülk 11:00) | en yeni | ✓ / ✓ (hibrit `conf 1`) |
| R6 | bilgi yok (jakuzi) | — | gold yok; iki blok BİREBİR (geri çekilme) |
| R7 | Türkçe eşanlam ("araba" → "araç park yeri") | en eski | ✗ / ✓ |
| R8 | konuşma bağlamı ("Ücretli mi?") | en eski | ✗ / ✓ |

Ölçülen (satır başına): gold istemde mi (kod) · blok karakteri · cevap doğru mu (`correctAny/All`) · yasak ifade · makbuzsuz
eylem/söz (`unverifiedActionClaims`) · çelişkide kesin değer (`assertsDefiniteValue`) · beyan/doğrulanan kaynak · intent/risk/güven.
**Dallanma KODDAN:** gold istemdeyse cevap ona DAYANMALI; istemde değilse "doğru görünen" cevap **DESTEKSİZ** sayılır (şans/uydurma)
ve yokluk söylenmelidir. Beklenen tablo: R1/R2/R3/R7/R8'de legacy dürüst "bilgim yok" (geçer) ama cevap veremez, hibrit doğru
cevaplar; R4/R5/R6 iki modda davranış paritesi. Rapor "yalnız hibrit geçti / yalnız legacy geçti / ikisi" sayar.
🚨 Bu, §3b'nin devamı DEĞİL ayrı bir ölçümdür: §3b "kaynak bloğa girdi mi", §3d "model doğru cevapladı mı".

---

## 4. Veri akışı garantileri (Codex şartları ↔ kod)

| Şart | Nerede |
|---|---|
| Bağlam koruyan parçalama | `chunker.ts` (cümle sınırı, bitişik dilim, başlık "(i/n)"); onay kapısı `kb-fetch` içinde |
| TR/EN ve eşanlamlı sorgular | `text.ts` katlama+kök, `lexicon.ts` ~45 kavram; ölçek harness'ı tr/en/syn/typo sütunları |
| Kelime+vektör adaylarının birleştirilmesi | `sources.ts` (n-gram, bugün; yalnız TR sorguda) + `semantic.ts` sözleşmesi (gömme, ONAY; üretimde YOK) → `fusion.ts` CombSUM/RRF |
| Reranking | `rerank.ts` (ipucu/başlık/kalıp; tazelik puana girmez) |
| Kaynak sürümü / güncellik | `supersededById` kuralı; tazelik yalnız yakın-eşitlik (0.01) bozucu; kanıt `v` = kalem `updatedAt`; güncelleme/silme testi 10/10 |
| Çelişki kontrolü | `extractFieldTimes` (saat→alan atfı) + `preserveTimeConflicts` (ALAN bazlı, kategori-bağımsız) + sığmayan çelişki → istem notu + `confDropped` + `findTimeConflicts` (P4-b, istem) + kanıt `conf` |
| İşletme/mülk/onay kapsamı her aşamada | girdi zaten süzülmüş; önbellek küme parmak izi; graf saf modül, yetki grafın önünde — davranışsal doğrulama §3c |
| Silinen/pasif içerik indekste yaşamaz | küme parmak izi (test: silme + içerik değişimi) |
| Takvim/görev durumu belgeden tahmin edilmez | KB metni yalnız bilgi bloğu; canlı gerçekler `verifiedToolResults` sözleşmesine (uygulanmadı) |
| Misafir ↔ host kapsamı | seçici yüzeyin süzgecinden SONRA; graf katmanı misafir yoluna import edilmez (pin) |

---

## 5. Onay kapıları — SOMUT KAPSAM

| # | Bileşen | Migration | Ücretli servis | Politika | Somut kapsam / veri | Durum |
|---|---|---|---|---|---|---|
| 1 | Hibrit seçici (dilim 1+2) + kanıt + graf katmanı | YOK | YOK | YOK (bayrak kapalı) | Kod + testler + harness; canlı davranış aynen | **KODLANDI** |
| 2 | Hibrit bayrağını canlıda açma (`KB_RETRIEVAL_MODE=hybrid`) | YOK | YOK | Modele giden bağlam değişir | Önce eval seti uzun-rehber/30+ sınıfı, sonra tek test mülkü; `retrieval.fb` dağılımı izlenir | **ONAY** |
| 3 | Gömme (embedding) kaynağı | Kalıcı vektör için **EVET** (yeni tablo `KbChunkEmbedding{itemId, chunk, model, vector, contentHash}` ya da `pgvector`); ilk pilotta bellek-içi önbellek ile **HAYIR** | **EVET** — dış API'ye GİDEN VERİ: yalnız ONAYLI KB kalemi parçaları (mülk gerçeği) + misafirin SORUSU (retrieval anında); misafir adı/rezervasyon gitmez. Maliyet = (parça sayısı × ortalama token) ilk indeksleme + soru başına 1 çağrı; fiyat sağlayıcı listesinden (burada YAZILMADI) | KVKK alt-işleyen listesi güncellenir | Sözleşme hazır (`semantic.ts`, `fusion.ts` üçüncü kaynak) | **ONAY** |
| 4 | Kötü niyetli KB kalemini retrieval'da **eleme** (`detectPromptInjection`) | YOK | YOK | **EVET** (modele ne gitmez) | Bugün yalnız ÖLÇÜLDÜ (ilgisiz soruda gitmiyor; eşleşince gidiyor) | **ONAY** |
| 5 | LightRAG deneyi (host analizi) | YOK (deney dosyada) | **EVET** — LLM ile varlık/ilişki çıkarımı: KB metni + **misafir mesajı metni** dış modele gider (KVKK: misafir verisi, saklama/silme paritesi ŞART) | Host yüzeyi (misafire gitmez) | §6 protokol; çıktı yalnız kıyas raporu | **ONAY** |
| 6 | HippoRAG deneyi | YOK | **EVET** (aynı: OpenIE üçlüleri + gömme; PageRank yerel) | Host yüzeyi | §6 alternatif kol | **ONAY** |
| 7 | Agentic yeniden arama / HyDE | YOK | **EVET** (soru başına +1–2 model çağrısı) | Modele giden bağlam | YALNIZ kalan başarısız örneklerde (§3b syn 1/38, §8) | **ONAY** |
| 8 | `verifiedToolResults` / `actionReceipt` (P2, P5) | YOK | YOK | **EVET** (gönderim) | Ayrı tur (CLAUDE.md gereksinimi) | **ONAY** |

---

## 6. GraphRAG — host analizi: basit graf sorguları (KODLANDI) vs LightRAG / HippoRAG (PROTOKOL)

### 6.1 Kodlanan: DB-gerçek ilişki grafı (`src/modules/intelligence/graph/property-graph.ts`)

Düğümler: property · reservation · conversation · signal · task · memory · kb_item (yalnız kimlik + kapalı-küme
kategori/durum + zaman; **serbest metin yok**). Kenarlar: `stay_at` · `thread_of` · `observed_in` · `about_stay` ·
`task_for` · `task_about_stay` · `memory_of` · `memory_evidence` · `documents` — her biri `source` (db_fk | signal |
task | memory | kb) + `observedAt` + `certainty` (observed/inferred) taşır.

Kenarlara dilim 3'te `task_for_signal` eklendi (görev → sinyal, aynı kaynak mesaj: `Task.sourceMessageId` = `Signal.sourceEntityId`).

Sorgular: `stayOfSignal` (doğrudan ya da konuşma üzerinden konaklama çözümü), `recurringIssues` (pencere, kategori,
bildirim sayısı, **farklı konaklama sayısı**, bağlanamayan bildirimler AYRI, ilk/son zaman, kanıt sınıfı
`reported_only | task_open | task_done`, kenar kaynakları). **'confirmed' diye bir değer yoktur** (pin): görev kaydı
host'un iş açtığının kanıtıdır, arızanın doğrulandığının değil.

**Bildirim ↔ görev bağı (Codex turu 3 düzeltmesi):** kanıt sınıfı YALNIZ bildirime bağlı görevlerden okunur —
(a) aynı kaynak mesaj (`task_for_signal`) → `linkCertainty: "observed"`; (b) aynı konaklama + aynı kategori (pencere-içi
bildirim) → `"inferred"`. Başka konaklamanın (pencere-içi bildirimi olmayan) tamamlanmış işi ve pencere dışı bildirime bağlı
görev **kanıt DEĞİLDİR**; `unlinkedTasks` olarak ayrı görünür. Rapor alanları: `linkedOpenTasks · linkedDoneTasks ·
unlinkedTasks · reportsWithoutTask · linkCertainty`; bağlı AÇIK görev varsa `task_open`, bağlıların tümü done ise `task_done`.

**İlişkinin marjinal faydası (ölçüldü, test):** `reservationId` NULL ama konuşması bir konaklamaya bağlı sinyal
(QR/legacy satırları) düz taramada konaklamaya bağlanamaz; graf `observed_in → thread_of` ile bağlar. "Kaç farklı
konaklamada bildirildi" sorusu ancak grafla dürüst cevaplanır.

### 6.2 Kıyas protokolü — LightRAG · HippoRAG · basit graf (ONAY sonrası deney)

| | Basit graf (kodlandı) | LightRAG | HippoRAG |
|---|---|---|---|
| Girdi | DB-gerçek FK + kapalı-küme sinyal/görev/hafıza | KB metni + **mesaj metni** → LLM varlık/ilişki çıkarımı | Aynı → OpenIE üçlüleri; gömmeyle eşanlam kenarları |
| Kenar kaynağı/zamanı | Her kenarda (`source`, `observedAt`) | Çıkarım: kaynak = "LLM, belge X" — zaman belge zamanı; **kenara model sürümü + parça kimliği yazılmalı** (şart) | Aynı şart |
| "Şikâyet var → arıza doğrulandı" | Yapısal olarak imkânsız (`evidence` kapalı küme) | LLM "arıza var" ilişkisi üretebilir → **kural: LLM kenarı `certainty:"inferred"`, hiçbir rapor alanı onu "doğrulandı" saymaz** | Aynı |
| Misafir erişimi | Yapısal pin (import yok) | Deney çıktısı host raporu; misafir yoluna hiçbir kenar taşınmaz | Aynı |
| Maliyet | 0 (DB okuması) | Parça başına ≥1 LLM çağrısı (indeksleme) + sorgu başına 1–2 | Parça başına OpenIE çağrısı + gömme |
| KVKK | Misafir metni yok | Misafir mesajı dış modele gider → alt-işleyen + saklama/silme paritesi | Aynı |

**Deney soruları (host, 30 gün):** "hangi konu tekrar ediyor, kaç farklı konaklamada", "açık görevi olmayan tekrar",
"aynı konuda KB kalemi var mı / güncel mi", "bu konaklamanın önceki bildirimleri". **Ölçütler:** doğru konaklama
sayısı (DB gerçeği ile), yanlış "doğrulanmış" iması sayısı (0 olmalı), ek DB/model çağrısı, gecikme, maliyet,
KVKK'ya giden veri hacmi. **Kabul:** LightRAG/HippoRAG yalnız basit grafın CEVAPLAYAMADIĞI soru sınıfında
(kapalı-küme kategoriler dışındaki metin varlıkları, ör. "hangi cihaz") fayda gösterirse ilerler.

### 6.3 Sentetik mülk–mesaj–görev verisi — deney GERÇEK MİSAFİR METNİ OLMADAN (KODLANDI, bizim taraf ölçüldü)

`tests/helpers/graph-synthetic.ts` (`makeSyntheticProperty(stays, seed, windowDays)`): 40 konaklama, şablon mesajlar
(anonim, 12 şablon; şikâyet şablonları cihaz etiketi taşır: klima/sıcak su/wifi/gürültü/temizlik), sinyaller şablon
kategorisinden (sınıflandırıcı taklidi, `sourceEntityId` = mesaj), her 4. konuşmanın satırları `reservationId` taşımaz
(QR/legacy), görevler kural tabanlı: kategori başına en fazla BİR bağlı görev (mesajla ya da konaklamayla; done/todo) +
BİR **çeldirici** (bildirimsiz konaklamanın tamamlanmış işi). **Altın cevaplar üreticiden** (`truth`): kategori→konaklama,
kanıt sınıfı, bağ türü, bağlı/çeldirici sayısı, konuşma-bağlı sinyal sayısı, cihaz→bildirim sayısı.

Sorular `HOST_QUESTIONS` H1–H4; bizim taraf `tests/unit/property-graph-synthetic.test.ts` (3 tohum), rapor
`docs/olcum/graph-baseline-2026-09-09.md`: **H1–H3 birebir** (basit graf, sıfır model çağrısı), çeldiriciler kanıt sınıfını
değiştirmiyor ve `unlinkedTasks` olarak ayrı sayılıyor, **H4 (cihaz/varlık) basit grafla CEVAPLANAMAZ** — bu, LightRAG/HippoRAG'ın
tek aday katkısıdır. ONAY sonrası aynı `messages[]` (sentetik metin) + aynı `HOST_QUESTIONS` LLM tarafına verilir; kabul
ölçütü §6.2. Gerçek misafir metni hiçbir aşamada gerekmez.

---

## 7. P5 açık — RAG bunu kapatmaz

P5 = **kanıtsız eylem/söz iddiası için KOD KAPISI** (`unverifiedActionClaims` dedektörleri `tests/helpers/` içinde,
ürün koduna taşınmadı; `actionReceipt` uygulanmadı). Retrieval modele **daha doğru bilgi** verir; modelin
"ilettim / döneceğim" demesini **engellemez** — o, istem (P1, uygulandı) + kapı (P5, ONAY BEKLER) işidir.

---

## 8. Sıra (Codex turu 3 önerisi; durumla)

1. **Dört bulguyu düzelt** (§2.3) → ✅ kodlandı, 20/20 mutasyon.
2. **Bağımsız test seti: uzun rehber + karışık kategoriler** → ✅ `evals/kb-retrieval-paired.json` (R1–R8; §3d), çevrimdışı
   eşleştirme pinleri yeşil. Dilim 1+2+3 (bayrak kapalı) → CI → deploy (davranış aynen).
3. **Aynı sorularda legacy/hibrit GERÇEK model kıyası** → kurucu koşar (`npm run eval`; aynı komut 8 QR senaryosu + 16
   eşleştirilmiş satırı üretir). Sonuç `docs/olcum/eval-retrieval-<tarih>.md` → repoya.
4. Kalan başarısız örnekler için **önce sözlük/kök**; ancak sonra gömme (embedding) deneyi (#3 onay) ya da HyDE / agentic
   yeniden arama (#7 onay). Gömme YALNIZ gerçek-model kıyasında sözcüksel+n-gram'ın yetmediği sınıf görülürse.
5. Tek test mülkü + RiskEvent `retrieval.fb/srcs/sup/conf/confDropped` dağılımı → bayrağı açma kararı (kurucu, #2 onay).
6. GraphRAG: sentetik veride bizim taraf ölçüldü (§6.3, H1–H3 birebir, H4 cevaplanamaz); LightRAG/HippoRAG tarafı
   **yalnız** §6.2 kabul ölçütüyle ve ONAY sonrası (#5/#6), yine sentetik metinle — gerçek misafir metni gerekmez.

## 9. Bilinen sınırlar (dürüst)

- Kök alıcı kural tabanlı; yanlış birleştirme mümkün, simetrik olduğu için kaçırma üretmez. Ölçülmüş çarpışmalar
  düzeltildi: "varış→var" (iki kez), "şu→su", "ki" eki, "açılıyor→acil" (kabul edilen sınır).
- Sözlük ~45 kavram; eksik kavram sözcüksel isabete düşer. Sentetik set 38 konu — gerçek host KB'leri farklı kelime
  seçebilir; gerçek veride `retrieval.fb` dağılımı ölçülmeden genelleme yapılmaz.
- n-gram kaynağı yazım benzerliğidir, anlamsal DEĞİL; isabete katkısı ≈0, gürültüye katkısı ek varyasyonunda (§3b);
  yalnız Türkçe sorguda çalışır (dil algısı `detectGuestLanguage`; karışık dilde Türkçe sayılırsa n-gram girer).
- Saat→alan atfı cümlecik temellidir; bir cümlecikte iki alan kavramı ve tek saat varsa saat HİÇBİR alana atfedilmez
  (belirsizde hüküm yok → çelişki kaçabilir). Alan sözlüğü altı alan (giriş/çıkış/sessiz saat/havuz/spor salonu/temizlik);
  kahvaltı/servis gibi saatler alan değildir ve çelişki kontrolüne girmez.
- Canlı okuma tavanı 200: tek kalemi tavan dışında kalan konu hibritte ulaşılamaz (dürüst geri çekilme; §3b hedefli test).
  Plan tavanı 60/mülk olduğu için bugün hiçbir mülk buna çarpmaz.
- Hibrit AÇIKKEN sır süzgeçleri 200 kaleme kadar tarar (kalem başına 0.7–3.2 ms).
- Graf katmanı bugün hiçbir yüzeye bağlı değil (saf modül + testler); host UI bağlantısı ayrı iş. `Task.sourceMessageId`
  bugün yalnız bazı görevlerde dolu; mesaj bağı olmayan görevler konaklama+kategori çıkarımına düşer (inferred).
