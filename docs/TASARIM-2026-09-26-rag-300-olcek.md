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

### 4c. Gerçek müşteri boyutu ve blok bütçesi (09-27, ücretsiz — yalnız önbellek)

Ürün mülk başına en çok **60 aktif kayda** izin verir (plan tavanı, kurucu dahil). Ölçer artık "soru başına N kalemlik bilgi
tabanı" kurar (`EVAL_RAG_KB=perq`, `kbForQuery`: cevap kalemi + tam setten soruya göre tohumlanmış GÜNCEL dolgu; metinler tam
setle birebir → gömme/anlama önbellekte, 0 soru düştü). Ölçü: cevap cümlesi istem bloğunda mı; yeniden sıralayıcısız (o boyutta
sıralayıcı çıktıları önbellekte yok).

**60 kalem** (`docs/olcum/rag-lab-2026-09-27-2.md`, `-3.md`; TR / diğer diller / iki soru, %):

| Blok bütçesi | Yalnız sözcüksel | Yeni gömme | Blok ort. (yeni gömme) |
|---|---|---|---|
| 6k karakter / 12 parça (bugün) | 93 / 89 / 63 | 95 / 98 / 71 | 3,6k |
| 9k / 18 | — | 97 / 99 / 84 | 5,0k |
| 12k / 24 | 94 / 95 / 78 | 99 / 99 / 88 | 6,4k |
| 24k / 40 | 95 / 95 / 83 | **100 / 99 / 98** | 9,4k (p95 12,6k) |

**276 kalem** (`-27.md`, eşleştirilmiş alt küme, 41 soru düştü):

| Blok | Yeni gömme, sıralayıcısız | + ayrı çağrılı yeniden sıralama |
|---|---|---|
| 6k / 12 | 76 / 83 / 30 | 93 / 99 / 86 |
| 12k / 24 | 91 / 95 / 55 | 93 / 99 / 90 |
| 24k / 40 | 97 / 97 / 77 | **97 / 100 / 92** |

Yanıtsız soruda blok büyür (11,5 → 21 → 34 parça); geri çekilme ve sızıntı 0. **Gerçek boyutta en büyük kayıp BÜTÇE:** iki
sorulu mesajda cevap aday listesinde ama 6k/12 bloğa sığmıyor. ≤30 kalem / ≤24k bilgi tabanı bugün zaten TAMAMEN (24k'ya
kadar) isteme gidiyor; 31. kalemde bütçe birden 6k'ya düşüyor (uçurum). Sektör: OpenAI'nin dosya arama aracı varsayılan 20
parçaya kadar (parça ~800 token) döndürür; Anthropic'in "contextual retrieval" ölçümünde ilk 20 parça ilk 5/10'dan iyiydi.
Açık risk: uzun blokta cevap modelinin yanlış olguya sapması / dikkat dağılması — cevap düzeyi ölçüm ücretli (kredi bekliyor).
Maliyet: 24k/40'ta cevap isteğine ortalama ~+1,6k token (~0,2 sent/mesaj). **Kurucu kararı 09-27: "hazırla, sonra aç"** →
`KB_RETRIEVAL_WIDE_BUDGET` (varsayılan KAPALI; tek karar noktası `ai/kb-retrieve.ts`; kanıt `wb: 1`; `c9c7614`). Değer
**23.000 / 40** (24k değil): paketleyici satır başına seçicinin hesabından 1 karakter fazla sayar ve kendi tavanı 24k — tam dolu
24k seçimde son parça sessizce "alınmadı" olurdu (kesin dolan fikstürle pinli; 23k ile ölçülen sonuçlar 24k ile birebir).
Çağıranın kendi bütçesi önceliklidir (ölçer); küçük bilgi tabanı ve legacy etkilenmez. Açma: kredi gelince cevap düzeyi ölçüm
(± anahtar) + kurucu onayı. Bilinen etki (güvenli yön, küçük bilgi tabanındaki bugünkü davranışla aynı): blok büyüyünce mülk
saatiyle çelişen eski bir kalem bloğa daha sık girer → istemin çelişki listesi dolar, o alana değen cevap taslağa düşer
(`kb_time_conflict`); ilgisiz sorunun cevabı etkilenmez.

### 4d. Kalan kaçakların teşhisi ve saat alanı yanlış alarmı (09-27, ücretsiz — yalnız önbellek)

