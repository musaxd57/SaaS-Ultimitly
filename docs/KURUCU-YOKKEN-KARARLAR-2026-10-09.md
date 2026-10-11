# Kurucu yokken verdiğim kararlar (2026-10-09 gece →)

> Kurucu (10-09 gece): "Soru sormadan ilerle geçici olarak — kendi önerilerin, nasıl olmasını sen belirle, uygula; ben sana gelince neleri
> sorman gerekirken kendi önerin gibi yaptın yaz bana." Her satır: **normalde sorulacak soru · verdiğim karar · gerekçe · geri alma**.
> Canlı yok (Railway kapalı); yeni davranışlar KAPALI anahtar arkasında. Müşteriye giden metni değiştiren her şey anahtar açılmadan etkisiz.

## Döndüğünüzde bakılacaklar (kısa)

1. **Luna geçişi (env, sizin işiniz):** cevap + bekçi `gpt-6-luna` / `low`, karar metni yazıcısı 5.1, çeviri Luna `medium`, üslup Luna
   `none`; **anlama katmanı ve yeniden sıralayıcı 5.1'de kalsın** (10-10 dalga 5 düzeltmesi: Luna sıralayıcı 2,5 sn tavanında ~%10 düşüyor,
   Luna anlama getirmede 4–5 / 120 kaçırıyor — `docs/olcum/RAG-AYRISTIRMA-2026-10-10.md`). Tablo: `docs/olcum/LUNA-GECIS-2026-10-10.md` sonu.
2. **Açılmayı bekleyen anahtarlar** (hepsi kapalı, açmak = siz + ilk denemeler): doğrulanmış müsaitlik / uzatma (kanal + QR), tarih okuması,
   konuşma durumu satırı. Ölçümler raporlarda; önerdiğim sıra: tarih okuması + konuşma durumu (güvenlik ölçüleri 0, gereksiz soru 0) →
   doğrulanmış müsaitlik → uzatma → QR.
