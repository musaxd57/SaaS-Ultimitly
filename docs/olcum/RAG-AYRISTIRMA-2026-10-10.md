# RAG ayrıştırma — Luna'da çok sorulu mesajlarda getirme neden düştü? (2026-10-10)

> Kurucu (10-09): "RAG sistemimizi, model anlamasını, soru anlamasını bol bol test et." Cevap düzeyi koşusunda (`rag-answer-2026-10-10-2/-3`)
> Luna yapılandırması çok sorulu mesajlarda cevabı istem bloğuna 34/40 getirdi, 5.1 39/40. Bu belge kaybın hangi katmandan geldiğini
> getirme düzeyi ölçerle (`rag-lab`, `EVAL_RAG_KB=perq`: soru başına 60 kalemlik gerçekçi bilgi tabanı, yalnız GELİŞTİRME seti) ayırır.
> Kabul seti (holdout) koşulmadı. Ürün davranışı değişmedi; yeni şey yalnız KAPALI anahtar arkasında (aşağıda §5).

## 1. Katman katman (çok sorulu 120 mesaj = 240 cevap; "blokta" = iki cevap da istem bloğunda)

Sabit: gömme `text-embedding-3-small` @ 0,4 · canlı yapılandırma (`live+phist`: anlama açık, öğe kipi, sıralayıcı tek çağrı ilk 60, 2,5 sn tavan).

| Anlama | Yeniden sıralayıcı | Blokta (koşu 1 · koşu 2) | Eşik altı kaçak | Sıralayıcı tavan aşımı | Sıralayıcı p50 / p95 |
|---|---|---|---|---|---|
| 5.1 | 5.1 | **110 · 109** | 6 · 6 | 2 · 1 | 0,8–1,0 / 1,1–1,9 sn |
| Luna `none` | 5.1 | 107 · 105 | 9 · 8 | 2 · 0 | 0,8 / 1,1–1,2 sn |
| Luna `low` | 5.1 | 105 · 106 | 10 · 9 | 0 · 0 | 0,8 / 1,1 sn |
| 5.1 | Luna `none` | 106 | 6 | **14** | 1,2 / 2,9 sn |
| 5.1 | Luna `low` | 103 | 6 | **38** | 1,6 / 3,3 sn |
| Luna `low` | Luna `none` | 101 | 10 | 11 | 1,3 / 2,7 sn |

Koşu 2 = taze model önbelleğiyle tekrar (gömmeler aynı) — koşudan koşuya oynama 1–2 mesaj; farklar tekrar ediyor.

**Okuma — kayıp iki ayrı yerden geliyor:**
1. **Yeniden sıralayıcı (Luna):** kalite değil GECİKME. Üretimin sıcak yol tavanı 2,5 sn (`RERANK_HOT_PATH_DEADLINE_MS`, 5.1'in p95'inin
   ~2 katı olarak ayarlanmıştı). Luna `none`un p95'i 2,7–2,9 sn → çağrıların ~%10'u tavanı aşıyor, o mesajda sıra BUGÜNKÜ (sıralayıcısız)
   kalıyor. Dalga 3'teki "kalite eşdeğer" ölçümü tavansızdı (etiket kalitesi) — o sonuç doğru ama üretimde tavan var. Gecikme bu
   konteynerden ölçüldü (yeniden deneme beklemesi süreye girmez); oran ortama göre değişebilir, fark tutarlı.
2. **Anlama katmanı (Luna):** ~4 mesaj (%3) kayıp, eşik altı kaçak 6 → 9–10. Örnekler (geliştirme seti):
   - "Kalça ameliyatı geçiren annem var, oturup kalkarken destek alabileceği sabit bir kol desteği mevcut mu?" — 5.1 sorguyu
     "banyo tuvalet sabit kol desteği" diye yazıyor (cevap: tuvaletin yanındaki tutunma barı), Luna "sabit kol desteği oturup kalkma
     desteği" → kosinüs 0,62 → 0,36.
   - Geçmişte İngilizce soru + şimdi Türkçe soru: 5.1 dili çoğu zaman "en" sayıp İngilizce ikinci sorgu da üretiyor; Luna yalnız Türkçe
     yazıyor → İngilizce yazılmış kalem kaçıyor ("Pervaneleri çalışır bırakıp çıksak?" → cevap İngilizce kalemde, kosinüs 0,47 → 0,25).

