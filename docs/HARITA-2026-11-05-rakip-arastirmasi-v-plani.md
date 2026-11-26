# Harita — rakip / forum araştırması ↔ güncel kod ↔ V0–V8 (2026-11-05) — TASARIM VE KAPSAM ÖNERİSİ, UYGULAMA YOK

> Kurucu 11-05: "Bağımsız PMS hedefimiz açısından bu araştırmayı güncel kod ve V0–V8 planımızla eşleştirebilir miyiz? Tamamlananları
> yeniden yapmadan; mevcut, kısmen bağlı, bayrak arkasında ve canlı doğrulanmamış parçaları ayıran güncel bir harita … İlk değerlendirme
> tasarım ve kapsam önerisi olarak kalsın." Kaynak araştırma: Codex (kurucu aracılığıyla). Codex önerisi karar değildir; iddiaları kodda
> ölçüldü.
>
> **Nasıl ölçüldü:** beş dar tarama (Haiku, dosya:satır kanıtlı) + ana oturumda her önemli iddia kodda yeniden okundu (taramaların
> ikisinde yanlış yön düzeltildi). **"Canlı" ölçütü:** Railway 10-02 akşamından beri kapalı; üretim veritabanında yalnız migration
> 00–58 uygulanmış (`RAILWAY-ACILIS-2026-10-15.md` satır 11). Bu yüzden: migration 59–91 isteyen HER şey hiç canlı koşmadı; 10-02'den
> sonra yazılan migration'sız kod da canlıda doğrulanmadı. Klon sığ (geçmiş 10-31'den başlıyor) — tarih yerine migration numarası ve
> belgelerdeki "CANLI" kaydı kullanıldı.

Durum etiketleri: **CANLI** (10-02 öncesi yayında, kayıtlı) · **KOD** (kodda, varsayılan açık, canlıda doğrulanmadı) · **BAYRAK** (kodda,
`*_ENABLED` kapalı) · **KISMEN** (parçalar var, uçtan uca bağlı değil) · **YOK**.

## 1. V'lerde neredeyiz

