# Derin ajan turu — 2026-11-04 (kurucu: "5 çok derin agent … didik didik … acele etme")

> 5 derin inceleme ajanı (AI akışı · sayfa geçişleri + görsel · siber güvenlik · müşteriye görünen Türkçe · Haiku 5.5 + yeni özellikler)
> AYNI ANDA koştu; her birinin bulguları ayrı bir **çürütücü doğrulayıcı** ajanla kodda sınandı, öncelikli olanlar ana oturumca da açılıp
> doğrulandı. Ana oturum paralelde: `prompts.ts` incelemesi, API alma adımları, ileri özellikler. Ham dosyalar (iç, repoya girmez):
> scratchpad `derin-2026-11-04/` (0–5 + `*-dogrulama.md`). Güvenlik ayrıntısı bu PUBLIC repoya YAZILMADI — yalnız özet.

## 0. Rakamlarla

| Alan | Bulgu | Doğrulamada | Kritik | Yüksek |
|---|---|---|---|---|
| AI akışı | 12 + 5 şüphe | hiçbiri tamamen yanlış değil; 3 kısmen, 1 şüphe etkisiz | 0 | 3 (F2 canlı yol, F3, F5 uyarı kısmı) |
| Sayfa geçişleri + görsel | 19 | 18 doğru, 3 kısmen, 0 yanlış; birkaçının ciddiyeti düştü | 0 | 0 |
| Siber güvenlik | 5 + 2 yeni | 5/5 doğru; hepsi kapalı anahtar arkasında | 0 | 0 |
| Müşteriye görünen Türkçe | 45 (+ 4 kaçırılan) | 21 önemli bulgunun hiçbiri çürümedi; 8 kısmen | — | 3 (T-22, T-09, T-10) |
| Haiku 5.5 + yeni özellik | 14 katman kararı + 10 özellik | iki kod iddiası ana oturumca doğrulandı | — | — |

## 1. Bu turda YAPILANLAR (müşteriye giden metne dokunmaz; kurucu kuralı 09-27 "kolay + doğru → yap, haber ver")

Her biri: kırmızı-önce test → düzeltme → tam mutasyon (koşucu `scripts/mutation-run.mjs`, hepsi öldürüldü) → tip denetimi + lint.