## 2. Dil yönü (modelden BAĞIMSIZ bir açık)

| Soru → cevabın yazıldığı dil | 5.1 | Luna `low` | Luna `none` |
|---|---|---|---|
| Türkçe → Türkçe | 177/181 | 173/181 | 173/181 |
| İngilizce → Türkçe | 23/23 | 23/23 | 23/23 |
| **Türkçe → İngilizce** | **26/33 (%79)** | 25/33 | 28/33 |
| İngilizce → İngilizce | 3/3 | 3/3 | 3/3 |

Anlama katmanı yalnız Türkçe (`query_tr`) + misafirin dilinde (`query_original`) sorgu yazıyor. Yabancı misafir → Türkçe kalem köprüsü
var (`query_tr`), ama Türkçe misafir → İngilizce yazılmış kalem köprüsü YOK. Ev sahibi bilgi tabanının bir kısmını yabancı misafirler için
İngilizce yazdığında bu gerçek bir boşluk.

## 3. Öneri değişikliği (Luna geçişi, `LUNA-GECIS-2026-10-10.md` tablosu güncellendi)

- **`KB_RERANK_MODEL` boş (5.1)** — önceki öneri Luna `none` idi: üretimdeki 2,5 sn tavanında Luna çağrılarının ~%10'u düşüyor.
- **`AI_UNDERSTANDING_MODEL` boş (canlıdaki `AI_SEMANTIC_MODEL=gpt-5.1`)** — önceki öneri Luna `low` idi: getirmede tekrar eden 4–5 / 120
  kayıp; öğe / konaklama / anlama doğruluğunda (dalga 1–3) 5.1 ile eşit; 5.1 daha hızlı (anlama getirmeyi bekletir).
- Cevap modeli (Luna `low`), bekçi, çeviri, üslup, karar metni önerileri DEĞİŞMEDİ.

## 4. Cevap düzeyi kırmızı adayı `d_accessibility_5_f0_q1` (kanıtsız iddia, dört yapılandırmada) — ÖLÇER YANLIŞ ALARMI

Misafir (İngilizce): "if the lift fails, how many steps to the apartment?" · bilgi kalemi (Türkçe): "Asansör arızalı olduğunda … toplam
**52 iç merdiven basamağı** çıkmak gerekir. Katlar arasındaki sahanlıklar geniştir ve korkuluklar sağlamdır." · cevap: "… requires climbing
**52 steps**. The landings between floors are spacious, and the handrails are sturdy." — cevap BİREBİR doğru. İddia ölçeri (`claim-support`)
İngilizce "steps"i yürüme adımı (mesafe) okuyor, Türkçe "basamak"ı hiç birim saymıyor ve araya "iç merdiven" girince sayıyı birimsiz
bırakıyor → "kanıtsız". Düzeltme: "(iç / dış) (merdiven) basamak" ve İngilizce "stairs" adım / basamak sayısı; farklı sayı ve farklı birim
yine desteksiz (pinli). `claim-support` müşteri cevabında GÖLGE ölçümdür (P5 kapalı); karar metni denetiminde yalnız yanlış uyarıyı azaltır.

## 5. İngilizce köprü sorgusu (anahtar `AI_UNDERSTANDING_EN_QUERY_ENABLED`, KAPALI — kurucu yokken karar #13)