| Faz | Canlıda (10-02 öncesi) | Kodda, canlı değil | Eksik |
|---|---|---|---|
| ③ V0 kanal bağımsızlığı | V0.1–V0.7 (migration 49–51, 09-07/08) | V0.8 kanal erişim katmanı · V0.9 pin · bağlantı sağlığı + ham platform + bağlantı kapsamlı ilan (migration 60; yazıcılar `CHANNEL_METADATA_WRITE` kapalı) | d eski org kolonları (operatör planı) · e webhook girişi (Airbnb sandbox'ı bekler) |
| ④ Müsaitlik motoru | ilk dilim 09-24 (çekirdek + panel çakışma satırı) | doğrulanmış müsaitlik / uzatma kod metni (kanal + QR, anahtarlar kapalı) · araç sonucu sözleşmesi | modele araç olarak verilmesi (kurucu onayı) |
| ⑤ geniş otonomi | — | ilk dilim: görev / Wi-Fi / söz önerisi + tek tık onay (`AI_ACTION_SUGGESTIONS_ENABLED` kapalı) | ölçüt (≥10 karar, ≥%90 düzenlemesiz onay) hiç ölçülmedi |
| V1 hafıza + sinyal | migration 52 (09-08) · KB onay (53) · izlenebilirlik (54) · konuşma öğeleri (56, 09-26) | geçmişten öğrenme (65) · misafire görünen ad (83) · vektör deposu (87) · çelişki hesabı | — |
| V2 dikkat akışı | "Dikkat Gerektirenler" (09-09) · çakışmada para aralığı (09-24) | bağlantı sağlığı satırı · söz hatırlatması · tehlike "Sorunlu" kuralları · karma acil (WhatsApp → e-posta, kapalı) | — |
| V3 eylem + görev | roller (owner / manager / staff) · görev durumları · temizlikçi görünümü · görevlerin rezervasyon tarihini izlemesi | söz hafızası (62) · otomatik söz (75–77, kapalı) · karar kartları (59, `HOST_DECISIONS_ENABLED` kapalı) · WhatsApp karar kartı (88–89, kapalı) | **personel daveti · iş kabulü / reddi · son zaman · yedek kişi · daire kapsamlı yetki** |
| V4 kanıtlı AI | — | üretim izi + kalite konsolu (60, kapalı) | ürün yüzeyi yok |
| V5 rezervasyon riski / hazırlık | erken giriş hazırlık çekirdeği (tek konuşma paneli; "bilinmeyen yeşil gösterilmez" kuralı) | — | **konaklama listesi düzeyinde hazırlık görünümü** |
| V6 yorum + tekrarlayan sorun | tekrarlayan sorun = V1 örüntü hafızası (daire + konu, ≥3 olumsuz / 180 gün) | aynı soruya cevap tekrar kullanımı (85, gölge, bağlı değil) | yorum (değişmez 12: kaynak yok) · cihaz kaydı |
| V7 gelir | ev sahibinin gecelik aralığı → para aralığı | — | fiyat / plan / kısıt modeli; gelir bilinçli kaldırıldı (`financials:read` yok) |
| V8 Ask Lixus | — | WhatsApp ev sahibi döngüsü (88–89, kapalı) | sorgu yüzeyi yok |
| Airbnb öncesi 6 kapı | — | G1 kısmi · G2 ✅ · G3 süreç taslağı · G4 demo üreticisi (koşulmadı) · G6 dosya taslağı | G5 gerçek kullanım kanıtı (Hospitable 402 + Railway kapalı) |

**Özet:** canlı ürün 10-02'deki hâliyle V2'de duruyor; kodda V3'ün yarısı ve V8'e uzanan parçalar var. Hiçbiri canlıda değil: açılışta
**33 migration (59–91)** ve kapalı anahtarlar (`RAILWAY-ACILIS-2026-10-15.md` §3) bekliyor. Yeni dilimden önce en büyük risk bu birikim.

## 2. Araştırmanın 20 maddesi ↔ bugünkü kod

| # | Madde | Bugün (kanıt) | Durum | Faz |
|---|---|---|---|---|
| 1 | Giriş hazırlığı ekranı | hazırlık çekirdeği `early-checkin/readiness.ts` (görev yok / çıkış bilinmiyor → "bilinmiyor"; açık görev → "hazır değil") yalnız konuşma panelinde; birleşik konaklama satırı, erişim durumu, üstlenilmemiş iş sayısı yok | KISMEN | V5 |
| 2 | Personel ve iş kabulü | roller, temizlikçi görünümü (`tasks/staff-view.ts`), atama e-postası (görev başı saatte 3) var; **davet rotası / ekranı yok** (Codex'in iddiası doğru; `durum.md`'de "temizlikçi davet → kimlik akışı, kurucu onayı" bekliyor); kabul / ret / son zaman / yedek / daire kapsamı yok; WhatsApp yalnız ev sahibi, göreve dokunmuyor | KISMEN + YOK | V3 |
| 3 | Değişiklik etkisi | tarih değişince AÇIK sistem görevi yeni tarihe taşınır (`tasks/follow-reservation.ts`); **elle değiştirilen görev sessizce kalır** (çatışma gösterilmez); kanal / takvim tarih değişikliği karar kartı açmaz; erişim / kilit yolu yok; "tarih değişti" sinyali yalnız gözlem | KISMEN | V3 / V5 |
| 4 | Fiziksel envanter (ilanlar, villa–oda, oda havuzu) | `ChannelListing` (60, kapalı) var ama `Property.hospitableId` küresel tekil; villa / oda / havuz ilişkisi yok; daireler arası bağlı müsaitlik bilinçli kapsam dışı (`acik-isler.md`) | YOK | V0 / ④ |
| 5 | Konaklama türleri | `Reservation` yalnız kanal + durum taşır; sahip konaklaması / bakım / geçici tutma yok. ⚠️ iCal her etkinliği misafir konaklaması sayar ve temizlik + giriş görevi açar — beslemede ev sahibinin kapattığı günler de etkinlik olarak geliyorsa sahte temizlik görevi oluşur. Hangi kanal kapalı günü nasıl yazıyor, gerçek bir dışa aktarım dosyasıyla doğrulanmalı (resmi belgede bulunamadı) | YOK | ④ |
| 6 | İhtiyacın tamamlanması | öğe defteri (açık · ev sahibinde · cevaplandı · vazgeçildi · yerine geçti · bitti) CANLI; söz → görev bağı (62) kodda; **öğe ↔ görev bağı yok** (görev açmak / bitirmek öğeyi değiştirmez); "personelce üstlenildi" durumu yok | KISMEN | V3 |
| 7 | Cihaz bakım geçmişi | cihaz kaydı yok; cihaz sözcük envanteri yalnız sınıflandırıcıda; tekrarlayan sorun daire + konu düzeyinde | YOK | V6 |
| 8 | Stok ve çamaşır | "Hazırlık" sayfası CANLI: ihtiyaç / elde / alınacak (işletme düzeyinde tek stok); depo–daire–çamaşırhane hareketi, temiz / kirli, tahmin ≠ tüketim yok | KISMEN | — |
| 9 | Bilgi değişiklikleri | "Bilgi tabanına ekle", geçmişten öğrenme (65, kapalı), KB onay durumu (CANLI), çelişki hesabı var; değişikliğin hangi cevap / şablonu etkilediği gösterilmiyor; "misafire özel istisna ↔ daire kuralı" ayrımı yok | KISMEN | V1 |
| 10 | Güvenilir gelen kutusu | elle yazılan taslak yalnız ekranda (yenilemede kaybolur — kalıcı değil); **yalnız fotoğraftan oluşan mesaj içe alınmaz** (sayılır, atlanır, işletmeciye alarm — bilinçli: 08-06 denetimi, hangi olayda boş gövde geldiği canlı veriyle görülmeden yer tutucu satır yazılmıyor); kanal gönderen rolü (71) kapalı | KISMEN | — |
| 11 | Misafir portalı | QR sohbeti CANLI (konaklamaya bağlı cihaz, ikinci kayıt yok); talep durumu misafire görünmez; PIN kapalı; konaklama rehberi yok | KISMEN | — |
| 12 | Erişim hazırlığı | kod bilgi tabanında serbest metin; "üretildi" ≠ "kilide yerleşti" ayrımı yok; kilit entegrasyonu yok | YOK | V3 / V5 |
| 13 | Teklif ve grup rezervasyonu | yok ("tutulan" yalnız onay bekleyen durum, süresiz) | YOK | — |
| 14 | Fiyat ve satış kuralları | yok; "neden satılamıyor" yalnız dolu / onay bekleyen geceyi açıklıyor | YOK | V7 |
| 15 | Konaklama finansı | bilinçli kaldırıldı; tutar saklanıyor, okunmuyor (pin) | YOK (karar) | V7 |
| 16 | Mülk sahibi portalı | yalnız hesap rolleri | YOK | — |
| 17 | Misafir geçmişi | dönen misafir yalnız sağlayıcının kararlı misafir kimliğiyle; ad / maskeli e-posta birleştirmesi YOK (değişmez 10 ✓); işletmeye özel profil yok | KISMEN | — |
| 18 | Bağlantı ve geçiş sağlığı | eksik okuma (F16) kaynak düzeyinde CANLI; bağlantı sağlığı yazıcısı kapalı; geçmiş aktarımda karşılama / giriş mesajı tabanı (S7-4, 11-05) — bir açık yol kaldı (Tur 7 raporu Q-A); yan etkisiz prova / karşılaştırma yok | KISMEN | V0 |
| 19 | Ask Lixus | yok | YOK | V8 |
| 20 | Yerel çalışma modeli | işletme saat dilimi var, **daire saat dilimi yok**; para birimi yalnız rezervasyon satırında; ruhsat / kimlik bildirimi yok | KISMEN | — |

## 3. Tasarımı belirleyen dört senaryo — bugün ne olur

- **Uzatılan rezervasyon + elle sabitlenmiş temizlik:** sistem görevi yeni güne taşınır; temizlikçinin elle sabitlediği görev ESKİ günde kalır
  ve kimse uyarılmaz. Mesaj güncellemesinin / kilidin başarısı izlenmiyor (kilit yolu yok). Eksik: çatışmanın görünür olması.
- **Televizyon + çöp sorusu:** öğe kipi çöpü cevaplar. Televizyon `complaint_issue` etiketlenirse ev sahibinde kalır; `appliance_help`
  ("cihaz kullanımı") etiketlenirse model adım yazabilir ve ihtiyaç "cevaplandı" kapanır — bunu önleyen arıza kalkanı
  (`AI_FAULT_GUARD_ENABLED`) kapalı. Görev açmak öğeyi değiştirmez (bağ yok): "görev açıldı = tamir edildi" karışıklığı yok, ama "gerçekten
  bitti" de izlenemiyor.
- **Villa iptali:** villa / oda modeli olmadığı için uygulanamaz; bugün iptal yalnız o rezervasyonun kendi görevlerini temizler.
- **Geçmiş veri aktarımı:** ilk senkronla gelen eski rezervasyonlar karşılama / giriş mesajı almaz (S7-4, 11-05); tahsilat ve erişim komutu
  yolu zaten yok. Açık kalan: sonradan sağlayıcıya bağlanan eski daire (Q-A).

## 4. Araştırmanın dış iddiaları — doğrulama

| İddia | Sonuç |
|---|---|
| Booking.com yeni bağlantı sağlayıcısı kabulünü durdurdu | ✅ resmi sayfa: "pausing integrations with new connectivity providers until further notice" ([connect.booking.com](https://connect.booking.com/)); planımızdaki not ile aynı |
| Booking Review API yorumları kamuya açık sayfada kullanılamaz | ⚠️ yalnız üçüncü taraf bir yazıda ([elfsight](https://elfsight.com/blog/how-to-get-and-use-booking-com-api-partnership-and-integration/)); Booking'in kendi metni bulunamadı — sözleşmeye bakılmalı |
| Hospitable Knowledge Hub sonraki değişiklikleri kendiliğinden yansıtmıyor | ⚠️ kısmen: yardım belgesi Hub'ın mülk bilgisi + mesaj geçmişi + kurallardan kurulduğunu, elle eklenen kalemin kaynağa bağlı olmadığını söylüyor ([help.hospitable.com](https://help.hospitable.com/en/articles/9716792-improve-ai-accuracy-with-the-knowledge-hub)); "çabuk eskiyor" bir kullanıcı isteği ([featurebase](https://hospitable.featurebase.app/p/create-a-shared-knowledge-hub-for-similar-properties)) |
| Hospitable kabul / ret sistemi sessiz personelde yedeğe geçmiyor | ⚠️ bir kullanıcı isteği bunu istiyor ([featurebase](https://hospitable.featurebase.app/p/automatic-task-reassignment-when-cleaner-declines)); resmi belge okunmadı |
| "Bugün mikroservis ordusu kurmazdım; modüler uygulama + PostgreSQL + kalıcı kuyruk + ayrı işçiler" | ✅ bugünkü mimarimiz zaten bu; katılıyorum. "Kritik ilişkiyi JSON'a sıkıştırmazdım" — katılıyorum; bugün işletme stoğu tek JSON alanında (`supplyStockJson`), madde 8'e geçilirse tabloya taşınmalı |

## 5. İlk küçük ürün dilimi — dört adayın karşılaştırması

| Aday | Misafire giden değişir mi | Migration | Kimlik / e-posta akışı | Mevcut temel | Risk |
|---|---|---|---|---|---|
| A. Giriş hazırlığı (salt-okuma) | Hayır | Gerekmez | Hayır | hazırlık çekirdeği, görevler, öğeler, rezervasyon | Düşük — yalnız gösterim |
| B. Personel daveti + tek temizlik işinin kabulden bitişe | Hayır | Evet (davet + kabul alanları) | **Evet** (davet e-postası, şifre oluşturma — kural: onay + ilk denemeler birlikte; rol / davet akışında `sessionEpoch` artırılır) | roller, temizlikçi görünümü, atama e-postası | Orta — yeni kimlik yüzeyi |
| C. Değişiklik etkisi | Başta hayır (salt-okuma çatışma satırı); mesaj güncellemesi eklenirse evet | Belki | Hayır | görevlerin tarihi izlemesi, sinyal | Düşük → orta |
| D. İhtiyacın gerçekten tamamlanması | Arıza kalkanı açılırsa **evet** | Evet (öğe ↔ görev bağı) | Hayır | öğe defteri, söz → görev | Orta — AI kapısına dokunur |

**Önerim: önce A, hemen ardından B** (araştırmanın kendi sırasıyla aynı; ama B'yi ayrı dilim yapıyorum çünkü kimlik akışı ayrı onay ister).
Neden A önce: misafire giden mesaj, ödeme, otomasyon ve veri silme değişmez; migration gerekmez; hazırlık çekirdeği hazır; ve sonraki
dilimlerin başarısını ölçecek sayıları doğurur (araştırmanın ölçütleri: üstlenilmemiş iş, hazırlıksız giriş, kaybolan ihtiyaç).

**Büyük ürünler böyle yapıyor:** temizlik operasyon araçları hazırlığı "temizlik + denetim + bakım" işlerinin birleşimi olarak gösteriyor
(Breezeway için üçüncü taraf anlatımları: rezervasyon değişince temizlik / denetim işleri kendiliğinden açılıyor, fotoğraflı kontrol listesi,
hazırlık raporu); Turno'nun resmi yardım sayfası: iş önce asıl temizlikçilere gider, kabul ya da ret ederler; hepsi reddederse ya da
belirlenen süre içinde cevap gelmezse yedeklere açılır ([turno](https://intercom.help/turnoapp/en/articles/5538659-primary-and-backup-cleaners)). B bu modelin bizdeki karşılığı olur.

**A için örnek (önce → sonra):**

- Önce: ev sahibi yarın girecek misafirin dairesinin hazır olup olmadığını öğrenmek için görevler sayfasını ve her konuşmayı ayrı ayrı açar.
- Sonra — "Yaklaşan girişler" listesi (önümüzdeki 3 gün, satır başına bir konaklama):
  - `Cum 7 Kas · Lale 5 · giriş 15:00 · Temizlik: Ayşe'ye atandı, başlanmadı · Erişim: kapı kodu bilgi tabanında var (kilide yerleştiği bilinmiyor) · Açık ihtiyaç: bebek yatağı (sizde) · HAZIR DEĞİL`
  - `Cmt 8 Kas · Lale 7 · giriş 14:00 · Temizlik görevi yok · BİLİNMİYOR` — bilinmeyen asla yeşil gösterilmez.
  - `Paz 9 Kas · Lale 3 · giriş 16:00 · Temizlik bitti (çıkıştan sonra, 11:40) · Açık ihtiyaç yok · HAZIR`
- Kapsam dışı (sonraki dilimler): kabul / ret, yedek kişi, kilit entegrasyonu, misafire bildirim.
- Bilinen risk: temizlikçi görevi "bitti" işaretlemiyorsa satırlar "hazır değil" görünür (doğru ama gürültülü) — ilk hafta ölçülür.

## 6. Netleşmesi gereken izinler (kurucu: "uygulama, yedek / geri yükleme doğrulaması, ücretli ölçüm ve push izinlerini ayrıca netleştirelim")

Önerim — her dilim için aynı kalıp:

| İzin | Önerim |
|---|---|
| Uygulama | Siz dilimi seçip tasarım belgesindeki örnekleri onaylayınca. Müşteriye giden metin / ödeme / otomasyon / silme değişen her nokta ayrıca önce / sonra örneğiyle sorulur |
| Migration | Tasarımda gerekçesi gösterilirse yazılır; migration içeren push her seferinde sizin açık onayınızla |
| Yedek / geri yükleme | Railway açılmadan önce taze yedek + boş bir veritabanına geri yükleme provası (açılış belgesindeki adım); 33 migration'ın provası o kopyada |
| Ücretli ölçüm | A için gerekmez (model çağrısı yok). Model çağıran dilimlerde yine yalnız sizin onayınızla, tahmini maliyetle birlikte |
| Push | Tam kapı + build yeşilse migration'sız değişiklikler itilir (bugünkü kural); migration'lı olanlar onayla |

## 7. Sorular

- **H-1:** İlk dilim A (giriş hazırlığı, salt-okuma) olsun mu? Değilse B / C / D'den hangisi?
- **H-2:** A'da "erişim" satırı bugün yalnız "kod bilgi tabanında var / yok" gösterebilir (kilide yerleştiği bilinmez). Böyle başlansın mı,
  yoksa erişim satırı kilit / manuel kontrol gelene kadar gizlensin mi?
- **H-3:** B'ye geçildiğinde davet e-postası ve şifre oluşturma ekranı kimlik akışıdır — ilk denemeleri birlikte yapmak üzere tasarım
  belgesiyle gelebilir miyim?
- **H-4 (madde 5 için):** Airbnb / Booking takvim dışa aktarım bağlantınızdan bir örnek dosya (kişisel veri silinmiş) paylaşabilir misiniz?
  Kapalı günlerin konaklama gibi görev açıp açmadığını ancak gerçek dosyayla doğrulayabilirim.
