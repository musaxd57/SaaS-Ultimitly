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
| QR'ı aynı anda iki kez "aç" | Jeton yalnız boşsa yazılır → basılan QR ölü kalmaz | `tests/integration/property-chat-route.test.ts`, `property-chat-route-race.test.ts` (belirlenimci) |
| Mülk talimatı / söz / mesajdan görev | Aynı talimat, aynı söz (tür + saat), aynı gün aynı konu görevi kilit altında tekilleşir | `history-learn.test.ts`, `guest-commitments.test.ts`, `task-from-message.test.ts` |
| Ödeme eşzamanlılık testleri | Aynı olayın eş zamanlı teslimi, aynı işlemin iki olayı, fatura çakışması, eş zamanlı onay — dördü de gerçek PG'de pinlendi (kod değişmedi) | `tests/integration/paddle-webhook-*.test.ts`, `billing-consent-concurrent.test.ts` |
| Öneri listesi (anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI) | Aynı tür + aynı saat için AÇIK söz zaten varsa "Söz kaydet" önerisi gösterilmez (eskiden onay ikinci sözü açardı; ilk düzeltmede ölü "Onayla" düğmesi kalıyordu — Opus son kontrolü B1) | `ai-action-suggestions.test.ts` |
| Takvim senkronu + dosyadan içe aktarma | Satır KAYDEDİLDİKTEN sonra görev açma düşerse satır artık "Kaydedilemedi" sayılmaz (yazılmıştı; yeniden yükleme "zaten var" deyip görevleri hiç açmıyordu). Operatöre tek toplu alarm; görevler sonraki senkron / "Eksik görevleri oluştur" ile tamamlanır (Opus B4). İptal temizliği düşerse sonraki senkron ya da dosyanın yeniden yüklenmesi temizliği YENİDEN dener (eskiden iptal edilmiş konaklamanın temizlik görevi kalıcı açık kalabiliyordu — Haiku son tur) | `calendar-sync.test.ts`, `reservations-import-concurrent.test.ts` |
| Sentry (takip no. dilim G'nin bir kısmı) | Sürüm (Railway commit), ALAN etiketi ve Railway ortam adı etiketi; Sentry olay kimliği olay günlüğüne (iki yönlü bağ). `environment` alanı eskisi gibi (uyarı kuralları bozulmasın). İşletme özeti etiketi YOK (soru F5) | `tests/unit/correlation.test.ts`, `tests/integration/report-error.test.ts` |
| Paddle imza alarmı (yalnız operatör e-postası) | İmza anahtarla TUTUYOR ama zaman damgası eskiyse ayrı teşhis: "anahtar DOĞRU, değiştirmeyin — saat farkı / eski tekrar". Eskiden "anahtar yanlış" diyordu. Ret kararı aynı (401) | `tests/integration/paddle-webhook-signature-alarm.test.ts` |
| Kabul testleri (kurucu 10-15, 6 madde) | Aynı kimlik + farklı içerik → 409 · kiracı sınırı · bilerek yeni işlem · kısmi kopya (A/B tamam, C düştü → yalnız C) · kaynak değişti → 409 (hedef sırası [C,A] / [A,C] / yalnız [C]) · "Klima bozuk" ≠ "Musluk bozuk", aynı mesaj tekrar = tek görev, ertesi gün = yeni görev · çökme + iki AYRI Node süreci | `idempotency-acceptance*.test.ts`, `idempotency-two-workers.test.ts` (mutasyon 8/8) |
| İptal yolları aynı kilit (ChatGPT 10-15) | Sekiz iptal / onarım çağrısının HER biri (iCal geçişi · iCal "zaten iptal" onarımı · iCal kayıp uzlaştırması (prod'da anahtar KAPALI; fonksiyon düzeyinde) · dosya geçişi · aynı iptal dosyasının yeniden yüklenmesi · canlı satırlı dosya · rezervasyon düzenleme rotası (PATCH — temizliği HİÇ çağırmıyordu, Haiku bulgusu) · Hospitable) iptalden ÖNCE başlamış görev açma işlemine karşı sınandı: temizlik kilidi bekler, iptal edilmiş konaklamada görev kalmaz. "Zaten iptal + şu an görev yok → çık" kısa yolu KALDIRILDI (kanıt değildi). Kayıp uzlaştırmasında düşen temizlik artık operatöre alarm verir (eskiden sessizdi). Aynı iptal dosyasının yeniden yüklenmesi artık temizliği yeniden dener (eskiden yalnız canlı satırlı dosya deniyordu). Ters yön (Opus O1): "Yeniden aç" ya da takvimin yeniden onaylaması, süren bir iptal temizliğiyle yarışınca onaylı rezervasyon görevsiz kalabiliyordu → yeniden açılan rezervasyonda görev açma kilitli yoldan. Hospitable senkronunda yutulan görev hataları artık koşu başına tek alarm (Opus O4) | `cancel-paths-lock-protocol.test.ts` |

## B. Sorular (sıra = önerdiğim öncelik)

| # | Soru | Neden sorulmalı | Tam metin |
|---|---|---|---|
| 1 | **Ödeme S1 (U39):** bozuk / eksik tutarlı fatura yazılmasın, alarm versin | para kaydı | `odeme.md` §5 S1 — yama hazır `docs/hazir-yamalar/2026-10-07-U39-paddle-tutar.patch` |
| 2 | **Ödeme S2 (U42):** hesap silme + ödeme olayı aynı anda → alarm (eski yama değil, daha basit hâli) | para / alarm | `odeme.md` §5 S2 — yeni yama `docs/hazir-yamalar/2026-10-15-U42-basit-alarm.patch` |
| 3 | **İdempotency S1:** elle cevapta "zaten gitti" hafızası (kopan bağlantıda misafire çift mesaj) | misafire giden | `idempotency.md` §9 S1 |
| 4 | **Ödeme S3:** iade → fatura "iade edildi"; ters ibrazda operatöre alarm (erişime dokunmadan) | para | `odeme.md` §5 S3 |
| 5 | **Takip no. F2:** kart reddinde ödeme ekranında takip numarası satırı | müşteriye giden metin | `takip-numarasi.md` §15 F2 |
| 6 | **Takip no. F8 + F1/F3/F4:** tek migration ile destek ekranı v2, otomatik cevap ve QR izleri (⚠️ 10-16: "68" araştırma anındaki taslak numaraydı; gerçek 68 KB kopya + söz kimliği — paket adı `M-takip`, `docs/MIGRATION-MANIFEST.md`) | migration | `takip-numarasi.md` §15 |
| 7 | **İdempotency S2:** ortak "istek defteri" (elle rezervasyon, konuşma, şablon) | migration / akış | `idempotency.md` §9 S2 |
| 8 | **Deneme S1–S5:** Hospitable'lı hesaba işletme kimliği · silinen hesabın e-posta izi · geçici e-posta listesi · yüksek puanda kartla doğrulama · iade politikası | kimlik / para / KVKK | `deneme-kotuye-kullanim.md` §5 |
| 9 | **Yatay ölçek S1–S8:** ikinci kopya ne zaman · işçi servisi · migration'ı yayın öncesine · bağlantı tavanı · kapanış · vektörler DB'de · anlama tutarlılığı · senkron paralelliği | altyapı / migration | `yatay-olcek.md` §6 |
| 10 | **Ödeme S4:** duraklatılan abonelik "past_due" sayılıyor (14 gün ücretsiz) · bizim 14 gün / Paddle 30 gün | ürün kararı | `odeme.md` §5 S4 |
| 11 | **İdempotency S4 / S5 / S6:** kayıtta "hesabınız var" e-postası tekrarı · bilgi tabanında eski sekmeden kaydetme (409) · e-posta sağlayıcısına tekrar kimliği | kimlik / e-posta / arayüz | `idempotency.md` §9 |
| 12 | **Takip no. F5 / F6 / F7:** Sentry'ye işletme özeti · günlük bütünlük mührü · KVKK dökümü (avukat) | gizlilik | `takip-numarasi.md` §15 |
| 13 | **QR kalkan süresi (P3):** 120 sn'den uzun süren QR isteğinde tekrar = çift işleme; süreyi 300 sn'ye çıkaralım mı (çöken istekte misafirin yeniden denemesi 5 dk bekler) | misafir deneyimi | `idempotency.md` §8 #14 |
| 14 | **Söz ekranı metni (Opus B15):** aynı söz ikinci kez girilince bugün "Söz kaydedildi, görev açıldı." yazıyor ama yeni görev açılmıyor (söz zaten var). Önerim: "Bu söz zaten kayıtlı." — ÖRNEK: ev sahibi "Havlu, yarın 18:00"e iki kez basar → önce: iki kez "görev açıldı" · sonra: ikincide "Bu söz zaten kayıtlı." Böyle yapalım mı? | müşteriye giden metin | `components/inbox/commitments-card.tsx` |
| 15 | **D1 · Bilgi tabanı formu: bağlantı koparken metni düzeltip yeniden kaydetme** + iki 409 metninin onayı | müşteriye giden metin / davranış | ↓ §D1 |
| 16 | **D2 · Kaynak değiştikten sonra yeniden kopyalama:** eski kopyanın yanına ikinci kalem mi, eski kopya güncellensin mi | müşteriye giden davranış | ↓ §D2 |
| 17 | **D3 · Söz tekilleştirmesinin kapsamı:** "aynı tür + aynı saat = aynı söz" klima 18:00 ile musluk 18:00'i birleştiriyor | müşteriye giden davranış | ↓ §D3 |
| 18 | **D4 · Arıza görev tespiti:** "Kapının kilidi bozuldu", "Su akmıyor" bugün görev açmıyor | ev sahibine görünen görev | ↓ §D4 |
| 19 | **D5 · Eski sürümden kalan artık görevler:** iptal edilmiş konaklamada açık kalmış temizlik / giriş hazırlığı görevleri | veri silme | ↓ §D5 |
| 20 | **D6 · PATCH rotası iptal edilmiş rezervasyonu "Yeniden aç" kurallarını atlayarak açabiliyor** (arayüz kullanmıyor) | rezervasyon durumu | ↓ §D6 |
| 21 | **D7 · İptal → yeniden açma sonrası çıkış temizliği açılmıyor** (elle / söz / mesaj temizlik görevi varsa) | ev sahibine görünen görev | ↓ §D7 |

## C. Bilinen sınır (kayıt)
- Kopyalama: iki sekme + kopan bağlantı birleşiminde, ilk deneme A + B'ye eski metni yazdıysa ve kaynak ARADA başka sekmede düzenlendiyse,
  eski sekmeden C eklenerek yapılan yeniden deneme A + B'yi atlar, C'ye YENİ metni yazar (çift kalem yok; daireler arası metin farklı kalır).
  Opus 10-15 B14; kabul edildi.
- Sentry: `environment` alanı BİLEREK eskisi gibi (NODE_ENV); Railway ortam adı ayrı `railway_env` etiketi — mevcut uyarı kuralları değişmez.
- Bilgi tabanı yeniden denemesi: ilk istek yazıp cevap koptuysa ve kalem ARADA başka sekmeden düzenlendiyse, yeniden deneme artık
  düzenlenmiş kalemi sessizce DÖNDÜRMEZ — 409 + "Bu bilgi az önce farklı bir içerikle kaydedildi. Sayfayı yenileyip kontrol edin." (kurucu
  10-15 kabul maddesi 1; metin onayı §D1'de soruluyor). İstemci kimliği bırakır; ikinci basış YENİ kalem açar (§D1 bunu soruyor).
- İptal temizliği her çağrıda kilit bekler (hızlı yol yok): Hospitable senkronu penceresindeki her iptal edilmiş rezervasyon için ve iCal
  senkronu feed'deki her "iptal" satırı için turda bir kısa işlem açar (maliyet ölçümü ↓ §C sonu). Bilinçli bedel — "zaten iptal" bir
  güvenlik kanıtı değil (ChatGPT 10-15).
- Kayıp uzlaştırmasında (prod'da anahtar KAPALI) düşen temizlik alarm verir ama kendiliğinden yeniden denenmez (satır feed'de yok);
  kalıcı çözüm §D5'teki bir kerelik temizlik aracıyla aynı karar (Opus O5).
- Görev kapatılırken temizlikçinin aynı anda fotoğraf yüklemesi (milisaniyelik pencere) fotoğrafı depoda sahipsiz bırakabilir — önceden
  var, DOĞRULANMADI (yalnız kod okuması; Opus O10). Ayrı turda testle sınanacak.

## D. 10-15 akşam soruları (ChatGPT incelemesi + kabul testlerinden)

### D1 · Bilgi tabanı formu: bağlantı koparken metni düzeltip yeniden kaydetme
- **Bugün:** istek kimliği METNE bağlı. Aynı metin yeniden gönderilirse aynı kimlik → ikinci kalem açılmaz (çift tık / kopan bağlantı ✓).
  Ama metin değişirse yeni kimlik → yeni kalem.
- **ÖRNEK (bugün):** ev sahibi "Wi-Fi şifresi: 1234" yazıp Kaydet'e basar; bağlantı tam o anda kopar (kalem aslında KAYDEDİLDİ, ekranda
  hata görünür). Ev sahibi yazım hatasını fark edip "12345" yapar, yeniden basar → bilgi tabanında İKİ kalem: "1234" ve "12345". Yapay zekâ
  ikisini birden görür; bunu yakalayan bir uyarı da YOK (Mülk Hafızası çelişki denetimi yalnız giriş / çıkış saatine bakıyor).
- **Büyük şirketler:** ödeme sistemlerinde (Stripe vb.) tekrar anahtarı İŞLEM başınadır, içerik başına değil; aynı anahtar + farklı içerik
  → açık hata, sessiz ikinci kayıt yok.
- **Önerim:** kimlik FORM başına, kayıt başarıyla bitene kadar aynı kalsın. Düzeltilmiş metin aynı kimlikle gider; ilk kayıt gerçekten
  yazıldıysa sunucu 409 verir ve ekranda: "Bu bilgi az önce farklı bir içerikle kaydedildi. Sayfayı yenileyip kontrol edin." 409'dan sonra
  tekrar basmak yine aynı mesajı verir (sessiz ikinci kalem yok); sayfa yenilenince yeni form = yeni işlem. İlk kayıt gerçekten YAZILMADIYSA
  düzeltilmiş metin normal kaydedilir (409 yalnız önceki kayıt varsa).
- **ÖRNEK (sonra):** aynı olay → ikinci basışta "Bu bilgi az önce farklı bir içerikle kaydedildi. Sayfayı yenileyip kontrol edin." →
  ev sahibi yeniler, "1234" kalemini görür ve düzenler → tek kalem "12345".
- **Ayrıca metin onayı (bugün kodda, Railway kapalı olduğu için hiçbir müşteri görmedi):** kalem için yukarıdaki cümle; kopyalama için
  "Kaynak bilgi bu arada değişti. Sayfayı yenileyip yeniden kopyalayın." — bu iki cümle uygun mu?
- **Böyle yapalım mı?**

### D2 · Kaynak değiştikten sonra yeniden kopyalama
- **Bugün:** "Havuz 09:00–20:00" kalemi A ve B dairelerine kopyalandı. Sonra kaynak "09:00–22:00" yapıldı; ev sahibi yeniden A ve B'ye
  kopyalar → A'da ve B'de İKİ kalem: "09–20" ve "09–22". Misafir "havuz kaçta kapanıyor?" diye sorarsa yapay zekâ iki çelişkili bilgi görür.
  (Aynı işlem içinde kaynak değişirse kopyalama 409 ile durur — o kısım tamam; soru YENİ kopyalama işlemi için.)
- **Büyük şirketler:** paylaşılan içerikte (ör. Notion'un eşitlenmiş blokları) kopya kaynağa bağlı kalır ve güncellenir; ayrı bir ikinci
  kopya açılmaz.
- **Önerim:** dairede bu kaynaktan gelmiş bir kopya varsa yeni kalem AÇMA, o kopyayı güncelle. AMA o dairede kopya sonradan elle
  değiştirildiyse DOKUNMA ve söyle.
- **ÖRNEK (sonra):** yeniden kopyalama → A ve B'de tek kalem "09–22". B'deki kopyayı ev sahibi önceden "09–21 (cumartesi 23)" diye
  düzenlemişse B'ye dokunulmaz, ekranda: "1 dairede güncellendi, 1 dairede elle değiştirildiği için dokunulmadı."
- **Böyle yapalım mı?** (Seçenek: bugünkü gibi ikinci kalem · önerim · hiç kopyalama, yalnız "zaten var" de.)

### D3 · Söz tekilleştirmesinin kapsamı
- **Bugün:** aynı konuşma + aynı tür + aynı saat + açık söz = AYNI söz (çift tık / kopan bağlantıda ikinci söz ve görev açılmasın diye).
  Türler kaba (Havlu / çarşaf · Eksik eşya · Temizlik · Arıza / bakım) ve sözde serbest metin YOK.
- **ÖRNEK (bugün):** ev sahibi misafire iki ayrı şey söz verir: "klima teknisyeni 18:00" ve "musluk tamiri 18:00". İkisini de "Arıza /
  bakım, 18:00" diye kaydeder → TEK söz + TEK görev; ikinci söz kaybolur.
- Farklı konaklama: Airbnb / Booking'de konuşma rezervasyona bağlı, ayrı konaklama ayrı konuşma → birleşmez. Anahtar MUTLAK an (gün +
  saat) olduğu için aynı yazışmadaki iki konaklama ancak aynı gün + saatte birleşir (pratikte çok seyrek).
- Talep ≠ söz: söz yalnız ev sahibinin girdiği kayıttır; misafirin "18:00'de havlu getirir misiniz?" talebi söz açmaz. Öneri listesi
  (anahtarı KAPALI) "Söz kaydet" önerisini EV SAHİBİNİN mesajındaki sözden çıkarır ve iki durumda gizler: aynı tür + aynı saatte açık söz
  varsa, ya da o mesajdan SONRA aynı türde herhangi bir söz kaydedildiyse. Yani ev sahibi aynı saate ikinci, farklı bir şey söz verirse
  öneri görünmez.
- **Büyük şirketler:** tekilleştirme anlamla değil İŞLEM kimliğiyle yapılır (aynı tıklamanın tekrarı = aynı kayıt; yeni tıklama = yeni kayıt).
- **Seçenekler:** (1) bugünkü · (2) kısa pencere: aynı kişi aynı tür + saati **60 saniye içinde** ikinci kez girerse aynı söz (çift tık /
  kopan bağlantı), sonrası YENİ söz — migration yok · (3) istek kimliği — en doğrusu, migration 68 ister.
- **Önerim:** şimdi (2); migration 68 açılınca (3). Öneri listesindeki gizleme anahtar açılırken ayrıca konuşulur.
- **ÖRNEK (sonra, 2):** "klima 18:00" kaydedilir; 5 dakika sonra "musluk 18:00" → İKİ söz + iki görev. Kaydet'e iki kez hızlı basılırsa →
  tek söz.
- **Böyle yapalım mı?**

### D4 · Arıza görev tespiti ("Kapının kilidi bozuldu", "Su akmıyor")
Bugünkü kural yalnız belirli sözcükleri ("bozuk", "çalışmıyor", "su yok"…) ya da klima / buzdolabı gibi olanak listesini tanıyor. Şikâyet
sınıflandırıcısı bu mesajları ŞİKÂYET + CİHAZ olarak zaten tanıyor (ölçüldü), ama görev kuralı ona bakmıyor. **Önerim:** "şikâyet + cihaz
envanterinden bir cihaz" = bakım görevi (cihaz envanteri ve olumsuzluk kuralları sınıflandırıcıyla ORTAK, yeni sözcük listesi yok).

| Misafir mesajı | Bugün | Önerimle |
|---|---|---|
| Kapının kilidi bozuldu | görev yok | Bakım, 24 sa, konu "kapı" (öncelik sorusu ↓) |
| Kapı kilitlenmiyor | görev yok | Bakım, 24 sa, "kapı" |
| Su akmıyor · Banyoda su akmıyor | görev yok | Bakım, 24 sa, "su" |
| Duştan su akmıyor | görev yok | Bakım, 24 sa, "duş" |
| Musluktan su gelmiyor | görev yok | Bakım, 24 sa, "musluk" |
| Sifon bozuldu | görev yok | Bakım, 24 sa, "sifon" |
| Kapının kilidi bozuldu, içeri giremiyoruz | ACİL, 2 sa (güvenlik) | aynı |
| Klima bozuldu | Bakım, 24 sa | aynı |
| Kilit bozulmadı, sadece sıkı · Moralim bozuldu · Hava bozuldu | görev yok | görev yok |
| Su akmıyor mu acaba, gelmeden sormak istedim | görev yok | ⚠️ görev AÇILIR (soru, şikâyet sanılıyor — bilinen zayıf nokta; isterseniz soru eki olan mesajı hariç tutarım) |

- **Tekrar davranışı (bugünkü kural, değişmez):** aynı gün aynı cihaz için ikinci mesaj → aynı görev; farklı cihaz (klima / musluk) → ayrı
  görev; ertesi gün aynı cihaz → yeni görev; aynı mesaj yeniden işlenirse → tek görev.
- **Değişmeyenler:** ev sahibinin "mesajdan otomatik görev" ayarı KAPALIYSA (varsayılan kapalı) hiçbir görev açılmaz. Misafire hiçbir yeni
  metin / söz ("teknisyen geliyor" vb.) gitmez — görev iç kayıttır.
- **Öncelik sorusu:** kilit bozuk / kapı kilitlenmiyor normal (24 sa) mı, güvenlik gereği ACİL (2 sa) mı? Önerim: kilit = acil, su = normal.
- **Böyle yapalım mı?**

### D5 · Eski sürümden kalan artık görevler (iptal edilmiş konaklamada açık temizlik / giriş hazırlığı)
- **Neden olabilir:** eski kodda iptal temizliği kilitsizdi (iptalden önce başlamış görev açma, görevleri iptalden SONRA yazabiliyordu) ve
  temizlik düşerse hata yutuluyordu. Yeni kod ikisini de kapatıyor.
- **Yeni kod kendiliğinden onarır:** iCal'de hâlâ "iptal" görünen satır her senkronda · Hospitable penceresindeki iptal edilmiş rezervasyon her
  senkronda (⚠️ kurucu org'da Hospitable aboneliği 402 → senkron yok → orada ÇALIŞMAZ) · dosyası yeniden yüklenen satır. **Onarmaz:**
  feed'den kaybolmuş iCal satırı · Hospitable penceresi dışı · dosyası bir daha yüklenmeyen satır · PATCH ile iptal edilmiş ya da elle
  girilmiş rezervasyon.
- **Ölçüm hazır:** `scripts/diagnose-cancelled-leftover-tasks.ts` (salt-okuma, yalnız sayı: kaç rezervasyon / görev, kaç işletme ve işletme
  başına dağılım (kimliksiz), atanmış mı, bir kişinin güncellemesi var mı (sistem notları sayılmaz), depo fotoğrafı / dış bağlantı, kaynak,
  konaklama geçmiş mi). Railway açılınca bir kez koşulur; koşamazsa çıkış kodu 1.
- **ÖRNEK:** 12 Ekim'de iptal edilen konaklamanın temizlik görevi panoda hâlâ "yapılacak" → temizlikçi boşuna gidebilir.
- **Seçenekler:** (1) bir kerelik temizlik: önce kuru koşu (sayı), sonra sizin onayınızla gerçek koşu; aynı kilitli fonksiyon, yalnız
  sistemin açtığı bitmemiş görevler; ev sahibinin kendi görevi, mesajdan açılan görev ve bitmiş iş KORUNUR · (2) "Eksik görevleri oluştur"
  düğmesi bunları da temizlesin (ekranda görev kaybolur) · (3) dokunma.
- **Önerim:** önce sayım; sayı > 0 ise (1). Bir kişinin güncellemesi / fotoğrafı olan görevler ayrı sayılır, onlar için ayrıca sorarım.
- **Böyle yapalım mı?**

### D6 · Rezervasyon düzenleme rotası (PATCH) durumu serbestçe değiştirebiliyor (Haiku 10-15 bulgusu)
- **Bugün:** `PATCH /api/reservations/[id]` `status` alanını kabul ediyor. Arayüz bu rotayı KULLANMIYOR; yalnız doğrudan API ile (yönetici
  oturumu) çağrılabiliyor. İptal yönünü bu turda düzelttim (iptal sonrası görev temizliği artık aynı kilitle çalışıyor, testli). Ters yön
  açık: iptal edilmiş rezervasyon bu rotadan "onaylı" yapılırsa **"Yeniden aç" düğmesinin kuralları atlanıyor** — konaklaması bitmiş mi,
  kanal etkin gösteriyor mu kontrolü yok, denetim kaydı (audit) yok, görevler açılmıyor.
- **ÖRNEK:** bir yönetici tarayıcı araçlarıyla geçen ayın iptal edilmiş rezervasyonuna `{"status":"confirmed"}` gönderir → rezervasyon
  "onaylı" olur, takvimde dolu görünür, kayıt düşmez. Düğmeyle aynı istek "Konaklaması bitmiş rezervasyon yeniden açılamaz." derdi.
- **Önemli yan etki (Opus 10-15):** "Yeniden aç" düğmesi yalnız sağlayıcı senkronunun "kanal etkin gösteriyor" işaretiyle çalışır. Dosyayla
  ya da takvim bağlantısıyla YANLIŞLIKLA iptal edilmiş bir satırı bugün geri açmanın tek yolu bu PATCH (takvim satırı feed'de canlı
  görünürse senkron kendisi açar; dosya satırı için başka yol yok).
- **Önerim:** PATCH'te açma yönü "Yeniden aç" ile AYNI kurallardan geçsin (konaklama bitmemiş olmalı, denetim kaydı yazılır, görevler açılır)
  ama kanal işareti yalnız sağlayıcı satırında aransın (dosya / takvim / elle satırında aranmasın). Arayüzde görünen hiçbir şey değişmez.
- **Seçenekler:** önerim · PATCH `status` hiç kabul etmesin (dosya satırı yanlış iptalde geri açılamaz) · bugünkü gibi kalsın.
- **Böyle yapalım mı?**

### D7 · İptal → yeniden açma sonrası çıkış temizliği açılmıyor (Opus 10-15 O3; önceden var)
- **Bugün:** görev açma "bu türden görev var mı?" sorusunu rezervasyonun BÜTÜN görevlerine bakarak cevaplıyor (ev sahibinin kendi görevi,
  söz görevi, mesajdan açılan görev dahil). İptalde yalnız SİSTEMİN açtığı görevler silinir (doğru — ev sahibinin görevi korunur).
- **ÖRNEK (bugün):** onaylı rezervasyonda sistemin temizlik görevi + ev sahibinin misafire verdiği "Temizlik, yarın 18:00" sözünün görevi var.
  Rezervasyon iptal olur → sistem temizliği silinir, söz görevi kalır. Kanal rezervasyonu yeniden etkin gösterir, ev sahibi "Yeniden aç"a
  basar → "temizlik görevi var" (söz görevi) sayılır → ÇIKIŞ TEMİZLİĞİ hiç açılmaz; "Eksik görevleri oluştur" da bu rezervasyonu eksik
  saymaz. Temizlikçi çıkış gününe atanmaz.
- **Önerim:** "var mı?" kontrolü yalnız SİSTEMİN açtığı görevlere baksın (bitmişler dahil — iki kez açılmasın); eksik görev bandı da aynı
  kurala uysun.
- **ÖRNEK (sonra):** aynı olay → yeniden açınca çıkış temizliği açılır, söz görevi aynen durur. Sistemin temizlik görevi "bitti" ise ikincisi
  açılmaz.
- **Böyle yapalım mı?**

## E. Kurucu kararları 10-15 akşam (D1–D7 cevapları, AYNEN)

- **D1:** "Form başına kimliği seçiyorum. Ağ hatası veya 409 sonrası kimlik kendiliğinden değişmesin. Başarı kesinleşince yeni ekleme için yeni
  kimlik üret. Uyuşmazlıkta yazdığım metni koru; mümkünse kaydedilmiş kalemi gösterip onu düzenleme seçeneği sun. Sıradan "Ekle"ye tekrar
  basmak ikinci kayıt oluşturma onayı sayılmasın."
- **D2:** "Eski kopyayı güncelle seçeneğini onaylıyorum. Yalnız seçtiğim hedeflerde, bu kaynaktan geldiği doğrulanmış ve son kopyalamadan beri
  yerelde değiştirilmemiş kalem güncellensin. Yerel değişiklik varsa üzerine yazma; hangi dairede neden atlandığını göster. Eşzamanlı
  düzenlemeyi de koru. Kaynak bağı bilinmeyen eski kayıtları benzerliğe göre eşleştirme; migration gerekiyorsa uygulamadan önce bildir."
- **D3:** "“İstek kimliği şimdi” seçeneğini tercih ediyorum. Her yeni söz ayrı işlem kimliği alsın; çift tık ve bağlantı sonrası yeniden deneme
  aynı kimliği korusun. Aynı kimlikle farklı içerik gelirse sessizce birleştirme, açık uyuşmazlık döndür. Kontrol sunucuda ve veritabanında
  eşzamanlı isteklere dayanıklı olsun; görev oluşturma da tekrar güvenli olsun. Klima ve musluk aynı saatte iki ayrı söz/görev oluşturmalı;
  aynı sözün tekrarı oluşturmamalı."
- **D4:** "Görev tespitini genişletelim; fakat önceliği yalnız cihaz adına veya soru işaretine göre belirlemeyelim. Gerçek arıza bildirimi ile
  varsayım, olumsuzlama ve genel soruyu ayır. Görev başlığında “misafir bildirimi” olduğunu koru; doğrulanmış arıza gibi yazma. Kilitlenemeyen
  kapı, içeride mahsur kalma, tamamen susuzluk ve tek tuvaletin kullanılamaması için ayrı öncelik örnekleri sun; 2/24 saat hedeflerini henüz
  kesinleştirme. Otomatik görev kapalıysa görev açılmasın; misafire müdahale veya teknisyen sözü verilmesin."
- **D5:** "Önce salt-okuma sayım yapılsın; bu aşamada hiçbir kayıt değiştirilmesin. Sonuç sıfır değilse kapsamı bana göster, ayrıca onayımı
  bekle. Yalnız iptal edilmiş konaklamaya bağlı, sistemin oluşturduğu, başlanmamış temizlik/giriş hazırlığı görevleri aday olsun. Manuel
  görevleri, mesajdan açılanları, tamamlanmış veya personelin işlem yaptığı görevleri koru. “Eksik görevleri oluştur” düğmesine silme
  davranışı ekleme. Temizlikte kalıcı silme yerine geçmişi koruyan iptal/arşivleme mümkün mü, önce bunu açıkla."
- **D6:** "İlk seçenek. API ve panel aynı yeniden açma kurallarını kullansın; yetki kontrolü, işlem kaydı ve otomatik görev ayarı korunsun.
  Sağlayıcıya ait olmayan rezervasyonda sağlayıcı işareti aranmasın. Tekrarlanan istek ikinci görev oluşturmasın."
- **D7:** "İlk seçenek. Ara temizlik sözü veya manuel temizlik, otomatik çıkış temizliğini engellemesin; mevcut söz görevi korunsun. Ancak
  tamamlanmış sistem görevi yalnız aynı rezervasyonun aynı çıkış temizliğiyse tekrar oluşturmayı engellesin. Çıkış tarihi sonradan
  değişmişse eski tamamlanmış işi otomatik olarak yeni tarihin temizliği sayma; bu durumun önerilen davranışını ayrıca göster."

## F. Kararlara göre durum ve açıklamalar (10-15 akşam)

### D5 açıklaması — kalıcı silme yerine iptal / arşiv mümkün mü?
- **Bugün:** iptal temizliği görevi KALICI siler; görevin güncellemeleri (not, durum geçmişi) de silinir, depodaki fotoğraflar silme kuyruğuna
  girer. Geriye iz kalmaz.
- **Seçenek A — görev durumuna "iptal edildi" eklemek (migration GEREKMEZ; durum metin sütunu):** görev, notları ve fotoğrafları KALIR;
  panoda, temizlikçi listesinde ve sayılarda görünmez. Bedel: görev durumunu okuyan ~11 sorgu ve ekranın (Kanban sütunları, temizlikçi
  görünümü, rapor sayıları, eksik görev bandı, tarih takibi, dışa aktarma, görev açmanın "var mı?" kontrolü) yeni durumu bilmesi gerekir;
  bilmeyen yer iptal görevi "yapılacak" gösterir ya da "temizlik var" sayıp yenisini engeller (D7 ile bağlantılı). Rezervasyon yeniden
  açılırsa iptal görev geri mi açılır, yenisi mi açılır — kural gerekir (önerim: yenisi açılır, eskisi iptal kalır).
- **Seçenek B — ayrı "arşivlendi" sütunu:** A ile aynı tarama bedeli + migration.
- **Kişisel veri:** görev başlığı misafir adı taşıyor; arşivlenen görev de saklama süresi temizliğinin kapsamında kalır (bugünkü temizlik
  görev başlığını zaten kapsıyor — `data-retention.ts`).
- **Önerim:** A. Bir kerelik onarım ve iptal temizliği "sil" yerine "iptal edildi" yapar; önce durumu okuyan bütün yerlerin envanteri ve
  testleri. Kararını bekliyorum; şimdilik HİÇBİR artık görev değiştirilmiyor.
- **Bu turda yapılan (kararına uygun):** otomatik ONARIM yolları (takvim senkronunun onarım taraması, "zaten iptal" satırı, dosyanın yeniden
  yüklenmesi) artık yalnız senin aday tanımındaki görevleri temizliyor: sistemin açtığı, BAŞLANMAMIŞ, kimsenin güncellemediği / fotoğraf
  eklemediği giriş hazırlığı / temizlik. Başlanmış ya da kişi izi olan görev korunur. İptal ANINDAKİ temizlik bugünkü gibi (ürün davranışı;
  değiştirmek ayrı karar). Teşhis betiği aday / korunacak ayrımını sayar; hiçbir şey değiştirmez. "Eksik görevleri oluştur" düğmesine
  dokunulmadı.
- **Not:** canlıda takvim bağlantısı 0 (09-19 yedeği) → onarım taraması bugün hiçbir eski satıra uğramaz. Hospitable senkronunun her turda
  iptal temizliği çağırması ÖNCEDEN vardı (kurucu org'da 402 → koşmuyor).

### D4 öncelik örnekleri (2 / 24 saat hedefleri KESİNLEŞTİRİLMEDİ — senin seçimin)
| Durum | Örnek misafir mesajı | Neden ayrı | Önerdiğim sınıf |
|---|---|---|---|
| Kilitlenemeyen kapı | "Kapı kilitlenmiyor, gece açık kalacak" | güvenlik; misafir içeride ama kapı açık | yüksek |
| İçeride mahsur kalma | "Kapının kilidi bozuldu, çıkamıyoruz" | kişi güvenliği | en yüksek — ⚠️ **ÖLÇÜLDÜ (10-15 gece): bugünkü acil yolu bunu ACİL SAYMIYOR** (yalnız "içeri giremiyoruz" — dışarıda kalma — acil). Şikâyet olarak ev sahibine düşüyor; D4 ile normal bakım görevi açılır. Acil sayılsın mı → soru ↓ §G |
| Tamamen susuzluk | "Hiç su yok, ne musluktan ne duştan" | konaklama kullanılamaz | yüksek |
| Tek tuvaletin kullanılamaması | "Tuvalet tıkalı, başka tuvalet yok" | konaklama kullanılamaz | yüksek |
| Tek cihaz arızası | "Musluktan su gelmiyor" (duş çalışıyor) | konfor | normal |
| Varsayım / soru / olumsuzlama | "Su akmıyor mu acaba?", "Kilit bozulmadı" | arıza bildirimi DEĞİL | görev yok |
- Görev başlığı "misafir bildirimi" olduğunu söyleyecek (ör. "Bakım — misafir bildirimi: kapı"); doğrulanmış arıza gibi yazılmayacak.
- Otomatik görev ayarı kapalıysa görev yok; misafire hiçbir müdahale / teknisyen sözü gitmez (değişmez).
- **Sıra:** önce bu tablo üzerinde senin "yüksek / en yüksek" için saat seçimin; tespit genişletmesi (gerçek bildirim ↔ varsayım / olumsuzlama /
  soru ayrımıyla) ayrı dilim, örnek mesaj setiyle ölçülerek.

### Uygulama sırası (kararlarına göre)
1. D7 (görev "var mı?" yalnız sistem görevi; bitmiş görev yalnız aynı tarihteyse engeller) — migration yok.
2. D6 (PATCH ile açma "Yeniden aç" kurallarından; sağlayıcı işareti yalnız sağlayıcı satırında; tekrar ikinci görev açmaz) — migration yok.
3. D1 (form başına kimlik; uyuşmazlıkta metin korunur, kaydedilmiş kalem gösterilip düzenleme seçeneği) — migration yok.
4. D2 + D3 → **migration 68 gerekiyor** (kopyanın kaynak bağı + kopyalandığı andaki içerik izi; sözün istek kimliği + tekil dizin). Uygulamadan
   ÖNCE şemayı ve geri alma planını sana göstereceğim (senin şartın).
5. D4 → yukarıdaki saat seçiminden sonra.
6. D5 → arşiv seçimini bekliyor; sayım Railway açılınca.

## G. D1–D7 uygulama durumu (10-15 gece)

| Karar | Durum | Ne yapıldı (müşteriye görünen) | Kanıt |
|---|---|---|---|
| D1 | ✅ kodda (push bekliyor) | Kimlik form başına; ağ hatası / 409 sonrası değişmez, başarıda yenilenir. 409'da yazdığınız metin kalır, kaydedilmiş kalem gösterilir: **"Kaydedilen bilgiyi düzenle"** (düzenleyici güncel listeden açılır; kalem bu arada silindiyse "Kaydedilen bilgi listede bulunamadı. Sayfayı yenileyip tekrar deneyin.") ve **"Ayrı bir bilgi olarak ekle"** (bilinçli ikinci kayıt; sıradan "Ekle" yine 409) | `kb-create-request-id-screens.test.tsx` |
| D2 | ⏳ kod hazır, **migration 68 onayını bekliyor** (aşağıda) | Kaynaktan gelmiş + yerelde değişmemiş kopya güncellenir; yerelde değişmişse dokunulmaz ve daire adıyla "elle değiştirildiği için atlandı" yazılır; kaynak bağı bilinmeyen eski kopyalar eşleştirilmez | `kb-copy-update-d2.test.ts` |
| D3 | ⏳ kod hazır, **migration 68 onayını bekliyor** | Her söz kendi işlem kimliği; çift tık / yeniden deneme aynı kimlik; aynı kimlik + farklı içerik → "Bu söz az önce farklı bilgilerle kaydedildi. Sayfayı yenileyip kontrol edin."; klima 18:00 + musluk 18:00 = iki söz / iki görev | `guest-commitments.test.ts`, `idempotency-acceptance.test.ts` |
| D4 | ✅ kodda (push bekliyor) | ↓ ayrıntı | `task-detect.test.ts` (D4 bölümü) |
| D5 | ⏳ sayım aracı hazır (salt-okuma); Railway kapalı → koşulamadı | Hiçbir kayıt değiştirilmedi. Arşiv seçimi ↑ §F (önerim A) | `scripts/diagnose-cancelled-leftover-tasks.ts` |
| D6 | ✅ kodda (push bekliyor) | PATCH ve düğme aynı kural (`lib/reservations/reopen.ts`). "Sağlayıcıya ait" = bağlantı damgalı satır YA DA damga öncesi eski sağlayıcı satırı (kanal etiketli + referanslı); dosya / takvim / elle satırında işaret aranmaz. Şüphede işaret aranır (yanlış açma karşılama mesajı gönderebilir) | `reservation-reactivate-route.test.ts` |
| D7 | ✅ kodda (push bekliyor) | Yalnız sistem görevi "var" sayılır; bitmiş sistem görevi yalnız aynı takvim günündeyse engeller; düğmedeki sayı aynı kural | `lifecycle-presence*.test.ts`, `host-day-rule.test.ts` |

### D4 — ne değişti (önce / sonra)
| Misafir mesajı | Önce | Sonra |
|---|---|---|
| Kapının kilidi bozuldu · Kapı kilitlenmiyor | görev yok | Bakım — misafir bildirimi: kapı (normal, 24 sa) |
| Su akmıyor · Banyonun suyu akmıyor | görev yok | Bakım — misafir bildirimi: su |
| Musluktan su gelmiyor · Sifon bozuldu · Duştan su akmıyor | görev yok | … musluk · sifon · duş |
| Klima bozuldu | Bakım: cihaz/olanak | Bakım — misafir bildirimi: klima |
| Klima çalışmıyor | Bakım: çalışmıyor | Bakım — misafir bildirimi: klima |
| Salon ışığı yanmıyor mu, karanlıkta oturuyoruz (tereddütlü bildirim) | Bakım: yanmıyor | Bakım — misafir bildirimi: ışık |
| Su akmıyor mu acaba, gelmeden sormak istedim | görev yok | görev yok |
| Klima bozuk değil, sadece kumandayı bulamadık | ⚠️ Bakım: bozuk | görev yok |
| Kombi bozuksa ne yapmalıyız? · Klima çalışmıyorsa kimi arayalım? | ⚠️ Bakım | görev yok |
| Is the AC broken? · Klima çalışmıyor mu, biz mi yanlış yapıyoruz? | ⚠️ Bakım | görev yok (soru; konuşma yine ev sahibine düşer) |
| Merdivenlerde sigara kokusu var · I'll sue you | görev yok | görev yok (genel şikâyet + cihaz adı yetmez) |
| Getirdiğimiz kahve makinesi bozuldu | görev yok | görev yok (misafirin kendi eşyası) |
| Kapının kilidi bozuldu, içeri giremiyoruz | ACİL (2 sa) | aynı |
- **Ölçüm (5.122 mesajlık test / eval derlemi, ücretli çağrı yok):** 116 mesaj yeni görev açtı (gerçek arıza bildirimleri), 8 mesajın görevi
  kalktı (7'si soru / varsayım), 173'ünün yalnız konusu değişti (belirti sözcüğü → cihaz adı). Eşya ve temizlik görevleri DEĞİŞMEDİ.
- **Bilinen sınırlar:** "Tatil düşümüz bozuldu" → "duş" (sınıflandırıcının Türkçe harf katlaması; konuşma zaten şikâyet sayılıyordu) ·
  "Saç kurutma makinemiz bozuldu" (misafirin kendi eşyası, "kendi / getirdiğimiz" yoksa ayırt edilemez) · "Duş başlığı kırılmış",
  "Bulaşık makinesi su almıyor", "Kapı kolu elimde kaldı" bugün de görev açmıyor (sınıflandırıcı şikâyet saymıyor; ayrı tur).
- **Değişmeyenler:** otomatik görev ayarı kapalıysa görev açılmaz; misafire hiçbir metin / söz gitmez; konuşmanın şikâyet / devir kararı aynı.

### G'den doğan sorular
- **G-D4a · Öncelik (senin seçimin, 2/24 saat kesinleşmedi):** ↑ "D4 öncelik örnekleri" tablosu. Bugün yalnız acil güvenlik 2 sa, gerisi 24 sa.
- **G-D4b · İçeride mahsur kalma acil sayılsın mı?** "Kapının kilidi bozuldu, çıkamıyoruz" bugün acil DEĞİL (ölçüldü); misafire giden
  cevap kararı (otomatik cevap durur, ev sahibine düşer) aynı; fark acil işaret + 2 sa görev. Önerim: "çıkamıyoruz / içeride kaldık /
  mahsur kaldık / locked in / can't get out" (kapı / kilit bağlamında) acil güvenlik ağına eklensin — önce örnek setiyle ölçerek, misafire
  giden metin değişmeden.
  Böyle yapalım mı?
- **G-D2/D3 · Migration 68 onayı:** iki yeni sütun + bir yeni sütun + dizinler, hepsi BOŞ BIRAKILABİLİR (dolu tabloya zorunlu alan / tekil
  kısıt EKLENMEZ — tekil dizin yalnız yeni sütunda, eski satırlar NULL):
  `KnowledgeBaseItem.copiedFromId` (kaynak kalem), `KnowledgeBaseItem.copiedContentHash` (kopyalandığı andaki içerik izi) + dizin ·
  `GuestCommitment.clientRequestId` + `(conversationId, clientRequestId)` tekil dizini. Geri alma: sütunları okumayan sürüme dönmek yeterli
  (sütunlar boş kalır, eski kod onları görmez); gerekirse `DROP COLUMN` ile tamamen geri. Railway açılmadan önce taze `pg_dump` (kural).
  Onaylıyor musun?

## H. 10-15 gece — inceleme notun ("BOZUKLAR İÇİN BİLGİ TABANINDA YAZMAYAN ÖNERİLER VEREMEZ") + Opus dilim sonu kontrolü

İki anahtar yazıldı, ikisi de **KAPALI** (açmak senin kararın; ilk denemeler birlikte). Kapalıyken bugünkü davranış bayt bayt aynı (testli).

### H1 · `AI_FAULT_GUARD_ENABLED` — arıza her yolda arıza (Sabah Kararları 27 "b" + 30)
- Bugün: arıza kontrolü yalnız anlama modeli "şikâyet" derse çalışıyor. Demediği koşuda (kör set 6) TV arızası sıradan soru gibi cevaplandı,
  sana e-posta gitmedi.
- Anahtar açıkken: cihaz + arıza ifadesi (yedi dil; "görüntü yok / siyah ekran" dahil) AYNI cümlecikte görülünce kod arızayı sana bırakır
  (şikâyet öğesi + tek e-posta); aynı mesajdaki bağımsız soru cevaplanır. Wi-Fi / otopark / anahtar arızası da (liste kipinde de) bilgi
  tabanı şartı olmadan cevaplanmaz. Misafir "düzeldi" deyince kodun açtığı iş kapanır (aynı mesajda başka açık istek yoksa).
- Ölçüm (kayıtlı 1.115 tekil misafir mesajı, ücretli çağrı yok; üretimde anlama katmanının Türkçe sorgusuna bakar, burada mesajın kendisine):
  85 mesaj arıza sayıldı; bilgi / konaklama / enjeksiyon / acil sınıflarında yanlış alarm 0. Bilinen sınır: cihaz sözlükte yoksa (davlumbaz,
  blender) arıza sayılmaz.
- Arıza SAYILMAYANLAR (Opus ölçtü, düzeltildi): "Otoparka rota gönderir misiniz?" · "Telefon çekmiyor, wifi şifresi ne?" · "Bavulumuzun
  tekerleği kırık, asansör var mı?" · "Arabamız bozuldu, otopark var mı?" · "bozuk para" · "Klima arıza yaparsa kimi arayalım?" · "Klima
  çalışmadı ama sonra düzeldi".
- ÖRNEK: "Telvizyonda goruntu yok, sadece siyah ekran var. Copleri nereye atiyoruz?" (TV tarifi yok)
  ÖNCE (bazen): misafire çöp + "Televizyonda görüntü gelmiyorsa kaynak girişinin (HDMI/AV/TV) doğru seçili olduğundan emin olur musunuz?";
  sana e-posta yok. SONRA: misafire yalnız çöp cevabı; sana "⚠️ Acil misafir mesajı"; panelde "şikâyet / sorun · Size bırakıldı".
- **Açalım mı?** (QR'da aynı kural ayrı soru ↓ H3.)

### H2 · `AI_FIX_SUPPORT_GATE_ENABLED` — bilgi tabanında yazmayan arıza adımı GİTMEZ (senin notunun kod kemeri)
- Kural: cevabın bir cümlesi **arıza giderme adımıysa** ("çalışmıyorsa … yeniden açın", "dener misiniz", "emin olur musunuz") o cihazın
  bilgi tabanında **tarifi** olmalı; **kullanım adımıysa** ("MODE tuşuyla soğutmayı seçin") o cihaz bilgi tabanında **konu** olmalı. Yoksa
  cevap gitmez, taslak sende kalır (QR'da sana devredilir). Anlama modelinin etiketinden bağımsız; kanal + QR + Ayarlar testi aynı kural.
- Ölçüm (kayıtlı 3.324 cevap, ücretli çağrı yok): **36 cevap tutulurdu, hepsi şikâyet senaryosunda** (gerçekten gönderilmiş cevaplarda
  yanlış tutuş 0). Dökümü (Opus üçüncü tur düzeltmesi — önceki "hepsi uydurma" özeti YANLIŞTI):
  · ~16'sı uydurma arıza adımı: internet yok → "modemi fişten çekip 30 sn bekleyin"; kilit takılıyor → "anahtarı dikkatlice çevirerek
    kilitlemeyi deneyin"; pil / ekran kontrolü.
  · ~20'si bilgi tabanında YAZILI kullanım / yer bilgisinin arıza bildiren misafire adım olarak verilmesi: "klima çalışmıyor" → "MODE tuşuyla
    soğutmayı (kar tanesi) seçebilirsiniz"; "internet yok" → "Yatak odasındaysanız aynı şifreyle Lale-2G ağına bağlanmayı deneyebilirsiniz",
    "Modemin salondaki TV ünitesinin altında olması gerekiyor". Kural bunları da tutuyor (arıza adımı TARİF ister, kullanım bilgisi tarif
    sayılmıyor) — ↓ "⚠️ Bir sınır" sorusu tam bu.
- Karışık tur ölçümü (Opus): kayıtlı 3.113 meşru cevabın misafir mesajının başına "Televizyonda görüntü yok." eklenince — yani misafir arıza +
  başka bir soru sorduğunda — ilk sürüm meşru cevapların %10'unu tutuyordu (Wi-Fi şifresi, çöp, giriş saati…); düzeltildi, şimdi 47 / 3.113
  (%1,5) ve kalanların hepsi acil / şikâyet / sır isteği / enjeksiyon senaryosu (oralarda cevap zaten başka kapıda tutulur).
- Misafir bir cihazın ARIZASINI bildirdiyse o cihaza yöneltilen her adım tarif ister — cihaz bilgi tabanında yalnız KONU olsa bile (ör. "TV:
  kumanda çekmecede, Netflix yüklü" kalemi varken "Televizyonda görüntü yok" → "SOURCE tuşuna basıp HDMI 1'i seçin" artık GİTMEZ). Aynı
  mesajdaki ARIZASIZ cihazın kullanım cevabı ("TV çalışmıyor; Wi-Fi şifresi?" → Wi-Fi şifresi) gider.
- ÖRNEK 1 (bilgi tabanında TV kalemi yok): "Ekranda görüntü yoksa kaynak girişini (HDMI) kontrol edin." → ÖNCE gider · SONRA gitmez.
- ÖRNEK 2 (bilgi tabanında "Televizyon: görüntü gelmezse SOURCE → HDMI 1"): aynı adım → ÖNCE de SONRA da gider.
- ÖRNEK 3 (otopark tarifinde "kumanda çalışmazsa tuş takımına 5523"): "Kumanda çalışmazsa tuş takımına 5523 yazın" → gider (kumanda TV sayılmaz).
- ⚠️ Bir sınır: klima kaleminde yalnız KULLANIM varken ("MODE tuşuyla soğutma, 24 derece"), misafir "klima çalışmıyor" deyince modelin
  "MODE tuşuyla kar tanesini seçip 24 dereceye almayı dener misiniz?" cevabı da **tutulur** (arıza adımı tarif ister — 1 Ekim kararın 18 "a").
  Bilgi bilgi tabanında yazılı ama arıza tarifi olarak değil. Böyle kalsın mı, yoksa kullanım bilgisi arıza cevabında da kullanılabilsin mi?
- Bilinen sınır: aynı cihazın tarifi VARKEN tarifte yazmayan başka bir adım (cihaz düzeyinde okunuyor; misafir başka dilde yazınca sözcük
  karşılaştırması güvenilir değil).
- ⚠️ İkinci sınır (aynı sorunun parçası): misafir "Wifi şifresi çalışmıyor" deyince bilgi tabanındaki şifreyi aynen yineleyen cevap ("Ağ adı
  Lale-5G, şifresi Lale2025! — sondaki ünlem işaretiyle birlikte yazmanız gerekiyor") da tutuluyor (Opus ölçümü: 13 cevapta 4). Bilgi tabanındaki
  KULLANIM bilgisi arıza cevabında kullanılabilsin dersen bu ikisi birlikte gider.
- **Açalım mı?**

### H3 · QR'da "arıza her yolda arıza" (Opus N9)
- Bugün QR öğe akışını kullanmıyor; H2 (kanıtsız adım) QR'a bağlandı, H1'in "arızayı sana bırak + e-posta" kısmı QR'da YOK. QR'da arıza
  bildiren misafir şu an ya cevap alır (tarifliyse) ya da devredilir (kelime ağı / model şikâyet derse). Önerim: H2 QR'da yeterli; H1'in QR
  karşılığını ayrı turda ölçerek. Böyle yapalım mı?

### H4 · Opus dilim sonu kontrolü (12 bulgu) — ne yapıldı
| # | Bulgu | Durum |
|---|---|---|
| N1 | yeni anahtarlar bayrak listelerinde yoktu (tam suit kırmızı olurdu) | ✅ iki listeye eklendi |
| N2 | "görüntülü diyafon" bilgi tabanında TV tarifi sayılıyordu (anahtarsız, GEVŞETİYORDU) | ✅ belirti sözcükleri genel konu çıkarımından çıkarıldı |
| N3 | arıza sinyalinin yanlış alarmları | ✅ (↑ H1 listesi) |
| N4 | devir vetosu "görevlisine yönlendirileceksiniz", "ev sahibinizce iletildi", "host's lockbox" cümlelerini tutuyordu | ✅ (bu gece eklenen kalıp; canlıda yoktu) |
| N5 | "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli" "bilgim yok" sayılıyordu | ✅ (bu gece eklenen kalıp) |
| N6 | D4: misafir eşyası işareti bütün mesaja bakınca gerçek arıza görevi kayboluyordu ("Valizleri getirdik. Klimayı açtık, bozuldu") | ✅ yalnız arızanın cümleciği |
| N7 | "İNTERNET ÇALIŞMIYOR" (büyük harf) görev açmıyordu | ✅ |
| N8 | Geçmişten öğren: "bu ayakkabılıkta" tarih, "tekrar deneyin" deneme sayılıyordu | ✅ |
| N9 | liste kipinde Wi-Fi arızası tarif şartı olmadan cevaplanıyordu | ✅ (anahtar açıkken); QR ↑ H3 |
| N10 | misafir "düzeldi" deyince kodun açtığı iş kapanmıyordu | ✅ |
| N11 | teşhis betiği büyük veride 5 sn'de düşerdi | ✅ |
| N12 | test kalitesi (vakum iddia, ölü alan) | ✅ (bir maddeye gerekçeli itiraz: `$transaction` spy'ı model temsilcisi değil, aynı dosyada önceden üç test aynı kalıpla yeşil) |

### H5 · D4 görev tespiti — Opus düzeltmesinden sonra (önce / sonra)
| Misafir mesajı | Bu gece ilk sürüm | Şimdi |
|---|---|---|
| Valizleri getirdik. Klimayı açtık, bozuldu. | görev yok | Bakım — misafir bildirimi |
| Televizyon kendi kendine kapanıyor, bozuk. | görev yok | Bakım — misafir bildirimi |
| We brought our own towels. The AC is broken. | Temizlik görevi (yanlış) | Bakım |
| İNTERNET ÇALIŞMIYOR | görev yok | Bakım — misafir bildirimi |
| KLİMA ÇALIŞMIYOR | Bakım: cihaz/olanak | Bakım — misafir bildirimi: klima |
| Getirdiğimiz kahve makinesi bozuldu. | görev yok | görev yok (aynı) |

### H6 · İnceleme sayfasındaki 9 yorumun (10-15) neden analizi
Hepsi kör set 6'dan (Luna, kabul seti — o setin bilgi tabanını açmam yasak, bu yüzden sayfada göremiyorsun). "Misafire gitti" = ölçümde
"otomatik gönderilirdi"; hiçbiri gerçek misafire gitmedi.
| Senaryo | Senin notun | Ne oldu | Bu gece yazılan kural ne yapardı |
|---|---|---|---|
| k6-03 TV + çöp | TV görmezden gelinmiş gibi olmasın | TV sana kalmalıydı; bildirim yoktu | H1 açıkken: sana tek e-posta + panelde iş; misafire yalnız çöp |
| k6-13 TV "Sinyal yok" + koy | "Rica ederiz, iyi tatiller dileriz" kim yazıyor? · fazla yönlendirme | ⚠️ "Wifi'ye bağlandık… / Rica ederiz…" satırları senaryonun ÖNCEDEN YAZILMIŞ GEÇMİŞİ (test girdisi), yapay zekâmızın cevabı değil. Cevap: SOURCE → HDMI 2 + uydu alıcısı POWER (2 adım) + koy bilgisi | Bilgi tabanında TV tarifi yoksa H2 tutar; varsa bugünkü kural (1 Ekim 18 "a") gönderir |
| k6-14 bulaşık + cam şişe | iyi gibi | Kapak + ON/OFF + P3 + START (bir adım dizisi) + geri dönüşüm | — |
| k6-19 otopark kumandası | iyi gibi, fazla yönlendirme yok | "Pili bitmiş olabilir; arka kapağı açıp yedek CR2032 pili takabilirsiniz" | — |
| k6-24 klima kumandası | "Adama pilleri değiştirin mi yazacak?" | "Ekran boşsa pillerini değiştirin; yedek AAA piller TV ünitesinin üst çekmecesinde" | — |
| k6-25 bulaşık E24 | çok yönlendirme | Sepet → filtreyi çevirip çıkar → yıka → tak → programı başlat (4–5 adım) | — |
| k6-18 internet / kırmızı ışık | WAN ışığı demedi ki · çok yönlendirme | Modemi kapat-aç → 5 dk sonra hâlâ kırmızıysa fiber kutusu → modem yeniden (3 adım, misafirin söylemediği "WAN" varsayımı) | — |
| k6-39 Wi-Fi + market saati | "24.00'e kadar açık" rezillik | Cevap "her gün 24:00'e kadar açık" | — (aşağıda soru) |
| k6-14/19 iyi · k6-24/25/18 kötü | | | ⚠️ ikisi de pil / tuş adımı — kural netleşmeli ↓ |

**Sorular:**
- **H6a · Hangi arıza adımı misafire gitsin?** k6-19'da pil değiştirmeyi "iyi" dedin, k6-24'te "adama pilleri değiştirin mi yazacak" dedin. Fark
  bence adım sayısı / zorluk değil, cihaz olabilir (otopark kumandası vs klima kumandası) — emin değilim. Seçenekler: (a) bugünkü: bilgi
  tabanında tarif varsa gider · (b) en çok TEK basit adım (tuşa bas / kaynağı seç) gider, birden çok adım ya da kapak açma / filtre
  söküm / ikinci cihaz sana kalır · (c) bilgi tabanı kalemine "misafir kendisi yapabilir" işareti, yalnız işaretliler gider (yeni alan =
  migration) · (d) hiçbir arıza adımı otomatik gitmez, hepsi senin hazır taslağın olur. Önerim (b) + (c) birlikte; ölçüm setiyle (`evals/fault-mixed-dev.json`, ücretli koşu senin onayınla) önce/sonra gösteririm. Hangisi?
  Sektör araştırması (Opus, 10-15 gece; siteler açılamadı, arama özetlerinden — kısmen doğrulandı): misafiri adım adım yönlendiren iki
  ürün (Host & Guest Fix+, Akia) adımları EV SAHİBİNE / personele yazdırıyor; Hostaway arızayı (ör. "sıcak su yok") tırmandırma örneği veriyor;
  Hospitable bağlam zayıfsa cevap vermiyor; Airbnb arızalı cihazı ev sahibinin sorumluluğu sayıyor; Gartner: sorunların yalnız %14'ü
  tamamen self-serviste çözülüyor. k6-19 ile k6-24 ikisi de TEK pil değişimi — adım sayısına bakan hiçbir kural ikisini ayıramıyor; farkı
  yalnız sen bilirsin (tahmin: otoparkta misafir dışarıda kalıyor + yedek pil anahtarlıkta). Bu yüzden önerim (c) "senin işaretlediğin tek
  eylemlik tarif", işaret yoksa (d) gibi davransın. Ayrıntı: scratchpad notu, rapora özet.
- **H6b · "24:00" yazımı:** bilgi tabanında "07:00–24:00" yazıyorsa model "24:00'e kadar" diyor. Önerim: misafire giden metinde kod "24:00"ı
  "gece yarısına (00:00) kadar" yapsın (yalnız biçim; değer değişmez). ÖRNEK: ÖNCE "her gün 24:00'e kadar açık" · SONRA "her gün gece
  yarısına (00:00) kadar açık". Böyle yapalım mı? (Ya da bilgi tabanında bunu sen düzeltirsin — o zaman kod dokunmaz.)
- **H6c · Kabul setlerinin bilgi tabanını sayfada görmek:** o dosyaları açmam yasak (kör ölçüm bozulmasın diye senin kuralın). Sayfada
  göstermem için ya (1) yalnız BİLGİ TABANI bölümünü okumama izin verirsin (beklenen cevaplar / puanlar kapalı kalır) ya da (2) kör setleri
  sayfadan çıkarıp yalnız dev setlerini bırakırım. Hangisi?

### H8 · Opus ikinci dilim sonu kontrolü (10-16 gece, 11 bulgu) — ne yapıldı
| # | Bulgu | Durum |
|---|---|---|
| M1 | Arıza bildirilen cihaz bilgi tabanında yalnız KONU iken (TV kullanım kalemi, Wi-Fi şifresi) uydurma arıza adımı geçiyordu — senin TV vakanın ikizi | ✅ arızalı cihaza adım tarif ister (↑ H2) |
| M2 | 5.1'in kibar biçimleri adım sayılmıyordu: "Klimayı kapatıp **açabilirsiniz**" geçiyor, "tekrar açabilirsiniz" tutuluyordu; Almanca / Arapça "kapatıp açın" geçiyordu | ✅ 28 ölçülen biçimin hepsi tutuluyor |
| M3 | Wi-Fi bilgi tabanında konu olduğu için aynı cevaptaki KB'de olmayan klima kullanım adımı geçiyordu | ✅ kullanım adımı kendi cihazına bakar |
| M4 | Arıza okuması: "Klima hâlâ çalışmıyor, internet ise düzeldi" arıza sayılmıyordu; "Düzeldi mi?" düzelme sayılıyordu; "KLİMA ÇALIŞMIYOR AMA WİFİ DÜZELDİ" | ✅ düzelme yalnız kendi cihazını kapatır |
| M5 | (anahtarsız) Misafirin kendi eşyası ("Getirdiğimiz şarj aleti çalışmıyor") bakım görevi açıyordu — bu gecenin N6 düzeltmesinin gerilemesi | ✅ |
| M6 | (anahtarsız) TV belirti okuması istek tarafında GEVŞETİYORDU ("Diyafonda görüntü yok" TV tarifiyle cevaplanabilir) | ✅ yalnız şikâyet tarafında (sıkılaştırır) |
| M7 | "Klima arıza durumunda kimi arayalım?" / "arızası giderildi" arıza sayılıyordu | ✅ |
| M8 | "Salon" başlıklı kalemdeki TV kullanım adımı tutuluyordu (başlık spor salonuna iniyordu) | ✅ başlık yalnız YER ise metnin cihazları da konu |
| M9 | Geçmişten öğren örneğinde ad maskesi kalabalık mülkte eksik kalabiliyordu (yalnız aynı işletmeye görünür); nottan doğan taslakta "Örnek cevabınız" etiketi yanıltıcıydı | ✅ ad konuşma başına; etiket "Karşılaştırılan eski cevabınız" |
| M10 | "bilgim yok" istisnası geniş — **soru ↓ H9** | ❓ |
| M11 | küçükler (kodun şikâyeti kelime ağının şikâyetiyle birleşince "düzeldi" ikisini de kapatıyordu · "المكيف" klima sayılmıyordu · "Sahildeki kafede Türk kahvesini mutlaka deneyin" kahve makinesi adımı sayılıp tutuluyordu) | ✅ |
Arıza okuması ölçümü (kayıtlı 1.115 mesaj): aynı 85 mesaj, bilgi sınıflarında yanlış alarm 0. Bilinen sınırlar: "Otopark kapısı arabamız
içerideyken açılmıyor" (araba misafir eşyası sayılıyor) · "Bizim televizyonumuz bozuk, burada Netflix var mı?" (arıza sayılır — temkinli yön).
Bilinen sınır (anahtarsız, önceden var, DEĞİŞTİRİLMEDİ): "Salon" kalemindeki TV ARIZA tarifi bugün de TV tarifi sayılmıyor — düzeltmek
tarifsiz sayılan bazı arızaları cevaplanabilir yapar (misafire giden değişir) → senin onayın olmadan dokunmadım.

### H9 · "Bilgim yok" kalıbının "özel / ayrı / başka bir talimatım yok" istisnası (Opus M10)
- Bu gece N5 düzeltmesiyle "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli" artık "bilgim yok" sayılmıyor (doğru).
  Ama aynı istisna şunları da geçiriyor: "Televizyonla ilgili ayrı bir talimatım bulunmuyor, ev sahibinize ileteceğim." · "Bu konuda başka
  bir talimatım yok." (İngilizce "no other steps … in my notes" de geçiyor, "I don't have any other instructions" tutuluyor — dil tutarsızlığı.)
  Canlıda bu kalıp hiç yoktu (gerileme değil; kural kapalı anahtar değil, kalıp bu gece eklendi).
- Önerim: istisna yalnız AYNI cümlede olumlu yönerge varken ("…, anahtarı masaya bırakmanız yeterli") geçsin; yönergesiz "başka / ayrı bir
  talimatım yok" yine "bilgim yok" sayılıp misafire gitmesin.
  ÖRNEK: "Bu konuda başka bir talimatım yok." → ÖNCE (bu gece) gider · SONRA gitmez, sana kalır. "Çıkış için özel talimatımız yok, anahtarı
  masaya bırakmanız yeterli." → ÖNCE de SONRA da gider. **Böyle yapalım mı?**

### H10 · Kalıcı kuyruk (görseldeki "transactional outbox") — üç karar (10-16; ayrıntı `docs/TASARIM-2026-10-16-transactional-outbox.md`)
Kısa cevap: sistem bizde VAR — kimlik e-postaları (kayıt doğrulama, şifre sıfırlama) iş verisiyle aynı işlemde kuyruğa yazılıyor ve 15 saniyede
bir gönderiliyor (canlı); misafir mesajı kuyruğu hazır ama kapalı; olaylar (rezervasyon / mesaj) aynı işlemde yazılıyor. Bu gece eklenen: operatör
panelinde "Kuyruk sağlığı" (kaç satır bekliyor, en eski ne kadar bekliyor) + şifre sıfırlama kuyruğu kapalıysa açılışta uyarı.
- **O1 · Misafir mesajı kuyruğunu açalım mı (`DURABLE_OUTBOX_ENABLED=1`)?** Bugün: "işaretle → gönder → mesajı sonra kaydet"; gönderim ile kayıt
  arasında süreç düşerse misafire giden mesaj bizde kayıtsız kalabilir. Açılınca: mesaj + gönderim niyeti tek işlemde, süreç düşse de niyet
  kaybolmaz; "Gönderim Kuyruğu" ekranı hazır. ÖRNEK: 2 dk'lık senkron misafire oto-cevabı gönderirken sunucu yeniden başladı → ÖNCE: cevap gitmiş
  olabilir ama panelde görünmez · SONRA: satır "Doğrulanamadı" olur, sağlayıcı geçmişinden kontrol edilir, kopya gönderilmez. Önerim: Railway
  açılınca, ilk denemeler birlikte.
  Opus hazırlık incelemesi (10-16, `opus-o1-readiness` → tasarım belgesi §6): tek ENGEL bulundu ve düzeltildi (öğe kipinde "insanla görüşmek
  istiyorum" cevabından sonra kuyruk yolu yapay zekâyı 12 saat susturuyordu, bugünkü yol susturmuyor — artık ikisi aynı; karar kuyruğa girerken
  kaydediliyor, Opus son kontrolü ilk düzeltmedeki tehlikeli yöndeki açığı da yakaladı ve kapandı). Açmadan önce bilmen
  gerekenler: (1) ev sahibinin elle cevabı ANINDA değil, 2 dakikalık senkronun sonunda gider ("sıraya alındı" görürsün); (2) doğrulanmış erken
  giriş OTOMATİK onayı kapanır, onay sana taslak olarak düşer; (3) karar motoru (`HOST_DECISIONS_ENABLED`) bununla AYNI ANDA açılmasın (kart
  kuyruğa girer girmez "onaylandı" kapanıyor; teslim düşerse yeniden açılmıyor — ayrı düzeltme gerekir); (4) bayrak bütün işletmeler için tek —
  yalnız senin işletmende denemek için `DURABLE_OUTBOX_ORG_IDS` listesi eklememi ister misin? (5) Geri dönüş (env'i kaldırma) sonrası tek açık:
  kuyrukta iptal / başarısız kalmış taslaklar, bayrak kapanınca modele "verilmiş cevap" gibi görünebilir (iki süzgeç bayrağa bağlı; bayraktan
  bağımsız yapmak her turda kuyruk taraması demek, kuyruk tablosunda konuşma dizini yok). Seçenek A: küçük migration (yalnız dizin, veri
  değişmez) + süzgeç her zaman açık · Seçenek B: geri dönüşte o taslakları işaretleyen tek seferlik betik. Önerim A — açılıştan önce.
- **O2 · Kuyruksuz üç bildirim e-postası** (elle rezervasyon "yeni rezervasyon", görev atama, demo talebi): sağlayıcı arızasında kaybolur, yalnız
  hata uyarısı görünür. Önerim: yalnız görev atamasına "işaretle → gönder → olmazsa geri al" (migration'sız); genel bildirim tablosu şimdilik yok.
- **O3 · Kuyruk birikme alarmı:** panel bakılmazsa birikme fark edilmez. Önerim: vadesi gelmiş satır 15 dk bekleyince sana tek e-posta (düzelince
  temizlenir; diğer periyodik alarmlarla aynı kural). Yeni bir operatör e-postası olduğu için soruyorum.
  Kodda ölçülen kapsam (10-16 sabah): iki kuyruğu da 2 dakikalık senkron boşaltıyor ve o döngü ölürse `/api/health?strict=1` zaten 503 veriyor
  (ikinci izleyici oraya bakıyorsa sana haber gelir); boşaltma hatası da zaten geçiş tabanlı alarm üretiyor (`email-outbox`). Kalan tek boşluk:
  döngü canlı, hata yok ama satır ilerlemiyor (ör. takılı sahiplenme). Bu yüzden ikinci seçenek: e-posta yerine `strict` yoklamasına "kuyruk
  gecikmesi" sinyali (vadesi geçmiş satır 15 dk → 503) — yeni e-posta yok, ama izleyicinin sayfalama davranışı değişir. Hangisi? (A) e-posta
  · (B) strict yoklama · (C) şimdilik ikisi de yok (panel yeter). İkinci izleyici kurulu mu, onu da bilmiyorum.
- **Öneri turu (Haiku, 10-16 sabah; büyük şirketlerin kuyruk ekranlarında olup bizde eksik olanlar):** (yapıldı, haber) operatör panelinde
  "son 24 saatte incelemeye düşen (doğrulanamadı)" sayacı — `review` satırından çıkış elle olduğu için toplam yalnız büyüyordu. Sana sorulanlar
  (ev sahibinin gördüğü Gönderim Kuyruğu ekranı değişir):
  - **O5 · Satırın zamanı:** "Gönderilemedi" satırı ne zaman düştüğünü söylemiyor; "Sırada" satırının ne zaman deneneceği görünmüyor. Öneri: satırda
    "3 saat önce" + sayımlarda "son 24 saat / 7 gün" filtresi (migration yok, ~35 satır).
  - **O6 · Toplu yeniden dene:** bir eşleme hatası düzelince onlarca "Gönderilemedi" satırı tek tek tıklanıyor. Öneri: yalnız son 24 saatin kalıcı
    başarısızları, tek tıkta en çok 50, onay metninde sayı; bayat cevap vetosu gönderim anında yine çalışır. Misafire mesaj gönderen bir düğme
    olduğu için açıkça soruyorum (~70 satır, migration yok).
  - (Migration ister, şimdilik yok) `review` satırına "incelendi" işareti.

### H7 · Küçük kalanlar (Opus D17 listesinden)
- **O14 (yapıldı, haber):** Görevler sayfasındaki "Eksik görevleri oluştur (3)" düğmesindeki sayı GÖREV değil çıkış temizliği eksik REZERVASYON
  sayısıydı (düğme giriş hazırlığını da açtığı için bildirimde "5 görev oluşturuldu" çıkabiliyordu). Etiket artık "Eksik görevleri oluştur
  (3 rezervasyon)". Sayım kuralı değişmedi.
- **O16 (soru):** D1'de "sıradan Ekle'ye tekrar basmak ikinci kayıt onayı sayılmasın" dedin — bu yalnız bilgi tabanı FORMUNDA uygulandı.
  "Şablondan öneriler" ve "Geçmiş cevaplar" ekranlarında 409'dan sonra "Ekle"ye tekrar basmak bugün ikinci kalem açar. Aynı kural oralarda
  da uygulansın mı (409 → "Kaydedilen bilgiyi düzenle" / "Ayrı bir bilgi olarak ekle" seçimi)? Önerim evet.

## I. Kurucu kararları 10-16 sabah (Codex soruları + araya yazdıkların) — uygulama durumu

Kararların özü (aynen kaydı oturum notlarında; burada yalnız ne yapıldığı). **Faz 1** = migration'sız, kodda bitti (push öncesi tam kapı) ·
**Faz 2** = migration ister (şema taslağı gösterilecek, onaydan sonra push) · **Faz 3** = misafire giden yapay zekâ davranışı (anahtar KAPALI,
önce / sonra örneğiyle).

| Karar | Durum |
|---|---|
| Migration 68 onaylandı | ✅ Faz 1 — ana dala alındı (eski kopyayı güncelle + sözün istek kimliği) |
| Söz ekranı "Bu söz zaten kayıtlı" (görev açılamadıysa gizlenmez; klima / musluk ayrı işlem) | ✅ Faz 1 (`commitments` 200 + `reused`) |
| S6 e-posta kuyruğu: aynı satırın her denemesi aynı anahtar, bilinçli yeni e-posta yeni anahtar | ✅ Faz 1 (`Idempotency-Key: email-outbox/<satır>`); "tamamen biter" İDDİA EDİLMEDİ — sağlayıcı 24 saat tutar, kendi gönderim kaydımız + belirsiz sonuç politikası Faz 2 |
| Ödeme S4: duraklatma ≠ ödeme gecikmesi | ✅ Faz 1 (`paused` ayrı durum, ek süre yok, plan değişikliği reddedilir, banner "Aboneliği yönet") |
| Ödeme S1: eksik / tutarsız veriden fatura yok, olay kaybolmaz, düzeltilince yeniden işlenebilir | ✅ Faz 1 (tam rakam dizisi; olay `error` + `needs_review: <kod>` → Paddle'dan yeniden gönderilince işlenir; alarm) |
| Ödeme S2: hesap silinirken ödeme olayı → alarm + olay kaybolmaz + hesap geri açılmaz + inceleme kaydı | ✅ Faz 1 + istediğin test: `paddle-webhook-org-race.test.ts` (5 senaryo, gerçek PostgreSQL, belirlenimci sıra) |
| O1 liste anahtarı + "kuyruktayken / gönderilirken kapatılırsa" testi + eski sürüme dönüş açıklaması | ✅ Faz 1 (`DURABLE_OUTBOX_ORG_IDS`; tasarım belgesi §7 — 🚨 eski koda dönmeden ÖNCE ana anahtar kaldırılmalı) |
| QR: 300'e çıkarma; çalışan kilit ≠ tamamlanmış kayıt; süresi dolan eski işçi göndermesin | ✅ Faz 1 (120 sn kilit + 24 sa tamamlanmış kayıt + işçi jetonu) |
| S1 elle gönderim kalıcı işlem kimliği · S2 işlem defteri tablosu | Faz 2 (tek tablo; şema taslağı gelecek) |
| S5 bilgi tabanı sürüm alanı (bayat kayıt atomik ret, yazılan metin korunur, fark gösterilir) | Faz 2 |
| Ödeme S3 iade / ters ibraz (onaylı iade tutarı, kısmen / tamamen, ters ibraz ayrı durum + alarm + geri alınması; fatura değişmez, düzeltme kaydı) | Faz 2 |
| O2 görev ataması bildirimi kalıcı kuyruktan (atama + bildirim birlikte; yeniden atanınca eski bildirim gitmez) | Faz 2 |
| O3 A + B (e-posta + strict yoklama; alarm bozuk kuyruğa bağlı değil, yeniden başlatma döngüsü yok) + ikinci izleyici kurulum belgesi | ✅ Faz 1 (migration gerekmedi): kuyruk "ilerlemiyor" = işçinin alabileceği satır 15 dk bekliyor VE 15 dk'dır ilerleme yok → bir kez e-posta (kuyruktan geçmez) + `/api/health?strict=1` 503 `queue_stalled`; normal yoklama değişmez. İkinci izleyicinin kurulu olup olmadığı BİLİNMİYOR → Railway açılış listesinde kurulum + test alarmı maddesi |
| S4 kayıt tekrarı | ✅ Faz 1 (migration gerekmedi): doğrulanmamış hesap + ilk bağlantı geçerli + aynı parola = aynı kaydın tekrarı → ikinci e-posta yok; yanıt ve süre aynı (tek bcrypt); yalnız kalıcı e-posta kuyruğu açıkken (canlı yol) |
| O5 kuyruk ekranı zamanları · O6 önizlemeli toplu yeniden dene | Faz 2 |
| H2 belirtiyle ilgili tarif (TV siyah ekran ≠ ses ayarı) + tehlike bağlamı · H9 konu bazlı "bilgim yok" (çözüm bilgisi yok cümlesi misafire ASLA) | Faz 3 |

### Dilim sonu kontrolü (Opus, 10-16 öğle — 11 bulgu, hepsi işlendi; Haiku iki tur)
- **F1 (KVKK):** incelemeye düşen ödeme olayının ham yükü süresiz kalıyordu → 12 ayda küçülür; silinmiş işletmeninki yazılırken küçülür.
- **F2:** hesap silme ile ödeme olayı yarışı ters sırada hâlâ alarmsızdı → silme ön kontrolü abonelik satırını kilitler (iki bağlantılı gerçek
  PostgreSQL testi, kırmızı-önce).
- **F3:** geri dönüşte ulaşmamış cevap modele "verilmiş" görünüyordu → süzgeçler kuyruk satırının varlığına bağlı (migration'sız).
- **F4:** tutar sütunu sınırı · **F5:** "Ödeme incelemesi" listesi operatör panelinde + alarm gerçek eylemi söyler · **F6:** vakumlu test →
  uçtan uca · **F7 (KVKK):** QR tekrar kaydındaki metin özeti anahtarlı + konaklama silinince silinir · **F9:** Resend "aynı anahtar başka
  içerik" çakışması belirsiz sonuç sayılır, körlemesine yeniden gönderim yok · **F10:** liste silinirse kuyruk kimseye açılmaz (`*` = herkes) ·
  **F11:** doğru olay gelince eski inceleme satırı kapanır. **F8** → soru I4.

### Sorular (10-16 öğle)
- **I1 · Öneri yolunda "klima / musluk ayrı" kuralın SAĞLANMIYOR (anahtar KAPALI, `AI_ACTION_SUGGESTIONS_ENABLED`):** elle form senin kuralına
  uyuyor (her tıklama ayrı işlem → klima 18:00 + musluk 18:00 = iki söz, iki görev). Yapay zekânın söz ÖNERİSİ ise aynı tür + aynı saatte açık
  söz varsa yeni söz AÇMIYOR, var olanı döndürüyor. Klima da musluk da "Arıza / bakım" türünde ve söz cihazı / konuyu saklamıyor (yalnız tür +
  saat) → ÖRNEK: misafir "klima çalışmıyor" ve "musluk damlıyor" yazdı, iki öneriyi 18:00'e onayladın → bugün TEK söz + TEK görev (ikinci onay
  "Bu söz zaten kayıtlı" der); öneri listesi de ikincisini gizler. Birleştirmenin sebebi: ev sahibi aynı sözü elle kaydettiyse öneriyi onaylayınca
  ikinci görev açılmasın. Seçenekler: (A) söze kısa KONU alanı (ör. "klima", "musluk"; migration) — aynı tür + saat + konu birleşir, farklı konu
  ayrı · (B) öneri yolunda birleştirmeyi kaldır (migration yok; ama elle kaydedilmiş aynı söz öneriyle ikinci kez açılabilir) · (C) bugünkü gibi
  kalsın. Önerim A (Faz 2 şemasına eklerim); anahtar kapalı olduğu için bugün kimseyi etkilemiyor.
- ~~**I2 · Ödeme gecikmesi ek süresi 14 gün mü 30 gün mü**~~ → **KAPANDI (kurucu 10-16: "Ek 14 gün istemiyorum")**: ek süre yok; ödenmiş dönem
  bitince ücretli otomatik işler durur, yenileme ödemesi doğrulanınca açılır (kod: `billing/subscription.ts`).
- **I3 · O1 Seçenek A son onayı:** dizinin garanti ettiği / etmediği tasarım belgesi §7'de. Onay verirsen migration taslağını Faz 2 ile birlikte gösteririm.
- **I4 · Duraklatılmış abonelik metni (müşteri ekranı):** Paddle müşteri portalında müşterinin duraklatmayı kendisinin bitirebildiğini (devam
  ettir) belgede DOĞRULAYAMADIM (Paddle'da devam ettirme API / yönetim paneli işi; duraklatma e-postasında "ödeme yöntemini güncelle" bağlantısı
  var). Bu yüzden metin şimdilik eylem vaat etmiyor. ÖNCE (benim ilk yazdığım, yayınlanmadı): banner "Aboneliğiniz duraklatıldı — otomatik
  yanıtlar kapalı. Aboneliğinizi devam ettirerek hemen yeniden açabilirsiniz." · ŞİMDİ: "Aboneliğiniz duraklatıldı — otomatik yanıtlar kapalı.
  Panelleri kullanmaya devam edebilirsiniz." + "Aboneliği yönet" bağlantısı; plan değiştirme hatası: "Aboneliğiniz duraklatılmış olduğu için
  şu anda plan değiştirilemez." Seçenekler: (A) böyle kalsın · (B) "…Devam ettirmek için bize yazın." (destek yolu) · (C) uygulama içine
  "Aboneliği devam ettir" düğmesi (Paddle API ile; kod + ödeme akışı, ilk denemeler birlikte). Önerim A, Paddle panelinde portal bir kez
  kontrol edildikten sonra gerekirse C.


## J. Kurucu kararları 10-16 öğleden sonra (Codex incelemesi + açık kararlar) — uygulama durumu ve sorular

| Karar | Durum |
|---|---|
| Ödeme: ek 14 gün yok; ödenmiş dönem bitince ücretli işler durur, ödeme doğrulanınca açılır | ✅ kodda (`billing/subscription.ts`); Opus N1: Paddle `past_due` olayı dönem sonunu ÖDENMEMİŞ döneme taşıyabiliyordu → yazılan değer yalnız dönem başı (`webhooks/paddle/route.ts`), uçtan uca test |
| Ödeme: körlemesine yeniden ödeme yok | ✅ zaten vardı (canlı abonelikte yeni ödeme ekranı arayüzde + sunucuda kapalı, "Aboneliği yönet"); "önce mevcut işlemi kontrol et" → J4 |
| Elle mesaj: kalıcı kuyruk + hızlı uyandırma, 2 dk varsayılan değil | ✅ `kickOutboxDrain` (ölçüm p50 23 ms / p95 36 ms, 20 farklı misafir, yerel PG + sağlayıcı taklit); "yeniden dene" de hızlı; ayrı servis gerekmedi |
| QR: kilit yenileme + işlem sırasında sahiplik kaybı + kalıcı tekillik, eski işçi çalışırken ikinci işçi testleri | ✅ nabız + her ücretli adımdan (kota, getirme, model, yeniden yazdırma, bekçi, daire sayacı) önce eşzamanlı yenileme; süpürülmüş ama alınmamış kilit yeniden alınır |
| Kuyruk anahtarları ayrı, ne yaptıkları açık | ✅ `DURABLE_OUTBOX_*` (yeni işi kuyruğa alma) ≠ `OUTBOX_DELIVERY_PAUSED` (bekleyeni duraklat); yönetim sayfası + `DEPLOYMENT.md` §6 |
| Arıza önceliği yapay zekâdan / H2-H9 örnekleri | tasarım + örnekler `docs/TASARIM-2026-10-16-faz3-konu-bazli-cevap.md` (kod yok, onay bekliyor) |

Mutasyon: 18 + 6 mutant; yaşayanlar gerekçeli (aşağıdaki durum dosyası). Opus N1–N9 + Haiku 8 bulgusu işlendi (N1'de "yalnız kayıtlı değer"
önerisine itiraz: Paddle yeni dönemi önce "aktif" olayıyla yazarsa sızıntı geri gelir).

### Sorular (10-16 öğleden sonra)
- **J1 · Duraklatma kapsamı:** "yeni işi kuyruğa alma" kapanınca mesaj DURMAZ, anında gider; "bekleyeni duraklat" yalnız kuyruktakini durdurur
  (listede olmayan işletmenin anında gönderimi sürer). Üçüncü bir "bütün misafir gönderimlerini durdur" şalteri ister misiniz? (önerim: evet)
- **J2 · Duraklatmada ev sahibine ipucu (metin):** ÖNCE "Sıraya alındı" · SONRA "Sıraya alındı — gönderim geçici olarak durduruldu; durdurma
  kalkınca gidecek."
- **J3 · Ödeme gecikmesinde önceden uyarı bandı (metin):** "Son ödemeniz alınamadı. Ödenmiş döneminiz 1 Kasım'da bitiyor; bu tarihten sonra
  otomatik yanıtlar durur. Kart bilgilerinizi güncelleyin." (bugün kapanmadan önce bant yok; kapanınca dairedeki QR da kapanır)
- **J4 · "Önce mevcut işlem kontrol edilsin":** erişim kapalı + `past_due` iken Faturalandırma açılınca sunucu Paddle'dan aboneliği okusun
  (10 dk'da en çok bir), "active" ise yerel kayıt düzelsin — otomatik mi, "Ödememi kontrol et" düğmesi mi? (anahtar kapalı doğar, sandbox birlikte)
- **J5 · Dönem içi düşen tahsilat:** dönem ilerlemeden düşen tahsilatta erişim hemen kapanır (ek süre doğmayan yön); kesin çözüm ayrı
  "ödenmiş dönem sonu" alanı (migration). Sandbox'a kadar böyle kalsın mı?
- **J6 · Erişimi kapanmış `past_due` müşteri plan değiştirebiliyor** (eskiden de): kapansın mı? Metin önerisi: "Ödemeniz alınamadığı için şu
  anda plan değiştirilemez. Önce kart bilgilerinizi güncelleyin."
- **J7 · Paddle sandbox (birlikte):** (a) reddedilen yenilemede `past_due` yükünde dönem ilerliyor mu, (b) çift ödeme (Codex C1) için sunucunun
  açtığı tek işlem (`transactionId`).
- **J8 · RiskEvent saklama:** konuşma kimliği taşıdığı için takma adlı kişisel veri (Codex C6); öneri: `DATA_RETENTION_MONTHS` sonrası konuşma
  kimliği boşaltılsın (istatistik kalır). Avukat paketine de giriyor.
- **J9 · Örnek ortam dosyasındaki kaldırılmış `BILLING_PAST_DUE_GRACE_DAYS` satırı** (kural gereği .env* dosyalarını açmıyorum).
- Açık kalanlar: I1 · I3 · I4 (yukarıda); I2 kapandı (ek süre yok).

## K. Codex'in 21 maddelik haritası + "ilan tekrarı" (10-16 akşam, kodda doğrulandı) — durum ve karar bekleyenler

Kapalı (kodda var): 1 ödeme tutar doğrulaması · 14 söz ekranı metni (↓K2) · 2 silme yarışı alarmı · 10 `paused` / ek süre yok · 13 QR kilit ≠ tamamlanmış kayıt · 15 D1 KB formu ·
16 D2 kopyalama · 19 D5 artık görevler. Hazır yamada (migration + kod onayı): 3 elle cevap kalıcı niyet (`M-defter`; bugün kuyruk anahtarı açıkken
kalıcı) · 4 iade / ters ibraz (`M-iade`) · 7 istek defteri (`M-defter`) · 11 KB sürümü (`M-kb-surum`). Belge / ölçüm: 9 ölçek (§J, rakamlar
ölçülmedi diye işaretlendi — Codex C5) · 12 Sentry etiketleri var, "işletme özeti anonim değildir" dili düzeltildi (C6).

Karar bekleyenler (soru — örnekli; anahtarlar kapalı olduğu için bugün kimseyi etkilemiyor):
- **K1 · Deneme kimliği "otomatik kesme" mi "inceleme sinyali" mi (madde 8 + ilan tekrarı):** `TRIAL_IDENTITY_ENABLED` açılınca aynı ilan /
  takvim başka hesapta görülmüşse deneme KENDİLİĞİNDEN biter (sizin 10-10 kararınız, `billing/trial-identity.ts`). Codex: "şimdilik inceleme
  sinyali, otomatik kesme yok; ilan kimliği işletme / insan kimliği değildir (yeni yönetici olabilir)". Ayrıca ekran metni "Bu ilan daha önce bir
  deneme hesabında kullanıldı." başka bir hesabın varlığını ima ediyor. Seçenek A (bugünkü): otomatik bitir · B: denemeyi bitirme, operatör
  listesine düşür (risk puanı zaten var) + metin yok. Önerim B — anahtarı açmadan önce karar.
- ~~K2 · Söz ekranı metni (madde 14)~~ → **KAPALI (kodda doğrulandı):** elle söz yolu söz ile görevi AYNI işlemde yazar
  (`lib/guest-commitments.ts`): yeni söz = yeni görev → "Söz kaydedildi, görev açıldı." doğru; aynı işlemin tekrarı "Bu söz zaten kayıtlı."
  (görev açılmadı). Görevsiz söz kaydı bu yolda yok.
- **K3 · Ödeme ekranı hata metinleri (madde 5):** kesin ret / doğrulama beklemesi / teknik hata bugün kısmen aynı metni gösteriyor. J4
  ("önce mevcut işlemi kontrol et") ile birlikte tasarlanmalı — Paddle sandbox denemesinde.
- **K4 · Aynı çıkışa elle açılmış temizlik görevi (madde 21):** bugün sistem kendi çıkış temizliğini yine açar (iki görev yan yana). Öneri:
  aynı rezervasyonun çıkış gününe elle açılmış temizlik görevi varsa sistem ikincisini açmasın (ara temizlik yine engellemez).
- **K5 · Durum geçişleri tek serviste (madde 20):** rezervasyon PATCH'i iptal dışı durumu doğrudan yazıyor; panel ve API "yeniden açma"da ortak
  servisi kullanıyor. İç düzen, müşteri etkisi yok — öncelik düşük, sizin sıranıza göre.
- I1 (söz birleştirme, madde 17) yukarıda açık.

## L. Geçmişten öğren × Codex'in 6 ilkesi (10-16 akşam; Opus denetimi 10-15, kodda doğrulandı) — durum ve sorular

Anahtarlar (`HISTORY_LEARN_ENABLED`, `PROPERTY_INSTRUCTIONS_PROMPT_ENABLED`) KAPALI; bugün kimseyi etkilemiyor. Denetimde çıkan, misafire giden
metni değiştirmeyen düzeltmeler kodda: yapay zekâ taslağını "Taslağı kullan" ile aynen ya da az değiştirerek gönderdiğiniz cevap ev sahibi
kanıtı SAYILMAZ (taslak sözcüklerinin %60'ı cevapta → çift düşer; Codex ilke 2) · tarihe / geçici duruma bağlı, "belki düzelir" türü deneme
ve "bilgi belirtilmemiş" taslakları işaretli gelir, onay için kutucuk ister · taslağın altında dayandığı eski cevabınız (maskeli, ay etiketiyle).
Mülk karışması yok (okuma mülk + işletme kapsamlı), KVKK silme / saklama / dışa aktarma işliyor.

Karar bekleyenler (denetim + ilk dilim tasarımı: `gecmisten-ogren-6-ilke.md` §A–§C):
- **L1 · Geçmiş cevaplarınız nerede kullanılsın? (kurucu isteği "önceki mesajlardan host cevaplarını kontrol etsin")** Bugün yapay zekâ
  cevap yazarken yalnız bilgi tabanına, daire bilgisine ve O sohbete bakıyor; eski sohbetlerdeki cevaplarınızı yalnız "Geçmişten öğren"
  taslağını onaylayınca görüyor. Destek yazılımlarında yaygın düzen: eski temsilci cevapları önce TEMSİLCİYE taslakta kaynağıyla gösterilir;
  müşteriye kendiliğinden giden cevap onaylı bilgiden çıkar. Önerim: ilk adımda YALNIZ "AI öner" taslağında, AYNI dairenin eski cevaplarınıza
  bakılsın (başka daire asla; yapay zekânın kendi eski cevabı, konaklamaya özgü izin / tarih, "belki düzelir" denemesi, kapı kodu ve
  rezervasyon öncesi Wi-Fi getirmenin İÇİNDE dışarıda); bilgi tabanında aynı konu varsa bilgi tabanı kazanır; taslağın altında hangi eski
  cevabınıza dayandığı görünür. Otomatik gönderim ve QR aynı kalır, migration yok, anahtar kapalı doğar.
  ÖRNEK: misafir "TV açılmıyor, ne yapayım?", bilgi tabanında TV yok. Önce: taslak ara cevap, siz elle yazıyorsunuz. Sonra: taslak
  "Kumandadan HDMI 1 kaynağını seçin." + altında "Mart 2025'te bir misafire böyle yazmıştınız: …" → siz "Onayla ve gönder". Böyle yapalım mı?
- **L2 · Onaylarken bilgi tabanında aynı konu varsa (Opus H2):** bugün "Wi-Fi şifresi yeni2025" kaydınız varken geçmişteki eski "lale2024"
  cevabından çıkan taslağı onaylarsanız ikisi birden etkin kalır; misafir sorunca yapay zekâ birini seçer (yanlış şifre gidebilir). Eski
  geçmiş önerisi (Bacak B) 09-18'de tam bu yüzden "zaten kayıt varsa önerme" kuralını almıştı. Önerim: aynı daire + aynı konuda etkin kayıt
  varsa taslak "Bilgi tabanınızda bu konu var: …" işaretiyle gelsin; onayda üç düğme "Eskisinin yerine koy" (eskisi pasife) · "Ayrı bilgi
  olarak ekle" · "Vazgeç". ÖRNEK: misafir "Wi-Fi şifresi?" → önce: iki şifreden biri · sonra: yalnız seçtiğiniz. Böyle yapalım mı?
- **L3 · Tek konuşmada geçen bilgi (Opus H7):** yalnız bir misafire söylediğiniz cümle işaretsizse tek tıkla bilgi tabanına giriyor (insan
  onayıyla, otomatik değil). Önerim: "Yalnız 1 konuşmada geçti — herkese uygun mu?" işareti + kutucuk. ÖRNEK: "Bu akşam kapıda bekleyeceğim"
  → önce tek tıkla kalıcı bilgi · sonra önce kutucuk. Böyle yapalım mı?
- **L4 · Düzenleyip gönderdiğiniz yapay zekâ taslağı:** bugün (kodda) taslağın sözcüklerinin %60'ı ya da fazlası cevabınızda kalıyorsa o cevap
  sizin bilginiz sayılmıyor (şüphede öğrenme yok). Bu eşik uygun mu, yoksa "bir harf bile değiştirdiysem benim cevabımdır" mı? Önerim:
  bugünkü gibi kalsın (yapay zekânın kendi sözünü kanıt yapması pahalı, kaçan bir çift ucuz).
- **L5 · Sağlayıcı otomasyonu (Opus H9, migration ister):** Hospitable'ın kendi şablon mesajı bizde ev sahibi mesajı sayılıyor (sağlayıcı
  gönderen rolünü saklamıyoruz). Bizim şablonlarımız zaten ayrılıyor. Önerim: Airbnb Direct'e geçişte gönderen rolü kanal katmanında saklansın
  (ayrı tur); bugün için değişiklik yok.

## M. Konu bazlı "bilgim yok" (H9) — Opus dilim sonu kontrolünden iki not (10-16 akşam; anahtar KAPALI)
- **M1 · "Bilgi veremem" yakalanmıyor (bugün de, anahtardan bağımsız):** "bilgim yok" kuralı "bilgi veremiyorum"u yakalıyor ama "Bu konuda bilgi
  veremem." / "Kesin bilgi veremem."i yakalamıyor → bu cümleler bugün misafire GİDEBİLİR. Önerim: "veremem / veremeyiz" ailesi de "bilgim yok"
  sayılsın (yalnız tutma yönünde). ÖRNEK: misafir "Havuz kaçta açılıyor?", cevap "Bu konuda bilgi veremem." → önce: gider · sonra: ev sahibine
  kalır. Böyle yapalım mı? (Müşteriye gideni değiştirdiği için sormadan yapmadım.)
- **M2 · Bilgi:** H9 açıkken bile "Başka bir bilgim yok." gibi KONUSUZ yokluk cümlesi bütün cevabı tutar (hangi konunun açık kaldığı bilinmiyor);
  ilk açılışta "kısmen giden" cevap sayısı kanıttaki `ta` izinden ölçülecek.

## N. Codex 10-16 akşam bulguları (6 madde, kodda doğrulandı ve düzeltildi) + bir karar sorusu

| # | Bulgu | Durum | Müşteriye / misafire giden değişti mi |
|---|---|---|---|
| 1 | Silinen hesabın küçültülmüş ödeme olayı Paddle yeniden gönderince ham kişisel veriyle geri yazılıyordu | ✅ küçültülmüş yük hiçbir yeniden işlemede ezilmez | Hayır (kayıt) |
| 2 | Aboneliği kapanan işletmenin KUYRUKTAKİ otomatik mesajı gönderilebiliyordu | ✅ gönderilmez, iptal de edilmez (bekler); elle cevap etkilenmez | EVET (sizin "ödenmiş dönem bitince otomatik işler dursun" kararınızın kuyruğa uygulanması; kalıcı kuyruk bugün kapalı) → N1 |
| 3 | KB kopyalamada mevcut kopyayı güncelleyen tekrar, kaynak arada değişince 409 vermiyordu | ✅ güncellenen kaleme de işlem kimliği yazılır | Ev sahibi ekranı: o durumda "kaynak değişti" uyarısı |
| 4 | Arıza okuyucu 64 cümleden sonrasını okumuyordu | ✅ misafir metni bütünüyle; cevap 200 cümleye kadar, aşan cevap tutulur | Yalnız iki kapalı anahtar açıkken (bugün değişmez) |
| 5 | "Geçmişten öğren" gönderilemeyen ev sahibi mesajını kanıt sayıyordu | ✅ yalnız teslim edilmiş ya da kuyruksuz mesaj kanıt | Hayır (anahtar kapalı, taslak) |
| 6 | Sağlık yoklamasında eşzamanlı istekler veritabanı okumasını çoğaltıyordu | ✅ süren yoklama paylaşılır | Hayır |

- **N1 · Ödeme sonrası bekleyen otomatik mesaj ne olsun?** Bugün (kod): erişim kapanınca kuyruktaki yapay zekâ cevabı / karşılama mesajı
  GİTMEZ ve SİLİNMEZ, bekler; ödeme doğrulanınca bütün eski kontrollerden (misafir yeniden yazdıysa iptal, rezervasyon iptalse iptal, giriş
  penceresi geçtiyse iptal) geçip gider. "AI anahtarı kapatılınca" kuralı (Y5) farklıydı: yapay zekâ cevabı iptal, karşılama mesajı bekler.
  Seçenekler: A) bugünkü gibi beklesin, ödeme gelince gitsin · B) yapay zekâ cevabı iptal + gelen kutusunda "gönderilmedi (abonelik)" notu,
  yaşam döngüsü mesajı beklesin (Y5 ile aynı) · C) hepsi iptal. ÖRNEK: misafir "Wi-Fi şifresi?" yazdı, cevap kuyruğa girdi, 5 dk sonra
  ödenmiş dönem bitti; ödeme 3 gün sonra geldi → A: misafir 3 gün sonra Wi-Fi cevabı alır (bayat olabilir) · B: cevap gitmez, ev sahibi notu
  görür. Önerim **B** (Y5 ile tutarlı; günler sonra giden yapay zekâ cevabı yanıltıcı olabilir). Hangisi?

## O. Kurucu kararları 10-17 (K / L / M / N / H9 / I cevapları, AYNEN özü) — uygulama planı

| Soru | Kurucu kararı (özü) | Uygulama |
|---|---|---|
| H9 istisnası | "Televizyonla ilgili ayrı bir talimatım bulunmuyor" gibi cümle KESİNLİKLE yazılamaz, "ev sahibinize ileteceğim" de söylenemez. "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli" → ilk yarısı ("…özel talimatımız yok") YAZILMASIN, yalnız yönerge kalsın | ✅ (10-17) istisna kaldırıldı (yedi dil); ANAHTARSIZ silici (`ai/no-instruction-filler.ts`, her cevap yolunda): yönerge varsa yalnız "talimat yok" kısmı / cümlesi silinir. Opus derin kontrolü (10-17) üzerine İZİN LİSTESİ: "talimat yok" ardındaki adım bilgi tabanından gelmemiş olabilir → yönerge cihaz adımıysa ("Özel bir talimatımız yok, kombiyi sıfırlamak için reset tuşuna basın"), konu "bu konuda" gibi göndergeselse, konu bilinmiyorsa (jakuzi) ya da geriye yalnız selam kalıyorsa SİLİNMEZ → cevap tutulur, ev sahibi yanıtlar. İstem değişmedi |
| M1 | "bilgi veremem" tutulsun — "müşteriye öyle denir mi, sussa daha iyi" | ✅ (10-17) "bilgi veremem / veremeyiz / veremeyeceğim / verememekteyiz" "bilgim yok" sayılır (pinli). DAR: "Kimlik bilgilerinizi göndermeden giriş kodunu veremeyiz" gibi politika cümlesi tutulmaz (bugünkü gibi gider) |
| I1 | migration, önerildiği gibi (A: söze konu alanı) | Faz 2 migration |
| I3 | anlaşılmadı | sade açıklama ↓ |
| I4 | şimdi A; sonra KESİNLİKLE C: tıklanınca hemen ödeme alınıp pakete dönsün | A kalır; C kodu anahtar KAPALI (Paddle "devam ettir"), ilk denemeler birlikte |
| N1 | ödeme gelince çalışmaya başlasın, bayat mesaj KESİNLİKLE gitmesin, tek gösterimlik uyarı olabilir | ✅ (10-17) B: erişim kapalıyken kuyruktaki yapay zekâ cevabı İPTAL (`billing_paused`) + gelen kutusunda not ("Aboneliğiniz aktif değilken gelen mesaja otomatik yanıt gönderilmedi — lütfen elle yanıtlayın"); yaşam döngüsü mesajı talep edilmez, bekler, ödeme gelince yalnız penceresi geçerliyse gider (iptal / geçmiş pencere → gitmez). EK (kodda bulundu): erişim kapalıyken GELEN misafir mesajları da damgalanır — eskiden ödeme gelince oto-yanıt günler önceki sorulara cevap üretiyordu (`markBillingPausedConversations`). Haiku + Opus (10-17): "en son kapalı görüldü" işareti (senkron düşse de yazılır) oto-yanıt penceresini o andan başlatır; kapalı dönemi kapsayan kuyruk satırı (hiç talep edilmemiş ileri vadeli cevap dahil) iptal; bekleyen karşılama / giriş mesajı varış günü geçtiyse gitmez; not "misafir insan istedi" gibi kalıcı sebebi ezmez. Hepsi gerçek PostgreSQL'de pinli |
| L1 | mantıklı; sürekli onay istemesin (iki kip, hatasız); aynı şey farklı yazılmışsa daha güncel kazanır; iyi embedding; ilk başta bütün mesajlar tutulup dizinlensin; güven zamanla azalsın (dün yazılan neredeyse kesin, 1 yıl önceki zayıf) | tasarım + migration + kod (anahtar KAPALI) |
| L2 | evet; ev sahibi bir kez daha güncel olanı seçince o artık doğru sayılsın, model kendini geliştirsin | onay akışı + eski kalem pasif |
| L3 | mantıklı ama ev sahibini çok uğraştırmasın | yalnız gerçekten tek seferlik görünenlerde işaret |
| L4 | ev sahibi taslağı az değiştirip gönderdiyse değiştirdiği yerleri o daire için öğrensin (%40'tan az değişim); milyar dolarlık şirket çözümü | düzenleme farkından öğrenme (migration) |
| L5 | Hospitable gidecek; şimdilik sağlayıcı otomasyonu ile ev sahibi mesajını AYIR; Airbnb Direct'e geçişte rol kanal katmanında | gönderen rolü saklanır (migration) |
| K1 | B (otomatik kesme yok) + risk puanı geliştirilsin, IP'lere bakılsın, kötüye kullanım engellensin | risk puanı + IP sinyali (migration), eşik üstü inceleme |
| K3 | ödeme ekranı hata metinleri bol bol düzenlensin | ✅ (10-17) envanter (57 metin) + düzeltmeler ↓§P |
| K4 | önerildiği gibi | ✅ (10-17) çıkış gününe ev sahibinin elle açtığı temizlik (söz görevi değil) varsa sistem ikincisini açmaz; "Eksik görevleri oluştur (N)" aynı kural (`lib/tasks/lifecycle-presence.ts`). Görev formu rezervasyon bağlamadığı için (Opus 10-17) AYNI MÜLKTE rezervasyonsuz elle temizlik de sayılır — formun gerçek gövdesiyle pinli. Ara temizlik, söz görevi, vadesiz elle görev, eski çıkış gününe açılmış görev engellemez (gerçek PostgreSQL) |
| K5 | anlaşılmadı | sade açıklama ↓ |
| Genel | "Daha iyi olacaksa migration yapalım, bol bol, didik didik" | migration'lar Faz paketlerine |

**I3 (sade):** misafir mesajı kuyruğu kapatılınca, kuyrukta kalmış GÖNDERİLMEMİŞ taslakların yapay zekâya "verilmiş cevap" gibi görünmemesi
gerekiyor. Bu artık kodda çözüldü (10-16, migration'sız). Sorulan yalnız HIZ için bir dizindi (migration): her konuşmada "kuyrukta satırı var
mı" sorgusunu tek adımda yapar. Davranışı değiştirmez, yalnız ucuzlatır. Sizin "migration yapalım" kararınızla Faz 2 paketine ekliyorum.

**K5 (sade):** rezervasyon durumunu değiştiren üç yer var (rezervasyon düzenleme, panelden "yeniden aç", senkron). Biri ortak kuralı kullanmıyor; bu
bugün hata yapmıyor, ama ileride bir kural eklenince birinde unutulabilir. İş: üçünü tek fonksiyona bağlamak. Müşteri hiçbir fark görmez — iç
düzen. Sıradaki büyük işlerden sonra yapacağım.

## P. K3 — ödeme ekranı metinleri (10-17, kurucu "bol bol düzenleyelim"; envanter Haiku, kodda doğrulandı)

Önce → sonra (yalnız ev sahibinin ödeme / abonelik ekranı; misafire giden metin yok):

| Durum | Önce | Sonra |
|---|---|---|
| Plan değişikliği reddi (ör. "zaten bu plandasınız", yıllık abonelik, duraklatılmış) — uygulama adımı | "Doğrulama hatası" (sunucunun sebebi hiç görünmüyordu) | sunucunun sebebi: "Zaten bu plandasınız." / "Yıllık aboneliklerde plan değişikliği panelden yapılamıyor…" |
| Ödeme sağlayıcısı değişikliği reddetti (ham sebep artık müşteriye de ağ yanıtına da gitmez) | "Plan değişikliği yapılamadı. Lütfen tekrar deneyin. (Paddle HTTP 400 (subscription_locked) env=production resource=subscriptions)" | "Plan değişikliği yapılamadı; planınız değişmedi. Lütfen tekrar deneyin, sorun sürerse bize yazın." (ham sebep operatör alarmına) |
| Tutar değişti (409) | "Tutar değişti — lütfen yeni tutarı onaylayın." + pencere kapanıyor, yeni tutar yok | yeni tutar KENDİLİĞİNDEN hesaplanıp pencere yeniden açılır + "Tutar değişti. Yeni tutarı kontrol edip yeniden onaylayın." |
| Onay bekleniyor (202) | kırmızı hata alanında "…Paddle onayı bekleniyor…" | nötr bilgi: "İşleminiz alındı, ödeme sağlayıcısının onayı bekleniyor. Planınız birkaç dakika içinde güncellenecek." |
| Abonelik yönetim sayfası (429 / abonelik yok / ağ) | hepsi "Abonelik yönetim sayfası açılamadı. Lütfen tekrar deneyin." | sebebe göre: "Çok fazla istek…" / "Yönetilecek bir aboneliğiniz bulunamadı. Bir plan seçerek abonelik başlatabilirsiniz." / "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." |
| Onay kaydı: ağ hatası | "Onayınız kaydedilemedi, ödeme başlatılamadı…" (sunucu hatasıyla aynı) | "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin." |
| Ödeme ekranı yüklenemedi | "Ödeme servisi yüklenemedi. Bağlantınızı kontrol edin." + düğme sonsuza dek "Yükleniyor…" (betik indi ama boşsa / önceki hata etiketi kaldıysa hiç metin yoktu) | "Ödeme ekranı yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin." + düğme "Sayfayı yenileyin" (20 sn zaman aşımı dahil) |
| Erişimi kapalı abonelik etiketi | her durumda "aboneliğiniz aktif değil" | "son ödemeniz alınamadı" / "aboneliğiniz duraklatıldı" / "aboneliğiniz iptal edildi" (sınırlı mod bandıyla aynı dil) |
| Yıllık dönem seçiliyken plan düğmeleri | açıklamasız kapalı | "Yıllık ödemeye geçmek için bize yazın, birlikte halledelim." |
| "Önizleme" jargonu (409 / 400) | "Önizleme doğrulanamadı…", "Bu önizleme zaten kullanıldı…" | "Tutar onayının süresi doldu. Planı yeniden seçip tutarı tekrar onaylayın.", "Bu onay zaten kullanıldı…" |
| Diğer | "Geçersiz plan.", "Plan fiyatı yapılandırılmadı.", "…duraklatılmış olduğu için… değiştirilemez.", "Yönetilecek bir Paddle aboneliği…", "Şu anda işlenemedi…", "(Merchant of Record)" | "Seçilen plan bulunamadı. Sayfayı yenileyip tekrar deneyin.", "Bu plan şu anda satın alınamıyor…", "…duraklatıldığı için şu anda plan değiştirilemiyor.", "Yönetilecek bir aboneliğiniz…", "İşleminiz şu anda tamamlanamadı; planınız değişmedi…", İngilizce terim kaldırıldı |

Bilinçli DOKUNULMAYAN: hukuki metinler (Mesafeli Satış / Ön Bilgilendirme — avukat paketi); düşürme penceresindeki "hemen geçerli olur, aradaki fark bir sonraki faturanıza yansıtılır" DOĞRU (Paddle `prorated_next_billing_period`: değişiklik hemen, ücret farkı sonraki fatura). Kanal (sağlayıcı) aboneliği metinleri ödeme ekranı değil — ayrı tur. Tek kaynak `src/lib/billing/billing-ui-text.ts` (pinli).

## Q. S2 migration paketi (10-17) — tasarım hazır, dört soru

Tasarım (dosya:satır, şema farkı, SQL taslağı, değişmezler, 39 kırmızı-önce test): `docs/TASARIM-2026-10-17-s2-migration-paketi.md`. Önerilen
migration'lar (hazır yamadaki 69–75'ten sonra; hepsi boş kolon ya da yeni tablo, birbirinden bağımsız): **76** `GuestCommitment.topic` (I1) ·
**77** `KnowledgeBaseItem.supersededAt` (L2) · **78** `Message.channelSenderRole` (L5) · **79** `SignupNetworkTrace` + `Organization.trialIdentityReusedAt`
(K1; anahtar aydınlatma metni yayınlanmadan açılmaz). L3 migration'sız. Soru gerektirmeyenler (L2/L3, L5 1. faz, K1 "otomatik kesme yok") koda geçecek.

- **Q1 · I1 — elle kaydettiğiniz KONUSUZ söz + aynı saatte KONULU öneri:** ÖRNEK — "Misafire söz ver" ile **Arıza / bakım, bugün 18:00**
  kaydettiniz (formda konu yok). Sonra misafire "Klima için teknisyen 18:00'de gelecek" yazdınız; öneri "Söz kaydet: Arıza / bakım (klima) — 18:00".
  (a) ÖNERİM: onaylayınca yeni görev AÇILMAZ, sözünüze "klima" yazılır ("Aynı saatte kaydettiğiniz söze bağlandı (klima)"); ardından "musluk 18:00"
  önerisi AYRI söz + görev açar · (b) konusuz elle söz hiçbir öneriyle birleşmez (aynı iş için iki görev olabilir) · (c) elle forma isteğe bağlı
  "Konu" seçimi (yalnız Arıza / bakım ve Eksik eşya). Anahtar kapalı; bugün kimse etkilenmiyor.
- **Q2 · L5 — kanalın (sağlayıcının) otomatik mesajı "cevap" sayılsın mı?** ÖRNEK — misafir 13:55 "Otopark var mı?"; sağlayıcının zamanlanmış "Giriş
  bilgileri" mesajı 13:56; senkron 13:57'de ikisini görür. Bugün: şablon "ev sahibi cevabı" sayılır → yapay zekâ otopark sorusunu cevaplamaz, panodaki
  açık iş "ev sahibi yazdı" diye düşer. Önerim (2. faz): kendi otomatik mesajlarımızdaki kural (K7) — cevap DEĞİL → otopark cevaplanır, iş açık kalır.
  Risk: sağlayıcının yapay zekâsı gerçekten cevapladıysa çift cevap → 2. faz yalnız alan canlı hesapta doğrulandıktan sonra (Hospitable belgesi bu
  ortamdan açılamadı; kurucu org 402).
- **Q3 · K1 — aydınlatma cümlesi + saklama süresi:** önerilen cümle — "Ücretsiz denemenin kötüye kullanılmasını önlemek için kayıt sırasında IP
  adresinizden geri döndürülemez bir özet ve bağlandığınız ağın özeti oluşturulur; ham IP adresi bu amaçla saklanmaz. Bu bilgi yalnız ekibimizin
  incelemesinde kullanılır, otomatik karar verilmez ve 90 gün sonra silinir." (a) 90 gün mü (önerim; silip yeniden açmayı 3 ay görür) 30 gün mü?
  (b) Onay kanıtı olarak tutulan ham kayıt IP'si bu amaçla KULLANILMAZ — doğru mu? ÖRNEK: Ayşe 1 Ekim'de kaydoldu, 5 Ekim'de silip aynı evden yeniden
  açtı → operatör listesinde "aynı ağdan başka kayıt" görünür.
- **Q4 · K1 — operatör "Denemeyi bitir" deyince müşterinin göreceği metin:** önerim "Ücretsiz denemeniz sona erdi. Devam etmek için bir plan seçin.
  Bir yanlışlık olduğunu düşünüyorsanız bize yazın." (sebep söylenmez — kaçışı öğretmemek için; "risk / kötüye kullanım" sözcükleri geçmez). Hesap
  kapatılmaz (ödeme yapmak isteyen meşru müşteri dışarıda kalmasın); "Denemeyi geri ver" ile geri alınır. Uygun mu?