Açıkken anlama katmanı her istek için ek bir İngilizce arama sorgusu (`query_en`) yazar; getirmeye Türkçe ve özgün dil sorgularından SONRA
girer (tavanı 6, onların yerini almaz; İngilizce misafirde tekrar etmez). Kapalıyken şema / istem / önbellek anahtarı / sorgu listesi bayt
bayt eskisi. Ölçüm (perq dev; tek soru grupları her 4'üncü soru; gruplar `multi,neg,single_tr,single_xx`):

| Anlama | Köprü | Çok sorulu (120) | Tek soru TR (111) | Tek soru yabancı dil (111) | Türkçe → İngilizce kalem (çok + tek) | Negatif: ort. parça |
|---|---|---|---|---|---|---|
| 5.1 | kapalı | 110 | 110 | 107 | 33/41 | 10,7 |
| 5.1 | **açık** | **115** | **111** | **108** | **39/41** | 10,9 |
| Luna `low` | kapalı | 105 | 107 | 108 | 30/41 | 10,9 |
| Luna `low` | **açık** | **112** | **110** | **110** | **39/41** | 10,9 |

- Soru bazında: 5.1'de 9 iyileşme / 2 kötüleşme, Luna'da 15 / 3. Kötüleşenlerin hepsi bütçe yarışı (ek aday başka parçayı yeniden
  sıralama sonrası bütçeden itiyor), hiçbiri "cevap bulunamadı" değil.
- Maliyet: gömmeye giden metin +%30 (sorgu başına bir kısa metin), yeniden sıralayıcı isteği +%5 karakter, anlama çıktısı istek başına
  3–8 sözcük. Sızıntı 0.
- Bilinen sınırlar (Haiku incelemesi, kodda doğrulandı): 4–5 sorulu Türkçe mesajda köprü yalnız ilk 1–2 isteğe yetişir (tavan; köprü
  bilerek en sonda) · tekilleştirme `toLocaleLowerCase("tr")` "INTERNET" / "internet"i ayırır (eski satır, canlı yol — dokunulmadı).
- **Öneri:** anahtarı aç (`AI_UNDERSTANDING_EN_QUERY_ENABLED=1`) — açma kurucu + ilk denemeler birlikte (getirme müşteriye giden cevabı
  etkiler). Kabul seti (holdout) koşulmadı.

## 6. Cevap düzeyi doğrulama — önerilen son yapılandırma (`rag-answer-2026-10-10-5` / `-6`)

Cevap Luna `low` · anlama 5.1 · yeniden sıralayıcı 5.1 · canlı anahtarların tamamı (öğe, kural gölgesi, şikâyet takibi, ücret kuralı, kodla selam,
ev sahibi kararı, erişim kodu) · perq dev, grup başına 40 soru.

| Köprü | Blokta: tek TR · tek yabancı · çok sorulu | Cevap düzeyi (sayılı cevap): tek TR · tek yabancı · çok sorulu | Bilgim-yok | Kırmızı aday |
|---|---|---|---|---|
| kapalı | 39 · 39 · 38 / 40 | 10/13 · 11/13 · 21/25 | 3 | 1 |
| **açık** | **40 · 40 · 40 / 40** | 10/13 · **12/13** · **22/25** | 4 | 3 |

Kırmızı adayların tek tek incelemesi (kaynak metinle):
- kapalı · `d_building_4` — cevap doğru ("-1. kattaki … 3F Depo"); ölçer "-1." sıra sayısını "1. kat" okuyor → **ölçer yanlış alarmı**.
- açık · `multi_33` — cevap doğru (İngilizce kalemin çevirisi); ölçer "Lale Evleri 4'e gece dönüş"ü "4 gece" süresi okuyor → **ölçer yanlış alarmı**.
- açık · `d_restaurants_6` (başka olgu) — evdeki internet hızını ek bilgi olarak vermiş; doğru ve soruyla ilgili → sorun değil.
- açık · `d_restaurants_0` — **GERÇEK HATA (cevap modeli):** kalem "hafta sonu 10.00'dan önce gitmezseniz sıra bekleyebiliyorsunuz";
  cevap "Hafta sonu 10.00'dan önce sıra bekleyebiliyorsunuz; kalabalıksız bir saat aralığına dair kesin bilgi yok" — olumsuz koşulu ters
  okumuş, istenen cevabı ("10'dan önce gidin") vermemiş. Bilgi blokta → getirme değil; aynı soru önceki iki koşuda kırmızı değildi (modelin
  koşudan koşuya oynaması). Köprüye bağlanamaz (n = 1); "olumsuz koşul" cümleleri cevap istemi / ölçüm işine girdi.

Sonuç: köprü getirmede tutarlı kazanç (üç grupta 40/40), cevapta +2; gerçek hata sayısı iki kolda 0 ↔ 1 ve o hata getirmeden bağımsız.
Öneri değişmedi (anahtarı aç; kurucu + ilk denemeler). İki ölçer yanlış alarmı ayrıca düzeltilecek.
