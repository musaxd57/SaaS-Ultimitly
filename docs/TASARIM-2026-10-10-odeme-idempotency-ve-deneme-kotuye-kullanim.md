# Ödeme idempotency + deneme (trial) kötüye kullanımı — durum ve öneri (kurucu: "sonradan bakılacak, unutma")

> Kurucu (10-10): "Ödeme almada idempotency'de iyi miyiz? … Free trial'ı kötüye kullanmasınlar; şu an IP tutuyoruz ama aynı Wi-Fi (otel)
> olabilir … bir risk skoru kur … goal hedefinden sapmadan bunlara sonradan bakmamız gerek, unutma." KOD YAZILMADI; bu belge iki Haiku
> taramasının kodda doğrulanmış özeti + öneridir. Ödeme / kimlik akışı → uygulama kurucu onayı + ilk denemeler birlikte.

## 1. Ödeme idempotency — durum: İYİ (üç küçük boşluk)

Videodaki desen (istemci `Idempotency-Key` başlığı gönderir, sunucu aynı anahtarı görünce önceki sonucu döndürür) ödemeyi BİZİM sunucumuza
POST eden sistemler içindir. Bizde tahsilatı Paddle'ın ödeme ekranı (overlay) doğrudan yapar; sunucumuz kart çekmez. Aynı korumanın bizdeki
karşılıkları:

| Yol | Tekilleştirme | Aynı istek iki kez gelirse |
|---|---|---|
| Paddle webhook | `WebhookEvent.providerEventId @unique` + "işlendi" ise erken dönüş (`api/webhooks/paddle/route.ts`) | ikinci teslim `duplicate: true`; yarıda kalan olay yeniden işlenir (işleyiciler idempotent) |
| İmza / tekrar saldırısı | HMAC-SHA256 + `timingSafeEqual` + ±5 dk pencere (`lib/payments/paddle.ts`) | geçersiz imza 401, eski zaman damgası red |
| Fatura | `Invoice @@unique([provider, providerRef])` (Paddle işlem kimliği) + P2002 yutulur | tek fatura |
| Plan değişikliği | önizleme jetonu HMAC + `jti` TEK KULLANIM (SystemLock) + bekleyen kilit + uygulama öncesi tutar kontrolü; zaman aşımında yeniden göndermez, durumu okur | aynı jeton ikinci kez 409 |
| Abonelik satırı | `Subscription.organizationId @unique` + `occurred_at` koruması + K4 kimlik kapısı (eski iptal yeni aboneliği ezmez) | yeniden uygulanır, zararsız |

**Boşluklar (kodda doğrulandı):**
1. **İkinci aktif abonelik sessizce ilkinin yerine geçer** (`route.ts` K4 satırı): aynı işletme webhook gelmeden önce ikinci bir ödemeyi
   tamamlarsa yeni abonelik kaydedilir, ilki Paddle'da faturalanmaya devam edebilir ve ALARM YOK. Öneri: operatör alarmı (müşteriye etkisi
   yok) — "kayıtlı aktif abonelik farklı bir aktif abonelikle değişti".
2. **Çift ödeme ekranı penceresi** (`api/billing/consent` + `paddle-plans.tsx`): "zaten aktif abonelik var" kontrolü yalnız webhook'un yazdığı
   satıra bakar; ödeme biter bitmez (webhook gelmeden) ikinci sekmede yeni ödeme ekranı açılabilir. Öneri: ödeme başarılı dönünce plan
   düğmeleri "Ödemeniz işleniyor" ile kilitlenir + sunucuda son 10 dk içinde tamamlanmış ama henüz bağlanmamış ödeme varsa yeni onay
   kaydı verilmez.
3. **Test eksikleri:** aynı `event_id`'nin EŞZAMANLI iki teslimi · aynı işlemin iki farklı `event_id`'si · fatura P2002 dalı · eşzamanlı iki
   onay (consent) isteği. (Kod doğru görünüyor; kanıtı yok.)

## 2. Deneme kötüye kullanımı — durum

- **Deneme başına IP engeli YOK.** Tek IP sınırı kayıt hız limiti: aynı IP'den saatte 5 kayıt (`register/route.ts`, IPv6 /64). Otelde
  aynı Wi-Fi'deki iki gerçek ev sahibi ikisi de kayıt olabilir; yalnız saatte 6. kayıt 1 saat bekler.
- Aynı kişi yeni e-postayla yeni 14 gün alabilir: e-posta yalnız küçük harf + kırpma; `ad+1@gmail.com` ayrı hesap. Tek kullanımlık
  e-posta alan adı listesi, CAPTCHA, risk puanı, cihaz parmak izi YOK. E-posta doğrulaması ŞART (gerçek posta kutusu gerekir).
- **Doğal işletme kimliği:** Hospitable ilan kimliği GLOBAL eşsiz — aynı ilan ikinci bir kuruluşa bağlanamaz. Ama Hospitable HESABI ve iCal
  takvim URL'si kuruluşlar arasında kontrol edilmiyor; silinen hesabın kimliği (tombstone) yeni kayıtta bakılmıyor.
