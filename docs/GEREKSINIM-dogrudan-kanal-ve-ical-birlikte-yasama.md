# GEREKSİNİM — Doğrudan kanal bağlantısı ve iCal aynı mülkte birlikte yaşasın (kurucu, 2026-09-08)

> Durum: **KAYIT** (uygulanmadı). Kurucu talimatı: "Şimdilik bunu gereksinim olarak kaydet." Değişmez 6'nın
> (Hospitable+iCal aynı ilanı beslerse tahminî birleştirme YOK, sahiplik/öncelik ile) somutlaştırılmış hâlidir.
> Uygulama yeri: Airbnb Direct / Vrbo / Booking bağlantıları geldiğinde (V0 kalan işler) ve deterministik
> Availability Engine (④) tasarımında. V1/V2 kapsamına GİRMEZ.

## Kurucu metni (aynen)
Aynı mülkte doğrudan kanal bağlantısı ve iCal birlikte bulunabilsin. Airbnb/Booking/Vrbo doğrudan bağlantısından
gelen veri, aynı kanalın iCal verisine göre öncelikli olsun. iCal, doğrudan bağlantının rezervasyon bilgilerini ezmesin
veya aynı rezervasyonu ikinci kez oluşturmasın. Farklı kanalların rezervasyonları takvimde birlikte gösterilsin.
Yalnız aynı kanala ait iCal pasif/yedek olsun. Örneğin Airbnb doğrudan bağlandıysa Airbnb iCal'i kayıtlı kalsın ama
takvime ikinci kez rezervasyon yazmasın. Booking ve Vrbo iCal'leri çalışmaya devam etsin; Airbnb bağlantısı onların
rezervasyonlarını getirmez.

## Gereksinim maddeleri (test-pinlenecek)
1. **Birlikte varlık:** bir mülkte aynı anda N doğrudan bağlantı (kanal başına en çok bir) + M iCal kaynağı olabilir.
2. **Kanal başına sahiplik:** her rezervasyonun tek bir *yetkili kaynağı* vardır. Aynı kanal için doğrudan bağlantı
   varsa yetkili kaynak odur; o kanalın iCal'i **pasif/yedek** olur: kayıtlı kalır, çekilmeye devam edebilir (sağlık/
   karşılaştırma için), ama **rezervasyon YAZMAZ** (create/update/cancel yok).
3. **Ezmeme:** iCal hiçbir koşulda doğrudan bağlantıdan gelen bir rezervasyonun alanlarını (tarih, durum, misafir)
   ezemez; aynı rezervasyonu ikinci kez oluşturamaz.
4. **Diğer kanallar etkilenmez:** Airbnb doğrudan bağlantısı Booking/Vrbo iCal'lerini pasifleştirmez; onlar yazmaya
   devam eder. Bir kanalın bağlantısı başka kanalın rezervasyonlarını getirmez.
5. **Takvim birleşik görünüm:** farklı kanalların rezervasyonları (doğrudan + iCal) aynı takvimde birlikte gösterilir;
   kaynak rozetiyle (kanal + doğrudan/iCal).
6. **Geçişler geri alınabilir:** doğrudan bağlantı kaldırılırsa aynı kanalın iCal'i yeniden aktif kaynak olur;
   bağlantı gelince iCal yedeğe düşer. Geçişte mevcut satırlar silinmez; sahiplik değişimi audit'lidir.
7. **Belirsizlikte sessiz birleştirme YOK:** doğrudan bağlantı satırı ile iCal satırı aynı konaklamayı gösteriyorsa
   (aynı kanal, çakışan tarihler) tahminle birleştirilmez; sahiplik kuralı (madde 2) uygulanır ve iCal satırı
   *yedek* olarak işaretlenir/gizlenir, silinmez (değişmez 6, 10).

## Bugünkü durum (kod-doğrulandı, 2026-09-08)
- Hospitable köprüsü bugün tüm kanalların rezervasyonlarını getirir (`sourceReference` = Hospitable kimliği,
  `calendarSourceId` NULL). iCal kaynakları ayrı kimlikle yazar (`sourceReference` = iCal UID, `calendarSourceId` =
  kaynak). İkisi arasında eşleştirme YOK → aynı mülke hem Hospitable hem o kanalın iCal'i bağlanırsa aynı konaklama
  **iki satır** olabilir (bilinçli: tahminî birleştirme yasak). Bu gereksinim o boşluğu sahiplik kuralıyla kapatır.
- iCal reservation-only (değişmez 5); mesaj yeteneği yok (`channels/capability.ts`).
- `CalendarSource` bugün "kanal" bilgisini etiketten türetir (`channelFromLabel`); madde 2 için kaynağın kanalı
  **açık alan** olmalı (etiket tahmini yetmez) → küçük şema/UI işi, gereksinim uygulanırken.

## Bağımlılıklar / sıra
Airbnb Direct adaptörü (sandbox+doküman olmadan sahte connector YOK, değişmez 18) → ChannelConnection kanal başına
(bugün `(org, provider)` tek satır; provider "hospitable") → sahiplik kuralı ingest write service'te (canonical, sağlayıcı
bağımsız) → Availability Engine bu sahipliği okur. Test: conformance kiti + "aynı kanal iCal yedek / farklı kanal aktif /
bağlantı kalkınca geri dönüş / ezmeme / mükerrer yok / takvim birleşik" senaryoları.
