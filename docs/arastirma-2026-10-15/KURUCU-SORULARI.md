# Kurucu soruları — V sonrası araştırmalar (10-15)

Kurucu 10-15: "geçici olarak soru sorma … Vlerden sonra yapacağız dediklerimi yap". Beş Opus araştırması bitti. Müşteriye / misafire giden
hiçbir şeyi değiştirmeyen düzeltmeler SORULMADAN yapıldı (§A). Değiştirenler aşağıda soru olarak bekliyor (§B). Her sorunun tam metni,
"bugün böyle · büyük şirketler böyle · önerim · ÖRNEK önce / sonra · böyle yapalım mı?" biçiminde, raporun içinde; burada yalnız tek satır ve yer.

## A. Sorulmadan yapılanlar (müşteriye / misafire giden değişmedi; migration YOK)

| Konu | Ne oldu | Kanıt |
|---|---|---|
| Bilgi tabanı ekleme (form, şablon önerisi, geçmiş cevap önerisi) | Aynı kalem yeniden gönderilirse aynı istek kimliği → çift tık / kopan bağlantıda ikinci kalem açılmaz | `tests/ui/kb-create-request-id-screens.test.tsx` (kırmızı-önce ölçüldü) |
| Bilgi tabanı "diğer dairelere kopyala" | Her hedef dairede kopya bir kez (`copy:<kaynak>:<kimlik>`, 67'nin dizini); yeniden denemeye eklenen daire yazılır | `tests/integration/kb-copy-request-id.test.ts` (gerçek PG, `Promise.all`) |
| Rezervasyon görevleri (giriş hazırlığı / temizlik) | Rezervasyon başına işlem kilidi → senkron + "Eksik görevleri oluştur" aynı anda koşunca iki temizlik açılmaz | `tests/integration/reservation-tasks-concurrent.test.ts` |
| Kimliksiz CSV aynı anda iki kez | Doğal anahtar kontrolü işletme yazma kilidi altında tekrar → çift rezervasyon yok ("zaten var" sayılır, yeni hata metni yok) | `tests/integration/reservations-import-concurrent.test.ts` |
| QR'ı aynı anda iki kez "aç" | Jeton yalnız boşsa yazılır → basılan QR ölü kalmaz | `tests/integration/property-chat-route.test.ts` |
| Mülk talimatı / söz / mesajdan görev | Aynı talimat, aynı söz (tür + saat), aynı gün aynı konu görevi kilit altında tekilleşir | `history-learn.test.ts`, `guest-commitments.test.ts`, `task-from-message.test.ts` |
| Ödeme eşzamanlılık testleri | Aynı olayın eş zamanlı teslimi, aynı işlemin iki olayı, fatura çakışması, eş zamanlı onay — dördü de gerçek PG'de pinlendi (kod değişmedi) | `tests/integration/paddle-webhook-*.test.ts`, `billing-consent-concurrent.test.ts` |
| Öneri listesi (anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI) | Aynı tür + aynı saat için AÇIK söz zaten varsa "Söz kaydet" önerisi gösterilmez (eskiden onay ikinci sözü açardı; ilk düzeltmede ölü "Onayla" düğmesi kalıyordu — Opus son kontrolü B1) | `ai-action-suggestions.test.ts` |
| Takvim senkronu + dosyadan içe aktarma | Satır KAYDEDİLDİKTEN sonra görev açma düşerse satır artık "Kaydedilemedi" sayılmaz (yazılmıştı; yeniden yükleme "zaten var" deyip görevleri hiç açmıyordu). Operatöre tek toplu alarm; görevler sonraki senkron / "Eksik görevleri oluştur" ile tamamlanır (Opus B4). İptal temizliği düşerse sonraki senkron ya da dosyanın yeniden yüklenmesi temizliği YENİDEN dener (eskiden iptal edilmiş konaklamanın temizlik görevi kalıcı açık kalabiliyordu — Haiku son tur) | `calendar-sync.test.ts`, `reservations-import-concurrent.test.ts` |
| Sentry (takip no. dilim G'nin bir kısmı) | Sürüm (Railway commit), ortam, ALAN etiketi; Sentry olay kimliği olay günlüğüne (iki yönlü bağ). İşletme özeti etiketi YOK (soru F5) | `tests/unit/correlation.test.ts` |

## B. Sorular (sıra = önerdiğim öncelik)

| # | Soru | Neden sorulmalı | Tam metin |
|---|---|---|---|
| 1 | **Ödeme S1 (U39):** bozuk / eksik tutarlı fatura yazılmasın, alarm versin | para kaydı | `odeme.md` §5 S1 — yama hazır `docs/hazir-yamalar/2026-10-07-U39-paddle-tutar.patch` |
| 2 | **Ödeme S2 (U42):** hesap silme + ödeme olayı aynı anda → alarm (eski yama değil, daha basit hâli) | para / alarm | `odeme.md` §5 S2 — yeni yama `docs/hazir-yamalar/2026-10-15-U42-basit-alarm.patch` |
| 3 | **İdempotency S1:** elle cevapta "zaten gitti" hafızası (kopan bağlantıda misafire çift mesaj) | misafire giden | `idempotency.md` §9 S1 |
| 4 | **Ödeme S3:** iade → fatura "iade edildi"; ters ibrazda operatöre alarm (erişime dokunmadan) | para | `odeme.md` §5 S3 |
| 5 | **Takip no. F2:** kart reddinde ödeme ekranında takip numarası satırı | müşteriye giden metin | `takip-numarasi.md` §15 F2 |
| 6 | **Takip no. F8 + F1/F3/F4:** tek migration (68) ile destek ekranı v2, otomatik cevap ve QR izleri | migration | `takip-numarasi.md` §15 |
| 7 | **İdempotency S2:** ortak "istek defteri" (elle rezervasyon, konuşma, şablon) | migration / akış | `idempotency.md` §9 S2 |
| 8 | **Deneme S1–S5:** Hospitable'lı hesaba işletme kimliği · silinen hesabın e-posta izi · geçici e-posta listesi · yüksek puanda kartla doğrulama · iade politikası | kimlik / para / KVKK | `deneme-kotuye-kullanim.md` §5 |
| 9 | **Yatay ölçek S1–S8:** ikinci kopya ne zaman · işçi servisi · migration'ı yayın öncesine · bağlantı tavanı · kapanış · vektörler DB'de · anlama tutarlılığı · senkron paralelliği | altyapı / migration | `yatay-olcek.md` §6 |
| 10 | **Ödeme S4:** duraklatılan abonelik "past_due" sayılıyor (14 gün ücretsiz) · bizim 14 gün / Paddle 30 gün | ürün kararı | `odeme.md` §5 S4 |
| 11 | **İdempotency S4 / S5 / S6:** kayıtta "hesabınız var" e-postası tekrarı · bilgi tabanında eski sekmeden kaydetme (409) · e-posta sağlayıcısına tekrar kimliği | kimlik / e-posta / arayüz | `idempotency.md` §9 |
| 12 | **Takip no. F5 / F6 / F7:** Sentry'ye işletme özeti · günlük bütünlük mührü · KVKK dökümü (avukat) | gizlilik | `takip-numarasi.md` §15 |
| 13 | **QR kalkan süresi (P3):** 120 sn'den uzun süren QR isteğinde tekrar = çift işleme; süreyi 300 sn'ye çıkaralım mı (çöken istekte misafirin yeniden denemesi 5 dk bekler) | misafir deneyimi | `idempotency.md` §8 #14 |
| 14 | **Söz ekranı metni (Opus B15):** aynı söz ikinci kez girilince bugün "Söz kaydedildi, görev açıldı." yazıyor ama yeni görev açılmıyor (söz zaten var). Önerim: "Bu söz zaten kayıtlı." — ÖRNEK: ev sahibi "Havlu, yarın 18:00"e iki kez basar → önce: iki kez "görev açıldı" · sonra: ikincide "Bu söz zaten kayıtlı." Böyle yapalım mı? | müşteriye giden metin | `components/inbox/commitments-card.tsx` |

## C. Bilinen sınır (kayıt)
- Kopyalama: iki sekme + kopan bağlantı birleşiminde, ilk deneme A + B'ye eski metni yazdıysa ve kaynak ARADA başka sekmede düzenlendiyse,
  eski sekmeden C eklenerek yapılan yeniden deneme A + B'yi atlar, C'ye YENİ metni yazar (çift kalem yok; daireler arası metin farklı kalır).
  Opus 10-15 B14; kabul edildi.
- Sentry: `environment` alanı BİLEREK eskisi gibi (NODE_ENV); Railway ortam adı ayrı `railway_env` etiketi — mevcut uyarı kuralları değişmez.
- Bilgi tabanı yeniden denemesi: ilk istek yazıp cevap koptuysa ve kalem ARADA başka sekmeden düzenlendiyse, yeniden deneme düzenlenmiş
  kalemi döndürür (yeni kalem açmaz). Kalem zaten var; form temizlenir. Haiku 10-15 inceleme; kabul edildi (409 yeni müşteri metni ister).
