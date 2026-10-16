# Deneme (trial) kötüye kullanımı — derin araştırma ve kartla doğrulama tasarımı (2026-10-15)

> Kapsam: salt okuma. Kod değiştirilmedi, test / DB koşulmadı. Kaynak: `docs/TASARIM-2026-10-10-odeme-idempotency-ve-deneme-kotuye-kullanim.md`,
> `src/lib/billing/trial-identity.ts`, `src/lib/billing/trial-risk.ts`, kayıt rotaları + web kaynakları (her iddianın yanında).
> Durum: TAMAMLANDI — bölümler 0–6.

## 0. Bugün ne var (kodda doğrulandı)
- Deneme kimliği (migration 61, `TRIAL_IDENTITY_ENABLED` KAPALI): ilan numarası / takvim jetonu HMAC özeti; ikinci hesapta görülürse
  deneme o an biter (ücretsiz sürüm, operatör istisnası var).
- Risk listesi (yalnız operatör): ilan tekrar 60 · geçici e-posta 30 · 24 sa+ doğrulanmamış e-posta 10. Eşik yok, otomatik işlem yok.
- Kartla doğrulama: YOK (kurucu: "önce yalnız liste").

## 1. Hâlâ açık olan kapılar (kodda ölçüldü)

Önce bir rakam: kötüye kullanılan bir deneme bize ne kadara patlar?
- Pro deneme: 7 daire, günde 500 yapay zekâ işlemi (`plan-limits.ts` `aiCallsPerDay: 500`).
- Ölçülmüş maliyet: bugünkü 5.1 hattı ≈ **$0,013 / misafir mesajı** (`docs/SABAH-RAPORU-2026-10-01.md` satır 703, kör set 12).
- Gerçekçi kötüye kullanan (10 daire, günde ~30 misafir mesajı): 14 gün × 30 × $0,013 ≈ **$5–6** OpenAI maliyeti.
  Üst sınır (her gün 500 işlemin tamamı): 14 × 500 × $0,013 ≈ **$91**.
- Asıl kayıp gelir: denemeyi döndüren ev sahibi ayda ₺899 (Pro) ödemiyor → her 14 günde ≈ ₺450 kayıp.
- Sonuç: tek tek ucuz; zararı "ödeyecek müşterinin ödememesi". Savunma ucuz ve meşru müşteriyi üzmeyen olmalı.

### 1.1 Yalnız Hospitable ile bağlanan hesap (iCal yok) — KİMLİK BOŞLUĞU: TAM AÇIK
Kodda ölçülen:
- `trial-identity.ts` `DIRECT_PROVIDER_PLATFORM` yalnız `airbnb / airbnb_direct / booking / booking_direct` içerir.
  `channelListingIdentityKey("hospitable", …)` → **null**. Yani Hospitable ile bağlanan hesap için HİÇ kimlik yazılmaz (bilinçli:
  köprünün kendi mülk numarası kimlik değildir — kurucu kuralı).
- Üstelik ilan kaydı (`recordChannelListings`, `channels/metadata.ts`) `CHANNEL_METADATA_WRITE=1` ister — o da KAPALI. Doğrudan Airbnb
  adaptörü ağa çıkmıyor. Yani anahtar açılsa bile bugün kimliğin TEK canlı kaynağı iCal okumasıdır.
- 09-19 yedek manifesti: **`CalendarSource = 0`** (org 9 · mülk 11). O verilerle `TRIAL_IDENTITY_ENABLED=1` açılsaydı kural
  **sıfır** hesabı kapsardı — bugünkü müşterilerin tamamı Hospitable köprüsüyle (ya da elle) çalışıyor.
- Kazara kısmi koruma: `Property.hospitableId` GLOBAL `@unique`. İlk hesap yaşarken ikinci hesap AYNI Hospitable hesabını bağlarsa
  `linkProperty` P2002'ye çarpar, daireler bağlanmaz (deneme işe yaramaz + operatöre hata). AMA ilk hesap dairelerini ya da hesabını
  silerse kolon boşalır → yeni hesap aynı Hospitable'ı bağlar → **yeni 14 gün, hiçbir iz yok**.
- Kapatma yolu (sağlayıcıdan bağımsız kurala UYGUN): Hospitable API'si mülkün bağlı olduğu GERÇEK kanal ilanlarını verebiliyor —
  `GET /properties?include=listings` → her ilan için `platform` (airbnb / booking / homeaway) + `platform_id`. Kimlik yine
  `airbnb:<ilan no>` olur (köprünün numarası DEĞİL, Airbnb'nin numarası); köprü kalkınca da aynı kimlik doğrudan bağlantıdan gelir.
  Kaynak: üçüncü taraf SDK `keithah/hospitable-python` (`models.py` `Listing{platform, platform_id, platform_name, platform_email}`,
  `API.md` "GET /properties?include=listings,user"). **Canlı API'de DOĞRULANMADI.**
- 🚨 Engel: bizim OAuth kapsamımız `property:read reservation:read message:read message:write` (`hospitable-oauth.ts:132`) —
  `listing:read` YOK. OAuth ile bağlı mevcut hesaplar ilan listesini göremez; kapsam eklemek = müşterinin yeniden onay vermesi.
  Kişisel erişim jetonu (PAT) "Read" ile muhtemelen görür (doğrulanmadı).
- `platform_email` alanı (ev sahibinin Airbnb hesap e-postası) güçlü bir kimlik olurdu ama kişisel veri + Hospitable'a özgü →
  ÖNERMİYORUM.

### 1.2 E-posta takma adları (Gmail noktası / `+etiket`) — SAYILIYOR, PUANA GİRMİYOR
- Kimlik: `normalizeEmail` yalnız kırp + küçük harf. `ad+1@gmail.com`, `a.d@gmail.com`, `ad@gmail.com` = üç ayrı hesap, üç deneme.
- `canonicalMailbox()` var (Gmail noktası + `+etiket` atar) ama YALNIZ operatör panelindeki "aynı kutudan çok hesap" kanaryasında
  sayı olarak (`admin/page.tsx:142-154`). **`trialRisk()` bu sinyali KULLANMIYOR** — "Riskli denemeler" listesinde görünmez.
- Kanarya sınırları (ölçüldü): `take: 5000` + yalnız bugün yaşayan sahipler. Silinen hesabın e-postası hiçbir yerde kalmaz →
  "hesabı sil, aynı adresle (ya da takma adla) yeniden kaydol" görünmez.
- `canonicalMailbox` boşlukları: `ad@googlemail.com` ile `ad@gmail.com` AYNI kutudur ama alan adı birleştirilmiyor → ayrı sayılır.
  Outlook / Hotmail / Yandex / iCloud / Proton `+etiket` destekler — bunlar için de `+` atılıyor (doğru). Yahoo "-anahtar" takma adı,
  iCloud "E-postamı Gizle", DuckDuckGo / SimpleLogin / addy.io yönlendiricileri ve kendi alan adında "her adres bana gelsin" (catch-all)
  → **hiçbir kanonikleştirme yakalayamaz**. Takma ad savunması yalnız tembel kötüye kullananı yakalar.
- Önceki ret: `emailCanonical` kolonu + "kanonik posta kutusu kayıt limiti" REDDEDİLDİ (`kalici-kararlar.md` satır 56). Aşağıdaki öneri
  engel değil, PUAN sinyali (kurucu 10-10 sorusunu (b) hâlâ cevapsız).
- Ek bulgu: **hesap silme → aynı e-postayla yeniden kayıt = yeni 14 gün.** `deleteAccountData` kullanıcıyı siliyor, e-posta için
  hiçbir iz (tombstone) kalmıyor; `ErasureTombstone` yalnız misafir verisi içindir. Deneme kimliği (ilan) yetimleşip yakalar — ama
  yalnız iCal'li hesapta.

### 1.3 Geçici e-posta listesi tazeliği — ÇOK ESKİ / ÇOK KISA
- Bizim liste: elle yazılmış **49 alan adı** (`trial-risk.ts`), 10-10'dan beri değişmedi (git: `b38ea60`, `309eae6`).
- Topluluk listesi `disposable-email-domains/disposable-email-domains` (bugün indirildi): **9.892 alan adı**, son işlem
  **2026-10-15 10:31** (aynı sabah 5 işlem — günde birkaç kez güncelleniyor).
- Ölçüm: bizim liste topluluk listesinin **44 / 9.892 ≈ %0,44**'ünü kapsıyor. Bizdeki 5 alan adı onda yok (`temp-mail.io`,
  `tempmail.com`, `tempmail.net`, `spamgourmet.com`, `burnermail.io` — ikisi aslında takma ad servisi, "geçici" değil).
  Örnek kaçanlar: `tmpmail.org`, `tmailor.com`, `guerrillamail.info`, `1secmail.org`, `emailnax.com`, `fexpost.com`, `10mail.org`.