- Kazanç: 14 gün Pro (7 daire, günde 500 yapay zekâ işlemi); nakit yok, maliyet bizim OpenAI faturamız. Deneme bitince oto-mesaj, yapay zekâ,
  QR ve yeni daire kapanır (`BILLING_ENFORCED`).
- ⚠️ Önceki karar: **"kanonik posta kutusu kayıt limiti" ve `emailCanonical` kolonu REDDEDİLMİŞ** (`docs/claude/kalici-kararlar.md`
  "Ret edilenler"). Aşağıdaki öneri onu ENGEL olarak geri getirmez; yalnız puan sinyali olarak sorar.

## 3. Öneri (kurucunun öneri biçimiyle)

**Büyük şirketler böyle yapıyor:** Stripe Radar / Sift gibi sistemler tek sinyalle karar vermez; sinyalleri toplayıp bir PUAN çıkarır ve
puana göre kademeli davranır (izin ver / ek doğrulama iste / insana göster). Videodaki "ask for a number, not a verdict" budur.

**Önerim — iki aşama, cihaz parmak izi YOK:**
1. **İşletme kimliği (en güçlü, KVKK riski en az):** aynı Hospitable hesabı, aynı ilan ya da aynı iCal URL'si DAHA ÖNCE başka bir kuruluşta
   deneme kullandıysa yeni kuruluş ikinci deneme almaz — bağlantı adımında plan seçmesi istenir (engel değil, ödeme yolu). Otel Wi-Fi'sinden
   etkilenmez; kiralama işinin gerçek kimliği budur.
2. **Risk puanı (0–100, yalnız kayıt anında):** sinyaller — e-postanın posta kutusu karşılığı (`+etiket` / Gmail noktası) başka hesapta var mı ·
   tek kullanımlık e-posta alanı · aynı IP'den son 24 saatte kayıt sayısı (TEK BAŞINA belirleyici değil) · silinmiş hesapla eşleşme. Puan
   eşiğin üstündeyse ENGELLEME yok: deneme kısalır (ör. 3 gün) ya da kartla doğrulama istenir; operatör panelinde "riskli kayıtlar" listesi.
3. **Cihaz parmak izi (tarayıcı, ekran, yazı tipleri, canvas):** ŞİMDİLİK YAPMAYALIM — kişisel veri; AB'de (.eu açılışı) ePrivacy açık rıza
   ister, Türkiye'de aydınlatma metni değişir (avukat paketi). Etkisi işletme kimliğinden düşük.

**Örnekler (önce → sonra):**
- Deneme biten ev sahibi yeni Gmail ile kayıt olup AYNI Hospitable hesabını bağlıyor → bugün: yeni 14 gün · önerilen: "Bu ilanlar daha önce
  bir deneme hesabında kullanıldı; devam etmek için plan seçin."
- Otelde aynı Wi-Fi'den iki farklı ev sahibi kayıt oluyor → bugün ve önerilen: ikisi de normal deneme (IP tek başına puanı eşiğe taşımaz).
- `ad+3@gmail.com`, aynı IP'den 10 dakikada 3. kayıt → bugün: normal deneme · önerilen: puan orta → deneme başlar, operatör listesinde görünür;
  puan yüksekse (silinmiş hesapla da eşleşiyorsa) deneme 3 gün.

**Kurucuya sorular:** (a) İşletme kimliği kuralı (1) uygulansın mı? (b) Risk puanında posta kutusu eşleşmesi sinyal olarak kullanılabilir mi
(önceki ret engel içindi)? (c) Eşik üstü davranış: kısa deneme mi, kartla doğrulama mı, yalnız operatör listesi mi? (d) Ödeme boşlukları 1–2
için alarm + "ödemeniz işleniyor" kilidi yapılsın mı?

## 4. KURUCU KARARI (10-10, döndüğünde)

- **Ödeme:** operatör alarmı + "Ödemeniz işleniyor" kilidi — YAPILACAK (ilk denemeler kurucuyla).
- **Deneme:** işletme kimliği kuralı + risk puanı + operatör listesi + yüksek puanda kartla doğrulama — YAPILACAK. Kısa deneme (3 gün) seçilmedi.
- 🚨 **Kurucu düzeltmesi: "İlerde Hospitable gidecek, Hospitable üzerine kurmuş gibi yapma."** İşletme kimliği Hospitable HESABINA bağlanmaz;
  sağlayıcıdan bağımsız: kanal bağlantısının hesap kimliği (`ChannelConnection`; Airbnb Direct / Booking / bugünkü köprü), ilan kimliği
  (migration 60 `ChannelListing`), iCal takvim adresi. (Kendi kuralımız zaten buydu — "Hospitable'a özgü özellik yapılmaz" — önerirken çiğnedim.)
- **Sıra:** şimdi başla — önce ödeme alarmı + kilit, sonra migration 60 uygulanır (ilan kimliği ona dayanır; Railway açılmadan önce taze yedek),
  sonra deneme işletme kimliği, sonra risk puanı + kartla doğrulama.
