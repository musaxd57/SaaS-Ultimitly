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
| İki sorulu mesaj: İKİ cevap da blokta (mesaj düzeyi) | ≥ %95 (kurucu alt sınırı; 09-27'ye kadar burada %90 yazıyordu) |
| Yanıtsız soru: blok küçük kalır, geri çekilme yok, cevapta desteksiz somut iddia yok | 0 uydurma |
| Kiracı / sır / onay sınırları | 0 sızıntı (mevcut pinler + ölçerin `sızıntı` sütunu) |
| Gecikme | yeniden sıralama p95 ≤ 2,5 sn (sıcak yol tavanı zaten bu) |
| Maliyet | mesaj başına ek maliyet raporlanır, kurucu onaylar |

İki sorulu mesaj için önce %90 önerilmişti (iki bağımsız %95'in ikisi birden ≈ %90); kurucunun alt sınırı her grupta %95 olduğu
için 09-27'de (Codex) %95'e çekildi. Codex'in notu da doğru — 39 örnekte %95 = 38/39, tek kayıp sonucu değiştirir, bu yüzden
kabul BÜYÜK ve görülmemiş kümede verilir.

**Kabul KODDA kapıdır (09-27, `tests/eval/rag-lab/acceptance.ts`):** holdout koşusu eskiden yalnız "satır var mı" diye bakıyordu.
Artık koşulan HER yapılandırma için tek soru TR / tek soru diğer diller / iki sorulu mesaj ≥ %95, sızıntı 0 ve koşu EKSİKSİZ
(beklenen her satır var; örnekleme, ücretli grup süzgeci, önbellek alt kümesi, düşen yeniden sıralama çağrısı kabul DEĞİL) —
sağlanmazsa eval KIRMIZI, rapora "holdout kabulü" satırı yazılır. Holdout'ta yalnız seçilen TEK yapılandırma koşulur (taban
kıyası dev setinde); ücretli katmanın grupları `EVAL_RAG_PAID_GROUPS=single_tr,single_xx,multi,neg` ile tam verilir.

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
uzun tire iki yanı cümlecikse böler ("Giriş – 15:00" etiketi ve "09:00 – 20:00" aralığı bölünmez). Üçüncü tur (ikinci kör batarya,
140 cümle): SORU cümlesi saat bildirmez (SSS'nin "S:" kısmı), "|" cümle sınırıdır, "Yerel tavsiye" kalemi mahalleyi anlatır (müze girişi,
belediye havuzu mülkün saati değil), gün kaymalı başvuru ("the day before / after arrival", "varıştan bir gün önce") ve "by" teslim tarihi
giriş/çıkış değildir, erişimin ÇIKIŞ GÜNÜ bitmesi çıkıştır ("kod çıkış günü 11:00'de iptal edilir"), "the flat is yours from 2 pm until
11 am" giriş + çıkıştır, personel öznesiyle "gir-" misafirin girişi değildir, "yerleşebilirsiniz" / "daireyi teslim etmeniz" giriş /
çıkıştır, havuz başında servis edilen kahvaltı havuz saati değildir, iki alanlı etiket satırı tire / eğik çizgi / parantezle ayrılır,
kısa isim öbeği ortak yüklemi paylaşır ("Havuz ve spor salonu 08:00-20:00 arası açık"). Dördüncü tur (üçüncü kör batarya, 160 cümle):
madde işareti ("•") ve "a.m." noktası cümle sınırı; İngilizce "on" Türkçe "ön" sayılmaz ("on departure day" yer değil — ÖNCEDEN VAR OLAN
hata, İngilizce varış/çıkış saatlerini düşürüyordu); başka bir şeyin girişi ("check-in for the boat tour", "tekne turu için giriş",
"havalimanı check-in kontuarı") ve Konum kalemindeki Türkçe giriş/çıkış (metro çıkışı) alan değil; virgülle devam eden saat listesi / "which
…" cümleciği önceki konuyu taşır; kısa etiket + virgül ("Geç giriş, … 01:00'e kadar") alanını verir; "because / unless" iki cümleciği
ayırır ("unless" sonrası koşul); "ayrılış günü / departure day" gündür; anahtarı çıkış günü geri vermek çıkıştır; resepsiyon masası,
cankurtaran ve bina kapısının saati kendi saatidir; "talep / istek" hizmet sözüdür; "misafir gelmiyorsa / if nobody …" müsaitlik,
"geciktirmek" uzatmadır; "16:00'dan … 10:00'a kadar" başlangıç-bitiştir. Beşinci tur (mutasyon koşusu, `8603f97`, 160 mutant): 140'ı
öldü, 20 kural parçası hiçbir teste dayanmıyordu → 19'una YALNIZ ona dayanan pin eklendi; olumsuz emirle "gir-" elemesi ölü kuraldı
(kök sökücü "girmeyin"i "gir"e indirmez, giriş kanıtı hep başka bir "gir-" biçiminden gelir) ve kaldırıldı. İnceleme iki yeni hata buldu:
erişimin BİTMESİ ("kod çıkış günü 11:00'den sonra çalışmaz", "stops working", "will not work", "no longer works", "geçerliliğini yitirir")
başlangıç fiili sayılıp çıkış günü saati GİRİŞ okunuyordu (mülkün 15:00 girişiyle sahte "giriş 11:00" çelişkisi) → olumsuzlanan / biten
başlangıç fiili bitiştir; "ve" ile bölünen "çıkıştan sonra 10:00–20:00 arası [valiz] bırakabilirsiniz" çıkış saati sayılıyordu → başvuru
noktasından sonraki ARALIK başka işin penceresidir (aynı cümlecikteki tek saat alanın değeri olarak kalır).

| ölçüm | canlı kural (`7382338`) | yeni kural |
|---|---|---|
| iki yönlü batarya (`tests/helpers/time-field-battery.ts`, gerçek / tuzak) | 99/168 · 40/146 (dördüncü tur `8603f97`: 166/168 · 135/146) | **168/168 · 146/146** |
| kör batarya 1 (115 cümle; ikinci turda bakıldı → "görüldü") | 43/59 · 30/56 | 57/59 · 56/56 |
| **kör batarya 2 (140 cümle; AYARSIZ, ikinci tur kuralıyla)** | 42/61 · 39/69 | **49/61 · 60/69** |
| **kör batarya 3 (160 cümle; AYARSIZ, üçüncü tur kuralıyla)** | 35/65 · 42/80 | **51/65 · 72/80** |
| kör batarya 2 / 3, sonraki turlardan sonra ("görüldü") | — | 61/61 · 69/69 / 64/65 · 79/80 |
| 60 kalem, mülk saatiyle çelişen soru (yanlış alarm) | %30 (geniş blokla %58) | **%3,9 (%12,9) — hepsi gerçek** (beşinci turda aynı) |
| 276 kalemlik dev setinde okunan gerçek saat | — | ilk turla birebir (kayıp yok; beşinci turda da fark 0) |
| mutasyon (`scripts/mutation-run.mjs`, saat alanı kuralı) | — | 140/160 → pin / silme → ikinci tur 178/179 (yaşayan R11 gün kaymalı tek saat: pinlendi) |

Kalan %3,9 / %12,9'un tek kaynağı dev setine bilerek konmuş gerçek çelişkidir ("standart çıkış saati en geç 12:00" ↔ mülk 11:00): tutulması
doğrudur. Kör bataryanın kalan iki farkı bilinçlidir: yere bağlı sessizlik kuralı ("havuz başında 22:00'den sonra müzik yasak") cümlecikte
iki alan (havuz + sessizlik) adlandırır → hüküm yok; genel sessizlik saati sayılsaydı "sessizlik 23:00" kalemiyle sahte çelişki notu
üretirdi (bataryada `soft`). Bilinen sınırlar: İngilizce "by 11 am" bir teslim tarihi de olabilir (çıkış sayılır); "noise" sözcüğü köke
inerken durak sözcüğe düşüyor — saat kuralı ham sözcüğe bakıyor, retrieval tarafı ayrı iş. Başvuru cümleciğindeki TEK saat alanın
değeri sayılır: "Çıkıştan sonra 12:00'de anahtarı bırakın" çıkış 12:00 okunur, çünkü aynı biçim "Check-out is at 11:00 and after
check-out bags can stay …" / "before check-out at 11:00"te gerçek değerdir — sözcük kuralıyla ayrılamıyor (anlam katmanı işi); aralık
ve "…'e kadar / by" ise ayrılır (↑beşinci tur).

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
| 2 | holdout kabulü | `EVAL_RAG_KB=holdout EVAL_RAG_PAID_GROUPS=single_tr,single_xx,multi,neg` + 1. adımda seçilen TEK yapılandırma, örnekleme YOK. Kapı kodda: her grup ≥ %95 + sızıntı 0 + eksiksiz koşu, değilse KIRMIZI (§1). 🚨 YALNIZ `.md` toplu tablosu okunur; yan JSON AÇILMAZ | ~5 $ |
| 3 | cevap düzeyi, 60 kalem | `EVAL_RAG_ANSWER=1 EVAL_RAG_ANSWER_KB=perq EVAL_RAG_ANSWER_CONFIGS=s0.25+und+e3l,s0.25+und+e3l+wide npm run eval -- tests/eval/rag-answer.eval.test.ts` | ~1 $ |
| 4 | cevap düzeyi, 276 | `EVAL_RAG_ANSWER=1 EVAL_RAG_ANSWER_CONFIGS=s0.25+und+prodwin+dl2500+cap400+e3l,FINAL` (aynı dosya) | ~1 $ |

Okuma: 0. adımın `çağrılar` satırı soru başı maliyeti verir → 1–4 yeniden tahmin edilir, kurucuya söylenir. Cevap düzeyinde
geniş blok ANCAK şu ikisi birlikte tutarsa açılmaya önerilir: `sayı cevapta` düşmez VE `yabancı sayı` (başka kalemin olgusu) +
yanıtsız soruda `desteksiz iddia` artmaz (eşleştirilmiş; aynı sorular). Kabul kapısı §1.

### 6b. 09-27 ücretli ölçümler (kurucu: "kredi geldi, testlerini yapabilirsin … sormana gerek yok, yeter ki en iyisi olsun")

Tüm koşular gpt-5.1 (anlama + yeniden sıralayıcı; `AI_SEMANTIC_MODEL` boş → `OPENAI_MODEL`) ve `text-embedding-3-large`
(1536) ile; çıktılar disk önbellekli (tekrar koşu ücretsiz). Raporlar `docs/olcum/rag-lab-2026-09-27-{4,5,7}.md`.

**Temiz dev ölçümü (276 kalem, ~1.000 soru, önerilen hat `FINAL` = s0.25+und+prodwin+dl2500+cap400+e3l+wide):**

| yapılandırma | iki soru (ikisi de blokta) | tek soru TR | diğer diller | yanıtsız: geri çekilme / sızıntı | sıralayıcı p50 / p95 |
|---|---|---|---|---|---|
| FINAL (pencere 40+10) | 111/120 (%92,5) | 432/441 (%98,0) | 438/441 (%99,3) | 0 / 0 | 1.020 / 1.693 ms |
| FINAL + `wper50` (istek başına 50) | **112/120 (%93,3)** | **435/441 (%98,6)** | 438/441 | 0 / 0 | 1.092 / 1.635 ms (istek +%19) |
| FINAL + `demote` | 106/120 | 428/441 | 438/441 | 0 / 0 | — → ELENDİ |

**Luna (kurucu: "gpt-6-luna 12 kat ucuz"; yalnız yeniden sıralayıcının modeli değişti, aynı sorular / adaylar):**

| sıralayıcı | iki soru | tek soru TR | diğer diller | p95 | başarısız / 2,5 sn aşımı |
|---|---|---|---|---|---|
| gpt-5.1 | 111/120 | 432/441 | 438/441 | 1.693 ms | 9 |
| gpt-5.1 + wper50 | 112/120 | 435/441 | 438/441 | 1.635 ms | 4 |
| Luna, düşünme `none` | 108/120 | 430/441 | 438/441 | 1.427 ms | 2 |
| Luna `none` + wper50 | 110/120 | 432/441 | 438/441 | 1.334 ms | 1 |
| Luna, düşünme `low` | 110/120 | 428/441 | 435/441 | 2.771 ms | 37 |

Luna daha hızlı ve ~8–12 kat ucuz, doğrulukta gpt-5.1'in 2–3 soru gerisinde (`minimal` bu modelde desteklenmiyor, 400). Sıralayıcı
için üretim anahtarı YAZILMADI (kurucu kararı; öneri: bugünkü hacimde gpt-5.1 kalsın).

**Düşünme kaybı yavaşlıktan mı? (kurucu: "Luna'ya reasoning eklesek 5.1'den iyi olmaz mı?")** Aynı üç koşu süre tavanı 9 sn ile
önbellekten yeniden hesaplandı (`rag-lab-2026-09-27-8.md`, SIFIR yeni çağrı): gpt-5.1 111/120 · 432/441 · 438/441 · Luna `low`
111 · 429 · 436 · Luna `none` 108 · 430 · 438. Süre sınırı kalksa da `low` iki soruda ancak eşit, tek soruda 2–3 soru geride;
p95'i (2,8 sn) canlının 2,5 sn tavanını aşar. `medium`/`high` ölçülmedi (her kademe daha yavaş; kazanç beklentisi yok).

**Maliyet:** adım 0 + 1 ≈ 11–12 $ (1.733 sıralama + ~400 anlama çağrısı, istek ~15–17 bin karakter); tahmin (~4 $) grup başına
111 soruluk örneklemeye göreydi, tam set 441 soru. Luna koşuları ≈ 1–2 $. Canlıda soru başına ek maliyet: tek soru ~0,5 sent, iki
soru ~1–1,5 sent (gpt-5.1).

🚨 **Hız sınırı olayı (09-27 11:14–11:19 TR):** cevap düzeyi ölçümü 3 işçiyle gpt-5.1'in hesap geneli dakikalık token sınırına
dayandı (552 isteğin 252'si 429). Anahtar canlıyla aynı hesaptaysa o dakikalarda canlı cevaplar da sınıra takılmış olabilir (sistem
otomatik göndermez, mesaj ev sahibinde kalır). Geçersiz rapor kullanılmadı. Ölçerlere `RAG_LAB_RPM` (dakikalık istek tavanı) + cevap
ölçerinde tek işçi / yeniden deneme / GEÇERSİZ satır / eşleştirilmiş kıyas eklendi; sonraki koşular hesabın sınırının ~%30'unda.
🚨 Kural: ücretli ölçüm canlıyla aynı hesapta koşuyorsa HER ZAMAN `RAG_LAB_RPM` ile (cevap ölçümü 8, sıralama/anlama 30).

**Cevap düzeyi, gerçek müşteri boyutu (60 kalem, aynı 276 soru, 552 cevabın hepsi geçerli, 429 yok;
`docs/olcum/rag-answer-2026-09-27.md`):**

| grup | ölçü | bugünkü blok (6k/12) | geniş blok (23k/40) |
|---|---|---|---|
| tek soru TR (80) | cevap blokta · sayılı cevapta doğru sayı · desteksiz iddia | 75 · 30/36 · 5 | **80 · 34/36 · 1** |
| diğer diller (80) | aynı | 77 · 32/36 · 5 | **80 · 33/36 · 4** |
| iki soru (80) | aynı | 60 · 34/46 · 2 | **77 · 36/46 · 4** |
| yanıtsız (36) | desteksiz iddia (uydurma) · yabancı sayı | 0 · 1 | 0 · 2 |
| tümü | yabancı sayı (başka kalemin olgusu) | 63 | 57 |

§6a'daki açma şartı sağlanıyor: doğru sayı düşmüyor (artıyor), yanıtsız soruda uydurma artmıyor (0 → 0), başka kaleme sapma azalıyor.
Geniş bloğu açma kararı kurucuda; 276 kalemlik cevap ölçümü kredi bittiği için yarıda kaldı (GEÇERSİZ, rapora girmedi).

**GEÇERSİZ (kredi bitti, yarıda kaldı):** holdout kabul koşusu (`durum: YARIDA KALDI`; çıktıların ödenmiş kısmı önbellekte, kaldığı
yerden devam eder) ve 276 kalemlik cevap ölçümü. İkisi de kredi gelince, kurucu onayı + bütçe sınırıyla tamamlanır.

**Ölçüm modeli kuralı (kurucu 09-27):** keşif / ablasyon ucuz modelle (Luna, `rrm:gpt-6-luna+rre:none`), misafire giden her şey
(cevap, güvenlik katmanları, son kabul) canlıdaki modelle (gpt-5.1) — örneklemle ucuzlatılır, vekil modelle ölçülmez. Aynı işin
bu yöntemle maliyeti ~25–30 $ yerine ~8–10 $.

### 6c. 09-27 ücretsiz ölçüm: geniş blokta asıl tavan PARÇA SAYISI (`rag-lab-2026-09-27-9.md`, önbellekten, SIFIR yeni çağrı)

Geniş blokta (`wide` = 23k karakter / 40 parça) kaçan her cevapta blok 40 parçaya dayanmıştı ama karakterin ancak yarısı dolmuştu
(p50 ~12k / 23k): çok sorgulu seçimde (alt sorgular + anlama sorguları + cevapsız önceki sorular) sıra-sıra seçim her listeye ~5 yer
bırakıyor, listesinde 8.–30. sıradaki cevap sığmıyor. Parça tavanı yeniden sıralayıcıya giden isteği DEĞİŞTİRMEZ (pencere seçimden
önce kurulur) → önbellekle birebir ölçülür. Aynı ~1.000 dev sorusu, gpt-5.1 sıralayıcı çıktıları:

| yapılandırma | iki soru | tek soru TR | diğer diller | blok karakter p50 / p95 | yanıtsız soruda ort. parça | sızıntı |
|---|---|---|---|---|---|---|
| FINAL (`wide`, 23k / 40) | 112/120 (%93,3) | 432/441 (%98,0) | 438/441 (%99,3) | 12,1k / 14,2k | 32,5 | 0 |
| FINAL + `mc60` | 113/120 (%94,2) | 436/441 (%98,9) | 438/441 | 18,2k / 19,8k | 46,0 | 0 |
| **FINAL + `mc80`** | **116/120 (%96,7)** | **437/441 (%99,1)** | 438/441 (%99,3) | 23,2k / 23,6k | 52,5 | 0 |

`mc80`: 9 kazanç, 0 kayıp (eşleştirilmiş). Örnek (`multi_81`): "Kişisel bakım atıklarını nerede biriktirelim? … Bir arkadaşımız bir
gece katılabilir, ne işlem uygulanır?" — 40'ta ikinci cevap ("fazla konukta ek ücret veya iptal") blokta YOK, 80'de var. Blok boyu
23k'da karakter bütçesi bağlar (küçük bilgi tabanının bugün zaten aldığı boy); cevap modeline istek başına ~+3k token (~0,35 sent).
🚨 KARAR DEĞİL: (1) set GÖRÜLDÜ (dev), (2) yanıtsız soruda bloğa giren parça 32→52 — uydurma oranı ancak ücretli CEVAP ölçümüyle
(`rag-answer`, gpt-5.1, `RAG_LAB_RPM=8`) bilinir, (3) holdout kabulü ücretli. `KB_RETRIEVAL_WIDE_MAX_CHUNKS` kurucu kararıyla 80 (09-27 "80'e çık"; bayrak yine KAPALI); AÇMAK
= kurucu onayı + kredi gelince cevap ölçümü (60 kalem, `wide+mc40` vs `wide` — `wide` artık üretim sabitiyle 80) + holdout.
Kredi gelince (kurucu onayıyla; ortak önek + `RAG_LAB_RPM=8 EVAL_RAG_ANSWER_WORKERS=1`): 60 kalem
`EVAL_RAG_ANSWER=1 EVAL_RAG_ANSWER_KB=perq EVAL_RAG_ANSWER_CONFIGS=s0.25+und+e3l+wide+mc40,s0.25+und+e3l+wide` (~1–2 $) ve 276 kalem
`EVAL_RAG_ANSWER_CONFIGS=FINAL+mc40,FINAL` (~1–2 $); açma şartı 6a'daki ile aynı (doğru sayı düşmez, yabancı sayı ve yanıtsız soruda
desteksiz iddia artmaz). Ardından holdout kabulü seçilen yapılandırmayla.
İstek başına 50 aday (`wper50`, sıralayıcı çıktıları 09-27 ücretli koşudan önbellekte) `mc80`in ÜSTÜNE katkı vermiyor
(`rag-lab-2026-09-27-10.md`: iki soru 115 ↔ 116/120, TR 437 ↔ 437, diğer 439 ↔ 438) → sıralayıcı isteğini %19 büyütmeye gerek yok;
kaldıraç parça tavanı.
Gerçek müşteri boyutunda (soru başına 60 kalem, `EVAL_RAG_KB=perq`, sıralayıcısız — `rag-lab-2026-09-27-11.md`) de aynı yön: iki soru
117 → 119/120, tek soru TR 439 → 441/441, diğer 437 → 439/441 (6 kazanç, 0 kayıp); yanıtsız soruda bloğa giren parça 27 → 36.