- Yanlış pozitif kontrolü: topluluk listesinde gmail / hotmail / outlook / yandex(.com.tr) / mynet / icloud / yahoo / proton /
  superonline / ttmail / turk.net **YOK** (ölçüldü) → Türk ev sahibinin olağan adresi işaretlenmez.
- Not: geçici e-posta servisleri günde yeni alan adı açıyor; statik liste her zaman geride kalır. Ama kayıt e-posta DOĞRULAMASI
  istiyor; doğrulanmamış hesap GİRİŞ YAPAMAZ (`needsEmailVerification`) → geçici e-posta yine de çalışan bir posta kutusu olmalı.

### 1.4 "Google Takvim'den yeniden yayınlama" kaçışı — AÇIK (bilinçli)
- `icalIdentityKey()` yalnız Airbnb (`/calendar/ical/<no>`), Booking (`?t=`), VRBO / HomeAway (`/icalendar/<jeton>.ics`) tanır.
  Diğer her adres → null. `calendar.google.com/calendar/ical/…/basic.ics` → kimlik yok.
- Aynı kaçış: herhangi bir ara servis (başka bir kanal yöneticisinin dışa aktardığı iCal, kendi sunucusu, Hospitable'ın kendi
  dışa aktarımı). Kısaltıcı (bit.ly vb.) zaten çalışmaz — iCal okuyucu yönlendirme izlemiyor (3xx hata).
- Bedeli: kötü niyetli kişi Airbnb takvimini Google'a ekleyip Google'ın "gizli iCal adresini" verir → yeni deneme. Bunu bilen
  kişi az; ama kaçış tek adım.
- Kapatma fikri (öneri, §4 dilim 4): takvim İÇERİĞİNDEN kimlik — Airbnb takvim satırlarındaki rezervasyon kodları / UID'ler
  (`…@airbnb.com`) Google'dan geçince de çoğunlukla korunur. Ama bu misafir rezervasyonuna bağlı veri (KVKK: dolaylı kişisel veri)
  → yalnız özet + yalnız "örtüşme var mı" sinyali, kimlik değil. Kurucu sorusu.

### 1.5 Aynı kişinin birden çok hesabı — BUGÜN NE DURDURUYOR?
| Saldırı | Bugün | Neden |
|---|---|---|
| Yeni e-posta + aynı Airbnb iCal | yeni 14 gün | `TRIAL_IDENTITY_ENABLED` kapalı (açılınca yakalanır) |
| Yeni e-posta + aynı Hospitable (ilk hesap yaşıyor) | daireler bağlanmaz | `hospitableId @unique` çakışması (kazara) |
| Yeni e-posta + aynı Hospitable (ilk hesap silinmiş) | yeni 14 gün | kimlik yok (1.1) |
| Hesabı sil + AYNI e-postayla kayıt | yeni 14 gün | e-posta izi yok (1.2) |
| `ad+2@gmail.com` | yeni 14 gün | yalnız kanarya sayar |
| Geçici e-posta | yeni 14 gün, listede görünür (listedeyse) | yalnız liste |
| Takvimsiz, elle rezervasyon + QR | yeni 14 gün | hiçbir kimlik yok |
| Aynı IP'den 6. kayıt / saat | 1 saat bekler | `register:<ip>` 5/saat (IPv6 /64) |
- CAPTCHA yok, telefon yok, cihaz parmak izi yok, kart yok. Kayıt e-posta doğrulaması ŞART (bot için tek gerçek engel).
- Kayıt IP + tarayıcı bilgisi ZATEN saklanıyor (`User.acceptedIp`, `acceptedUserAgent` — KVKK onay kanıtı amacıyla). Bunu risk
  puanına kullanmak AMAÇ DEĞİŞİKLİĞİ olur (KVKK md. 4 "amaçla bağlantılı") → aydınlatma metni güncellemesi ister.

## 2. Kartla doğrulama tasarımı (Paddle)

