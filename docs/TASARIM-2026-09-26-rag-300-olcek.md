# RAG 300 kalem ölçeğinde ≥%95 (#189) — ölçüm, değişiklikler, açık kalanlar (2026-09-26 gece)

> Kurucu (09-26 gece, /loop): "300 kalemlik bilgi tabanında bile yüzde 95 olmalı minimum … migration gerekiyorsa yaz …
> oranı sen ver." Codex'in önerdiği sıra (önce ölçer, sonra aday geri çağırma, soru başına kanıt, gerçek 300 ölçeği, kabul
> kapısı) mantıklı bulundu ve izlendi; reddedilmiş fikirler (mutlak alaka eşiği, kategori tahmini, en-yeni-30 geri
> çekilmesi) yeniden açılmadı. GraphRAG/HyDE ilk darboğaz çıkmadı.
>
> 🚨 **09-26 gece OpenAI kredisi BİTTİ** (gece ölçümleri tüketti). Bu yüzden ayrı çağrılı yeniden sıralamanın temiz ölçümü,
> holdout kabul koşusu ve cevap düzeyi ölçüm YAPILAMADI; maliyeti artıran her değişiklik bayrak arkasında, açma kararı
> kurucuda. Aynı anahtar canlıda da kullanılıyorsa canlı yapay zekâ cevap üretemez (güvenli yedek: otomatik gönderim yok).

## 1. Hedef ve kabul kapısı (önerilen oran)

Kurucu "%95'i sen ver" dedi. Önerim — **gerçek 300 kalemlik, geliştirmede görülmemiş holdout** üzerinde:

| Ölçü | Hedef |
|---|---|
| Tek soru, Türkçe parafraz: cevap cümlesi bilgi bloğunda | ≥ %95 |
| Tek soru, Türkçe dışı dil: cevap cümlesi bilgi bloğunda | ≥ %95 |
| İki sorulu mesaj: İKİ cevap da blokta (mesaj düzeyi) | ≥ %90 (cevap düzeyinde ≥ %95) |
| Yanıtsız soru: blok küçük kalır, geri çekilme yok, cevapta desteksiz somut iddia yok | 0 uydurma |
| Kiracı / sır / onay sınırları | 0 sızıntı (mevcut pinler + ölçerin `sızıntı` sütunu) |
| Gecikme | yeniden sıralama p95 ≤ 2,5 sn (sıcak yol tavanı zaten bu) |
| Maliyet | mesaj başına ek maliyet raporlanır, kurucu onaylar |

İki sorulu mesajda mesaj düzeyi hedefin daha düşük olması bilinçli: iki bağımsız %95 olasılığın ikisi birden ≈ %90'dır; Codex'in
notu da doğru — 39 örnekte %95 = 38/39, tek kayıp sonucu değiştirir, bu yüzden kabul BÜYÜK ve görülmemiş kümede verilir.

## 2. Ölçer (RAG lab, `tests/eval/rag-lab/`)

- **Aşama bazlı kayıp:** her kaçan cevap için okuma (okuma tavanı / onay süzgeci) → parça (iğne parça sınırında bölünmüş) →
  geri çekilme → eşik (aday listesinde yok) → pencere (aday listesinde ama yeniden sıralayıcıya gösterilmedi) → bütçe(rr)
  (pencerede ama 6k/12 parça bloğuna girmedi) → bütçe → kırpma (600 karakterde iğne yok) ayrı sayılır. "Kuru" koşu modelsiz
  pencere tavanını verir.
- **Veri:** gerçekçi dev seti (`evals/rag-scale/dev.json`, 276 kalem: uzun rehberler, eski tek kopya kayıt, sürümler,
  çelişkiler, iki dil, yanıtsız sorular, "Ayrıca" dışındaki iki soru biçimleri). Ayrı **kör holdout** (`holdout.json`,
  299 kalem / 472 olgu) — içeriği okunmadı; yalnız son kabulde, yalnız toplu sayıyla raporlanır.
- **Taban:** `base0926` = 09-26 gece öncesi canlı hâl (small gömme, eşik 0,4, ilk 20 aday, 600 karakter, 2,5 sn, okuma 200) —
  sabitler değişse de kıyas tabanı sabit.
- Tüm model çıktıları disk önbellekli (tekrar koşu ücretsiz), gecikme yanına yazılır (p50/p95), geçici ağ hatası yeniden denenir.
- **Cevap düzeyi** (`rag-answer.eval.test.ts`): seçilen blok üretimin cevap modeline verilir, cevap KODLA ölçülür (sayılı
  cevapta sayı, "bilgim yok" itirafı, devir, yanıtsız soruda desteksiz iddia). LLM hakem yok. KOŞULMADI (kredi).

