# Müsaitlik motoru — ilk dilim (09-24)

Yol planı ④: "deterministik Availability Engine". Kurucu talimatı: müsaitlik ve rezervasyon durumu
ASLA model hafızasından ya da RAG'den cevaplanmaz; kiracıya kapalı, kanıt ve tazelik döndüren
deterministik bir araçtan gelir. Bu dilim o aracın çekirdeğini ve ilk ürün tüketicisini ekler.
**Yapay zekâya / isteme BAĞLANMADI** (o ayrı dilim: araç çağrısı + `verifiedToolResults` sözleşmesi).

## Dosyalar

| Dosya | Görev |
|---|---|
| `src/modules/availability/core.ts` | SAF çekirdek (DB/ağ/saat yok; `now` dışarıdan). Gece semantiği, tek tarih kuralı, kapalı başarısız "boş", çakışma olgusu, karar + kesinlik. |
| `src/modules/availability/load.ts` | Veritabanına dokunan TEK dosya. Kiracı kapalı; misafir adı/iletişim/rezervasyon kodu/besleme adresi SEÇMEZ. |
| `src/lib/channels/property-links.ts` | Sağlayıcıya özgü alanı (`Property.hospitableId`) okuyan tek yer; çekirdek `hospitable*` okumaz (değişmez 1/20). |
| `src/modules/availability/conflicts.ts` | İlk tüketici: önümüzdeki 60 gecede aynı geceye düşen rezervasyonlar. |
| `src/modules/intelligence/incidents/attention.ts` | Panel "Dikkat Gerektirenler": `calendar_conflict` satırı. |

## Kurallar (test-pinli)

- **Gece N** = N tarihinde başlayan gece; konaklama `[giriş, çıkış)` yarı açık. Aynı gün devir çakışma DEĞİLDİR.
- **Tek tarih kuralı:** veritabanında aynı gün üç biçimde durur — köprü/elle giriş `D 00:00Z`, iCal tarih
  değeri `D 12:00Z`, iCal TZID'li değer gerçek an. Kural: UTC saati TAM 00:00:00.000 ya da 12:00:00.000
  ise değer yalnız tarihtir (UTC günü); aksi hâlde gerçek an → mülk diliminde gün. İstanbul'da `/calendar`
  ile birebir aynı (parite testi). Bilinen sınır: öteki dilimlerde tam 00:00Z/12:00Z'ye düşen gerçek bir an
  tarih sanılır.
- **Kapalı başarısız "boş":** bir gece yalnız (a) üzerinde rezervasyon yoksa, (b) mülkün en az bir kapsama
  kaynağı varsa ve (c) HER kaynak taze ve başarılıysa "boş"tur; aksi hâlde "bilinmiyor" + sebep
  (`no_coverage_sources · source_error · source_never_synced · source_stale · source_freshness_unrecorded ·
  load_truncated · anomalous_claim`). Köprünün son başarılı okuması bugün HİÇBİR yerde kaydedilmiyor →
  köprüye bağlı mülkte boş gece dürüstçe "bilinmiyor".
- **İşgal birleşimdir:** bir iddianın eklenmesi hiçbir geceyi dolu→boş çeviremez; iptal satırı yok sayılır,
  tanınmayan durum İŞGAL EDER (güvenli yön), `pending` "tutuluyor".
- **Çakışma OLGUDUR, birleştirme DEĞİL** (değişmez 6): hiçbir satır iptal edilmez/gizlenmez; `identicalSpan`
  (giriş+çıkış birebir aynı) yalnız "aynı konaklama iki kaynaktan gelmiş olabilir" İPUCUDUR.
- **Karar + kesinlik:** `unavailable + verified` ancak en az bir iddia taze kaynaktan ya da host'un kendi
  girişinden geliyorsa; yalnız kanıtsız iddialarla (bayat köprü, hayalet besleme satırı) dolu görünen
  aralık `unavailable + unverified`. İleride yalnız `verified` sonuç otomatik bir cevaba dayanak olabilir.

## Ölçülen bulgular (09-24 araştırması, kodla doğrulandı)

- Hiçbir yazma yolu (elle giriş, iCal senkronu, dosya içe aktarma, köprü) çakışan rezervasyonu
  reddetmiyor ya da fark etmiyordu; takvim sayfası gece başına FARKLI MÜLK saydığı için aynı mülkte iki
  rezervasyon görünmüyordu. Panel satırı bu boşluğu yalnız TESPİTLE kapatır.
