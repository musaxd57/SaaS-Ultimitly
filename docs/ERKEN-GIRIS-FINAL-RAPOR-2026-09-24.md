# Erken giriş kanıt modeli — final mühendislik raporu (09-24)

Kurucu isteği: *"Hassas istek = ENGEL değil; doğrulama iş akışı. Gerçek verileri ve operasyonel kanıtları topla, host
politikasını uygula; yeterli kesinlik varsa onayla, yoksa tahmin etme — mevcut güvenli / insan / bekletme akışı."*
Ayrıntılı tasarım ve inceleme tabloları: `docs/ERKEN-GIRIS-KANIT-MODELI-2026-09-24.md` (bu rapor onun özetidir;
çelişkide tasarım belgesi kazanır). Harf sırası kurucunun istediği başlıklardır.

## A. Mevcut özellikler (tur başında)

Saf karar çekirdeği (`lib/early-checkin/core.ts`), olgu yükleyici (`load.ts`), 6 dilde KODDAN onay metni (`reply.ts`),
host kuralı (`rules.ts`, `AutomationRule`), temizlik bitince bir kez yeniden değerlendirme (`recheck.ts`), dört katmanlı
birleşim (kelime ağı · cevap modelinin beyanı + niyet etiketi · bekçi · anlama katmanı), dar `staff` rolü. Ayrıntı:
tasarım §A.

## B. Önerilerden hangileri zaten vardı

REQUEST ≠ BLOCK, otomatik RED yok, dar temizlikçi rolü, kimlikli + zaman damgalı temizlik kaydı, READY'nin devre bağı,
"en erken otomatik onay saati" (`earliest`), ücretin kuraldan gelmesi, resmi ↔ misafirin bildirdiği çıkışın ayrı alanları,
çakışmanın READY'yi geçememesi. Tasarım §B.

## C. Eksikler (17) ve durumları

