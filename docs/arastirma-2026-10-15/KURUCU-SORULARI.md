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
| 6 | **Takip no. F8 + F1/F3/F4:** tek migration (68) ile destek ekranı v2, otomatik cevap ve QR izleri | migration | `takip-numarasi.md` §15 |
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
- Ölçüm (kayıtlı 3.324 cevap, ücretli çağrı yok): **22 cevap tutulurdu, hepsi tarifi olmayan arıza için uydurulmuş adım** (klima çalışmıyor →
  "kapatıp birkaç dakika sonra açın"; internet yok → "modemi fişten çekip 30 sn bekleyin"; kilit takılıyor → "kolu kaldırıp anahtarı yavaşça
  çevirin"). **Gerçekten gönderilmiş cevaplarda yanlış tutuş 0.**
- ÖRNEK 1 (bilgi tabanında TV kalemi yok): "Ekranda görüntü yoksa kaynak girişini (HDMI) kontrol edin." → ÖNCE gider · SONRA gitmez.
- ÖRNEK 2 (bilgi tabanında "Televizyon: görüntü gelmezse SOURCE → HDMI 1"): aynı adım → ÖNCE de SONRA da gider.
- ÖRNEK 3 (otopark tarifinde "kumanda çalışmazsa tuş takımına 5523"): "Kumanda çalışmazsa tuş takımına 5523 yazın" → gider (kumanda TV sayılmaz).
- ⚠️ Bir sınır: klima kaleminde yalnız KULLANIM varken ("MODE tuşuyla soğutma, 24 derece"), misafir "klima çalışmıyor" deyince modelin
  "MODE tuşuyla kar tanesini seçip 24 dereceye almayı dener misiniz?" cevabı da **tutulur** (arıza adımı tarif ister — 1 Ekim kararın 18 "a").
  Bilgi bilgi tabanında yazılı ama arıza tarifi olarak değil. Böyle kalsın mı, yoksa kullanım bilgisi arıza cevabında da kullanılabilsin mi?
- Bilinen sınır: aynı cihazın tarifi VARKEN tarifte yazmayan başka bir adım (cihaz düzeyinde okunuyor; misafir başka dilde yazınca sözcük
  karşılaştırması güvenilir değil).
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

### H7 · Küçük kalanlar (Opus D17 listesinden)
- **O14 (yapıldı, haber):** Görevler sayfasındaki "Eksik görevleri oluştur (3)" düğmesindeki sayı GÖREV değil çıkış temizliği eksik REZERVASYON
  sayısıydı (düğme giriş hazırlığını da açtığı için bildirimde "5 görev oluşturuldu" çıkabiliyordu). Etiket artık "Eksik görevleri oluştur
  (3 rezervasyon)". Sayım kuralı değişmedi.
- **O16 (soru):** D1'de "sıradan Ekle'ye tekrar basmak ikinci kayıt onayı sayılmasın" dedin — bu yalnız bilgi tabanı FORMUNDA uygulandı.
  "Şablondan öneriler" ve "Geçmiş cevaplar" ekranlarında 409'dan sonra "Ekle"ye tekrar basmak bugün ikinci kalem açar. Aynı kural oralarda
  da uygulansın mı (409 → "Kaydedilen bilgiyi düzenle" / "Ayrı bir bilgi olarak ekle" seçimi)? Önerim evet.