- ✅ **DÜZELTİLDİ (ayrı commit):** `lib/turnover.ts getAdjacency` ham anları karşılaştırıyordu; karışık
  yazımda (önceki çıkış iCal `D 12:00Z`, bu giriş köprü `D 00:00Z`) aynı gün devri bulunamıyor ve isteme
  "giriş öncesi daire boş, erken girişte devir baskısı yok" yazılıyordu; `prompts.ts sameDay` UTC gününe
  bakıyordu (TZID'li anda yanlış gün). Artık `getAdjacency` motorun `calendarDateOf` kuralıyla (mülk dilimi)
  süzer ve "aynı gün" kararını KODDA verir (`previousSameDay`/`nextSameDay`); istem ve gelen kutusu devir
  bandı aynı kararı okur. Kırmızı-önce: eski kod iki gerçek aynı gün devrini "komşu yok" döndürüyordu.
- ⚠️ `reports.ts getOccupancyForecast` çıkış gecesini dolu sayıyor (yarı açık aralık değil); çağıranı yok.

## İnceleme ajanı bulguları (09-24) — düzeltildi

- **"Taze" besleme iddiası gerçekte hiç oluşmuyordu:** senkron `feedLastSeenAt`i koşunun BAŞINDA,
  `lastSyncedAt`i SONUNDA yazar; eski kural `görülme ≥ son başarı` istiyordu (test ikisini eşit veriyordu).
  Artık koşu içi pay (`feedRunToleranceMs` 5 dk, kadans 15 dk'dan kısa). ⚠️ `feedLastSeenAt` yalnız
  `ICAL_DISAPPEARANCE_RECONCILE_ENABLED` açıkken yazılır (canlıda KAPALI) → canlıda besleme iddiaları
  "kanıtsız" kalır ve dolu gece `unavailable + unverified` döner. Bu DOĞRU yöndür: kayıp tespiti kapalıyken
  iptal edilmiş bir konaklama hayalet satır olarak kalabilir.
- **Silinen takvim bağlantısının öksüzleri host girişi sayılıyordu** (DELETE satırları `manual`a çevirir):
  artık `manual` + alınma damgası (`ingestedAt`) = `detached_source` (kanıtsız). Sınır: V0.4 öncesi öksüzlerde
  damga yok.
- **Sıfır gecelik satır "boş" üretiyordu** (kapalı başarısız kuralının deliği): o gece artık `anomalous_claim`.
- **Girdi hangi aralık için yüklendiğini taşımıyordu:** `loadedRange` + `outside_loaded_range` (AI aracı
  bağlandığında başka aralık için yüklenmiş girdi sessizce "müsait" diyemez).
- **Panel satırı gürültülüydü:** köprü + aynı ilanın iCal'i birlikteyse her konaklama bir satır üretip kartı
  dolduruyordu. Artık mülk başına TEK satır (en önemli çakışma + "N çakışma daha"); önem kanıta göre
  (kesin 97 · talep ya da yalnız kanıtsız iddialar 70 + "kayıtlardan biri güncel olmayabilir" · birebir kopya
  45); geceler yarı açık aralığa uygun yazılır ("5 Eki – 6 Eki geceleri"; eskiden çıkış gününü gösteriyordu).
  Motor bacağı çökerse geçiş tabanlı alarm (sessiz boş liste değil).
- Bilinen sınırlar (dokunulmadı): `property-links` bağlantı kesilmiş köprü mülkünü de kapsama kaynağı sayar
  (o mülk hiç "müsait" diyemez — güvenli yön); `getAdjacency` 10 aday alır (aynı pencerede 10+ üst üste satır
  en yakın komşuyu kaçırabilir); `prompts.ts fmtDate` sunucu diliminde gün yazar.

## Kanıt

Kırmızı-önce + iki yönlü mutasyon **46/46** (ilk turda 7 mutant hayatta kaldı, hepsi gerçek pin eksikliğiydi:
milisaniye çapası, boşluksuz küme değişimi, "birebir aynı tarih", karışık boş/bilinmeyen gece, yükleme
tavanı, köprü filtresi, motor arızasının paneli düşürmesi).

## Dilim 2 (09-23 ikinci tur) — konuşma sayfasında erken giriş / geç çıkış / uzatma geceleri (yalnız host)

`src/modules/availability/stay-edges.ts` (saf) + `stay-edges-load.ts` (tek DB dosyası). Konuşma sayfasında
rezervasyon varsa ve konaklama bitmediyse "Önceki ve sonraki geceler" bloğu: girişten önceki gece (erken
giriş), çıkış gecesi (geç çıkış / uzatma), bilinen bir sonraki rezervasyona kadar boş gece sayısı (en fazla
14 gece ileri) ve konaklamanın kendi içindeki çakışma. Her satır motorun kararı + kesinliği: kanıtsızsa
"(kayıt güncel olmayabilir)"; bilinmeyen gece "bilinmiyor", ASLA "boş". Blok tek bir alt satırla biter:
"Misafire söz vermeden önce kanal takviminden kontrol edin." Misafirin kendi rezervasyonu hesaba katılmaz
(kendi gecesi "dolu" görünmesin); iptal/red durumundaki konaklamada blok yok.
**İsteme / yapay zekâya BAĞLANMADI** — yalnız host görür.

## Ölçülen açık (09-23 ajan, kodla doğrulandı) — ONAY BEKLİYOR, uygulanmadı

- **Gönderim kapısı müsaitlik iddiasını DURDURMUYOR.** "Evet, 14 Ekim gecesi daire boş; bir gece daha
  kalabilirsiniz." · "Yes, next weekend is available." · "Unfortunately we're fully booked that night." —
  üçü de `passesAutoReplySafetyGate`ten GEÇİYOR (güven ≥0.75, `riskLevel:none`). Uzatma isteklerinin
  çoğu `general` / düşük öncelik sınıflanıyor ("Konaklamamızı uzatmak istiyoruz", "Rezervasyonu uzatabilir
  miyiz?", "Can I extend my stay?"); bir kısmı yanlışlıkla `early_departure` + `cancellation` (güvenli yön).
- **İstem "muhtemelen müsait" diyor:** komşuluk bloğu kayıtlı önceki/sonraki rezervasyon YOKSA "daire
  muhtemelen müsait / geç çıkış daha esnek olabilir" yazıyor — motorun "boş yalnız kanıtla" kuralıyla
  çelişen bir ima (iCal/kanal beslemesi hiç yoksa kayıt yokluğu boşluk kanıtı değildir).
- **Öneri (kurucu onayı ister, gönderim politikası):** oto-yanıtta misafire müsaitlik İDDİASI (boş/dolu,
  "kalabilirsiniz", "available/booked") taşıyan cevap, motorun `verified` kararıyla eşleşmedikçe
  GÖNDERİLMEZ (kanal → taslak; QR → devir). Ayrıca istemdeki "muhtemelen müsait" cümlesi motorun
  kararıyla değiştirilir. İkisi de ayrı dilim + GOLDEN SET + iki yönlü senaryo.