## 3. Bulgular (taban, dev, grup başına 111 / 120 soru)

| Aşama (taban) | Tek soru TR | Diğer diller | İki soru |
|---|---|---|---|
| Blokta | 77/111 (%69) | 81/111 (%73) | 40/120 (%33) |
| Okuma tavanında (200) kaybolan cevap | 24 | 24 | 39 |
| Pencerede değil (ilk 20 dışı) | 7 | 4 | 47 |
| Aday listesinde değil (eşik) | 2 | 1 | 8 |

Kaybın iki büyük kaynağı: **okuma tavanı** (en eski kalemler seçiciye hiç ulaşmıyordu) ve **iki sorulu mesajda pencere**
(mesaj 6–8 alt sorguya bölünüyor, sırayla ilk 20'de liste başına ~3 aday kalıyordu). Eşik ve gömme modeli üçüncü sırada.

## 4. Değişiklikler

| Değişiklik | Durum | Etkisi |
|---|---|---|
| Misafir adı / daire no ikamesi seçimden SONRA (`63fe778`) | CANLI | Her yeni misafirin ilk mesajında anlamsal arama soğuyordu (ada göre farklı metin → önbellekte yok); sır kararı yine doldurulmuş metinle |
| Vektör ısıtması yazma anında + açılışta (`6597221`) | CANLI (anahtar açıkken) | Yayından/yeniden başlatmadan ve KB düzenlemesinden sonraki ilk mesaj artık anlamsal |
| Okuma tavanı 200 → 400 | CANLI | Bugün plan tavanı mülk başına 60 aktif kalem → canlıda etkisiz; ölçekte okuma kaybı 0 |
| Gömme modeli `OPENAI_EMBEDDING_MODEL=text-embedding-3-large` (1536'ya kısaltılmış) + modele göre eşik (large 0,25) | env ile, varsayılan small | Yeniden sıralayıcısız blok: TR 77→83, diğer diller 76→93 /111; iki soruda adaya hiç girmeyen cevap 7→0 |
| Soru başına yeniden sıralama penceresi + ayrı paralel çağrı (`a1fdc0a`) | bayrak `KB_RERANK_PER_QUESTION`, varsayılan KAPALI | Kuru tavan (cevap düzeyi) iki soru %74→%97; tek çağrılı ölçümde iki soru %33→%50 |
| Anlama sorgusu alt sorguyla aynıysa liste o soruya işaretlenir | bayrakla birlikte | Mantık hatası kapandı; dev setinde ölçülen etkisi 0 (8 çakışmanın hepsinde soru zaten kendi penceresini alıyordu) |

**Yeni hat (dev, `docs/olcum/rag-lab-2026-09-26-11.md`; large + 0,25 + soru başına pencere TEK çağrıda + okuma 400):**

| Grup | Taban | Yeni |
|---|---|---|
| Tek soru TR | %69 | **%95** |
| Diğer diller | %73 | **%99** |
| İki soru (ikisi birden) | %33 | %50 |
| Sürüm (eski kayıt yerine güncel) | %67 | %100 |
| Çelişki | %100 | %100 |
| Yanıtsız soruda geri çekilme | 2 | 0 |
| Sızıntı | 0 | 0 |
| Yeniden sıralama p50 / p95 | 950 / 1.383 ms | 997 / 1.478 ms |
| İstek boyu (ort.) | 5,8 bin karakter | 12 bin karakter |

İki sorulu mesajda kalan kayıp: pencerede olduğu hâlde bloğa girmeyen cevap 51/240 — tek çağrıda ~90 aday sorulunca model
cevapların ~%21'ini işaretlemiyor (tek soruda ~50 adayla %2). Çözüm üretimde yazıldı: her soru AYRI çağrı. Temiz ölçümü kredi
bittiği için yarım kaldı (yarım koşu geçersiz sayıldı, rapora girmedi).

### 4b. Ücretsiz ön tahmin — yarım koşunun önbellekteki çağrılarıyla (09-26 gece, kredi bittikten sonra)

Ölçere "yalnız önbellek" kipi eklendi (`RAG_LAB_OFFLINE=1`, önbellekte olmayan çıktı ağa çıkmadan hata) ve **eşleştirilmiş alt
küme** (`RAG_LAB_OFFLINE_SKIP=1`: önbellekte olmayan soru TÜM yapılandırmalardan çıkarılır). Yarıda kalan ayrı çağrı koşusunun
başarılı çağrılarıyla (`docs/olcum/rag-lab-2026-09-26-12.md`; 25 soru çıkarıldı, iki soruda 97/120 kaldı — alt küme rastgele
DEĞİL, tam ölçümün yerini TUTMAZ):

| Grup (alt küme) | Taban | Tek çağrı | **Ayrı çağrı** |
|---|---|---|---|
| İki soru (ikisi birden) | %33 | %49 | **%86** |
| Tek soru TR | %69 | %94 | %93 (yalnız ayrı çağrıya 2,5 sn tavanı uygulandı) |
| Diğer diller | %73 | %99 | %99 |

Gecikme (kayıtlı süreler, aynı alt küme): taban p50 950 / p95 1.363 ms → ayrı çağrı p50 1.121 / p95 1.737 ms (paralel
çağrıların en yavaşı); istek boyu ortalama 5,8 bin → 17,3 bin karakter (~3 kat).

Aynı önbellekle (pencere değişmediği için ücretsiz) ablasyonlar: ayrı çağrıda soru başına etiket (`prl`) +1 soru; atla-paketle
(`skip`), kalem başına 5 parça (`pi5`), anlama sorgusu payı 1/2 (`xs0.5`) **fark yok** → üretime alınmadı. Modelin
görüp işaretlemediği adayı görülmemişlerin arkasına atmak (`demote`, `-14.md`): iki soru +1, diğer diller +1 (pencere dışı
cevap bloğa girdi), TR aynı, yanıtsız soruda blok boyu / geri çekilme aynı — 318'de +2, kesin ölçüme aday (üretime alınmadı). Ayrı çağrıda kalan
kayıp: pencere dışı (iki soru 4 cevap, TR 4), model işaretlemedi (iki soru 9, TR 2), işaretlendiği hâlde bloğa girmedi (iki soru
3 — üçü de saat çelişkisi notlu satırlar; çelişki partnerleri bütçeyi alıyor), 600 karakter kırpma iğneyi kesti (TR 1), 2,5 sn
tavanı (TR 1).

**Pencere kuruluşu (modelsiz tavan, tam dev örneklemi, `-13.md`; pencere dışı kalan cevap):** bugünkü 40+10 → iki soru 6/240,
TR 4/111, diğer 1/111 · **istek başına 50 → 2 / 3 / 1** · liste tabanı 10 (`wfloor10`) 5 · RRF taban (`wownrrf`) 6 · taban 20
(`wown20`) 5. Seçenekler üretimin `rerankCandidateWindows` işlevinde (varsayılan birebir bugünkü); 50'ye geçmek çağrı başına
+%25 aday demek — kredi gelince son blok etkisiyle birlikte ölçülüp karara bağlanır.

## 5. Codex'in "sınanması gerekenler"i

- **Sığmayan ilk parçada `break` / kalem başına 3 parça:** ölçüldü (↑§4b, ücretsiz): fark YOK — değiştirilmedi.
- **Düz etiket her alt sorguda:** ayrı çağrılarda soru başına etiket (`prl`) ölçüldü: +1 soru (97'de) — şimdilik üretime
  alınmadı. Tek çağrıda soru bazlı etiket (`pq`) ücretli, ayrı çağrı yolu seçildiği için önceliksiz.
- **600 karakter kırpma ablasyonu:** ücretli (istek değişir); kırpma sütunu aşama tablosunda bilgi olarak var (TR 2, diğer 2).
- **Kalıcı vektör deposu (migration):** gerek görülmedi — `cold` kaybı yazma/açılış ısıtmasıyla kapatıldı; depo tahliyesi
  ölçümde görülmedi. Migration YOK.

## 6. Açık kalanlar (sıra)

1. Kredi gelince: ayrı çağrılı yeniden sıralamanın temiz dev ölçümü (istek başına 40 ve 50 pencereyle, ± `demote`), maliyet +
   p95. Tahmini maliyet (gpt-5.1 liste fiyatıyla, yaklaşık): dev ölçümü ~4 $, holdout kabulü ~5 $, cevap düzeyi ~2 $ —
   önce ~1 $'lık küçük deneme (`EVAL_RAG_SAMPLE` büyük) + kurucu onayı.
2. Holdout kabul koşusu (yalnız toplu sayı) — §1 kapısı.
3. Cevap düzeyi ölçüm (`EVAL_RAG_ANSWER=1`), E4 sentetik setinin yeni hatla tekrarı.
4. Kurucu kararı: `OPENAI_EMBEDDING_MODEL=text-embedding-3-large` ve `KB_RERANK_PER_QUESTION=1`.
