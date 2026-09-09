# RAG / GraphRAG — somut tasarım + yerel dilimler 1–2 (2026-09-09)

> Kurucu/Codex talebi: mevcut kaynak/onay/kanıt altyapısını kullanarak retrieval tasarımı + **bağımsız ve mevcut
> yetki içindeki dilimlerin yerelde uygulanması**. Migration, yeni ücretli servis ve güvenlik/gönderim politikası
> değişiklikleri **ayrı onaya** (§5, somut kapsamla). Canlıya alma YOK: bayrak `KB_RETRIEVAL_MODE` varsayılan KAPALI.
> Gerçek model eval'ini kurucu koşar. **P5 (kanıtsız iddia için kod kapısı) AÇIK kalır — RAG bu açığı kapatmaz (§7).**
> Dilim 2 (Codex turu 2): arama yöntemlerinin açıklaması (§2.1) · gerçek retrieval yolunda 30/100/300 ölçek ölçümü (§3b)
> · kelime+n-gram(+gömme sözleşmesi) aday birleşimi · yeniden sıralama · sürüm/tazelik/çelişki · host graf katmanı (§6).

---

## 0. Kısa hüküm

| Soru | Cevap |
|---|---|
| Bugün neden retrieval yok? | Bilgi tabanı mülk-kapsamlı ve küçük; `kb-fetch` en yeni 30 kalemi çekiyor, `packKnowledgeBase` 24k karakterde kesiyor. Küçük KB'de bu doğru. Sorun **uzun rehber metni** ve **30+ kalem**de: ilgili cümle ya tavandan düşüyor ya 7k karakterin ortasında kayboluyor. **Ölçüldü (§3b):** 100 kalemde legacy doğru kaynağı soruların yalnız %51'inde bloğa alıyor; hibrit %99. |
| Ne kodlandı? | **LLM'siz, deterministik hibrit seçici** (`src/lib/ai/retrieval/`): bağlam koruyan parçalama + BM25 (kök + alan sözlüğü + yazım toleransı) + karakter n-gram ikinci kaynağı + büyüklük koruyan birleşim (CombSUM; RRF de var, ölçümle ikinci) + yeniden sıralama (ipucu/başlık/kalıp/tazelik) + sürüm kuralı + çelişki koruma + çok soru + konuşma bağlamı + PII'siz kanıt. Yetki/onay/sır filtreleri **retrieval'ın ÖNÜNDE** (yapısal pin). |
| Vektör/embedding? | **Sözleşme + no-op** (`semantic.ts`); gerçek puanlayıcı **ücretli servis** → onay (§5, somut kapsam). Birleşim yolu bugün n-gram kaynağıyla GERÇEK veride çalışıyor; gömme kaynağı aynı sözleşmeye üçüncü kaynak olarak girer. |
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
                  · tazelik (≤0.05, eşitlik bozucu) · sürüm kuralı (supersededById) · çelişki koruma (kategori-bağımsız saat)
  semantic.ts     SemanticScorer sözleşmesi + no-op + kaynak ağırlıkları — gerçek puanlayıcı ONAY ister
  index-cache.ts  LRU 64 / TTL 10 dk; anahtar = küme parmak izi (id + updatedAt + içerik özeti) — max(updatedAt) DEĞİL
  select.ts       selectKbForPrompt: sürüm → küçük-KB passthrough → alt sorgular → kaynaklar → birleşim → rerank → eşik
                  → round-robin → çelişki koruma → bütçe (6k / 12 parça) → droppedItems + PII'siz kanıt
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
   ≤1/≤2 ile fuzzy) · **karakter 3-gram TF-IDF kosinüsü** (yalnız güçlü belirteçlerden; kök sökücüyü atlayan biçimler ve
   uzak yazım hataları için) · **anlamsal** (varsa; parça anahtarı→0..1 haritası, sözleşme).
6. **Aday şartı**: güçlü kök isabeti YA DA kategori ipucu YA DA n-gram ≥0.3 YA DA anlamsal >0. "var/yok/lazım/…" gibi
   ZAYIF kökler tek başına aday yapmaz — "Jakuzi var mı?" tam kümeyle geri çekilsin diye (E1 dürüstlüğü).
