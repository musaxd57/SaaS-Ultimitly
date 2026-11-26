# Tasarım 2026-11-18 — "Ödeme alındı, abonelik bekleniyor" kalıcı durumu (Codex 11-17, 1. bulgu)

> Kaynak: `docs/KURUCU-TALIMATI-2026-11-18-codex-raporu-ve-orkestrasyon.md` satır 18 ("ödeme alındı, abonelik bekleniyor kalıcı bir durum
> olmalı. Ekrandaki bekleme süresinin dolması, yeniden ödeme izni vermemeli"). Şema DEĞİŞMEZ. Anahtar yok: düzeltme iki kipte de
> (`PADDLE_CHECKOUT_INTENT_ENABLED` açık / kapalı) geçerlidir. Para akışı → ilk canlı / sandbox denemesi kurucuyla birlikte.

## 1. Bugün ne var, açık nerede (kodda doğrulandı, 957e91c1)

"Ödeme alındı" bilgisi yalnız **10 dakikalık kilitte** yaşıyor (`SystemLock checkout-pending:<işletme>`, `lib/billing/checkout-pending.ts`):

| Kip | Kilidi kim yazar | 10 dk sonra |
|---|---|---|
| Niyet AÇIK | işlem olayı / sunucunun Paddle okuması (`settlePaidIntent`: kilit + niyet "completed") + istemci sinyali | kilit düşer; niyet kapalı; canlı abonelik yoksa **yeni Paddle işlemi açılır** |
| Niyet KAPALI (açılış varsayılanı) | **yalnız istemci** (`checkout.completed` → `api/billing/checkout-pending`); işlem olayı kilit YAZMAZ (niyet satırı yok) | aynı |

Abonelik olayı 10 dakikada bağlanmazsa (Paddle gecikmesi, web kancası arızası, olay "bağlanamadı / inceleme", işleyici hatası → yeniden
işleme eşikleri 15 dk – 256 sa) müşteri ikinci kez ödeyebilir. İkinci abonelik ilkinin yerine geçer ya da ikisi birden faturalanır;
ilk abonelik hiç bağlanmadıysa "ikinci abonelik" alarmı da doğmaz.

## 2. Tasarım

### 2.1 Kalıcı kayıt (şemasız)
`CheckoutIntent` satırı ödeme defteridir. Durum kümesi genişler (sütun metin, migration yok; tablo canlıda boş):

`opening · open` → **`completed` = ödeme alındı, abonelik bekleniyor** → `fulfilled` (abonelik hesaba bağlandı) ya da `released`
(ödeme geçersiz: aboneliği Paddle'da iptal edilmiş / operatör serbest bıraktı). Öteki kapanışlar aynen: `canceled · expired · failed`.

`completed` satırı olan işletmeye **süre sınırı olmadan** yeni ödeme ekranı açılmaz. Kilit (10 dk) kalır: istemci sinyaliyle sunucunun
ödemeyi görmesi arasındaki köprü ve ucuz ilk bakış.

### 2.2 "Ödeme alındı" yalnız SUNUCUNUN doğruladığı kaynaktan kalıcılaşır
1. **İşlem olayı** (`transaction.paid / completed`): niyet satırı varsa `completed` olur — kapanmış ama ödenmemiş satır (süresi dolmuş, iptali
   doğrulanamamış) dahil: "Paddle ödendi diyor" yerel kapanışa baskındır. Satır yoksa (niyet kapalı kip — işlemi istemci açtı) olayın
   onay kaydından (`custom_data.consentId` → `CheckoutConsent` → işletme; onayın yaşı aranmaz, işletme onay satırından gelir) satır yazılır.
   Yalnız ödeme ekranı işlemi: köken `web` / `api` (yenileme, plan değişikliği, ek tahsilat işlemleri ASLA kayıt açmaz); köken alanı yoksa
   işlemin aboneliği yerelde bağlı değilse.
2. **Sunucunun Paddle okuması** (niyet kipi: süpürge / onay rotası) — bugünkü `settlePaidIntent`.
3. **İstemci sinyali + doğrulama** (`api/billing/checkout-pending`): istemci işlem kimliğini de gönderir; sunucu Paddle'dan okur — durum
   ödenmiş VE işlemin onay kimliği isteğin onayıyla aynıysa kayıt yazılır. Web kancası tamamen kapalıyken de kalıcı durum oluşur. Okunamazsa
   bugünkü gibi yalnız 10 dk kilit (istemcinin sözüyle kalıcı kilit YAZILMAZ — hatalı sinyal müşteriyi kalıcı kilitlemesin).

### 2.3 Çıkış (kalıcı durum ancak kanıtla kapanır)
- **Bağlandı** (`fulfilled`): (F1) aynı onay kimliğini taşıyan abonelik olayı abonelik satırına yazıldı · (F2) işlem olayındaki abonelik
  kimliği yereldeki abonelikle aynı · (F3) uzlaştırma: Paddle'daki işlemin abonelik kimliği yereldeki abonelikle aynı (durumu ne olursa
  olsun — sonradan iptal edilmiş abonelik eski kaydı "bekliyor" bırakıp yeni satın almayı kilitlemesin).
- **Geçersiz** (`released`): uzlaştırma — işlemin Paddle'daki aboneliği İPTAL edilmiş (operatör iptal + iade etti) · operatörün elle
  serbest bırakması (denetim kaydıyla).
- Paddle okunamıyor / işlemi bulamıyor → durum DEĞİŞMEZ (ödeme kanıtı elde; belirsizlikte ikinci ödeme açılmaz).
- Süreyle kapanış YOK. 90 günlük saklama süpürgesi `completed` satırı silmez.

Uzlaştırma (en çok iki Paddle okuması: işlem → abonelik) iki yerde koşar: müşteri engellendiği anda (onay rotası; kullanıcı başına
saatte 20 istek sınırının içinde) ve saatlik süpürgede (alarmdan önce — yanlış alarm olmasın).

### 2.4 Görünürlük
- **Müşteri**: ilk 10 dk bugünkü metin ("Ödemeniz işleniyor…"). Sonrası YENİ metin (kurucu onayına): "Ödemeniz alındı, aboneliğiniz henüz
  hesabınıza tanımlanmadı. Lütfen yeniden ödeme yapmayın; kısa sürede tanımlanmazsa bize yazın." Ayarlar › plan kartları bu sürede kilitli.
- **Operatör**: 15 dakikadır bekleyen ödeme için geçiş tabanlı alarm (işletme, işlem, Paddle'daki durum, yapılacak iş); Operasyon Teşhisi'nde
  "ödemesi alınan, aboneliği bağlanmayan" listesi + "serbest bırak" düğmesi. Bağlanınca / serbest kalınca alarm kapanır.

## 3. Reddedilen seçenekler
- **Kilidi uzatmak (ör. 24 sa / 3 gün):** süre hâlâ yeniden ödeme izni verir (Codex'in itirazı); kısa tutulursa açık, uzun tutulursa
  hatalı istemci sinyali müşteriyi günlerce kilitler.
- **Kalıcı kilidi istemci sinyaliyle yazmak:** doğrulanmamış söz kalıcı engel olur.
- **Yeni tablo / sütun (`CheckoutConsent.paidAt`, `fulfilledAt`):** daha okunaklı ama migration ister; aynı davranış var olan tabloyla
  kuruluyor. Migration turunda yeniden değerlendirilebilir (kazanç: abonelik kimliğini satırda tutmak → F2/F3 Paddle okumasız).
- **Abonelik olayı gelmezse Paddle'dan çekip aynı işleyiciden geçirmek (kendiliğinden kurtarma):** en iyi uzun vade budur ama yeni bir
  para yolu mekanizması → ayrı anahtar + sandbox denemesi + kurucu onayı (soru Ö-2). Bu dilim yalnız "ikinci ödeme açılmasın + görünür olsun".

## 4. Paddle varsayımları (sandbox'ta doğrulanacak — `PADDLE-VARSAYIM`)
- `GET /transactions/{id}` yanıtı `status`, `subscription_id`, `custom_data`, `origin` taşır (belge: `subscription_id` "paid"de boş
  olabilir, "completed"de dolu; köken değerleri `web · api · subscription_recurring · subscription_update · subscription_charge ·
  subscription_payment_method_change`). Belgeler bu oturumdan okunamadı (ağ izni); arama özetinden alındı.
- Paddle.js `checkout.completed` olayı `data.transaction_id` taşır. Taşımıyorsa 2.2-3 çalışmaz, 2.2-1 ve kilit yine çalışır.
- Yanlış çıkarsa en kötü sonuç: uzlaştırma karar veremez → kayıt bekler → operatör alarmı + elle serbest bırakma (ikinci ödeme yine açılmaz).

## 5. Bilinen sınırlar
- Niyet kapalı kipte iki sekmede AÇILMIŞ iki ödeme ekranı ikisi de ödenebilir (işlemi istemci açar) — bu, niyet anahtarının çözdüğü ayrı
  açık; kalıcı durum yalnız SONRAKİ açılışı engeller.
- Abonelik önce, ardından yalnız `transaction.paid` (abonelik kimliği boş) gelirse kayıt bir süre "bekliyor" görünür; canlı abonelik
  kontrolü zaten önce gelir, süpürge / engel anı uzlaştırması kaydı kapatır.

## 6. Kurucu soruları
- **Ö-1 (müşteri metni):** 2.4'teki yeni cümle uygun mu?
- **Ö-2 (kendiliğinden kurtarma):** abonelik olayı 15 dk gelmezse sistemin aboneliği Paddle'dan okuyup kendisi bağlaması (anahtarlı,
  önce sandbox). Örnek — bugün: müşteri öder, olay kaybolur, operatöre alarm gelir, elle "yeniden gönder" gerekir. Öneri: sistem 15. dakikada
  aboneliği okur, bağlar, alarm yalnız bağlayamazsa gider.
- **Ö-3 (migration turu):** abonelik kimliğini ödeme kaydında tutan sütun (Paddle okumasını azaltır) migration turuna girsin mi?