3. **Migration 60** (kanal üst verisi + yapay zekâ izi + kalite konsolu): kod hazır yama; itmek = taze `pg_dump` + "push et".
4. **Açık taahhüt hafızası:** A / B / C seçimi (`docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md`).
5. **Cevap inceleme sayfası** yeni ölçümlerle güncellendi (6.127 çift); yorumlarınız artık her güncellemede korunur.
6. Bilgi için: bayat takvim kaynağında çakışma artık "kesin" değil (#9), plan sınırı yarışı düzeltildi (#12).
7. **İngilizce köprü sorgusu** (#13, anahtar kapalı): Türkçe soru İngilizce yazılmış bilgi kalemini %79 → %95 buluyor; açmayı öneriyorum.

| # | Normalde sorardım | Kararım | Gerekçe | Geri alma |
|---|---|---|---|---|
| 1 | Konuşma durumu satırının metni ("Konuşma aşaması … · teslim edilmiş cevap: N · son cevaptan bu yana X (yeni oturum)") | Yalnız OLGU yazılır, davranış talimatı yok (selam / kısa selam kuralı eklenmedi) | Kod selamı canlıda açık (`AI_CODE_GREETING_ENABLED`) — modele "yeni oturumda selam ver" demek kodun selam kuralıyla çakışırdı; önce kör eval etkisini ölçer | `AI_CONVERSATION_STATE_ENABLED` kapalı kalır |
| 2 | Kör eval yapılandırması | Önce hedef yapılandırma (cevap + anlama Luna `low`), sonra 5.1 ve Luna `medium` | Kurucu 10-09: Luna'ya geçiş + "reasoning farklarını dene" | — |
| 3 | QR'de doğrulanmış müsaitlik / uzatma: aynı anahtar mı ayrı mı, hangi tarihler | AYRI anahtar `AI_VERIFIED_QR_ENABLED` (kapalı); müsaitlik yalnız konaklamaya DEĞMEYEN aralıkta (bitişik / örtüşen = konaklama değişikliği → ev sahibi); uzatma kanaldaki kurallarla aynı | QR'yi dairedeki misafir kullanır; kurucu "bayrak olsun, unutturma" dedi | anahtar kapalı kalır |
| 4 | Konuşma durumu satırında teslim edilen cevap sayısı | Yazılmaz (Haiku: blokta "giden mesaj" sayısıyla çelişiyordu) | otomatik karşılama selam kuralında sayılır, cevap sayısında sayılmaz | — |
| 5 | Kör eval ilk sonucu (Luna `low`, 46 senaryo × 2 kol) | Satır bayrak kapalı kalır; son kodla 5.1 / Luna `low` / Luna `medium` tekrar koşulur | sızıntı / yanlış susturma / söz / selam tekrarı iki kolda 0; açık kolda beyan 33/33 (kapalı 32/33), belirsiz "yarın" sorusu daha net | — |
| 6 | QR'de "müsait değil" cevabı doluluk bilgisi verir mi (Haiku P2) | Kabul edilen risk: yalnız dairede kalan, cihazı bağlı misafire, aralık başına evet/hayır; ad / fiyat / kanal yok; takvimler senkronluyken aynı bilgi OTA'nın açık takviminde de görünür | anahtar zaten kapalı; açılırsa "müsait değil" yalnız kanalda bırakılabilir (tek satır) | `AI_VERIFIED_QR_ENABLED` kapalı |
| 7 | Luna 6.0 geçişi — ilk ölçüm (konuşma durumu 46×2 + kurucu 8×2; 5.1 / Luna none / low / medium) | Cevap + anlama için **Luna `low`** öneriyorum (güvenlik ölçüleri hepsinde 0; Luna `low` 5.1'den iyi: beyan 32/33 ↔ 30/33, çıkış saati 4/5 ↔ 3/5, belirsizde hedefli soru 1–2/6 ↔ 0/6; p50 4,1 sn ↔ 2,2 sn) — ayrıntı ve ikinci dalga `docs/olcum/LUNA-GECIS-2026-10-10.md`. **10-10 kesin (4 dalga, canlı anahtarlarla doğrulandı):** cevap + anlama + bekçi Luna `low`, yeniden sıralayıcı Luna `none`, karar metni yazıcısı 5.1, çeviri Luna `medium`, üslup Luna `none`; canlıda ücret kuralı açıkken Luna'nın ücret açığı yok | kurucu "neredeyse her yerde Luna, reasoning'li" | env değeri; kod varsayılanı değişmedi |
| 8 | Karar metni yazıcısının (ev sahibinin onay / ret kararını misafire yazan katman) modeli ve düşünme seviyesi | Ayrı katman değişkeni `AI_DECISION_TEXT_MODEL` / `AI_DECISION_TEXT_REASONING_EFFORT` (boşken cevap modelinin ayarı BİREBİR — bugünkü davranış); değer önerisi `gpt-5.1` (geliştirme seti gerekçe anma: 5.1 10/14, Luna `high` 7/14, `low` 5/14, `medium` 5/11 + 7 zaman aşımı; kör kabul seti 5.1 9/10, Luna `high` 7/10, `low` 5/10, `medium` 4/10; güvenlik ölçüleri hepsinde tam — `docs/olcum/LUNA-GECIS-2026-10-10.md`) | yazıcı bugün cevap modelinin ayarını paylaşıyor; cevap için en iyi seviye (`low`) karar metni için en iyisi olmayabilir, ve karar metni ev sahibi panelde beklerken yazılır (oto-yanıt değil) | değişkenleri boş bırak |
| 9 | Müsaitlik motorunda bayat kaynağın satırı: panel çakışması "kesin" mi kalsın (açık iş: "`claimBasis` kaynak tazeliğine bakmıyor → ayrı karar") | Besleme satırı kaynağın son başarılı okumasında görülse de o okuma tazelik sınırından (6 sa) eskiyse "taze iddia" DEĞİL (motor 2): panel bayat kaynaklı çakışmayı önem 97 / "gözlendi" yerine 70 / "çıkarım" gösterir; para etkisi güveni düşer. Yapay zekâ aracı zaten bayat sonucu kesin saymıyordu (sözleşme 3: sonuç yine "bayat") | Kaynak 10 saattir okunamıyorsa arada iptal edilmiş olabilir; "kesin çift rezervasyon" demek yanlış alarm. Misafire giden hiçbir metin değişmez (yalnız daha temkinli) | `claimBasis`taki tazelik koşulu (tek satır) |
| 10 | Tarih çözümünü (`ai/date-resolution.ts`, hazırdı ama bağlı değildi) cevap istemine bağlamak; gece yarısından sonra yazılan "yarın" | (a) Anahtar `AI_DATE_RESOLUTION_ENABLED` (KAPALI) arkasında istemde "TARİH OKUMASI" bloğu: cevapsız misafir mesajlarının tarihleri KODLA, her mesaj kendi yazıldığı ana göre; yalnız olgu (gün adları, kesin / belirsiz, sabit gerekçe), davranış talimatı yok, misafirin metni girmez. (b) 00:00–04:59 arasında yazılan "yarın / öbür gün" BELİRSİZ (bir önceki gün de seçenek; açık tarih söylüyorsa o kazanır). (c) Doğrulanmış müsaitlik / uzatma göreli günü mesajın YAZILDIĞI ana göre çözer (eskiden işleme anı: 23:59'da yazılıp 00:01'de işlenen "yarın boş mu?" bir gün kayardı — anahtarlar kapalı olduğu için bugün etkisiz) | Talimatın "date resolution metadata" maddesi; (b) ve (c) doğrulanmış akışları yalnız DAHA TEMKİNLİ yapar (belirsiz → ev sahibine); (a) kör eval'le ölçülür, anahtar ancak ölçümle açılır | (a) anahtar kapalı kalır; (b)/(c) tek satırlık geri alma |
| 11 | Açık taahhüt hafızası (talimat "Benim ek önerilerim" + V2 "GUEST COMMITMENT" kartı) kodlansın mı | KODLAMADIM: yeni tablo (migration) ister, talimat "yalnız gerekçelendiğinde" ve "gelecek AI özelliklerini topluca uygulama" diyor. Seçenekli öneri yazdım: `docs/TASARIM-2026-10-10-acik-taahhut-hafizasi-onerisi.md` (önerim A: söz ev sahibinin açık işaretinden + görev bağlantısı, metin yorumu yok) | Misafire söz verilen metni yorumlamak ürün kararı; yanlış "söz" alarmı güveni bozar | — |
| 12 | Tam test koşusunda kırmızı çıkan plan sınırı yarışı (4 eşzamanlı daire eklemede 2'si geçti; `BILLING_ENFORCED` canlıda açık) — düzeltilsin mi | DÜZELTTİM (hata düzeltmesi, ürün davranışı değişmedi): sayım + oluşturma tek işlemde, kuruluş satırı kilidi altında (takvim kaynağı kotasının kalıbı); belirlenimci test eski kodda kırmızı; mutasyon 7/7 | Kurucunun onayladığı plan sınırları zaten bu davranışı istiyor; eski "oluştur, sonra fazlaysa sil" yaması yük altında delikti | `58f4163`'ü geri al |
| 13 | Getirme ölçümünde bulunan açık: Türkçe soru → İngilizce yazılmış bilgi kalemi (cevap %79 blokta, diğer yönler %98–100). Anlama katmanına İngilizce arama sorgusu eklensin mi | EKLEDİM, anahtar `AI_UNDERSTANDING_EN_QUERY_ENABLED` KAPALI arkasında: her istek `query_en` taşır, getirmeye Türkçe + özgün dil sorgularından SONRA girer. Ölçüm (geliştirme seti): 5.1 anlamayla çok sorulu 110 → 115 / 120, Türkçe → İngilizce kalem 33/41 → 39/41; Luna ile 105 → 112. Kötüleşen soru 2 (bütçe yarışı), negatif grupta gürültü artmadı. Açmayı öneriyorum (kurucu + ilk denemeler) | Getirme müşteriye giden cevabı etkiler, o yüzden anahtar kapalı; kapalıyken istem / şema / önbellek / sorgu listesi bayt bayt eski (pinli, mutasyon 13/13) | anahtar kapalı kalır |
| 14 | Luna önerisinde anlama katmanı ve yeniden sıralayıcı | Öneriyi DEĞİŞTİRDİM: ikisi de 5.1'de kalsın (env boş). Sıralayıcı: dalga 3 ölçümü tavansızdı, üretimin 2,5 sn tavanında Luna çağrılarının ~%10'u düşüyor. Anlama: getirmede iki koşuda tekrar eden 4–5 / 120 kayıp, diğer ölçülerde eşit | Ölçümle kesinleşti (`docs/olcum/RAG-AYRISTIRMA-2026-10-10.md`); tavanı Luna için yükseltmek misafirin bekleme süresini uzatır — onu önermiyorum | env değeri |

## Kurucu döndü (10-10) — cevaplar

| Konu | Kurucu kararı |
|---|---|
| Luna geçişi | ÖNERİLEN yapılandırma: cevap + bekçi Luna `low`; anlama, sıralayıcı, karar metni 5.1 (env boş); çeviri Luna `medium`; üslup Luna `none` — Railway açılınca env |
| İngilizce köprü (#13) | AÇILACAK, ilk denemelerle |
| Anahtar açma sırası | Kademeli: 1) Luna + köprü 2) tarih okuması + konuşma durumu 3) doğrulanmış müsaitlik 4) uzatma 5) QR karşılıkları |
| Açık taahhüt hafızası (#11) | **A** — söz yalnız ev sahibinin açık işaretinden + görev bağlantısı (migration 61) |
| Migration 60 | ŞİMDİ uygula + push; Railway açılmadan önce taze `pg_dump` |
| Ödeme boşlukları | Operatör alarmı + "Ödemeniz işleniyor" kilidi |
| Deneme kötüye kullanımı | İşletme kimliği (Hospitable'a DEĞİL, sağlayıcıdan bağımsız kanal bağlantısı / ilan / iCal) + risk puanı + operatör listesi + yüksek puanda kartla doğrulama |
| Uygulama sırası | Şimdi başla |

## Gece modu (10-10, kurucu: "soru sorma, Haiku'yu bol kullan, kapıları beklerken paralel iş") — karar bekleyenler

Kurucu sabah bakar; hiçbiri müşteriye giden metni / politikayı değiştirecek şekilde UYGULANMADI.

| # | Konu | Ne buldum / ne yaptım | Önerim | Karar |
|---|---|---|---|---|
| 15 | QR: konaklama başına mesaj tavanı (Haiku QR taraması F2) | Bugün yalnız IP başına 20/dk; cihazı bağlayan kişi farklı IP'lerden sınırsız mesaj YAZDIRABİLİR (her mesaj veritabanına satır; kota dolunca da "teşekkürler" / kota cevabı yazılıyor). | Konaklama başına saatlik tavan (ör. 40) + aşımda yazmadan kısa cevap + ev sahibine tek kayıt. Örnek: 41. mesaj → "Şu anda yanıt veremiyoruz, ev sahibiniz bilgilendirildi." (metin sizin onayınızla). | — |
| 16 | QR PIN kapalıyken ilk taranan cihaz konaklamayı kilitler (F3) | Eski misafir / temizlikçi QR fotoğrafıyla check-in saatinden sonra açarsa gerçek misafir "başka cihazda açık" görür. `QR_PIN_ENABLED` bilinçli kapalı (CLAUDE.md). | PIN'i açmak (ilk denemeler birlikte) ya da kapalıyken "başka cihazda açık" durumunda ev sahibine bildirim. | — |
| 17 | QR kritik (acil) e-postası tekrar seli (F4; `QR_ESCALATION_EMAIL_ENABLED` açıksa) | Tekrar bastırma yalnız SON olayı hatırlıyor; "yangın / acil 2 / acil 3" dizisi her seferinde e-posta. | Konaklama başına saatlik kritik e-posta tavanı (ör. 3) + son N olayı hatırlama. | — |
| 18 | QR: model çıktısında sır vetosu (F7) | Bilgi tabanı taranıyor ama ÇIKTI taranmıyor; ev sahibinin QR'a elle yazdığı kod geçmişten modele gidebilir. | Gönderilmeden önce çıktıda aynı tarama; eşleşirse devir. Müşteriye giden cevabı etkiler → önce/sonra örnekli onay. | — |
| 19 | QR yapay zekâ kotası işletme geneli (F8) | Bir dairenin QR'ını ele geçiren, aynı işletmenin ÖTEKİ dairelerinin QR kotasını tüketebilir. | Daire başına alt kota. | — |
| 20 | QR sır süzgeci: "Kapı açma: 4590" biçimi (F1) | Kaçıyordu (kod sözcüğü yok, bitişik değil). DAR bir kalıp hazırladım ("kapı + aç- fiili + değer"; yıl / fiyat / saat / adres ikizleri korunuyor, süre pinli). Bu, mevcut değişmezin ("QR'da kapı kodu hiçbir biçimde yok") açığını kapatan güvenlik düzeltmesi — misafire giden metni yazmaz, yalnız o kalemi QR bağlamından düşürür. | Uyguluyorum (sır süzgeci kuralı: altın set iki yönlü + süre pini); gerçek misafir külliyatında "sıfır yeni yanlış tutuş" ölçümü canlı veriyle sizin onayınızla yapılabilir. | ✅ KURUCU 10-11: "Böyle kalsın". |
| 21 | Load balancer / yatay ölçek | Ayrı LB yok, bugün gerekmiyor; 2 kopya ön koşulları yazıldı (`docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`). | Goal sonrası. | — |

| 22 | Bürünme (destek görünümü) sırasında OPERATÖR PANELİ yazmaları (Haiku operatör denetimi) | Bürünmüşken `/admin`e gidilip 2FA sıfırlama, müşteri açma, lead güncelleme, kalite denetimi yapılabiliyor; bant "salt okunur" diyor. Pin bunları "operatör paneli (kendi yetkisi)" diye muaf tutuyor; dışa aktarma ise sizin kararınızla bürünmede KAPALI. | Tutarlılık için bürünmede bütün operatör yazmaları kapansın (önce "çıkış", sonra işlem); `/admin` sayfası bürünmede kalite konsolu gibi çıkışa yönlendirsin. | — |
| 23 | Operatörün ikinci faktörü (Haiku operatör denetimi P2) | Operatör yetkisi "hesapta 2FA açık + bu cihaz güvenilen" ile de veriliyor (30 gün kayan "beni hatırla" çerezi); parola + çalınmış çerez TOTP sormadan operatör paneli açar. | Operatör hesaplarında "beni hatırla" kapalı ya da operatör yetkisi için en çok 12 saatlik taze 2FA. Giriş akışını etkiler → sizin kararınız. | — |
| 24 | Operatörün başka bir operatörün 2FA'sını sıfırlaması + lead değişikliklerinin denetim kaydı + konsolda sır maskesi | 2FA sıfırlama operatör hedefini engellemiyor; lead PATCH hiç denetim kaydı yazmıyor (kaydın işletme alanı zorunlu, lead'in işletmesi yok); kalite konsolu gönderilmiş metni maskesiz gösteriyor. | Operatör hedefine iki operatörlü onay ya da ret; operatör denetim kaydı için ayrı tablo (migration); konsolda kod / şifre değerleri maskeli + kayıtlı "ham göster". | — |

| 25 | Yapay zekâ üretim izi (taslak metin) ve kurucu etiket notu dışa aktarmaya girmiyor (Haiku KVKK denetimi B2) | Gerekçe bugün yalnız "eğitim / dışa aktarma yasağı" (migration 60 tasarımı); KVKK m.11 erişim hakkı açısından değerlendirilmemiş. Gönderilmemiş taslak hiçbir dışa aktarımda yok. | Avukat paketine soru: erişim talebinde gönderilmemiş yapay zekâ taslakları da verilmeli mi? Evetse dışa aktarmaya yalnız ilgili misafirin konuşmasına ait taslaklar (eğitim yasağı ayrı kalır). | — |
| 26 | Mülk Hafızası'nda "çelişki" (değişmez 13) hiç yazılmıyor | Şemada `contradictedById` var, hiçbir kod yazmıyor; okuma yüzeyi de süresi dolmuş kalemi ayıklamıyor (bugün süre yalnız fiyat aralığında, o da kendi okuyucusunda bayatlıkla eleniyor — davranış farkı yok). Çelişkinin TANIMI (ör. bilgi tabanı "havlu var" derken son 30 günde 3 "havlu yok" şikâyeti) bir ürün kararı. | Önce yalnız ev sahibine görünen "çelişki olabilir" işareti (yapay zekâya GİTMEZ); tanım örnekli önerilecek. | — |
| 27 | Misafire verilen sözler dışa aktarmaya eklendi (Haiku KVKK denetimi B3) | Mevcut kural uygulandı: "ev sahibinin KENDİ girdiği kayıtlar dışa aktarılır" (`hostEnteredFacts`, V2). Söz kaydı metin taşımaz (tür, son an, durum, konuşma / görev kimliği). Saklama artık oluşturma anına da bağlı (görev tarihi ileri taşınınca söz saklama süresini aşmaz). | Bilgi için — geri almak isterseniz tek satır. Metin (sizin onayınız): Ayarlar'daki "dışa aktarma neleri içerir" listesi ve misafir silme diyaloğu sözleri anmıyor (liste zaten fatura / risk / teslim kayıtlarını da anmıyordu). | — |
| 28 | Uygulamada "Hospitable" adı (talimat: "yalnız Airbnb / Booking / Vrbo düğmeleri, PMS logosu yok"; Haiku envanteri) | Logo yok (yalnız Lixus logosu). Ad ev sahibine görünen 31 yerde: 8'i bağlanmak için ZORUNLU (bağlantı düğmesi, anahtar alanı, my.hospitable.com adımları); 23'ü değil — 6 hata metni (`provider-errors.ts`; dosyanın kendi yorumu "PMS adı görünmez" diyor), konuşma / kuyruk "aboneliğiniz pasif" uyarıları, bağlantı kartı bantları ("(env)" iç terimi dahil), silme / dışa aktarma notları, landing SSS (pinli). | Köprü sürdükçe ev sahibi düzeltmeyi Hospitable'da yapıyor → ÖNCE/SONRA örneği: "Hospitable aboneliğiniz aktif değil. Kanal senkronizasyonu için…" → "Kanal bağlantınızın aboneliği aktif değil — bağlantı sağlayıcınızdaki planı kontrol edin." · "Hospitable'a şu anda ulaşılamıyor." → "Kanal şu anda yanıt vermiyor — kendiliğinden düzelir." Önerim: hata / durum metinleri sağlayıcıdan bağımsız; ad yalnız bağlantı kartının "nasıl bağlanırım" bölümünde. Landing SSS ayrı karar (ücretli plan bilgisinin dürüstlüğü). | ✅ KURUCU 10-11: "sen seç" → hata / durum / uyarı / silme-dışa aktarma metinleri sağlayıcıdan bağımsız; ad yalnız bağlantı kartı adımlarında + landing SSS'de (uygulandı, pinli). |
| 29 | Pahalı / dış etkili uçlarda hız sınırı (Haiku taraması, 49 uç; kodla doğrulandı) | Yapay zekâ maliyeti doğuran her müşteri ucu hız sınırlı + günlük kotalı; sınırsızlar iç tavanlı (bilgi tabanı yazımında embedding ısıtması saatlik süreç tavanı), imza / sır korumalı (cron, Paddle) ya da tek satır + durum korumalı (gönderim yeniden deneme). İki açık: (a) görev ATAMA e-postası tavansız — yönetici aynı görevi döngüyle yeniden atarsa personelin kutusu dolar; (b) otomatik cevap önizlemesi istek başına 12 model çağrısını kotadan 1 birim sayıyor (kodda bilinçli, yorumlu) → Başlangıç planında günde teorik 1.800 çağrı. | (a) görev başına saatte en çok 3 atama e-postası (e-posta akışı → sizin onayınız); (b) önizlemede birim = gerçek model çağrısı sayısı ya da önizleme başına günlük ayrı tavan. | ✅ KURUCU 10-11: (a) görev başı saatte 3 atama e-postası — uygulandı (pinli); (b) önizleme kotası bekliyor. |

Not: QR adresini (token) yenileme (F11) — "chatToken rotasyonu YOK (bilinçli)" kalıcı kararı var; tekrar önermiyorum. F5 (PIN kaba kuvvet) PIN açılınca önemli — 16 ile birlikte.

## Kurucu uyandı (10-11 gece) — cevaplar

- **V2 yetim boşluk satırı:** "Evet ekle yalnız … değer uydurmayalım" + "Airbnb API alınca oradan, takvimden çekeriz" → satır ana dalda
  (anahtar `ATTENTION_GAP_ENABLED`, açmak = env "1"), TUTAR YOK; gerçek gecelik fiyat Airbnb Direct takviminden gelince eklenir.
  Tasarım: `docs/TASARIM-2026-10-11-v2-yetim-bosluk.md`.
- **28 / 29a / 20:** yukarıdaki satırlarda.
- Kurucu: "gece modundasın, soru sorma; sabah ben 'sor' diyene kadar" → yeni sorular bu listeye yazılır.
- **Haiku incelemesi (10-11 gece), kararınıza:** (a) görev atama tavanı görev başına — yönetici görevi KENDİNE atadığında kendine giden e-posta
  da kovadan sayılıyor ve aynı saat içinde dördüncü FARKLI kişiye atama e-posta göndermiyor. Önerim: kendine atamada e-posta (ve sayaç) atlansın.
  E-posta akışı olduğu için uygulamadım. (b) Bağlantı kartındaki "(Hospitable üzerinden) kurun" ve plan uyarısı bağlanma adımı sayıldı, KALDI.
  (c) Adı gelmeyen ilanın varsayılan adı ("Hospitable mülkü") DEĞİŞTİRİLMEDİ: yeniden bağlanırken aynı adlı öksüz daireyi geri sahiplenme
  eşleşmesi bu adı kullanıyor; değişirse eski satır sahiplenilmez, kopya daire oluşabilir. Hospitable'da adsız ilan pratikte yok.
- **Dışa aktarma kapsamı (10-11 gece, değişmez 14 pini `data-export-coverage.test.ts`):** 43 modelin 20'si işletme dökümünde, kalanı gerekçeli
  dışarıda (sır, geçici sayaç, iç kuyruk, türetilmiş kayıt). Kararınıza iki tane: **ev sahibinin ev / erken giriş kuralları** (`AutomationRule`) ve
  **karar kartı kararları** (`DecisionRequest`) bugün dökümde yok. Önerim: "ev sahibinin kendi girdiği kayıt dışa aktarılır" kuralıyla eklensin
  (misafire giden metni etkilemez; Ayarlar'daki dışa aktarma açıklaması da güncellenir — metin sizin onayınız).

## Sabah (10-11) — kurucu cevapları ve uygulama

| # | Konu | Kurucu kararı | Uygulama |
|---|---|---|---|
| Haiku (a) | Kendine görev atama | "Kendine e-posta gitmesin" | `api/tasks/[id]`: kendine atamada e-posta YOK ve görev başı saatte 3 kovasından SAYILMAZ (`task-assign-email-cap.test.ts`). |
| Dışa aktarma | `AutomationRule` + `DecisionRequest` | "Dışa aktarmaya gerek yok" (kişisel veri değil; misafir yazışması zaten dökümde) | Gerekçeli DIŞARIDA (`data-export-coverage.test.ts`). |
| 29b | Oto-yanıt önizleme kotası | "Gerçek çağrı kadar düşsün" (önizlemeyi ileride kaldırmayı düşünüyor) | Modele giden HER konuşma bir birim (`previewBudget`, model çağrısının hemen önünde); bütçe biterse önizleme DURUR, ekranda "günlük sınır doldu · kalan konuşmalar önizlenmedi". Rota yalnız bakar. |
| 15 | QR konaklama başına mesaj tavanı | "Evet, saatte 40" + metin AYNEN | 41. mesaj: yapay zekâ çağrılmaz, mesaj kaydedilmez, misafir 429 ile "Şu anda çok fazla mesaj aldık. Ev sahibiniz bilgilendirildi; kısa süre sonra tekrar yazabilirsiniz." görür; ev sahibine saatte TEK kayıt: konuşma "Ev sahibine iletildi" işareti + karar kaydı (`stay_message_cap`) + açıksa uyarı e-postası. |
| 17 | QR acil e-postası | "Konaklama başı saatte 3" | Sahiplenmeden SONRA sayılır (aynı acil metnin tekrarı hak yemez); tavanda sahiplenme bırakılır. Misafire giden cevap değişmez. |
| 18 | QR çıktı taraması | "Taransın ama response geri dönsün … tekrar üretilsin, ev sahibine devir çok olmasın" | Cevapta DEĞER taşıyan kapı / kutu / giriş kodu → kodlu taslak hiçbir yere yazılmaz, model sabit kural notuyla BİR KEZ daha yazar (ikinci gerçek çağrı = QR kotasından bir birim); yine kodluysa devir (`door_code_in_reply`). Wi-Fi şifresi, posta kodu, telefon, saat, fiyat, değersiz anış ("kapı kodunuz Airbnb mesajında") ve bilgi tabanında zaten verilen sayı tetiklemez. |
| 19 | QR daire alt kotası | "Evet, daire başı alt kota" | Her daire QR payının en çok "eşit payın İKİ katı" (1–2 dairede sınır yok). Pro 7 daire → 43/gün, İşletme 25 daire → 36/gün. Taşma işletmenin QR sayacına dokunmaz. |
| 22 | Destek görünümünde operatör yazmaları | "Kapat, önce çıkış" | 2FA sıfırlama, müşteri açma, lead, kalite denetimi, başka hesaba geçiş, deneme istisnası: "Bu işlem operatörün kendi hesabından yapılır — önce destek görünümünden çıkın." `/admin` destek görünümünde yalnız bu notu gösterir. Resmî talepte dışa aktarma: önce çıkış, sonra operatör panelindeki "Dışa aktar" (bugünkü gibi). |
| Wi-Fi | QR'da kod kuralı | "Kapı kodu yok, Wi-Fi verilsin" | `wifi` kategorisindeki, kapı / kutu / kilit / PIN / kod izi taşımayan kalem QR'a girer ("Wi-Fi kodu" kapı izi sayılmaz); `checkin` kategorisi ve öteki kategorilerdeki her sır kalıbı bugünkü gibi düşer. Rezervasyon öncesi kanal konuşmasında Wi-Fi YİNE verilmez. İstem kuralı: Wi-Fi yazılabilir, kapı / bina / tuş paneli kodu ASLA. |
| Wi-Fi metinleri | Misafir notu + gizlilik | Not: "yalnız kapı kodunu ansın"; gizlilik: "Wi-Fi şifresi yer alır, cümleyi güncelle, paketi güncelle" (henüz onay alınmadı) | Misafir notu: "Otomatik asistan + ev sahibi. Kapı kodu gibi giriş bilgileri güvenlik için burada paylaşılmaz." Gizlilik md.15 güncellendi, `LEGAL_VERSION` 2026-10 / "Ekim 2026"; avukat paketi (HTML + PDF) QR bölümüne güncelleme notu. Ev sahibi ekranlarındaki iki açıklama da kurala uyduruldu. |

Not: QR canlı ölçüm geliştirme setindeki `qd-wifi-tr` beklentisi yeni kurala çevrildi (Wi-Fi şifresi verilmeli, kapı kodu verilmemeli). Kör kabul seti
(`qr-live-acc1`) AÇILMADI — yeni kurala göre güncellenmesi sizin / ölçüm turunun işi.

### Haiku incelemesi (10-11 sabah, 12 bulgu) ve kurucunun ek kararları

| Bulgu | Hüküm | Uygulama |
|---|---|---|
| 1 (P1) Wi-Fi kaleminde "Bina / çöp odası şifresi 4590" geçiyordu | DOĞRU | Wi-Fi kalemindeki her şifre değeri aynı cümlede bir Wi-Fi adına bağlı olmalı (`wifiSecretsAttributed`); iz listesine bina / apartman / site / otopark / garaj / çöp odası / depo / asansör eklendi. |
| 2 (P1) Önizleme sağlayıcı çökükken de birim yakıyordu (08-01 olayının dönüşü) | DOĞRU | Önizleme canlı oto-yanıtla AYNI sayım: önce bakılır, model gerçekten cevap verince düşülür. |
| 3 / 11 Cevap taraması: geniş muafiyet, "4 5 9 0", yıl / fiyat yanlış tutuşu | DOĞRU (kısmen) | Kapı bağlamlı kalıplarda bilgi tabanı muafiyeti yok; ayraçlı rakam yakalanır; "2019'da" / "1500 TL" tetiklemez. "dört beş dokuz sıfır" ve "4590 3 numaralı kapı" biçimleri bilinen sınır (geçmiş artık gizlendiği için kaynağı kapandı). |
| 4 Geçmişteki ev sahibi kodu modele gidiyordu | Kurucuya soruldu → "Evet, gizle" | Ev sahibi / yapay zekâ satırlarında kapı kodu değeri "(kod gizlendi)"; misafirin gördüğü geçmiş değişmez. |
| 5 Acil e-posta sayacı başarısız gönderimde yanıyordu | DOĞRU | Yalnız GİDEN e-posta sayılır. Tavanda operatöre hata bildirimi eklenmedi (tavan bilinçli karar). |
| 6 41. mesaj acilse | Kurucuya soruldu → kurucu 112 satırının kendisini kaldırdı | Tehlikede misafire hiçbir şey gitmez (aşağıda). Tavan istisnası gerekmedi: tavandaki misafir zaten metin görüyor, ev sahibi uyarılıyor. |
| 7 Tavan tekrar denemeleri sayıyordu | DOĞRU | Tavan istek kimliği sahiplenmesinden SONRA; tavanda sahiplenme bırakılır. |
| 8 Tavan bildirimi hata verirse genel 500 | DOĞRU | Bildirim yazımı try/catch; misafir onaylı metni yine alır, hata raporlanır. |
| 9 "Her model çağrısı bir birim" yorumu yanlıştı | DOĞRU (yorum) | Sayım canlıyla aynı: modelin cevap yazdığı her konuşma bir AI işlemi; yorumlar düzeltildi. |
| 10 KVKK dışa aktarma değişikliği "onaysız" | YANLIŞ | Kurucunun açık cevabı: "dışa aktarmaya gerek yok". |
| 12 Küçükler | Kısmen | Eski yorumlar (kb-warm, kb-from-templates) düzeltildi; birim test veritabanına gitmiyor. Sahiplenme bırakmanın 5 dk saati silmesi ve alt kotanın reddedilen denemeyi sayması bilinçli bırakıldı (etkisiz). |

**Kurucu (10-11):** "112'yi arayın yazmasın … yönlendirme olmayacak hiçbir şekilde; sadece sorulursa numarasını verebilir" → tehlikede misafire
**hiçbir şey** gitmez (kurucu seçti), ev sahibine acil uyarı; istemdeki gaz örneği ve şikâyet katmanı satırı yönergesiz; modelin kendiliğinden
yazdığı "112'yi / polisi / acil servisi arayın" QR'da bir kez yeniden yazdırılır, yine varsa devir (`emergency_directive`), kanalda çıktı vetosu.
**Açık (öneri bekliyor):** "ambulans / polis numarası ne?" sorusunda resmî numaraların koddan beslenmesi + bağlam (hastaya numara ver, ev sahibini
şikâyete gidiyorsa bırak) ve Luna 6.0'ın bu ayrımı ölçümü; bilgi tabanında olmayan yer önerisi (rakipler ne yapıyor). Öneri belgesi hazırlanıyor.

### Haiku ikinci incelemesi (10-11, 10 bulgu)

| Bulgu | Hüküm | Uygulama |
|---|---|---|
| 1 (P1) "Wi-Fi şifresi 12345678, bina şifresi 4590" — ikinci şifre aynı cümledeki Wi-Fi'ye yaslanıp geçiyordu | DOĞRU | **Etiket kuralı** (`secretLabels`): her şifre / kod sözcüğünün hemen önündeki etiket (en yakın virgül / nokta / satır sonu ya da önceki şifrenin değerinden sonrası) Wi-Fi adı taşımalı; etiket boşsa yalnız karttaki İLK şifre Wi-Fi sayılır. Kalem süzgeci, cevap taraması ve geçmiş gizleme aynı kuralı kullanır. |
| 2 Cümle sınırı gerçek kartları düşürüyordu ("Wi-Fi adı: LaleNet. Şifre: gunes1907") | DOĞRU | Etiketsiz ilk şifre kartın devamı sayılır (pinli). |
| 3 Yer adları ("Lale Sitesi Wi-Fi", "Apartman Wi-Fi") kartı düşürüyordu | DOĞRU | Yer adları iz listesinden çıkarıldı (onların şifresini etiket kuralı yakalar); "ağ / WPA / güvenlik anahtarı" iz sayılmaz. |
| 4 112 yönergesi yanlış tutuşları ("acil durumda bizi arayın", "Daire 117'de") | DOĞRU | Yönerge = arama fiilinin NESNESİ acil servis / numara (Türkçede ≤2 sözcük önce, öteki dillerde ≤3 sözcük sonra); "bizi / us" nesnesi, daire / kat / dahili numarası hariç; tek başına "emergency" servis sayılmaz. |
| 5 Kaçan yazımlar (çağırın, telefon edin, Вызовите, بالإسعاف, Wählen, policía) | DOĞRU | Fiil / servis listeleri genişledi; aksan ve hemze katlanır. 23 olumlu + 13 olumsuz örnek pinli. |
| 6 Acil e-posta tavanı eşzamanlılıkta aşılabiliyordu | DOĞRU | Hak göndermeden ÖNCE atomik ayrılır, e-posta gitmezse geri verilir (eşzamanlı 6 acil → en çok 3 e-posta, pinli). |
| 7 Gizleme değeri her yerde değiştiriyor ("Havlu ücreti 4590 TL") | Kısmen | Bilinçli bırakıldı: yalnız modele giden geçmiş kopyasında, güvenli yön. Rezervasyon / onay kodu artık kapı kodu sayılmaz. |
| 8 "4590 kapı kodudur" kaçıyordu; 24k üstü gizleme açık kalıyordu | DOĞRU | Değer-önce kalıbı eklendi; sınır üstü fail-closed (her 4–8 hane gizlenir). "45 90" / "4.5.9.0" bilinen sınır. |
| 9 "Wi-Fi: LaleNet, çamaşır odası kodu: 4590" geçiyordu | DOĞRU | Etiket kuralıyla düşer (pinli). |
| 10 Eski "güvenlik satırı" yorumları | DOĞRU | Kod, test ve bağlayıcı belgelerde güncellendi. |

### Kurucu (10-11 öğleden sonra) — bekleyen kararların cevapları

| Konu | Kurucu | Durum |
|---|---|---|
| Acil numara sorusu | "Önce ölçüm sonra kod; Luna 6.0'a yaptıralım (5.1 pahalı); model olarak da Luna'yı tercih edelim, iyiyse" | Ölçüm seti `evals/emergency-number.json` (33 senaryo) + `tests/eval/emergency-number.eval.test.ts`; Luna 6.0 `low`, 2 tekrar. Sonuç ve kod önerisi ayrıca sorulacak. |
| Yer önerisi (bilgi tabanında yok) | B1 — ev sahibi döngüsü. Kurucu notu: "model ilk başta hostun bütün mesajlarını tarıyor, cevabı yüksek ihtimalle bulur" | ⚠️ Düzeltme (kodda ölçüldü): model ev sahibinin TÜM mesajlarını taramıyor — yalnız AYNI sohbetteki önceki cevaplar (istem KURAL-1 kaynak 3). Geçmiş ev sahibi cevaplarından bilgi tabanı önerisi (Bacak B) 09-11 kurucu kararıyla KAPALI (`KB_HISTORY_SUGGESTIONS_ENABLED`). Bugün gelen kutusundaki taslakta "Eksik bilgi: …" satırı var ama "bilgi tabanına ekle" yolu yok. B1 tasarımı + örnek ekran getirilecek (harita servisi ayrı karar). |
| Operatör "beni hatırla" (karar 23) | "Böyle kalsın" | Değişiklik yok. |
| QR ilk cihaz kilidi (karar 16) | "QR PIN'i kapatmam ki, bayrakla ilgili dimi" | Evet: `QR_PIN_ENABLED` ortam bayrağı (canlıda bugün KAPALI). Açmak = Railway açılınca env "1" + ilk denemeler birlikte; açıkken konaklamayı yalnız PIN'i bilen cihaz bağlar, kilit sorunu kalmaz. Kod değişikliği gerekmiyor. |

### Kurucu (10-11 akşam) — ölçümden sonra

| Konu | Kurucu | Uygulama |
|---|---|---|
| Acil numara | "Acil numara 112 değil ki, her tür için ayrı; bayrak arkasında uygula; model nasıl hata yapıyor, neden, neyden etkilendi açıklasın" | `ai/emergency-number.ts` + QR rotası, anahtar `AI_EMERGENCY_NUMBER_ENABLED` KAPALI. Servis başına numara (ambulans 112 · polis 155 · jandarma 156 · itfaiye 110). Modelin açıklaması: `docs/olcum/acil-numara-2026-10-11-gpt-6-luna-mv3u05l3-aciklama.md` ("polisi arayacağım / numara ne?" ifadesi onu "acil"e çekmiş; tekrar bakınca şikâyet etiketini kendisi koyuyor — sonradan açıklama, iç nedenin kanıtı değil). Kural: anlama niyeti + koddan ev sahibi sözcüğü + konaklama konusu → ölçüm setinde 62/62 doğru karar. |
| Ev sahibinin kendisi tehdit | "Size kalsın" | Numara verilmez, ev sahibine kalır (ev sahibi sözcüğü bacağı). |
| Yer önerisi B1 | "İkisini de yap" | Gelen kutusunda "Eksik bilgi" → "Bilgi tabanına ekle" (form ön dolu, ev sahibi kaydeder) + mülk sayfasında "Son 30 günde N misafir çevre önerisi sordu — 'Yerel Tavsiye' ekleyin". Harita servisi önerisi (B3) ayrı karar. |
| Test hatalarının nedeni | "Hata olunca hemen nedenini gör; önerdiğin döngü gibi olsun" | `tests/eval/failure-analysis.ts`: ① modelin açıklaması (ipucu) ② karşı deneme (ifade çıkar, aynı katman yeniden; tetikleyici = bütün tekrarlarda düzelen) ③ düzeltme katmanı önerisi (kanıt önce) ④ doğrulama (aynı vakalar + kör set). Acil numarada ilk sonuç: h4 tetikleyici "Polisi arayacağız" (0/2 → 2/2) → istem; h1 / h12 kararsız → model sınırı. Kural `CLAUDE.md` Çalışma tarzı. |
| Anlama istemine şikâyet tehdidi kuralı | "Bayrakla ekle + ölç" | `AI_UNDERSTANDING_THREAT_RULE_ENABLED` (KAPALI). Geliştirme 62/62 (kapalı 58/62), kör set acc1 anlama 18/18 (kapalı 16/18), tehlikeli hata 1 → 0. ⚠️ Açıkken model anlaşmazlıklarda "acil" etiketini düşürüyor (24/24; önizlemede "acil kalkmaz" demiştim). Kurucu: "ev sahibi eve girdi" türü → acil, misafire hiçbir şey gitmez (bugünkü davranış, rota testiyle pinli; kural açıkken de acil kalıyor). Anlaşmazlıkta "acil"in düşmesi = AÇIK KARAR; anahtarı açmak kurucunun. |
| Kör set acc1 hataları | — | Ürün kararı kapalı 15/18, açık 16/18; kalan 2 kodun "hangi numarayı arayayım?" sorusunu tanımaması + 1 "güvence parası / itiraz" kaçışı. Yalnız a1 / a4 / a10 açıldı (`seen`), iki genel kod kuralı (servis adsız soru yalnız acil bağlamda; depozito eş anlamlıları + itiraz) → kayıtlı niyetlerle 18/18, görülmemiş 15/15. Kör set 2 (acc2) kurucu onayıyla ölçülüyor. |
| Acil numara kanal yolu | "Şimdilik yalnız QR" | Değişiklik yok. |
| Kör set 2 (acc2) | "Evet, yeni kör set" | 20 görülmemiş senaryo, iki kol: ürün 14/18 ikisinde de, 🚨 anlaşmazlıkta numara 0; anlama kuralı kapalı 15/18, açık 18/18. Kalan 4 hata kodun numara sorusu tanıyıcısı (who do I call · 112 mi 155 mi · acil hattı hangisi · "Ambulans?"); yalnız b2/b5/b7/b9 açıldı (`seen`), genel kurallar → kayıtlı niyetlerle 18/18, görülmemiş 14/14. |
| Haiku 3. tur (8 bulgu) | — | Doğru: başarısız çağrı paydadan düşüyordu · "2.kattan" bölünüyordu · ifade yalnız ilk geçişte, sınırsız siliniyordu · model beyanı kanıtı eziyordu · "hangi numaralı daire" numara sorusu sayılıyordu · acil bağlamda taksi / doktor numarası 112 alıyordu · çıplak "teminat" sigorta anlamında meşru acili durduruyordu · son koşu ada göre seçiliyordu → hepsi düzeltildi + pinli (mutasyon 17/17). 🚨 EN ÖNEMLİ: ölçer ve neden analizi anlama katmanını yalnız **öğe** kipinde çağırıyordu, canlı **öğe + ev kuralı + şikâyet takibi** kipinde → bugünkü ölçüm sayıları canlı istemle alınmadı; ölçer artık ürünle aynı bayrak fonksiyonlarından kipi alır. Canlı kipte yeniden ölçüm = kurucu onayı. Kısmen: "itiraz / dispute" kaldı (hedef anlaşmazlık; tıbbi acilde geçmesi zorlama örnek). |
| Haiku (iki tur) | — | 1. tur 6 bulgu (5'i doğru, 1'i temiz): bitişik "Evsahibi", "manager / landlady", "geri ödemezseniz" kaçıyordu; "numara 5'teki komşu", "Polis kaç dakikada gelir?", "call the police about the noise" numara sorusu sanılıyordu; ev sahibi e-postası "yanıtlamadı" diyordu; rapor satırı yoktu → hepsi düzeltildi + pinli. 2. tur 5 bulgu (hepsi doğru): eksik bilgi özeti adrese giriyordu (misafir adı taşıyabilir → oturum belleği); yenilemede odak zıplıyordu; "Polis numara 155 mi?" / "Police contact?" kaçıyor, "5 numaralı daire" soru sanılıyordu; "Booking'den geldik, annem fenalaştı" ve yabancının "tehdit"i numarayı haksız durduruyordu → düzeltildi. Mutasyon üç tur: 24/28 → 37/38 → 19/19 (yaşayanlar pinlendi). |