| Commit | Ne | Neden (bulgu) | Mutasyon |
|---|---|---|---|
| `c1c20568` + `f845224c` | Karar yazıcısı Claude modelinde ama Anthropic anahtarı yok / kalıcı red → açılış UYARISI + çalışma anı ALARMI (metin yine onaylı şablon) | Ajan 5: sessiz şablona düşüş — onaylanan Haiku geçişi fark edilmeden hiç çalışmayabilirdi | 7/7 (ilk koşuda M4 yaşadı → test güçlendirildi) |
| `a1406093` | Japonca / Çince / Korece klavyede aday seçen Enter mesajı yarım GÖNDERMEZ (misafir QR sohbeti, ev sahibi QR cevap kutusu, ana sayfa demosu; Safari keyCode 229 dahil) · Pano telefonda yana KAYMAZ | Ajan 2 S-13 + doğrulayıcı K-4 · S-18 (Raporlar'daki 10-22 hatanın eşi) | 7/7 |
| `3a5154c4` | Bilgi tabanı dışa aktarma başka siteden tetiklenince 403 (saatlik hak yanmaz, denetim kaydına sahte satır düşmez) | Ajan 3 S-04 | 3/3 |
| `184fd14e` | Kalıcı kuyruk: model düşünürken ev sahibi yazdıysa bayat AI cevabı GİTMEZ (çift cevap yok) · teslim + onarıcı "Cevaplandı" çapası içeri alınma anına da bakar | Ajan 1 F1 + F2-ek (bugün kuyruk KAPALI; açılmadan önce kapı) | 4/4 |
| (ölçüm) | İstek 11 sonuçları ölçüm raporuna (§8): Haiku karar yazıcısı ÜRÜN YOLUNDA kör 29/30, geliştirme 40/40, sızıntı 0 | — | — |

Geri çekilen öneri: ana oturumun "WhatsApp'ta günlük özet" önerisi kurucunun 10-09 "şimdilik yok" kararıyla çakışıyordu (ajan 5 yakaladı).

## 2. KURUCUYA SORULAR (önce / sonra örnekli; müşteriye ya da misafire gideni değiştirir)

### S1 — Gönderim sırasında yazılan misafir mesajı kayboluyor (AI akışı F2 — CANLI YOL, en önemlisi)
- **Bugün:** 10:00 misafir "Wi-Fi şifresi?" → AI cevabı hazırlanırken 10:03 misafir platformda "Mutfakta duman var, alarm çalıyor" yazar → AI
  10:04'te Wi-Fi cevabını gönderir → sonraki senkron 10:03 mesajını içeri alır ama sıralamada AI cevabından ÖNCE kaldığı için konuşma
  "Cevaplandı" olur → **acil uyarısı gitmez, AI görmez, gelen kutusunda "Cevaplandı".**
- **Önerim:** içeri alınırken "bizim son cevabımızdan SONRA içeri alınan misafir mesajı" konuşmayı "Yeni" yapar (elle gönderim yolunun bugünkü
  kuralının senkron eşi) → acil ağı ve oto-yanıt onu normal yeni mesaj gibi görür. Sonra: aynı senaryoda ev sahibine acil uyarısı gider,
  konuşma "Yeni" görünür. Böyle yapalım mı?

### S2 — QR'da açık tehlike: misafire de ev sahibine de hiçbir şey gitmiyor (F3 — doğrulandı)
- **Bugün:** QR'dan "Prizden kıvılcım çıkıyor" → misafire cevap yok (K10 kararı: devir cümlesi gitmez), ev sahibine e-posta yok
  (`QR_ESCALATION_EMAIL_ENABLED` kapalı), WhatsApp yolu yok. Belgeler çelişkili: sabah raporu 10-01 "açın" diyor, açılış belgesi "açmayın".
- **Önerim:** `QR_ESCALATION_EMAIL_ENABLED=1` (açılışta) — ev sahibine "⚠️ Acil misafir mesajı" e-postası (kanal yolundaki gibi; WhatsApp
  hibrit açılınca o da). Misafire giden metin DEĞİŞMEZ. Açalım mı?

### S3 — "Tamamlandı" yapılmış konuşmaya yeni mesaj sessiz (F5 — uyarı kısmı doğrulandı)
- **Bugün:** ev sahibi konuşmayı Tamamlandı yapar → misafir ertesi gün "Su basıyor" yazar → AI cevap vermez (07-26'dan beri bilinçli), **acil /
  şikâyet uyarısı da gitmez** (bilinçli değil). Mesaj "Tümü" listesinin üstüne çıkıyor ama bildirim yok.
- **Önerim:** yalnız UYARI kısmı: kapalı konuşmaya gelen yeni mesaj acil ağına bakılır (oto-yanıt kapalı kalır). Böyle yapalım mı?

### S4 — Tek konuşmadaki hata bütün otomasyonu durduruyor (F6 + doğrulayıcı K3)
- **Bugün:** bir konuşmada beklenmeyen hata → o geçişte işletmenin TÜM oto-yanıtları + karşılama + giriş talimatı + çıkış mesajları durur; her
  2 dakikada aynı konuşma yine patlarsa hiç gitmez.
- **Önerim:** konuşma başına hata yakalama + alarm; patlayan konuşma ev sahibine kalır (işaretlenir), diğerleri devam eder. Dikkat (K3): gönderim
  başarılı olup kayıt düştüyse ikinci cevap riski — yakalayıcı "gönderim yapıldı mı" izine bakmalı (tasarım notu yazılır). Yapalım mı?

### S5 — Platform dışı ödeme cevabında anlam hatası (prompts.ts KURAL-4 + ÖRNEK 20)
- **Bugün öğretilen:** "IBAN'dan ödesem?" → "Ödeme ve rezervasyon işlemlerinin platform üzerinden yürütülmesi gerekiyor; **bu konu ev sahibinizin
  kararıdır.**" — "ev sahibinin kararı" demek "isterse IBAN olur" kapısını aralık bırakır (taslak ev sahibine gösterilir, elle gönderilebilir).
- **Önerim:** "Ödeme ve rezervasyon işlemleri yalnız platform üzerinden yapılabiliyor." Değiştirelim mi? (istem değişikliği → ücretli ölçüm)

### S6 — İstem v2 (prompts.ts yapısal — ücretli A/B gerekir)
- Taban cevap istemi "Mesajınız kaydedildi; ev sahibiniz görebilir" cümlesini 43 kez, "ev sahibinizin kararıdır" kalıbını 30 kez öğretiyor;
  K10 (09-30) ve 10-01 kararlarınızdan beri bu cümleleri taşıyan cevap misafire GİTMİYOR → model kendi cevabını tutulmaya mahkûm ediyor;
  11 yama katmanıyla kapatılıyor. Örneklerde kurala aykırı 7 cümle var (duygu beyanı "It's lovely to hear from you again", uydurma süreç
  "entry details are only ever shared … before your arrival" vb.).
- Ajan 5 ek: Haiku cevap katmanı ölçümü bütün bayraklar KAPALIYKEN yapılmış — yani bu eski istemle. "Haiku kural çiğniyor" sonucunun bir kısmı
  istemden.
- **Önerim:** kurallarınızı tabana işleyen tek, sade istem (v2) + açılış bayraklarıyla A/B (Luna ve Haiku, geliştirme + kör set). Ölçüm koşalım mı?

### S7 — Anlama isteminde çelişki (ajan 5 — ana oturumca doğrulandı; v2 kuralının kalan tek hatası)
- `semantic/understand.ts:157` (öğe kipi, canlıda açık): "bozuk şeyi nasıl düzeltirim" isteği `fix_request` + `appliance_help` diyor; v2 kuralı
  (`:77`) "dumanda ASLA appliance_help" diyor. 5.1'in 74'te kalan tek hatası tam burası ("Isınmıyor, prizden duman çıkıyor" → acil + kullanım).
- **Önerim:** ilişki satırına "duman / kıvılcım / yanık kokusu → acil, fix_request değil" ayrımı + aynı 74 vaka yeniden ölçüm (ücretli, ~$1).

### S8 — Ekranda yanlış açıklamalar (Türkçe — doğrulandı; ev sahibi / ziyaretçi görür)
| ID | Bugün | Önerim |
|---|---|---|
| T-22 | Ayarlar: misafire "(…bir hata olursa ekibimiz hemen düzeltir.)" notu gider diyor — bu söz 08-08'de kaldırıldı | "Otomatik gönderilen cevapların sonuna "(Bu yanıt otomatik asistan tarafından hazırlandı.)" notu eklensin." (notun kendisinden tek kaynak) |
| T-09 | "AI bir yanıtta en güncel 30 kaydı okur" (KB sayfası + fiyat tablosu) — 09-11'den beri yanlış | KB: "…konu konu ayrı kayıtlara bölün; AI her soruda en ilgili kayıtları seçer." · fiyat satırı: kurucu kararı |
| T-10 | Landing şikâyet rozeti "Yatıştırır + bilgi toplar", "misafir beklemede kalmaz" (K10'dan beri misafire bir şey gitmiyor) | rozet "Taslak hazırlar, size bırakır" · "misafir beklemede kalmaz" çıkar |
| T-14 | "Soruların sizin üslubunuzla yanıtlanır." | "Sorular sizin üslubunuzla yanıtlanır." |
| K-1 | SSS "Lixus AI yalnızca misafir mesajlarınızı okur" (rezervasyon, mülk, takvim de okunur) | "Lixus AI misafir mesajlarını, rezervasyon ve daire bilgilerinizi okur; …" (gizlilik metniyle aynı) |
| T-28 | Varsayılan giriş şablonu "Kapı kodunu aşağıda bulabilirsiniz" deyip Wi-Fi basıyor (misafir görür, ev sahibi seçerse) | kapı kodundan hiç söz etmeyen giriş metni (doğrulayıcı: "ayrıca ileteceğim" SÖZ olur, kullanılmaz) |
Tam liste (45 + terim sözlüğü 24 kavram): iç dosya `4-musteri-turkcesi.md` + doğrulaması. Önerim: yüksek + orta olanları tek dilimde, pinli
metinler (ör. "Bağlantı hatası", "Oto-yanıt testi") ayrı onayla.

### S9 — 2FA ekranı (sayfa S-19 — doğrulandı, sunucu güvenli)
- **Bugün:** 2FA açıkken ekranda aynı etiketli iki "Mevcut kod" kutusu; üstteki 2FA'yı onay penceresi olmadan kapatıyor (sunucu geçerli kod
  istiyor — güvenlik açığı DEĞİL, ekran tuzağı). Kurulumda karekod yok (anahtar 32 karakter elle yazdırılıyor; `qrcode.react` zaten bağımlılık).
- **Önerim:** kutulara ayrı etiket ("2FA'yı kapatmak için kod" / "…"), kapatmada onay penceresi, kurulumda karekod. Yapalım mı?

### S10 — Diğer ev sahibi ekranı düzeltmeleri (doğrulandı)
- S-07: Oturumu düşmüş sahip "deneme bitti" e-postasındaki bağlantıyla girince planlar yerine AI ayarlarını görüyor (`?tab=` kayboluyor; şifre
  değişiminden sonra bağlantının tamamı kayboluyor — K-1). → giriş sonrası tam adrese dön.
- S-08: "Taslağı kullan" / şablon, ev sahibinin yazdığı metni sormadan siliyor. → kutu doluysa "Yazdığınız metin değiştirilsin mi?" onayı.
- S-10: Başlarken 1. adım iCal kullanıcısını yalnız Hospitable kartına götürüyor. → iki seçenekli bağlantı.
- S-16: Hesap silindikten sonra hiçbir onay görünmüyor. → kısa onay sayfası.

### S11 — WhatsApp ev sahibi döngüsü (güvenlik — anahtarlar AÇILMADAN önce; ayrıntı iç dosyada)
- Numara bağlama akışına iki sertleştirme (yeniden doğrulama + hesap sahibine bildirim e-postası), numaraya "bu numara bağlandı; siz değilseniz
  DUR yazın" mesajı, gizlilik metnine Meta / WhatsApp alt işleyeni (açılış listesine ön koşul olarak).
- Ev sahibinin WhatsApp cevabından misafire giden metinde iletişim süzgeci bazı biçimleri kaçırıyor (çıplak alan adı, hane hane telefon,
  "at … dot"). Dikkat: "8+ rakam = telefon" kuralı Wi-Fi şifresini de yakalar → tasarımla. Airbnb kuralı uyumu.

## 3. Haiku 5.5 — katman başına karar önerisi (ajan 5; fiyatlar Anthropic resmî sayfalarından)
| Katman | Öneri |
|---|---|
| Karar yazıcısı | Haiku'da kal ✅ (bu turda alarm eklendi); `usage` kaydı + uzun boşluk sonrası ilk çağrı süresi ölçümü |
| Cevap | Luna kal; Haiku'yu açılış bayraklarıyla + istem v2 ile YENİDEN ölç (S6) |
| Anlama | 5.1 kal; önce çelişki (S7), sonra şema sırası (bağlam alanları etiketten önce) |
| Yeniden sıralayıcı | 5.1 kal (ölçüldü: Haiku geride ve ucuz değil) |
| WhatsApp cevap kurucu | EN GÜÇLÜ yeni Haiku adayı (karar yazıcısıyla aynı yapı + ev sahibi önizlemesi); önce şema sırası "plan → metin" |
| Bekçiler | Haiku adayı — gerekçe sağlayıcı çeşitliliği ("bekçi ≠ yazarın sağlayıcısı"); misafir metni taşıdığı için gizlilik metni kararı şart |
| Kalite denetçisi | Opus 4.8 → Opus 5.5 |
| Gölge sınıflandırıcı / hazırlık özeti | gpt-5.6-luna → gpt-6-luna (yarı fiyat) |
| Altyapı | yapılandırılmış çağrılar kullanım (token) döndürmüyor → canlıda yalnız ana cevabın maliyeti görünüyor; `usage` alanı eklenmeli |
KVKK sınırı: gizlilik sayfasındaki Anthropic satırı bugün yalnız karar metnini kapsıyor; misafir metni okuyan her yeni Haiku işi o satırın
genişlemesini (kurucu + avukat) ister.

## 4. Yeni özellik önerileri (öncelik sırasıyla; hepsi ÖNERİ)
1. **Fotoğraf mesajı kaybolmasın** — yalnız fotoğraf gönderen misafirin mesajı içe alınmıyor (bilinçli karar, "veriyle karar" sayacı var:
   `hospitable-sync.ts` `messagesUnimportable`) → yer tutucu satır ("📷 Misafir fotoğraf gönderdi — platformda görün") + acil ağı. Karar sizin.
2. Gönderilen her AI cevabına gece "ikinci göz" (Haiku Toplu API, ayda ~$0,1) — kapının kaçırdığını görmek; Airbnb başvurusu için kanıt.
3. Taslak kabul ölçümü + düzenleme nedeni (taslak zaten saklanıyor).
4. Anlama sonucunu Mülk Hafızası'na bağlamak (tekrar eden arıza tespiti).
5. WhatsApp sesli not → misafire cevap / görev.
6. Airbnb / Booking'in kendi otomatik yanıtıyla çakışma denetimi.
7. Kullanım kanıtı paneli (operatör) — Airbnb başvurusunun eksik §10'u.
8. Kimlik bildirimi (KBS) hazırlık hatırlatıcısı — önce hukuk görüşü.
9. Mal sahibine aylık rapor. 10. Bilgi tabanında mevsim / tarih tazeliği taraması.

## 5. API alma — adımlar (öncelik sırasıyla)
1. **WhatsApp Cloud API (en yakın; kod hazır, anahtarlar kapalı):** Meta işletme doğrulaması → geliştirici uygulaması (Business) → WhatsApp'ta
   kayıtlı OLMAYAN Lixus hattı → görünen ad onayı → 3 Utility şablonu onayı → sistem kullanıcısı kalıcı belirteci (yıllık gözden geçirme) →
   Railway env + web kancası → gizlilik metni (Meta) → ilk deneme birlikte. Ayrıntı: `docs/TASARIM-2026-10-30-whatsapp-ev-sahibi-dongusu.md` §9.
2. **Anthropic:** ayrı çalışma alanı + ayrı anahtar + aylık harcama sınırı (karar yazıcısı kuruş düzeyi).
3. **Airbnb:** herkese açık API yok; program ortaklığı (NDA + veri güvenliği incelemesi). Eksikler: canlı demo kiracı, 3 ay kullanım kanıtı,
   bağımsız sızma testi, `security@` posta kutusu, CSP script-src, hukuk metninde köprünün "zorunlu" yazmaması. Dosya taslağı hazır
   (`docs/AIRBNB-INTEGRATION-DOSSIER.md`).
4. **Booking.com:** yeni bağlantı sağlayıcı alımı duraklatılmış görünüyor; açılsa bile fiyat / müsaitlik yönetimi ön koşul.
5. **Ara yol (karar sizin):** sertifikalı kanal yöneticisi API'si (ör. Channex) Hospitable köprüsünün yerine — 10-21 strateji notunda açık
   soru; Airbnb MESAJLAŞMA kapsamı belgelenmemiş → ücretsiz deneme hesabıyla ölçülebilir (kod yok).

## 6. Kalan (bu turun dışında, takipte)
F1-ek (satır içi yolda saniyelik pencere + Airbnb uygulamasından yazılan ev sahibi cevabı) · F4/K5 (QR'da ev sahibi devraldıktan sonra olası
tehlike) · F7 (QR saatlik tavan metni — iki doğrulayıcı farklı okudu, yeniden bakılacak) · F8/F9 (karar kartı + kuyruk birleşimi; anahtarlar
kapalı) · Ş1/Ş2 (belirsiz teslim sonrası ikinci gönderim riski — sağlayıcı davranışı ölçülmeli) · sayfa düşük bulguları (S-02…S-06, S-11,
S-14, S-15 erişilebilirlik, S-17) · Türkçe düşük bulgular + terim sözlüğü.