276 kalemde üç bayrak açıkken (yeni gömme + soru başına sıralama + geniş blok) kalan 9 cevap kaybı teşhis edildi: 4'ü sıralama
penceresinin dışında (biri kendi listesinde 3. sırada — RRF tek listedeki üst adayı gömüyor; `wfloor10` / `wper50` ücretli ölçümde),
4'ünü model "cevaplıyor" diye işaretlemedi (model kaçırması), **1'ini model işaretledi ama blokta yok**: işaretler tüm listelere
uygulanınca anlama katmanının dört sorgusunun başı ortak işaretli parçalar oldu, "aynı konuyu tekrar eden ek sorgu" kuralı dördünü
de atladı; o cevap yalnız bu sorgulardan geliyordu (blokta 30'dan fazla ilgisiz parça vardı).

| deney (eşleştirilmiş, 337 soru) | geniş blok | 6k/12 yeni hat | 09-26 canlı hattı |
|---|---|---|---|
| `answersFirst` ("cevaplıyor" işaretli parçalar önce, ek sorgu payı/tekrar kuralı dışında) | +1 / kayıp 0 | +3 / kayıp 2 | +1 / 0 |
| tekrar kararı yeniden sıralamadan ÖNCEKİ sırayla | +1 / kayıp 3 | +3 / kayıp 2 | +1 / kayıp 2 |
| çelişki çekmesi kapalı (yalnız üst sınır deneyi) | +2 / 0 | +2 / 1 | +1 / 2 |

`answersFirst` ölçüm seçeneği olarak eklendi (varsayılan KAPALI, birebir); 6k/12'de kayıp verdiği için varsayılan yapılmadı —
geniş blokla birlikte ücretli temiz ölçümde yeniden bakılır. Diğer ikisi elendi (çelişki koruması bir güvenlik özelliği; kazancı ±1–2).

**Saat alanı yanlış alarmı — KAPANDI (09-27, kurucu onayı: "yayınla kapıları yapıp o saat kuralını en iyi şekilde yap, didik
didik").** Aynı ölçümde bloğa giren kalemler mülkün giriş/çıkış saatiyle (`findTimeConflicts`, gönderim kapısının `kb_time_conflict`ı ve
istemin mülk saatini gizlemesi) çelişki üretiyordu: 60 kalemlik gerçekçi bilgi tabanında soruların **%30'u** (geniş blokla **%58**),
giriş/çıkış sorularının %43'ü (%57). Çoğu yanlış alarmdı:

| bugün "saat" sayılan ifade | okunan | gerçekte |
|---|---|---|
| "21.00'den sonra varacaksanız, önceden bildirin" (kategori ödüncü) | giriş 21:00 | geç varış koşulu |
| "Çok geç (01.00 sonrası) varışlarda sessiz olun" | giriş 01:00 | geç kalış anlatımı |
| "12.00 ile 14.30 arasında valiz bırakabilirsiniz" | giriş 12:00/14:30 | valiz penceresi |
| "19.00–24.00 arası araç girişi yasaktır" | giriş 19:00 | araç girişi (kapı) |
| "sahil yolunda 19.00–22.00 arası sokak müzisyenleri çıkıyor", "son otobüs 23:00'te çıkıyor" | çıkış 19:00/22:00, 23:00 | "çık-" fiili, çıkış değil |
| "girişin arkasındaki kapıdan çıkınca … 08:00–22:00 açıktır" | giriş 08:00/22:00 | girişin YERİ |

Düzeltme iki turda yapıldı (`retrieval/time-fields.ts`, tek kaynak — üç tüketici aynı kuralı okur). Birinci tur yukarıdaki sınıfları
kapattı; ikinci tur, kuralları GÖRMEMİŞ bir ajanın yazdığı kör bataryanın (115 cümle) gösterdiği sınıfları: erişimin başladığı an giriştir
("kapı kodu 15:00'ten itibaren çalışır", "keys are yours from 2 pm"); müsaitliğe bağlı izin istisnadır ("daire hazırsa 13:00'te
girebilirsiniz" → erken giriş, "müsaitliğe göre 12:00'ye kadar" → geç çıkış; "değilse / otherwise" koşulu kapatır, "bile / normal /
standart" eşlemez); konaklamanın başı/sonu ("konaklamanız 15:00'te başlar"), konaklama yerini boşaltmak ("daireyi 11.00'de boşaltmanızı",
"vacate the apartment") çıkıştır; havuz barı / havlusu / bilardo masası, sauna, ders, bakım havuz/spor saati değildir; gönderim anı ("kodu
10:00'da gönderiyoruz", "check-in guide at 10am") ve iletişim penceresi ("ekibimize 09:00-18:00 arası yazabilirsiniz") hiçbir alanın
saati değildir; "gir-" fiili yalnız konaklama yerine / misafire hitapla giriştir ("havuza 21:00'den sonra girmek yasak" havuzdur); koşul
parçasındaki / önceki tire parçasındaki ulaşım ana parçanın saatini aracın saati yapar ("transfer ayarladıysanız şoför 10:30'da bekliyor");
uzun tire iki yanı cümlecikse böler ("Giriş – 15:00" etiketi ve "09:00 – 20:00" aralığı bölünmez).

| ölçüm | canlı kural (`7382338`) | yeni kural |
|---|---|---|
| iki yönlü batarya (`tests/helpers/time-field-battery.ts`, gerçek / tuzak) | 81/108 · 32/101 | **108/108 · 101/101** |
| kör batarya 1 (115 cümle; ikinci turda bakıldı → artık "görüldü") | 43/59 · 30/56 | 57/59 · 56/56 |
| 60 kalem, mülk saatiyle çelişen soru (yanlış alarm) | %30 (geniş blokla %58) | **%3,9 (%12,9) — hepsi gerçek** |
| 276 kalemlik dev setinde okunan gerçek saat | — | ilk turla birebir (kayıp yok) |

Kalan %3,9 / %12,9'un tek kaynağı dev setine bilerek konmuş gerçek çelişkidir ("standart çıkış saati en geç 12:00" ↔ mülk 11:00): tutulması
doğrudur. Kör bataryanın kalan iki farkı bilinçlidir: yere bağlı sessizlik kuralı ("havuz başında 22:00'den sonra müzik yasak") cümlecikte
iki alan (havuz + sessizlik) adlandırır → hüküm yok; genel sessizlik saati sayılsaydı "sessizlik 23:00" kalemiyle sahte çelişki notu
üretirdi (bataryada `soft`). Bilinen sınırlar: İngilizce "by 11 am" bir teslim tarihi de olabilir (çıkış sayılır); "noise" sözcüğü köke
inerken durak sözcüğe düşüyor — saat kuralı ham sözcüğe bakıyor, retrieval tarafı ayrı iş.

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
3. Cevap düzeyi ölçüm (`EVAL_RAG_ANSWER=1`; geniş blok ± `KB_RETRIEVAL_WIDE_BUDGET` eşleştirilmiş — uzun blokta yanlış
   olguya sapma var mı), E4 sentetik setinin yeni hatla tekrarı.
4. Kurucu kararı: `OPENAI_EMBEDDING_MODEL=text-embedding-3-large`, `KB_RERANK_PER_QUESTION=1` ve `KB_RETRIEVAL_WIDE_BUDGET=1`.

### 6a. Kredi gelince — komutlar (🚨 kurucu "kredi yüklendi" demeden HİÇBİRİ koşulmaz; 09-27 kuralı)

Ortak önek (bulutta proxy şart; anahtar ortamdan): `NODE_USE_ENV_PROXY=1 RUN_REAL_EVAL=1`. Önerilen canlı hat (üç bayrak açık
hâlinin ölçerdeki ikizi): `FINAL = s0.25+und+prodwin+dl2500+cap400+e3l+wide` (`wide` üretim sabitlerini okur). Önbellek
`/tmp/lixus-rag-lab-cache` korunursa 09-26 gece çağrıları yeniden ödenmez.

| adım | ne | komut (ortak önekten sonra) | tahmini |
|---|---|---|---|
| 0 | deneme (her 10. soru) | `EVAL_RAG_KB=scale EVAL_RAG_SCALE_SIZES=0 EVAL_RAG_GROUPS=single_tr,single_xx,multi,neg EVAL_RAG_PAID_GROUPS=single_tr,single_xx,multi,neg EVAL_RAG_SAMPLE=10 EVAL_RAG_CONFIGS=FINAL npm run eval -- tests/eval/rag-lab.eval.test.ts` | ~1 $ |
| 1 | temiz dev (276) | aynı, `EVAL_RAG_SAMPLE` yok, `EVAL_RAG_CONFIGS=FINAL,FINAL+wper50,FINAL+demote` | ~4 $ |
| 2 | holdout kabulü | `EVAL_RAG_KB=holdout` + 1. adımda seçilen tek yapılandırma. 🚨 YALNIZ `.md` toplu tablosu okunur; yan JSON AÇILMAZ | ~5 $ |
| 3 | cevap düzeyi, 60 kalem | `EVAL_RAG_ANSWER=1 EVAL_RAG_ANSWER_KB=perq EVAL_RAG_ANSWER_CONFIGS=s0.25+und+e3l,s0.25+und+e3l+wide npm run eval -- tests/eval/rag-answer.eval.test.ts` | ~1 $ |
| 4 | cevap düzeyi, 276 | `EVAL_RAG_ANSWER=1 EVAL_RAG_ANSWER_CONFIGS=s0.25+und+prodwin+dl2500+cap400+e3l,FINAL` (aynı dosya) | ~1 $ |

Okuma: 0. adımın `çağrılar` satırı soru başı maliyeti verir → 1–4 yeniden tahmin edilir, kurucuya söylenir. Cevap düzeyinde
geniş blok ANCAK şu ikisi birlikte tutarsa açılmaya önerilir: `sayı cevapta` düşmez VE `yabancı sayı` (başka kalemin olgusu) +
yanıtsız soruda `desteksiz iddia` artmaz (eşleştirilmiş; aynı sorular). Kabul kapısı §1.