### 2.1 Paddle ne sunuyor (web kaynaklı; Paddle belgeleri bu ortamdan doğrudan açılamadı — arama özetleri)
- Üç deneme türü: **kartlı ücretsiz**, **kartlı ücretli** (2026'da açıldı), **kartsız** (hâlâ erken erişim, bekleme listesi; yalnız API ile
  açılır, Paddle ödeme ekranıyla açılamaz; Paddle bu denemeler için hatırlatma e-postası atmıyor).
  [create-trial](https://developer.paddle.com/build/trials/create-trial) ·
  [paid-trials 2026](https://developer.paddle.com/changelog/2026/paid-trials) ·
  [cardless-trials](https://developer.paddle.com/build/trials/cardless-trials) ·
  [cardless preview 2025](https://developer.paddle.com/changelog/2025/cardless-trials-developer-preview)
- Deneme FİYATIN üstünde tanımlanır: `trial_period` + `requires_payment_method` (+ ücretli denemede `trial_period.unit_price`).
  Denemeli fiyat ile normal aylık fiyat AYNI `price_id` → bizde ayrı bir fiyat kimliği gerekir (ör. `PADDLE_PRICE_PRO_KARTLI_DENEME`).
- Kartlı denemede abonelik `trialing` doğar; `next_billed_at` günü kayıtlı karttan çekilir, `active` olur. Deneme günü PATCH
  `next_billed_at` ile uzatılır / kısaltılır (en az 30 dk ileri, `proration_billing_mode: do_not_bill`); `items[].trial_dates.ends_at`
  güncellenir. [extend-activate](https://developer.paddle.com/build/trials/extend-activate-change-date-trials)
- Paddle, 7 günden uzun denemede bitişten en az 7 gün önce müşteriye hatırlatma e-postası atar; kart ağı kurallarını kendisi uygular.
  [trials concept](https://developer.paddle.com/concepts/subscriptions/trials/)
- Paddle'ın kendi önerisi: **ücretli deneme** (küçük tutar) "kötüye kullanımı azaltır" (paid-trials changelog).
- **Sıfır tutarlı yetkilendirme (₺0 kart doğrulama):** Paddle'da ayrı bir uç / özellik BULAMADIM. Kartlı ücretsiz denemede bankaya
  ₺0 ya da küçük tutarlı ön provizyon yapılıp yapılmadığı, Türk kartlarında 3D Secure istenip istenmediği belgelerde yok →
  **Paddle'a sorulacak.** Genel bilgi: bazı bankalar ₺0 doğrulamayı reddeder; başarılı doğrulama sonraki çekimin geçeceğini
  garanti etmez ([Checkout.com](https://www.checkout.com/docs/payments/authenticate-payments/verify-a-card),
  [Solidgate](https://docs.solidgate.com/payments/card-payments/zero-amount-authorization)). Stripe'ta deneme aboneliğinin ilk
  kurulumu 3DS ister ([Stripe destek](https://support.stripe.com/questions/no-prompt-for-3d-secure-%283ds%29-authentication-when-customer-creates-a-subscription-with-a-trial-period)).
- **Aynı kart iki hesapta mı?** Paddle kayıtlı ödeme yöntemi nesnesinde son 4 hane + son kullanma + kart sahibi adı var; kart
  PARMAK İZİ alanı bulamadım. 2025'ten beri ödeme yöntemi yalnız müşteri onaylarsa kaydediliyor.
  [payment-methods](https://developer.paddle.com/api-reference/payment-methods/overview) ·
  [spm-consent 2025](https://developer.paddle.com/changelog/2025/spm-consent-subscriptions)
  → "aynı kartla ikinci deneme" Paddle'dan güvenilir okunamaz (Stripe Radar bunu ağ verisiyle yapıyor; Paddle'da eşdeğeri bulunamadı).
- Paddle'da "aynı müşteriye ikinci deneme verme" hazır ayarı bulunamadı (FastSpring'de var: "Prevent trial hopping", aynı e-posta,
  yalnız kartsız denemede — [FastSpring](https://developer.fastspring.com/docs/prevent-trial-hopping)).

### 2.2 Seçenekler
| Seçenek | Ne olur | Artı | Eksi | Karar önerisi |
|---|---|---|---|---|
| A. Yüksek puanda **kartlı ücretsiz deneme** | Kapıya düşen hesap Paddle ekranında kart ekler, bugün ₺0; deneme bitince Pro ₺899 otomatik başlar, istediği an iptal | gerçek kart; kötüye kullanan her seferinde kart vermek + iptali hatırlamak zorunda; dönüşüm yükselir | kart parmak izi yok → aynı kartla tekrar yakalanmaz; Paddle'ın ₺0 işlemden ücret alıp almadığı belirsiz | **ÖNERİM** |
| B. Küçük tutar çek + iade et (₺10) | "kartı doğrula" için gerçek çekim, sonra iade | kart kayıtlı kalmaz | iade Paddle ONAYI ister (`pending_approval`), Paddle ücretini tutar (`retained_fee`), müşteri "neden para çekildi" der, fatura + iade belgesi; kartın kendisi sonraki ay için kayıtlı değil | ret |
| C. **Ücretli deneme** (ör. ₺49 / 14 gün) | Kapıdaki hesap ilk 14 gün için küçük ücret öder | Paddle'ın önerdiği; kötüye kullanımı en çok caydıran | %5 + 50¢ ≈ ₺25,5 ücret → ₺49'un yarısı gider; "14 gün ücretsiz" sözüyle çelişir | yedek seçenek (kurucu) |
| D. Paddle kartsız deneme | — | — | biz zaten kartsız deneme veriyoruz (yerel); erken erişim | gereksiz |

### 2.3 Ne zaman tetiklenir (önerilen puan ve eşik)
Eşik **60**. Hiçbir YUMUŞAK sinyal tek başına eşiğe ulaşmaz; IP sinyali asla tek başına karar vermez.
| Sinyal | Puan | Bugün var mı | Not |
|---|---|---|---|
| İlan / takvim daha önce başka denemede | 60 | var (anahtar kapalı) | kurucu kararı: deneme biter → "plan seçin" (kartlı kapı bunun YERİNE değil; bkz. soru S8) |
| AYNI e-posta, daha önce silinmiş deneme hesabında | 60 | YOK (iz yok) | §1.2 — yeni iz gerekir (S2) |
| Takma ad: kanonik posta kutusu başka bir hesapta (yaşayan ya da silinmiş) | 40 | yalnız kanarya | S2 |
| Geçici e-posta (topluluk listesi) | 30 | 49 alan adı | S3 |
| Aynı IP / IPv6 /64'ten son 24 saatte ≥3 doğrulanmış kayıt | 15 | YOK | `acceptedIp` amaç değişikliği → aydınlatma (S7) |
| 24 sa+ doğrulanmamış e-posta | 10 → **0 (kapıda)** | var | doğrulanmamış hesap zaten GİRİŞ YAPAMAZ — kapı için anlamsız, yalnız listede kalsın |
Örnek bileşimler: geçici e-posta + takma ad = 70 → kart · takma ad + IP = 55 → yalnız liste · geçici e-posta + IP = 45 → liste ·
silinmiş hesabın AYNI e-postası = 60 → kart.

Değerlendirme anları: e-posta doğrulandığında (ilk giriş), kanal bağlandığında, takvim ilk okunduğunda. Puan + sebepler bir kayıt
olarak saklanır (denetim + ölçüm; §4 veri modeli). Kapı yalnız anahtar AÇILDIKTAN SONRA açılan hesaplara uygulanır.

### 2.4 Müşteri deneyimi (sade Türkçe — "risk", "dolandırıcılık", "puan" kelimesi müşteriye GİTMEZ)
- Panel üst şeridi (deneme şeridinin yerine):
  **"Denemenize devam etmek için kartınızı ekleyin."**
  "Bugün ücret alınmaz. Denemeniz 29 Ekim'de biter; o gün iptal etmezseniz Pro plan aylık ₺899 olarak başlar. İstediğiniz zaman
  tek tıkla iptal edebilirsiniz."
  Düğmeler: **[Kart ekle]** · [Plan seç] · bağlantı: "Yardım alın"
- Kart eklendi: "Kartınız eklendi. Denemeniz 29 Ekim'e kadar sürüyor."
- İşleniyor (mevcut kilit metni): "Ödemeniz işleniyor."
- Kart reddedildi: "Kartınız onaylanmadı. Başka bir kart deneyin ya da bankanızla görüşün."
- "Neden benden kart istendi?" (yardım satırı): "Bazı yeni hesaplardan kart istiyoruz. Bu, ücretsiz denemeyi herkes için açık tutmamızı
  sağlıyor. Bir yanlışlık olduğunu düşünüyorsanız bize yazın." → operatör "bu hesaba güveniyorum" ile kapıyı kaldırır.
- Kapı açıkken: panel, gelen kutusu, bilgi tabanı açık (veri görülür); yapay zekâ, otomatik mesaj, QR kapalı (deneme bitmiş hesapla aynı).
- Sebep müşteriye SÖYLENMEZ (kaçışı öğretmemek için); operatör panelinde sebepler görünür.

### 2.5 Mevcut denemelere ne olur
- **Hiçbir şey.** Anahtar (`TRIAL_CARD_GATE_ENABLED`) ilk açıldığı an bir kez yazılır (deneme kimliğinin `trial-identity-enabled-at`
  emsali); o andan önce açılmış hesaplar kapı GÖRMEZ, yalnız operatör listesinde görünmeye devam eder.
- Ödeyen, kurucu (`PRIMARY_ORG_ID`), istisnalı (`trialIdentityExempt`) ve demo hesap kapı görmez.
- Anahtar kapanınca kapıdaki hesaplar serbest kalır (kapı türetilir, geri alınabilir — "BILLING_ENFORCED kapat = herkes açık" ilkesi).

### 2.6 KVKK / ePrivacy sınırları
- Kart verisi bize GELMEZ: Paddle satıcı-kayıtlı (merchant of record) ve kartı kendisi işler. Bizde yalnız Paddle müşteri kimliği
  (zaten `Subscription.customerId`) + kapı durumu.
- Hukuki sebep: dolandırıcılık / kötüye kullanım önleme = meşru menfaat (KVKK md. 5/2-f; GDPR Gerekçe 47 bunu açıkça sayar). Aydınlatma
  metnine yeni AMAÇ ("ücretsiz denemenin kötüye kullanılmasını önleme") eklenir → avukat paketi. Açmadan önce şart.
- Otomatik karar: KVKK md. 11/1-g ("münhasıran otomatik analizle aleyhe sonuca itiraz") ve .eu'da GDPR md. 22 → **itiraz yolu şart**
  ("Yardım alın" → operatör istisnası). Kart istemek hizmeti reddetmek değil, ama itiraz yolu yine konur.
- Kayıt IP'si (`User.acceptedIp`) bugün ONAY KANITI amacıyla saklanıyor; onu puana katmak yeni amaç → aydınlatma (KVKK md. 4 "amaçla
  bağlantılı, sınırlı").
- Silinen hesabın e-posta izi (S2): özet (HMAC) bile kişisel veri sayılır (takma adlı veri); saklama süresi (24 ay, deneme kimliğiyle
  aynı) + aydınlatma.
- Yurt dışı aktarım: Paddle'a zaten ödeme için veri gidiyor; KVKK md. 9 (7499 sayılı Kanun, 2024) — standart sözleşme imzalanır ve
  **5 iş günü içinde** Kurula bildirilir ([KVKK duyurusu](https://www.kvkk.gov.tr/Icerik/8043/Standart-Sozlesme-Bildirim-Modulu-Hakkinda-Kamuoyu-Duyurusu)).
  Kartlı deneme yeni KİŞİLERİ (kapıya düşen deneyenler) Paddle'a gönderir — mevcut dayanak kapsıyor mu: avukat.
- ePrivacy md. 5(3) (.eu açılışı): cihaz parmak izi ve çerez benzeri her tarayıcı okuması onay ister — EDPB Kılavuzu 2/2023 parmak izini
  açıkça kapsamaya alır ([EDPB PDF](https://edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf)).
  Kartla doğrulama tarayıcıya erişmez → ePrivacy dışı. Bu yüzden kart, parmak izinden hukuken daha temiz.
- Tüketici hukuku: kartlı denemenin kendiliğinden ücretliye dönmesi. Ev sahibi çoğunlukla ticari amaçla kullanır (6502 sayılı Kanun
  "tüketici" tanımı dışında kalabilir) ama bireysel ev sahibi tartışmalı → avukat. Her durumda: net metin, Paddle hatırlatması +
  bizim 3 gün önce hatırlatmamız, tek tık iptal.

### 2.7 İadeler
- Paddle'da iade = "adjustment"; canlı hesapta çoğu iade Paddle ONAYI ister (`pending_approval` → `approved` / `rejected`). Paddle iade ve
  itirazda ücretinin bir kısmını TUTAR (`retained_fee`, Eylül 2025).
  [create-transaction-adjustments](https://developer.paddle.com/build/transactions/create-transaction-adjustments) ·
  [retained-fees 2025](https://developer.paddle.com/changelog/2025/retained-fees-payout-totals/)
- İtiraz (chargeback) ücreti kartta **$15 ≈ ₺690**, PayPal $20; Paddle'ın kabul ettiği itiraz oranı **%0,65 altı**; kazanılan itiraz
  da orana sayılır. [Paddle chargebacks](https://www.paddle.com/help/manage/risk-prevention/understanding-chargebacks-with-paddle)
  (itiraz kazanılınca ücretin geri gelip gelmediğinde kaynaklar çelişiyor.)
- **Önerilen politika:** "Deneme sonrası ilk ödemeyi istemeden yaptıysanız 7 gün içinde yazın, tamamını iade ederiz." Bir itiraz
  (₺690 + oran riski) ₺899'luk iadeden pahalı. İlk dilimde kod yok: operatör Paddle panelinden iade eder.
- 🚨 Kodda bulunan tuzak: `trial-reminders.ts` yalnız `status: "trialing"` süzüyor, SAĞLAYICIYA bakmıyor. Kartlı denemedeki hesaba bizim
  "Deneme bitti, plan seçin" e-postası YANLIŞ gider (kartı zaten çekilecek). Kartlı denemede `provider: "trial"` süzgeci + ayrı metin
  ("29 Ekim'de kartınızdan ₺899 alınacak; istemiyorsanız iptal edin") şart.

### 2.8 Paddle ücretleri
- Standart: **%5 + 50¢** / ödeme ekranı işlemi (Paddle Ana Hizmet Sözleşmesi "5% of SRP plus $0.50";
  [Paddle 101](https://www.paddle.com/paddle-101), [MSA](https://www.paddle.com/legal/terms)). Ödeme, vergi, dolandırıcılık ve itiraz yönetimi dahil.
- Pro aylık ₺899: ₺45 + ≈₺23 = **≈₺68 (%7,5)**. Yıllık ₺8.990: ₺450 + ₺23 = ≈₺473 (%5,3). (USD/TRY ₺46.)
- ₺0'lık deneme işleminde 50¢ sabit kısmın alınıp alınmadığı belgede net değil ("SRP'nin %5'i artı $0,50") → **Paddle'a sor**. En kötü
  durum: kapıya düşen ve kart ekleyen hesap başına ≈₺23.
- Ücretli deneme (₺49): ≈₺2,5 + ₺23 = ≈₺25,5 ücret → tutarın ~yarısı. Küçük tutarlı ücretli deneme verimsiz.

### 2.9 Kodda bulunan bağlantı noktaları / tuzaklar (kartlı denemeyi açmadan ÖNCE kapanmalı)
1. 🚨 `getEntitlement`: `trialing` + `trialEndsAt == null` ya da geçmiş tarih → SÜRESİ DOLMUŞ (fail-closed, bilinçli). Paddle webhook'u
   `trialing` yazarken `trialEndsAt`'ı DOLDURMUYOR (yalnız `active`te null'a çekiyor, `route.ts:268`). Kapı yerel denemeyi bitirdiyse
   (`trialEndsAt = şimdi`) kartını ekleyen müşterinin erişimi `BILLING_ENFORCED` altında KAPALI kalır. Webhook `items[].trial_dates.ends_at`
   (yoksa `next_billed_at`) → `trialEndsAt` yazmalı.
2. 🚨 Fiyat kaçağı: kartlı deneme fiyatı herkese açık olursa yerel 14 gün biten herkes +14 gün kartlı deneme alır (28 gün). `consent`
   rotası bu fiyatı YALNIZ kapıdaki hesaba ve YALNIZ bir kez kabul etmeli (`cardTrialStartedAt`).
3. `trial-reminders.ts` sağlayıcı süzgeci (2.7).
4. `paddlePriceToPlanCode`: yeni env → "pro" (ek satır; mevcut haritaya dokunmaz).
5. K4 / ikinci abonelik alarmı: kartlı deneme aboneliği hesabın İLK Paddle aboneliği → mevcut yol; iptal (`subscription.canceled`)
   → yerel `canceled` → erişim kapanır (doğru).

## 3. Büyük SaaS'ların kullandığı diğer savunmalar (maliyet + yanlış pozitif)

> Yanlış pozitif (YP) oranları çoğunlukla satıcı iddiası; bağımsız ölçüm yok. Bizim için gerçek YP ölçüsü: "kapıya düşüp operatörden
> istisna alan hesap oranı" (§4 ölçüler).

| Savunma | Bize maliyet | Meşru müşteriye sürtünme / YP | Kimi durdurur | Lixus için öneri |
|---|---|---|---|---|
| E-posta doğrulama (VAR) | ₺0 | çok düşük | bot, sahte adres | kalsın |
| Geçici e-posta listesi (topluluk listesi, 9.892 alan adı, günlük güncel) | ₺0 + haftalık güncelleme | çok düşük: Türk ev sahibinin olağan sağlayıcıları listede YOK (ölçüldü §1.3) | tembel kötüye kullanan | **evet, puan sinyali** |
| Takma ad kanonikleştirme (Gmail noktası, `+etiket`) | ₺0 | düşük; aynı Gmail'in `+etiket`iyle iki ayrı işletme açan gerçek kişi nadir; yalnız SİNYAL | tembel kötüye kullanan | **evet, puan sinyali** (S2) |
| CAPTCHA — Cloudflare Turnstile | ücretsiz katman (20 pencere öğesi, sınırsız doğrulama); kurumsal ücretli ([Cloudflare](https://www.cloudflare.com/application-services/products/turnstile)) | çoğu kullanıcıda görünmez; çerezsiz olduğu iddia ediliyor (üçüncü taraf, doğrulanmadı) | betikli toplu kayıt | şimdi gerek yok (e-posta doğrulama + 5/saat yetiyor); bot dalgası görülürse 1 günlük iş. KVKK: Cloudflare'e yurt dışı aktarım |
| Telefon doğrulama (SMS kodu) | Twilio Verify $0,05 / başarılı doğrulama + SMS ücreti (TR fiyatı bulunamadı) ([Twilio](https://www.twilio.com/verify/pricing)); yerli sağlayıcı daha ucuz ama BTK başlık kaydı | **SMS adımında %20–30 terk, ikinci kodda %50+** (satıcı tahmini, [Vonage](https://developer.vonage.com/en/learning-center-content/use-cases/verify-business-cases/digital-onboarding-with-silent-auth)) | çok hesap açan kişi (TR'de hat kimlikle alınır → güçlü kimlik) | **şimdi HAYIR**; kart kapısından sonra hâlâ kötüye kullanım varsa. SMS şişirme dolandırıcılığı (sahte numaralara toplu SMS) riski: yalnız +90, numara başına hız sınırı şart ([Twilio Fraud Guard](https://www.twilio.com/en-us/blog/sms-pumping-fraud-solutions)) |
| IP itibarı (MaxMind minFraud Score $0,005/sorgu) ([MaxMind](https://www.maxmind.com/en/solutions/minfraud-services/pricing)) | 1.000 kayıt ≈ $5 | **YÜKSEK YP riski TR'de:** mobil ve bazı ev operatörlerinde paylaşımlı IP (CGNAT); VPN kullanan meşru kullanıcı | proxy / veri merkezi IP'sinden toplu kayıt | yalnız ZAYIF sinyal (+15), tek başına asla; ücretli servis şimdi gereksiz — kendi "aynı IP'den 24 saatte ≥3 kayıt" sayacımız yeter |
| Hız limiti (VAR: kayıt 5/saat/IP, IPv6 /64) | ₺0 | otel Wi-Fi'sinde 6. kayıt 1 saat bekler | betik | kalsın |
| Cihaz parmak izi (Fingerprint Pro ≈ $99/ay, 20.000 çağrı — üçüncü taraf özetleri) ([cside](https://cside.com/blog/fingerprintjs-pricing)) | ≈ ₺4.500/ay | düşük teknik YP; ama **.eu'da ePrivacy onayı** (EDPB 2/2023), TR'de aydınlatma; onay vermeyen = sinyal yok | aynı tarayıcıdan çok hesap | **HAYIR** (10-10 kararı aynen; maliyet bizim kayıp gelirimizden büyük) |
| Stripe Radar tarzı kart sinyalleri | Paddle'da yok (MoR değişmeden kopyalanamaz) | — | ön ödemeli / sanal kart, aynı kart çok hesapta; Stripe "%90 doğruluk" diyor (kendi iddiası) ([Stripe docs](https://docs.stripe.com/radar/free-trial-abuse)) | Paddle'a "ön ödemeli / sanal kartı denemede reddedebilir miyiz?" sorusu |
| Ücretli deneme (Paddle önerisi) | işlem başı ≈₺25 ücret | "ücretsiz" sözünü bozar | ciddi olmayan herkes | yalnız kurucu isterse (2.2-C) |
| Kart zorunlu deneme (herkese) | — | kayıt 3–5 kat düşer; denemeden ödemeye dönüş %18 → %49 (First Page Sage 2025 özeti, doğrulanmadı) ([Flint özeti](https://www.flint.com/blog/b2b-saas-free-trial-conversion-rate-statistics)) | hepsi | **HAYIR** — kurucu fiyat kararı "kart yok"; yalnız yüksek puana |
| Kademeli deneme (öneri, büyük şirket deseni: "kullanıma göre açılan hak") | ₺0 | kimliği henüz bilinmeyen hesapta günlük yapay zekâ işlemi 500 yerine 100; kimlik okununca 500 | Google'dan yeniden yayınlayan, takvimsiz kötüye kullanan | §1.1 kapanmadan HAYIR (Hospitable'lı meşru müşteri de kimliksiz kalır); sonra değerlendirilebilir |

**Özet hüküm:** Türkiye'deki ~10 daireli ev sahibi için en ucuz + en az sürtünmeli sıra: (1) işletme kimliğinin kapsamını genişlet
(Hospitable ilan no), (2) bedava e-posta sinyalleri (topluluk listesi, takma ad, silinmiş hesap izi), (3) yalnız yüksek puanda kart.
Telefon ve parmak izi, ölçüm "hâlâ kaçıyor" deyene kadar bekler.

## 4. Dilimli plan (her dilim ayrı onay, ayrı anahtar, geri alınabilir)

### Dilim 0 — kod yok (kurucu + Paddle'a sorular)
Paddle satıcı desteğine (sellers@ / panel): (a) kartlı ücretsiz denemede ₺0 işlemden "%5 + 50¢" alınıyor mu? (b) Türk kartında deneme
başında 3D Secure / ön provizyon var mı, tutarı ne? (c) ön ödemeli / sanal kartı denemede reddetme ayarı var mı? (d) aynı kartın birden
çok müşteride kullanıldığını gösteren bir alan / rapor var mı? (e) kartsız deneme genel kullanıma açıldı mı? Ayrıca canlı doğrulama:
Hospitable PAT ile `GET /properties?include=listings` TEK salt-okuma çağrısı (kurucuyla birlikte) — `platform_id` gerçekten Airbnb ilan
numarası mı?

### Dilim 1 — müşteriye GÖRÜNMEZ, migration YOK (yalnız operatör listesi zenginleşir)
- `trial-risk.ts`: yeni sebep `mailbox_shared` (kanonik posta kutusu başka yaşayan sahipte) — kanaryadaki hesap zaten yapılıyor, puana
  bağlanır. Puan / eşik yine YOK (yalnız sıralama), kurucunun "önce yalnız liste" kararı aynen.
- `canonicalMailbox`: `googlemail.com` → `gmail.com` birleştirme (yalnız analiz fonksiyonu; kimliğe girmez).
- Geçici e-posta: topluluk listesi repoya veri dosyası olarak (sürüm + indirme tarihi + kaynak işlem kimliği), elle haftalık güncelleme
  betiği (CI'da ağ yok — dosya repoda durur). Bizim 49'dan topluluk listesinde olmayan 5 alan adı ayrı "ek" listede kalır.
  Bellek: ~10.000 alan adı ≈ 200 KB, `Set` — kayıt yolunda değil, yalnız operatör sayfasında.
- Testler: saf birim (kırmızı-önce): her sinyal tek başına; `googlemail`/`gmail` eşitliği; topluluk listesinden bilinen alan adı + alt alan
  adı; gmail / hotmail / outlook / yandex.com.tr / mynet / icloud ASLA geçici sayılmaz (yanlış pozitif pini); liste dosyası boş / bozuksa
  yalnız sinyal kapanır (fail-open). Mutasyon `scripts/mutation-run.mjs`.

### Dilim 2 — Hospitable'lı hesaba işletme kimliği (sağlayıcıdan BAĞIMSIZ anahtar), migration YOK, `TRIAL_IDENTITY_ENABLED` arkasında
- Köprü senkronunda ilan listesi `include=listings` ile okunur; her ilan `platform` + `platform_id` → `otaListingKey("airbnb"|"booking", no)`
  (aynı `airbnb:<no>` kimliği iCal ve doğrudan Airbnb bağlantısıyla ORTAK). Köprünün kendi mülk numarası yine kimlik DEĞİL.
- Kayıt `recordTrialIdentities` (mevcut, fail-open, hazırlık + geri doldurma kuralları aynen); `CHANNEL_METADATA_WRITE`'a bağlanmaz.
- 🚨 Kapma riski: Airbnb ilan numarası herkese açık; ama burada numara SAĞLAYICININ yetkili cevabından geliyor (hesap gerçekten o ilana
  bağlı) → iCal'deki "sahte jetonla kapma" yolu yok. Yine de "eklemede değil gerçek okumada say" kuralı aynen.
- OAuth kapsamına `listing:read` eklenir → mevcut OAuth bağlantıları yeniden onay ister (müşteriye görünür adım → kurucu sorusu S1).
  Kapsamı olmayan bağlantı = bugünkü gibi kimliksiz (fail-open).
- Testler: ilan listesi alanı yok / boş / bilinmeyen platform → kimlik yok; aynı ilan iki hesapta → ikinci hesabın denemesi biter
  (gerçek PG, eşzamanlı iki senkron tek "ilk"); anahtar öncesi bağlanmış Hospitable hesabı cezalandırılmaz (geri doldurma).

### Dilim 3 — silinen hesabın e-posta izi (migration YOK: `TrialIdentity.keyType` kodda kapalı küme → yeni değer `mailbox`)
- Hesap silinirken (deneme kullanmış hesapsa) sahibin kanonik posta kutusu HMAC özeti `TrialIdentity`'ye yazılır; mevcut 24 ay süpürgesi
  ve yetimleştirme aynen. Kayıtta eşleşme → puan sinyali `mailbox_reused` (aynı adres 60, takma ad 40). **Engel değil, sinyal.**
- Önceki ret (`emailCanonical` kolonu + kayıt limiti) "kimlik ve engel" içindi; bu, ayrı tabloda özet + yalnız puan. Yine de kurucu onayı.
- Testler: sil → aynı adresle kayıt → sinyal; `+etiket` ile → 40; başka adres → yok; süpürge 24 ay; özet anahtarı parmak izi uyuşmazlığında
  kayıt durur (mevcut kural).

### Dilim 4 — kartlı deneme kapısı (müşteriye GÖRÜNÜR, para akışı → ilk denemeler kurucuyla), migration 68 (yalnız ekleme)
Veri modeli (hepsi nullable / varsayılanlı, dolu tabloya `@unique` / zorunlu kolon YOK):
```prisma
model Subscription {
  // ... mevcut alanlar
  trialGate          String?   // kapalı küme: "card_required"; null = kapı yok
  trialGateAt        DateTime? // kapının konduğu an (ölçüm + denetim)
  cardTrialStartedAt DateTime? // kartlı deneme BİR KEZ (fiyat kaçağı koruması)
}

/// Deneme risk değerlendirmesi — ham e-posta / IP / ad YOK (yalnız sebep kodları); hesaba bağlı profil kaydı = kişisel veri (10-16 Codex C6). Ölçüm + itiraz + "neden?" sorusu için.
model TrialRiskAssessment {
  id             String   @id @default(cuid())
  organizationId String
  score          Int
  reasons        String   // virgüllü kapalı küme kodları ("disposable_email,mailbox_shared")
  trigger        String   // "email_verified" | "channel_connected" | "calendar_read"
  version        String   // puanlama sürümü ("v1") — ağırlık değişince eski kayıtlar karışmasın
  gated          Boolean  @default(false)
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@index([organizationId, createdAt])
}
```
Davranış:
- Anahtar `TRIAL_CARD_GATE_ENABLED` (tam "1", VARSAYILAN KAPALI) + açılış anı işareti (SystemLock, `trial-identity-enabled-at` emsali).
- Değerlendirme anlarında puan ≥ 60 ve hesap anahtardan SONRA açılmışsa ve ödeyen / kurucu / istisnalı / demo değilse: `trialGate =
  "card_required"` (koşullu UPDATE, yarışsız). `getEntitlement`: kapı + `BILLING_ENFORCED` → premium yok (deneme bitmiş gibi). Hata = kapı
  yok (fail-open).
- `consent` rotası: kartlı deneme fiyatı YALNIZ `trialGate = card_required` ve `cardTrialStartedAt IS NULL` hesapta kabul.
- Webhook: `trialing` olayında `items[].trial_dates.ends_at` (yoksa `next_billed_at`) → `trialEndsAt`; aktifleşince kapı + tarih temizlenir.
  Tarih yoksa bugünkü fail-closed korunur + operatör alarmı.
- `trial-reminders.ts`: yalnız `provider: "trial"`; kartlı deneme için "kartınızdan ₺899 alınacak" hatırlatması (3 gün önce).
- Operatör: "Riskli denemeler" satırında sebepler + "bu hesaba güveniyorum" (mevcut `trialIdentityExempt` düğmesi kapıyı da kaldırır;
  bürünmedeyken YASAK — K8).
Testler (K2, `docs/TEST-EVIDENCE-CONTRACT.md`):
- Saf: eşik sınırı (59 kapı yok / 60 kapı); IP sinyali hiçbir bileşimde tek başına ≥ 60 değil (tüm alt kümeler taranır); sürüm alanı.
- Rota: kapısız hesap kartlı fiyatla 400; kapılı hesap 201; ikinci kez 400; bürünmede yazma yok.
- Webhook (gerçek PG): `trialing` + `trial_dates` → erişim açık; tarihsiz `trialing` → fail-closed + alarm; deneme içinde iptal → kapalı;
  aynı olay iki kez → tek etki; eski olay yeniyi ezmez (mevcut sıra koruması).
- Hatırlatma: Paddle denemesindeki hesaba "deneme bitti, plan seçin" GİTMEZ (kaldırma mutasyonu yakalamalı).
- Geriye uyum: anahtar öncesi hesap asla kapı görmez; anahtar kapatılınca kapılı hesap erişimi geri alır.
- Müşteri metni pinleri (sade dil: "risk / puan / dolandırıcılık" geçmez), marka adı pini.
- Mutasyon: eşik, fiyat süzgeci, sağlayıcı süzgeci, tarih eşlemesi — dördü de hayatta kalmamalı.

### Dilim 5 — yalnız ölçüm "hâlâ kaçıyor" derse
Turnstile (bot dalgası) · "aynı IP'den 24 saatte ≥3 kayıt" sinyali (`acceptedIp` amaç değişikliği, aydınlatma) · telefon doğrulama ·
takvim içeriğinden örtüşme sinyali (S6).

### Ölçüler (haftalık, operatör sayfasında; hepsi PII'siz sayılar)
| Ölçü | Neden | Hedef / alarm |
|---|---|---|
| Yeni denemelerin puan dağılımı (0 / 1–59 / ≥60) | eşik doğru mu | ≥60 oranı < %5 |
| Kapıya düşenlerin kart ekleme oranı | sürtünme | gözlem |
| Kapıya düşüp operatörden istisna alanlar | **yanlış pozitif vekili** | < %20; üstündeyse eşik / ağırlık gözden geçir |
| Kartlı denemeden ilk ödemeye dönüş | iş değeri | gözlem (sektör %18–49) |
| Kimlik tekrarı yakalanan / ay (iCal / Hospitable ilan / e-posta izi ayrı) | hangi sinyal çalışıyor | gözlem |
| İade ve itiraz sayısı | para + Paddle eşiği | itiraz oranı < %0,65 (Paddle); hedef 0 |
| Şüpheli denemelerde OpenAI harcaması | maliyet | gözlem |
| Kayıt → doğrulama → kanal bağlama hunisi | kapı yüzünden meşru kayıp | kapı açıldıktan sonra düşüş < 5 puan |

## 5. Kurucuya sorular (kurucunun öneri biçimiyle)

### S1 — Yalnız Hospitable ile bağlanan hesaba işletme kimliği
- **Şu an böyle:** Hospitable'lı hesap için hiç kimlik yazılmıyor. 09-19 yedeğinde takvim kaynağı 0 → o veriyle deneme kimliği
  kuralı açılsaydı KİMSEYİ kapsamazdı (hesaplar Hospitable'lı ya da elle).
- **Büyük şirketler:** işletmeyi e-postayla değil işin kendisiyle tanır (Stripe Radar ağ verisi; kanal yöneticileri ilan numarası).
- **Önerim:** Hospitable'dan mülkün bağlı olduğu GERÇEK Airbnb / Booking ilan numarasını okuyup aynı `airbnb:<no>` kimliğine yazmak.
  Köprü kalkınca da aynı numara doğrudan Airbnb bağlantısından gelir (Hospitable'a özgü değil). Bunun için Hospitable bağlantısına
  "ilanları okuma" izni eklenir → mevcut müşteriler bir kez "yeniden bağlan" der.
- **ÖRNEK:** Deneme biten ev sahibi hesabını siliyor, yeni Gmail ile kaydolup AYNI Hospitable hesabını bağlıyor →
  **bugün:** yeni 14 gün, hiçbir iz yok · **sonra:** "Bu ilan daha önce bir deneme hesabında kullanıldı. Devam etmek için bir plan seçin."
- **Böyle yapalım mı?** (Önce Dilim 0'daki tek salt-okuma çağrısıyla numarayı birlikte doğrulayalım.)

### S2 — Silinen hesabın e-posta izi + takma ad sinyali
- **Şu an böyle:** Hesabı silen kişi AYNI e-postayla kaydolunca yeni 14 gün alır (iz kalmıyor). `ad+2@gmail.com` yalnız operatör
  sayfasındaki bir sayıda görünür, "Riskli denemeler" listesine girmez.
- **Büyük şirketler:** e-postayı kanonikleştirip (nokta / `+etiket`) puan sinyali yapar; FastSpring "aynı e-postaya ikinci deneme yok"
  ayarı sunar.
- **Önerim:** engel DEĞİL, puan: silinen deneme hesabının posta kutusu geri döndürülemez özet olarak 24 ay saklanır (deneme kimliğiyle
  aynı tablo, aynı süre); aynı adres +60, takma ad +40. (Eski "kanonik kolon + kayıt limiti" reddi engel içindi; bu yalnız puan.)
- **ÖRNEK:** `ayse@gmail.com` denemeyi bitirip hesabı siliyor, `a.yse+2@gmail.com` ile yeniden kaydoluyor →
  **bugün:** yeni 14 gün, listede yok · **sonra:** listede "bu e-posta daha önce deneme kullandı (takma ad)" 40 puanla görünür; geçici
  e-postayla birleşirse kart istenir.
- **Böyle yapalım mı?** (Aydınlatma metnine bir satır gerekir.)

### S3 — Geçici e-posta listesini topluluk listesine bağlamak
- **Şu an böyle:** elle 49 alan adı; topluluk listesinin %0,44'ü.
- **Büyük şirketler:** açık kaynak listeyi (9.892 alan adı, günde birkaç güncelleme) kullanır.
- **Önerim:** listeyi repoya veri dosyası olarak koyup haftada bir elle güncellemek; Türk ev sahibinin olağan sağlayıcıları listede YOK
  (ölçtüm).
- **ÖRNEK:** `x@tmailor.com` ile kayıt → **bugün:** listede görünmez · **sonra:** "geçici e-posta" 30 puanla listede.
- **Böyle yapalım mı?** (Müşteriye görünmez, yalnız liste — hemen yapılabilir.)

### S4 — Yüksek puanda kartla doğrulama (Paddle kartlı deneme)
- **Şu an böyle:** yalnız operatör listesi; kimse otomatik etkilenmiyor.
- **Büyük şirketler:** herkesten kart istemez (kayıt 3–5 kat düşer); şüpheli olandan kart ister ya da ücretli deneme önerir (Paddle'ın
  kendi önerisi küçük ücretli deneme).
- **Önerim:** puan ≥ 60 olan YENİ hesaba "Denemenize devam etmek için kartınızı ekleyin. Bugün ücret alınmaz…" şeridi. Kart eklenince
  Paddle denemesi başlar; deneme bitince Pro ₺899 otomatik, istediği an tek tıkla iptal. Mevcut denemeler muaf; sebep müşteriye
  söylenmez; "Yardım alın" ile operatör kaldırır.
- **ÖRNEK:** Aynı ev sahibi `x@tmailor.com` (geçici, 30) + eski hesabının takma adıyla (40) kaydoluyor, takvimini Google'dan veriyor →
  **bugün:** yeni 14 gün · **sonra:** e-postasını doğrulayıp ilk girişte "kartınızı ekleyin" görür; kart verirse deneme sürer ve bitince
  ₺899 çekilir, vermezse yapay zekâ / otomatik mesaj kapalı kalır.
  Meşru örnek: `mehmet@gmail.com`, takvim Airbnb'den → puan 0 → **bugün ve sonra aynı:** kart istenmez.
- **Böyle yapalım mı?** (Para akışı → ilk denemeler birlikte; önce Paddle'dan ₺0 işlem ücreti ve 3D Secure cevabı.)

### S5 — İade politikası
- **Şu an böyle:** yazılı politika yok; iade Paddle panelinden elle.
- **Büyük şirketler:** deneme sonrası unutulan ilk ödemeyi sorgusuz iade eder — bir itiraz ($15 ≈ ₺690 + Paddle'ın %0,65 eşiği) iadeden
  pahalı.
- **Önerim:** "Deneme sonrası ilk ödemeyi istemeden yaptıysanız 7 gün içinde yazın, tamamını iade ederiz."
- **ÖRNEK:** kartlı denemeyi unutan ev sahibinden ₺899 çekildi, 3. gün yazıyor → **bugün:** belirsiz, bankasına itiraz edebilir ·
  **sonra:** tam iade, itiraz yok.
- **Böyle yapalım mı?**

### S6 — "Google Takvim'den yeniden yayınlama" kaçışı
- **Şu an böyle:** tanınmayan takvim kimlik sayılmaz (bilinçli: yanlış ceza riskinden kaçınma).
- **Önerim:** ŞİMDİLİK KAPATMAYALIM. Kapatmanın yolu takvim içeriğindeki rezervasyon kodlarını özetleyip başka hesapla örtüşmeyi
  aramak — bu misafir rezervasyonuna bağlı veri (KVKK) ve iş büyük. S1 + S2 + S4 sonrası ölçüm kaçış gösterirse açalım.
- **ÖRNEK:** Airbnb takvimini Google'a ekleyip Google adresini veren ev sahibi → **bugün ve sonra:** kimlik yok; ama e-posta sinyalleri
  yüksekse S4 kapısı yine kart ister.
- **Bekletelim mi?**

### S7 — Telefon doğrulama / CAPTCHA / IP itibarı
- **Önerim:** üçü de ŞİMDİ YOK. Telefon kayıtta %20–30 kayıp + SMS şişirme riski; IP Türkiye'de paylaşımlı adresler yüzünden yanlış
  alarm üretir; CAPTCHA'nın durduracağı bot zaten e-posta doğrulamasında takılıyor. Ölçü "hâlâ kaçıyor" derse sırayla CAPTCHA → telefon.
- **Böyle yapalım mı?**

### S8 — İlan tekrarında "plan seçin" yerine "kartla devam" da sunulsun mu?
- **Şu an böyle (kurucu kararı 10-10):** aynı ilan başka denemede görüldüyse deneme biter → "Devam etmek için bir plan seçin."
- **Önerim:** aynı kalsın; yalnız S4 açılınca bu hesaba da "Kart ekle" düğmesi gösterilmesin (yoksa ikinci 14 gün olur). Ödeyerek
  devam eder.
- **ÖRNEK:** Aynı Airbnb ilanıyla ikinci hesap → **bugün (anahtar açılınca):** deneme biter, plan seçer · **sonra:** aynı.
- **Böyle kalsın mı?**

## 6. Doğrulanmayanlar (dürüst liste)
- Paddle belgeleri bu ortamdan açılamadı (ağ 403); Paddle bilgileri arama özetlerinden — ₺0 işlem ücreti, deneme başı 3DS / ön provizyon,
  kart parmak izi, kartsız denemenin genel kullanıma açılıp açılmadığı **Paddle'a sorulmalı**.
- Hospitable `include=listings` → `platform_id` alanı yalnız üçüncü taraf SDK'dan; canlı API'de doğrulanmadı; `listing:read` kapsamının
  PAT'te gerekip gerekmediği bilinmiyor.
- Canlı veri yok (Railway kapalı, DB koşulmadı): kaç hesabın takma ad / silinip yeniden kayıt olduğu ÖLÇÜLMEDİ; tek sayısal canlı veri
  09-19 yedek manifesti.
- Telefon / dönüşüm / terk oranları satıcı ya da üçüncü taraf kaynaklı.
- Hukuk satırları (KVKK md. 11/1-g, tüketici tanımı, yurt dışı aktarım kapsamı) avukat paketine sorudur, hüküm değildir.

> Durum: TAMAMLANDI (2026-10-15). Kod değiştirilmedi.
