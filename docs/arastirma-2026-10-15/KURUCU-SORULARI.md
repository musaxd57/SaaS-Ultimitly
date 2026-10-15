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