7. **Birleşim**: CombSUM = Σ ağırlık × (puan/max) (bm25 1.0, ngram 0.7, semantic 1.0). RRF seçenek olarak duruyor;
   ölçümde iki terimli kesin isabetin kısa çeldiriciye kaybetmesine yol açtı (sıra farkını 1/61–1/62'ye sıkıştırır).
8. **Yeniden sıralama**: base (0..1) + ipucu + başlık (+tam örtüşme) + bigram + tazelik. Eşik: max(0.1, 0.25·en iyi).
9. **Seçim**: alt sorgular arası round-robin (kalem başına ≤3 parça) → çelişki koruma (çapayla farklı saat taşıyan aynı
   kategori parçaları çapanın hemen arkasına) → bütçe 6k karakter / 12 parça (isabet varken ≥1 parça).
10. **Geri çekilme**: küçük KB (≤12 kalem ve ≤6k) · içerik köksüz mesaj · hiç aday yok · hata → TAM küme (legacy).
11. **Kanıt**: `kbEvidenceJson.retrieved[].{id,v,c}` + `.retrieval{q,fb,sel,cand,ms,srcs,sup,conf}`; PII yok.

### Veri akışı (hibrit AÇIK)

```
kb-fetch (mülk + isActive + ONAY KAPISI; take 200, updatedAt desc; supersededById seçilir)
  → yüzeyin sır elemesi (QR: kategori + içerik; oto-yanıt: onaysız konaklamada aynı)   ← DEĞİŞMEDİ, seçicinin ÖNÜNDE
  → selectKbForPrompt(items, guestMessage, history)  [§2.1 adımları]
  → suggestReply(knowledgeBase = parçalar, knowledgeBaseDropped += seçilmeyen, knowledgeBaseSelection="retrieved")
      istem notu: "[NOT] … SORUYA GÖRE SEÇİLDİ; N kalem alınmadı. Sorulan konu yukarıda yoksa 'bilgi yok' DEME — insana devret."
  → RiskEvent: kbRetrieved = parça sayısı, kbDropped = toplam düşen, kbEvidenceJson (yukarıda)
```

### Değişmezler (test-pinli; iki yönlü mutasyon: dilim 1 20/20, dilim 2 §3b'de)

- Bayrak kapalı = **kimlik**. Retrieval modülü **DB'ye erişmez, kalem ekleyemez, metni değiştiremez** (parça = `content.includes`).
- Yetki/mülk/onay/sır filtreleri **retrieval'ın önünde**; önbellek süzülmüş kümenin parmak izini anahtarlar.
- **Hibrit legacy'den az bilgi taşımaz** (geri çekilme sınıfları). **Çelişki gizlenmez** (kategori-bağımsız saat kuralı).
- **Sürüm kuralı**: halefi kümede olan kalem düşer; halefi olmayan (pasif/silinmiş) korunur. **Tazelik** yalnız eşitlik bozucu.
- Silinen/pasif/onaydan düşen kalem indekste yaşayamaz; içerik değişince (misafir adı ikamesi) parmak izi değişir.
- Kanıt PII'siz; misafire dönen gövde kanıt taşımaz. Bayrak **tek** yerde okunur (`retrieval/flag.ts`).
- **Host graf katmanı misafir yoluna taşınmaz** (retrieval modülü + QR rotası + guest-chat onu import etmez, pin).

---

## 3. Baseline ölçümü (model YOK) — `docs/olcum/kb-retrieval-baseline-2026-09-09.md`

13 Codex senaryosu (uzun metin ortası ×2, eşanlam, EN, yanlış kategori, çok soru, çelişki, kötü niyetli kaynak, yazım hatası,
bağlam, büyük harf, selamlaşma, isabet yok): legacy `long_middle_oldest` ❌ → hibrit ✅; isabetli senaryolarda blok
2.9k–7.8k → 0.2k–0.9k karakter; gürültü 20–30 → 0–2; geri çekilmede blok legacy ile birebir; 3–23 ms.

## 3b. Ölçek ölçümü — 30 / 100 / 300 kalem, GERÇEK retrieval yolu — `docs/olcum/kb-retrieval-scale-2026-09-09.md`

Sentetik mülk KB'leri (36 konu × 3 TR paraphrase + EN; TR/EN/eşanlam/yazım sorusu; n/10 çeldirici; her 50 kaleme 7k rehber
+ 3 gömülü gerçek; `updatedAt` 400 güne tohumlu). Üretici `tests/unit/kb-retrieval-scale.test.ts` (CI'da kapı).

| n | Yapılandırma | hit@1 | hit@3 | inPrompt | gürültü | karakter | soğuk ms | ılık p95 |
|---|---|---|---|---|---|---|---|---|
| 30 | legacy | — | — | 90% | 29.1 | 4371 | — | — |
| 30 | hibrit bm25 | 94% | 100% | 100% | 0.8 | 352 | 14.2 | 3.3 |
| 30 | hibrit RRF | 93% | 99% | 100% | 1.8 | 718 | 8.9 | 3.5 |
| 30 | **hibrit CombSUM (varsayılan)** | 94% | 99% | 100% | 1.0 | 457 | 5.9 | 3.5 |
| 100 | legacy | — | — | **51%** | 29.3 | 4513 | — | — |
| 100 | hibrit bm25 | 93% | 97% | 99% | 2.7 | 726 | 27.4 | 5.6 |
| 100 | hibrit RRF | 91% | 95% | 99% | 5.3 | 1475 | 15.3 | 5.5 |
| 100 | **hibrit CombSUM** | 92% | 96% | 99% | 2.8 | 830 | 15.1 | 5.7 |
| 300 | legacy | — | — | **59%** | 29.2 | 2925 | — | — |
| 300 | hibrit bm25 | 93% | 94% | 99% | 3.3 | 1220 | 54.5 | 7.9 |
| 300 | hibrit RRF | 91% | 93% | 99% | 4.3 | 1439 | 52.4 | 8.2 |
| 300 | **hibrit CombSUM** | 94% | 95% | 99% | 3.6 | 1325 | 48.4 | 7.9 |

Güncelleme sonrası yeni metin 10/10, silme sonrası geri gelmeme 10/10 (her boyut). Soru türüne göre inPrompt (CombSUM):
guide 3/3 · tr 38/38 · en 38/38 · syn 37/38 · typo 38/38 (n=100/300).

**Okumalar (dürüst):**
- Legacy'nin açığı ölçekle büyür: 100+ kalemde doğru kaynak soruların yarısında modele gitmiyor.
- **n-gram kaynağının bu sentetik sette isabete marjinal katkısı ≈0** (bm25-yalnız hit@1 eşit ya da ±1 puan), bedeli
  hafif: gürültü +0.1–0.3 kalem, blok +14–30% karakter. Kök sökücü iyileştikçe ("ünsüz yumuşaması", yeni ekler) n-gram'ın
  kapattığı boşluk daraldı. Varsayılan AÇIK bırakıldı çünkü kök sökücünün kaçırdığı biçimleri yakalayan test-pinli durumlar
  var ("otoparkının"); `sources.ngram=false` ile kapatılabilir. **Karar kurucunun** (gerçek veride `retrieval.srcs` ile ölçülür).
- **CombSUM ≥ RRF** her boyutta (hit@1 +1–3 puan, gürültü −0.7–2.5 kalem, karakter −8–44%): RRF sıra farkını siliyor.
  Varsayılan ölçümle seçildi.
- **Mutasyon turu (dilim 2):** 14 mutasyon + kontrol koşusu. İlk turda kontrol koşusu KIRMIZIYDI (fixture hatası) → 6 "yakalandı"
  sahteydi; düzeltildi, tur tekrarlandı. Kontrol yeşilken hayatta kalan 5 mutasyon (başlık tam örtüşme, n-gram zayıf-terim
  süzgeci, fuzzy başlık bonusu, kanıt sup/conf, kb-fetch supersededById) için ayırt edici testler eklendi; iki n-gram
  süzgeci (zayıf-terim, eşik-altı sıfırlama) `hasEvidence` yüklemi geldikten sonra GEREKSİZ kaldığı için KALDIRILDI
  (hayatta kalan mutant = test edilemeyen kod). Son tur: kontrol yeşil, 17 mutasyonun tamamı yakalandı.
- **"Cevabın kaynakla desteklenmesi" burada ÖLÇÜLMEZ** — modelsiz harness yalnız "doğru kaynak modele gitti mi"yi ölçer.
  Modelin o kaynağı kullanıp kullanmadığı `srcVerified`/`kbEvidenceJson.used` ile gerçek eval'de ölçülür (§8 sırası).
- 300 kalem plan tavanının (60) üstündedir; hibritte `kb-fetch` okuma tavanı 200.

---

## 4. Veri akışı garantileri (Codex şartları ↔ kod)

| Şart | Nerede |
|---|---|
| Bağlam koruyan parçalama | `chunker.ts` (cümle sınırı, bitişik dilim, başlık "(i/n)"); onay kapısı `kb-fetch` içinde |
| TR/EN ve eşanlamlı sorgular | `text.ts` katlama+kök, `lexicon.ts` ~45 kavram; ölçek harness'ı tr/en/syn/typo sütunları |
| Kelime+vektör adaylarının birleştirilmesi | `sources.ts` (n-gram, bugün) + `semantic.ts` sözleşmesi (gömme, onay) → `fusion.ts` CombSUM/RRF |
| Reranking | `rerank.ts` (ipucu/başlık/kalıp/tazelik) |
| Kaynak sürümü / güncellik | `supersededById` kuralı; tazelik eşitlik bozucu; kanıt `v` = kalem `updatedAt`; güncelleme/silme testi 10/10 |
| Çelişki kontrolü | `preserveTimeConflicts` (kategori-bağımsız saat) + `findTimeConflicts` (P4-b, istem) + kanıt `conf` |
| İşletme/mülk/onay kapsamı her aşamada | girdi zaten süzülmüş; önbellek küme parmak izi; graf saf modül, yetki grafın önünde |
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

Sorgular: `stayOfSignal` (doğrudan ya da konuşma üzerinden konaklama çözümü), `recurringIssues` (pencere, kategori,
bildirim sayısı, **farklı konaklama sayısı**, bağlanamayan bildirimler AYRI, ilk/son zaman, kanıt sınıfı
`reported_only | task_open | task_done`, kenar kaynakları). **'confirmed' diye bir değer yoktur** (pin): görev kaydı
host'un iş açtığının kanıtıdır, arızanın doğrulandığının değil.

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

---

## 7. P5 açık — RAG bunu kapatmaz

P5 = **kanıtsız eylem/söz iddiası için KOD KAPISI** (`unverifiedActionClaims` dedektörleri `tests/helpers/` içinde,
ürün koduna taşınmadı; `actionReceipt` uygulanmadı). Retrieval modele **daha doğru bilgi** verir; modelin
"ilettim / döneceğim" demesini **engellemez** — o, istem (P1, uygulandı) + kapı (P5, ONAY BEKLER) işidir.

---

## 8. Sıra (önerilen)

1. **Dilim 1+2** (bayrak kapalı) → CI → deploy (davranış aynen). ✅ kod hazır.
2. Eval setine **uzun rehber + 30+ kalem** sınıfı — hibritin gerçek model üzerindeki etkisi ("cevap kaynakla destekleniyor mu",
   `srcVerified`, `kbEvidenceJson.used`) ancak böyle ölçülür; mevcut 8 senaryo küçük KB → passthrough.
3. Kurucu: `KB_RETRIEVAL_MODE=hybrid` ile eval; baseline = aynı koşu bayraksız → fark tablosu.
4. Tek test mülkü + RiskEvent `retrieval.fb/srcs/sup/conf` dağılımı → genişletme kararı.
5. Kalan başarısız örnekler (§3b: syn 1/38; hit@1 ≈%6 kaçak) için **önce sözlük/kök**; ancak sonra HyDE / agentic yeniden arama
   (ücretli, #7).
6. Gömme kaynağı **yalnız** sözcüksel+n-gram isabet oranı gerçek veride yetersiz bulunursa (#3).
7. LightRAG/HippoRAG deneyi **yalnız** §6.2 kabul ölçütüyle (#5/#6).

## 9. Bilinen sınırlar (dürüst)

- Kök alıcı kural tabanlı; yanlış birleştirme mümkün, simetrik olduğu için kaçırma üretmez. Ölçülmüş çarpışmalar
  düzeltildi: "varış→var" (iki kez), "şu→su", "ki" eki, "açılıyor→acil" (kabul edilen sınır).
- Sözlük ~45 kavram; eksik kavram sözcüksel isabete düşer. Sentetik set 36 konu — gerçek host KB'leri farklı kelime
  seçebilir; gerçek veride `retrieval.fb` dağılımı ölçülmeden genelleme yapılmaz.
- n-gram kaynağı yazım benzerliğidir, anlamsal değil; sentetik sette katkısı ≈0 (§3b).
- Hibrit AÇIKKEN sır süzgeçleri 200 kaleme kadar tarar (kalem başına 0.7–3.2 ms).
- Graf katmanı bugün hiçbir yüzeye bağlı değil (saf modül + testler); host UI bağlantısı ayrı iş.