| # | Eksik | Durum |
|---|---|---|
| 1 | Senaryo 2 (çıkıştan önce kanıtlı READY) imkânsızdı | ✅ dilim 1 (host rızası + başladım→hazır zinciri) |
| 2 | Bekleyen istek kayboluyordu | ✅ yeniden değerlendirme + kilit (dilim 6); dikkat kalemi AÇIK |
| 3 | Gelecek günün isteği hiç otomatik onaylanamaz | ⏸ bilinçli: varış günü bekler (`pending`); göreli gün çözümü = zaman bağlamı işi (#114) |
| 4 | Gün doğrulanmıyordu | ✅ `day_unverified` (dilim 1 + inceleme) |
| 5 | Geç onay geçmiş saati söylüyordu | ✅ `time_passed` + standart giriş geçtiyse `not_early` |
| 6 | Modellerin görmediği mesaj | ✅ `not_fully_read` (onay + politika yolu) |
| 7 | Bilgi sorusu ↔ izin karışık | ✅ politika metni (dilim 6, iki model + saat/gün yok) |
| 8 | Bavul erken girişe katlanıyor | ✅ `luggage` → host |
| 9 | Olay/aktör/duruş yok | ◐ sunum düzeltildi (dilim 7a/7b); `events[]` şeması tasarımda (§O), uygulanmadı |
| 10 | TOCTOU | ✅ kuyrukta otomatik onay yok; doğrudan yolda kabul edilen pencere (§S) |
| 11 | Denetim yetersiz | ✅ `ec` dayanak kimlikleri (dilim 2) |
| 12 | Temizlikçiye misafir verisi sızıyordu | ✅ tek personel görünümü (dilim 3) |
| 13 | Devir görevleri atanmamış | ⏸ varsayılan temizlikçi — personel daveti (kimlik akışı) sonrası |
| 14 | Personel hesabı açılamıyor | ⏸ kimlik akışı → kurucu onayı + ilk denemeler birlikte (§H) |
| 15 | Olumsuz operasyonel kanıt kaydedilemiyor | ◐ açık bakım + temizlikçinin bugünkü notu otomatiği durdurur; kapalı-küme bildirim AÇIK |
| 16 | Görev tarihi rezervasyonu izlemiyor | ✅ dilim 4a (üç yazma yolu, aynı TX) |
| 17 | Görev durumu ↔ geçmiş atomik değil | ◐ güvenli yön (kanıt yoksa hazır değil); atomik yazım sıradaki iş (C-17) |

## D. Ajan eleştirileri

Beş bağımsız inceleme (ürün · güvenlik/LLM · veri/eşzamanlılık · temizlik/operasyon · test/eval) + dört düşmanca
inceleme turu (dilim 1, dilim 8, dilim 6, son tur). Önemli bulgular tasarım §D, §R, §R2 ve dilim 8 inceleme notunda.
Örnekler: "yarın" kontrolü TR ekleri / büyük İ / Arapça harekeyi kaçırıyordu (P1, düzeltildi) · politika metni
modellerin görmediği mesajlar varken gidebiliyordu (P1, düzeltildi) · kilit akış `null` iken açık kalıyordu (P2,
düzeltildi) · bekçi redakte taslağı tam göremeden hüküm veriyordu (düzeltildi).

## E. Kabul / değiştirilen / reddedilen

Kabul: 4 durum, otomatik ret yok, misafir beyanı yalnız sıkılaştırır, yeni rol dizesi yok, ayrı kural tablosu şimdi yok,
deterministik sayı/saat/gün eşleştirmesi, iyimser yeniden doğrulama. Değiştirilerek: politika metni yalnız kural
`auto` iken; READY'nin gece yarısı düşmesi yerine devir günü şartı; denetim kaydında kimlik + zaman (saat/tutar mesajda).
Reddedilen: 9+ yeni durum, VERIFIED_UNAVAILABLE otomatik ret, "çıktık"ın onay kanıtı sayılması, model çağrıları boyunca
kilit, LLM onay bekçisi, holdout'a göre para dedektörü ayarı, bavul/havalimanı için kelime vetosu, host notunun
politika metnine eklenmesi. Tasarım §D-E.

## F. Nihai durum makinesi

`not_early · approvable · pending · needs_host` + nitelikler `fee`, `autoSend`, kapalı-küme `failed[]`. `pending` yalnız
kanıt GELEBİLİRSE; otomatik yalnız kural `auto` + iki model aynı saat + tek konu + tüm mesajlar okundu + gün doğrulandı
+ metindeki saat çelişmiyor + saat geçmedi + kuyruk yok. Tasarım §F.

## G. Kanıt hiyerarşisi

G0 resmi çıkış · G1/G2 misafirin planı/beyanı (yalnız sıkılaştırır) · G3 "çıktık" (yalnız bilgi — **kaydı AÇIK**, senaryo
5b `it.todo`) · G4 temizlik başladı (bilgi) · G5 kimlikli "bitti" (onay için zorunlu) · N2 açık sorun/bakım · N3 çakışma.
Tasarım §G.

## H. Temizlikçi izin modeli

`staff` rolü: yalnız `/tasks`, yalnız kendine atanmış görev, para/konuşma/rapor rotaları kapalı (senaryo 18-19 pinli).
Misafir adı/mesajı personele gitmez (tek kural `staff-view.ts`). Davet/devre dışı bırakma kimlik akışıdır → kurucu onayı.

## I. READY yaşam döngüsü

BU devrin görevinde kimlikli EN SON "bitti", devir günü, ≥5 dk, tüm devir görevleri kapalı, açık sorun yok; önceki
devrin / dünün işareti sayılmaz (senaryo 7, 20); yeni işgal READY'yi geçersiz kılar (8); çakışmayı aşamaz (9). Görev
tarihi artık rezervasyonu izler (dilim 4a). Tasarım §I.

## J. En erken otomatik onay saati

`earliest` = otomatik onayın alt sınırı; daha erken istek RED değil `before_window` → host (senaryo 12). Form etiketi
"Otomatik onay için en erken saat"; misafire/modele söylenmez.

## K. Ücret bağlantısı

Tek kaynak kuraldaki `fee`; onay ve politika metninde KODDA biçimlenir. Model yazdığı ertelemede tutar/indirim/muafiyet
söyleyemez (`price_claim`, dilim 8; senaryo 16b/17b). Kayıtlı ücret yoksa "ücretsiz" varsayılmaz. Tasarım §K.

## L. Kural deposu

`AutomationRule` üzerinde tipli depo (`rules.ts`); mülk satırı kilitli kayıt, mülk silinince kural silinir, kural parmak
izi karar kaydında. Ayrı tablo: org varsayılanı / kural geçmişi gerektiğinde. Tasarım §L.

## M. Migration gerekçesi

Bu turda migration YOK (Task/TaskUpdate, AutomationRule, RiskEvent kanıtı, User `staff` yetti). Railway riski: başarısız
`migrate deploy` açılışı düşürür; her migration push'u taze `pg_dump` + kurucu onayı ister. Tasarım §M.

## N. Birleşimin son hâli

Risk TESPİTİ birleşimdir (hiçbir katmanın "yok"u başkasının isteğini silmez). ONAY birleşim değildir: yalnız
deterministik doğrulanmış koşullar + KODDA kurulan metin. Bilgi sorusu istisnası dar: iki model koşup "yok" dedi +
kelime ağı yalnız aynı konu + saat/gün yok + tüm mesajlar okundu (senaryo 10b/10c, 14).

## O. Anlama şeması

`events[]` (olay · aktör · duruş · saat · gün, yalnız enum) TASARLANDI (§O); uygulanmadı — anlam katmanı bayrağı kapalı ve
kredi olmadan ölçülemiyor. Bugün misafirin çıkış saati yalnız sunumda "beyan" olarak ele alınıyor (dilim 7a/7b).

## P. Set B (gerçek mesajlar) bulguları

Araçlar hazır (salt-okuma dışa aktarım, kör etiketleme, mühür); **koşulmadı**: kurucunun makinesinde etiketleme + kredi
gerekiyor. Geliştirici ve ajanlar içeriği görmez. Protokol `docs/EVAL-MUHURLU-FINAL.md`.

## Q. Yanlış alarm / gereksiz inceleme oranı

Model katmanları kredisiz ÖLÇÜLEMEDİ. Ölçülebilen (deterministik): kelime ağı tek başına "istek yok" satırlarında dev
135/143 (%6 gereksiz inceleme), holdout 135/161 (%16). Para dedektörü kör holdout: temiz 130/134 (%3 yanlış alarm),
tutarsız ücret sözü 35/35. Eval harness'ına karar ölçüleri eklendi (gereksiz inceleme · bilgi sorusu ↔ izin · katman
gerekliliği · bilinmiyor) — kredi yüklenince tek koşuda raporlanır.

