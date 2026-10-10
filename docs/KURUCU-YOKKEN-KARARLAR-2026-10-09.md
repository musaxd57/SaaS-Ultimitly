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
| 20 | QR sır süzgeci: "Kapı açma: 4590" biçimi (F1) | Kaçıyordu (kod sözcüğü yok, bitişik değil). DAR bir kalıp hazırladım ("kapı + aç- fiili + değer"; yıl / fiyat / saat / adres ikizleri korunuyor, süre pinli). Bu, mevcut değişmezin ("QR'da kapı kodu hiçbir biçimde yok") açığını kapatan güvenlik düzeltmesi — misafire giden metni yazmaz, yalnız o kalemi QR bağlamından düşürür. | Uyguluyorum (sır süzgeci kuralı: altın set iki yönlü + süre pini); gerçek misafir külliyatında "sıfır yeni yanlış tutuş" ölçümü canlı veriyle sizin onayınızla yapılabilir. | — |
| 21 | Load balancer / yatay ölçek | Ayrı LB yok, bugün gerekmiyor; 2 kopya ön koşulları yazıldı (`docs/TASARIM-2026-10-10-load-balancer-yatay-olcek.md`). | Goal sonrası. | — |

Not: QR adresini (token) yenileme (F11) — "chatToken rotasyonu YOK (bilinçli)" kalıcı kararı var; tekrar önermiyorum. F5 (PIN kaba kuvvet) PIN açılınca önemli — 16 ile birlikte.