## R. Tehlikeli kaçak

Kelime ağı tek başına isteklerin dev 77/125, holdout 77/170'ini yakalıyor — bu yüzden YALNIZ yedek; asıl yakalama iki
model + birleşim (ölçüm kredi bekliyor). Üretimde bugün hassas istek bekçisiz OTOMATİK GİTMEZ (belirsizlik güvenli
değildir), yani kaçak otomatik izne dönüşmez. Para dedektörü kör holdout: 103/139 (%74) — kalan serbest anlatım bekçinin işi.

## S. Mutasyon istatistikleri

| Dilim | Sonuç |
|---|---|
| 1-3 (+ E5/S1 pinleri) | 77/77 |
| 8 ilk tur / inceleme revizyonu | 58/61 → düzeltildi · 66/76 → 9 eksik örnek + 1 ölü kod silindi → 9/9 |
| 6 | 32/32 |
| 7a/7b | 12/12 |
| 4a | 11/11 (1 eşdeğer mutant yazılı: eşitlik kısa devresi yalnız sorgu sayısını değiştirir) |
| 6 inceleme düzeltmeleri | 8/8 (sıra mutantı dahil) |

## T. Eşzamanlılık

Model çağrıları boyunca kilit yok; olgular kapıdan hemen önce okunur; doğrudan gönderimde `claim` CAS; kuyrukta otomatik
onay yok; kural kaydında mülk satırı `FOR UPDATE`; yeniden değerlendirme karar vermez, tüm hattı baştan koşar; son
mesaj `(createdAt, id)` ile tarama ile aynı. Tasarım §S.

## U. Denetlenebilirlik

`ec` = durum + düşen kodlar + otomatik mi + dayanak kimlikleri (devrin rezervasyonu, READY kaydı + anı, kural parmak izi,
saati okuyan model sayısı, çıkış doğrulandı mı); metin/saat/tutar yok, alan alan doğrulanır. Politika/onay metninde
kaynak sayımı NULL (ölçülmedi). Tasarım §U.

## V. Kapılar

(push anındaki SHA ile doldurulur ↓)

## W. Üretimi etkileyen değişiklikler

(↓)

## X. Push durumu

(↓)
