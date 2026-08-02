# `PasswordResetChallenge` — yapısal tasarım (2026-08-02)

> **DURUM: YALNIZ TASARIM.** Hiçbir kod değiştirilmedi, migration YAZILMADI,
> prod'a dokunulmadı, push YAPILMADI. Kullanıcının AÇIK onayından sonra
> uygulanacak.

---

## 1. Problem: neden geçici yama değil, yapısal çözüm

Bugün parola sıfırlama akışının **tüm sayaçları e-posta adresine göre
anahtarlanıyor** — ve e-posta, saldırganın serbestçe yazdığı bir istek alanı.
Kimlik kanıtı sunulmadan bir hesabın bütçesi tüketilebiliyor:

| Sayaç | Nerede | Limit | Saldırgan tüketebilir mi? |
|---|---|---|---|
| `forgot-req:{email}` | `RateLimitCounter` | 4 / 15 dk | **Evet** — kimlik doğrulaması yok |
| `pwResetCodeAttempts` | `User` satırı | 5 / kod | **Evet** — yalnız e-posta gerekiyor |
| `forgot-confirm:{email}` | `RateLimitCounter` | 8 / 10 dk | **Evet** (08-01'de kapı olmaktan çıkarıldı) |

**Ölçülen etki (bağımsız denetim, 08-01):** tek IP'den **9 istek / 15 dk
(0,6 istek/dk)** ile kurban süresiz olarak sıfırlama dışında tutulabiliyor —
4 istek kurtarma yolunu (`forgot-req`) kapatıyor, 5 istek eldeki kodu yakıyor.
IP kovası 12/15 dk olduğu için ikinci bir IP bile gerekmiyor.

**Neden sayaçları yeniden sıralamak çözmez:** sıra değişse de anahtar aynı kalır.
`(email)` ile anahtarlanan her bütçe, e-postayı bilen herkese açıktır. Çözüm
bütçeyi **saldırganın bilemeyeceği bir şeye** bağlamaktır. Bu, veri modeli
değişikliğidir — yama değil.

**İkinci, bağımsız kusur:** saldırı **tamamen sessiz**. `writeAudit` yalnız
başarılı sıfırlamada çağrılıyor; yakılan kod, başarısız confirm ve iki 429 için
hiçbir kayıt yok. Operatör görünürlüğü sıfır.

---

## 2. Değişmezler (tasarımın uymak zorunda olduğu kurallar)

1. **Bütçe challenge'a aittir, hesaba değil.** Bir challenge'ın denemeleri yalnız
   o challenge'ı adresleyebilen kişi tarafından harcanabilir.
2. **Challenge'ı adreslemek için e-postadan gelen sırrı bilmek gerekir.** Adres
   anahtarı `tokenHash`'tir; `email` ile challenge BULUNAMAZ.
3. **Token yalnız e-posta ile kullanıcıya ulaşır.** İstek API yanıtında, log'da,
   Sentry context'inde ya da hiçbir istemci yanıtında görünmez. Tek taşıyıcı
   e-postadaki bağlantıdır ve token orada **URL fragment'inde** (`#t=`) durur —
   query'de DEĞİL, çünkü query sunucuya/vekile/erişim log'una gider ve
   gitmediğini kanıtlayamayız (↓§6.1).
4. **Enumeration korunur.** Bilinmeyen ve kayıtlı e-posta dışarıdan ayırt
   edilemez: aynı gövde, aynı durum kodu, aynı bcrypt maliyeti.
5. **E-posta bombalama açılmaz.** `forgot-req:{email}` kovası KALIR — varlık
   sebebi budur.
6. **Fail-closed.** Belirsizlikte sıfırlama yapılmaz.
7. **Migration additive ve geri alınabilir.**

---

## 3. Şema

```prisma
/// Parola sıfırlama "challenge"ı — hesap başına DEĞİL, istek başına satır.
///
/// Bütçenin (deneme sayısı) hesaba değil BU SATIRA ait olması tasarımın
/// tamamıdır: satır yalnız `tokenHash` ile bulunabildiği için, e-postadan gelen
/// token'ı bilmeyen biri satırı adresleyemez ve denemesini harcayamaz.
model PasswordResetChallenge {
  id            String    @id @default(cuid())
  userId        String
  /// sha256(raw token). HAM TOKEN HİÇBİR YERDE SAKLANMAZ (emailVerifyTokenHash emsali).
  /// UNIQUE: confirm yolunun TEK arama anahtarı — e-posta ile arama YOK.
  tokenHash     String    @unique
  /// bcrypt(8 haneli kod). Yalnız "token + kod" modeli seçilirse dolu (↓§5).
  codeHash      String?
  attempts      Int       @default(0)
  maxAttempts   Int       @default(5)
  expiresAt     DateTime
  /// Tek kullanımlık tüketim damgası — paralel iki doğru kullanımda hakem.
  consumedAt    DateTime?
  /// Başarılı sıfırlama ya da yeni bir challenge tarafından kapatıldı.
  invalidatedAt DateTime?
  createdAt     DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([expiresAt])
}
```

`User` tarafına eklenecek TEK satır (ters ilişki):

```prisma
  passwordResetChallenges PasswordResetChallenge[]
```

**Bilinçli olarak YOK olanlar:**
- `email` kolonu yok → tek adresleme yolu `tokenHash`.
- Ham token/kod hiçbir kolonda yok.
- IP/User-Agent yok — KVKK yüzeyini gereksiz genişletmemek için (delil gerekirse
  `AuditLog` zaten `clientIp` tutuyor).

### Üretilecek SQL (additive, `47_password_reset_challenge`)

```sql
-- CreateTable
CREATE TABLE "PasswordResetChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetChallenge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetChallenge_tokenHash_key"
    ON "PasswordResetChallenge"("tokenHash");
CREATE INDEX "PasswordResetChallenge_userId_createdAt_idx"
    ON "PasswordResetChallenge"("userId", "createdAt");
CREATE INDEX "PasswordResetChallenge_expiresAt_idx"
    ON "PasswordResetChallenge"("expiresAt");

ALTER TABLE "PasswordResetChallenge" ADD CONSTRAINT "PasswordResetChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Neden güvenli:** yalnız YENİ tablo + index. Var olan hiçbir tabloya kolon
eklenmiyor, hiçbir kolon düşürülmüyor, dolu tabloya `@unique` konmuyor
(CLAUDE.md kuralı). Geri alma: `DROP TABLE`.

---

## 4. Akış diff'i

### İstek (`action: "request"`)

```
  IP kovası (12/15dk)                                    [DEĞİŞMEDİ]
  forgot-req:{email} kovası (4/15dk)                     [DEĞİŞMEDİ — bomba savunması]
  kullanıcı var mı?
    HAYIR → bcrypt parite maliyeti, HİÇBİR satır yazma   [DEĞİŞMEDİ]
    EVET  → raw token = randomBytes(32).hex              [YENİ]
            challenge satırı yaz (tokenHash, expiresAt)  [YENİ]
            e-posta: sıfırlama BAĞLANTISI (+ kod)        [DEĞİŞTİ]
  yanıt: her hâlde 200, gövde AYNI, token YOK            [DEĞİŞMEDİ]
```

### Onay (`action: "confirm"`)

```
  IP kovası                                              [DEĞİŞMEDİ]
- forgot-confirm:{email} kovası                          [KALDIRILDI — artık gereksiz]
+ challenge = findUnique({ tokenHash: sha256(token) })   [YENİ — TEK arama yolu]
+ yoksa / süresi dolmuş / tüketilmiş / iptal → genel hata + parite bcrypt
+ atomik deneme talebi:
+   updateMany({ where: { id, attempts < maxAttempts, consumedAt: null,
+                         invalidatedAt: null, expiresAt > now },
+                data: { attempts: { increment: 1 } } })
+   count === 0 → genel hata (bütçe bitti) + EŞİK ALARMI
  kod doğrula (bcrypt)                                   [DEĞİŞMEDİ]
+ doğruysa TEK koşullu yazma (TX):
+   challenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: now } })
+   count === 0 → yarışı kaybettik → genel hata
+   user.update({ passwordHash, sessionEpoch: +1 })
+   challenge.updateMany({ where: { userId, consumedAt: null }, data: { invalidatedAt: now } })
  audit: account.password_reset                          [DEĞİŞMEDİ]
```

**Kritik nokta:** `forgot-confirm:{email}` kovası KALDIRILIYOR çünkü işlevi
challenge satırındaki `attempts` tarafından devralınıyor — ve o bütçe artık
saldırgan tarafından adreslenemiyor. Kova KALSAYDI, bu tasarımın kapattığı deliği
tek başına yeniden açardı.

---

## 5. 🔶 KARAR NOKTASI: "yalnız token" mı, "token + kod" mu?

Bu bir güvenlik/UX takasıdır ve **ürün kararıdır** — ikisini de tasarladım.

### A) Yalnız token (bağlantıya tıkla)
E-posta bir bağlantı içerir; tıklayınca yeni parola formu açılır. `codeHash` NULL.
- ✅ En basit UX (tek tık), bugünkü iki adımlı formdan bile kolay.
- ✅ Elde edilen tüm güvenlik özellikleri sağlanır.
- ⚠️ **Sızmış URL tek başına yeterlidir**: tarayıcı geçmişi, ekran görüntüsü,
  yanlışlıkla paylaşılan bağlantı → parola sıfırlanabilir. TTL (10 dk) +
  tek-kullanım + `Referrer-Policy: no-referrer` bunu daraltır, sıfırlamaz.

### B) Token + kod (bağlantıya tıkla, sonra 8 hane yaz) — **ÖNERİM**
Bağlantı challenge'ı ADRESLER, kod onu YETKİLENDİRİR. `codeHash` dolu.
- ✅ Sızmış URL tek başına YETMEZ — ikinci sır gerekir.
- ✅ Bugünkü "kodu yaz" alışkanlığı korunur; kullanıcı için tanıdık.
- ⚠️ Bir tık + 8 hane = bugüne göre biraz daha fazla sürtünme.
- ⚠️ İki sır da AYNI e-postada; e-posta kutusu ele geçmişse fark yok. Koruduğu
  şey yalnız **URL sızıntısı** senaryosudur — ama o senaryo gerçektir ve bu
  tasarımın gereksinimlerinden biri zaten "token log'lara sızmasın"dır.

**Önerim B.** Gerekçe: tasarımın kendi gereksinim listesi token sızıntısını ciddi
bir tehdit olarak tanımlıyor; ikinci faktör tam olarak o tehdide karşı. Sürtünme
artışı bir tık + 8 hane, ve kullanıcı bu adımı zaten bugün yapıyor.

---

## 5b. DEĞERLENDİRİLİP REDDEDİLEN ALTERNATİF: HttpOnly çerez + stateless HMAC

Bağımsız bir tasarım ajanı, migration istemeyen ve istemci kodunu hiç
değiştirmeyen bir alternatif önerdi. Ciddi bir öneriydi, o yüzden gerekçeli
reddediyorum:

**Öneri:** `request` yanıtına `pwreset_ch` HttpOnly çerezi konur; değeri
`{expiresAtMs}.{HMAC(AUTH_SECRET, "pwreset:v1|"+email+"|"+ms)}`. Sunucuda hiçbir
şey saklanmaz. `confirm` çerezi doğrular: **kanıtlı** dalda bugünkü sayaç
çalışır (WHERE'e `pwResetCodeExpiresAt = çerezdeki ms` eklenir), **kanıtsız**
dalda sayaç HİÇ artmaz ve kod NULL'lanmaz.

**Güçlü yanları (gerçek):** migration yok · istemci değişikliği yok · sunucuda
durum yok · çerezi kimlik değil "kötüye-kullanım sinyali" sayıp fail-OPEN yapması
deponun kendi doktrinine (`sınırlar fail-OPEN, kimlik kapıları fail-closed`)
birebir uyuyor · kaba kuvvet tavanını 8/10dk'dan 3/10dk'ya DÜŞÜRÜYOR.

### Neden yine de reddediliyor

**1. Kanıtı saldırgan da üretebiliyor — asıl deliği kapatmıyor.** Çerez `request`
yanıtında dağıtılıyor ve o uç KİMLİK DOĞRULAMASIZ. Saldırgan kurbanın e-postası
için `request` çağırır → kurbana yeni kod gider, saldırgan da o kodun
`expiresAt`'ine bağlı GEÇERLİ bir çerez alır → **kanıtlı** dala girip kurbanın
5 denemesini yakar. Yani saldırı kapanmıyor, yalnız bir adım (bir `request`
çağrısı) ekleniyor. Toplam maliyet 4 + 5 = 9 istek/15 dk — **bugünküyle aynı**.

**2. Gereksinim 3'ü yapısal olarak sağlayamıyor.** Çerez tek bir `expiresAt`
damgasına bağlı; yeni bir `request` kodu ve damgayı değiştirdiği için önceki
kanıt otomatik olarak geçersizleşir. "Yeni request önceki geçerli challenge'ı
anında bozmaz" gereksinimi bu modelde tanım gereği sağlanamaz — model tek bir
canlı sır varsayıyor.

**3. Açık gereksinimi ihlal ediyor.** İstek: *"Challenge/token yalnız
e-postadan kullanıcıya ulaşmalı; request API cevabında … açığa çıkmamalı."*
`Set-Cookie` bir istemci yanıtı başlığıdır. Kural teknik bir kılı kırk yarma
değil — maddenin 1'de anlatılan sonucun ta kendisi: kanıt e-posta dışında bir
kanaldan dağıtılırsa saldırgan da alabilir.

**Alınan iyi fikirler:** ajanın `finishReset(...)` ortaklaştırması (geçiş
penceresinde iki yolun sürüklenmemesi için) ve bilinmeyen-e-posta dalının
biçimsel ayırt edilemezliği bu tasarıma dahil edildi (↓§7, §9/6).

### Değerlendirilen diğerleri (kısa)
- **`SystemLock`'ta challengeId + gövdede dönmek:** aynı 1. ve 3. kusurlar, üstüne
  saldırgan kontrollü satır üretimi ve `sessionStorage` kırılganlığı. Red.
- **CAPTCHA:** yeni bir alt-işleyen = gizlilik metni + DPA + m.9 aktarım kalemi
  (bugünkü LEGAL darboğazına yeni kalem) + CSP değişikliği; üstelik saldırgan
  eşiğin altında gezinebildiği için asıl sorunu çözmüyor. Red.

---

## 6. Token'ın açığa çıkmaması (gereksinim 3 ve 7)

| Yüzey | Kural |
|---|---|
| İstek API yanıtı | `{ ok: true }` — token YOK, challenge id YOK |
| E-posta gövdesi | Bağlantı (token URL **FRAGMENT**'inde) — **tek meşru taşıyıcı** |
| DB | Yalnız `sha256(token)`; ham token asla |
| Log / console | Yasak — kaynak-tarama pini |
| Sentry | Yasak — `redactSensitive` + pin |
| `AuditLog.metadataJson` | Yalnız challenge `id` (opak cuid), token/hash ASLA |
| Alarm e-postaları | Yalnız sayı + sebep kodu |
| Referrer | `/sifremi-unuttum` → `Referrer-Policy: no-referrer` (test-pinli) |

### 6.1 🚨 Token QUERY'de DEĞİL, FRAGMENT'te (Codex itirazı, 08-02)

İlk tasarım bağlantıyı `…/sifremi-unuttum?t=<token>` diye kuruyordu. **Bu, bu
belgenin kendi 3. gereksinimiyle ("log'da görünmez") çelişiyordu**: query
parametresi HTTP istek satırının parçasıdır, yani token'ı önündeki her katman
görür — Railway edge'i, Next'in istek log'u, araya girebilecek ters vekiller ve
e-posta güvenlik tarayıcılarının bağlantıyı önceden açan istekleri.

**Kanıtlanamayan iddia:** "Railway erişim logları query string tutmaz." Railway
üçüncü taraf bir platformdur; log içeriği bizim sözleşmemiz değildir, davranışı
tek taraflı değişebilir ve resmî dokümantasyon sayfaları bu ortamdan 403
dönüyor. Bir olumsuzu kanıtlamaya çalışmak yerine token'ı o katmanların
**erişemeyeceği** yere taşıdık.

**Taşıyıcı: `…/sifremi-unuttum#t=<token>`.** Fragment tarayıcıdan sunucuya
**hiç gönderilmez** (URL spec: istek hedefine dahil değildir) ve `Referer`
başlığından spec gereği çıkarılır. Yani:

| Sızıntı yolu | `?t=` | `#t=` |
|---|---|---|
| Railway edge / vekil erişim log'u | ⚠️ görür | ✅ ulaşamaz |
| Next istek log'u | ⚠️ görür | ✅ ulaşamaz |
| `Referer` başlığı (aynı-origin) | ⚠️ tam URL | ✅ hiç |
| E-posta tarayıcısının ön-ısıtma isteği | ⚠️ sunucuya taşır | ✅ taşımaz |
| Tarayıcı geçmişi / adres çubuğu | ⚠️ kalır | ✅ `replaceState` siler |
| Sunucu-tarafı hata bağlamı | ⚠️ URL'de | ✅ URL'de değil |

Üç savunma birlikte:
1. **Fragment** — sunucuya hiç ulaşmaz (`email-outbox.ts resetChallengeUrl`).
2. **`history.replaceState`** — istemci token'ı okur okumaz adres çubuğundan ve
   MEVCUT geçmiş girdisinden siler; "geri" tuşu token'lı URL'e dönemez
   (`forgot-password-form.tsx`). `sessionStorage`/`localStorage` KULLANILMAZ.
3. **`Referrer-Policy: no-referrer`** — ikinci savunma; sayfaya bir gün query'li
   bir parametre eklenirse global `strict-origin-when-cross-origin` onu
   aynı-origin gezinmelerde tam URL olarak sızdırırdı.

**Sentry tarafı kod-doğrulandı:** repoda tarayıcı SDK'sı YOK. `captureToSentry`
elle yazılmıştır ve yalnız `context`/`errName`/`errMessage`/`detail` gönderir —
istek URL'i hiçbir zaman toplanmaz. Yani fragment'in istemcide görünür olduğu
kısa pencere bile bir olay yüzeyine bağlı değildir.

**Test pinleri:** `password-reset-challenge.test.ts` #10 (bağlantı `new URL()`
ile ayrıştırılır: `search === ""`, `hash === "#t=<token>"`, gövdenin tamamında
`?t=` YOK) + token çıkarma regex'i yalnız `#t=` kabul eder → biçim geri
taşınırsa dosyadaki TÜM testler kırmızıya döner. `response-cache-policy.test.ts`
başlığı ve SIRASINI pinler (Next'te son eşleşen başlık kazanır; blok global
bloktan önce yazılırsa sessizce etkisiz kalırdı — mutasyonla doğrulandı).

### 6.2 Token'lı yolda `email` istenmez

Bağlantı TAZE bir sayfa yükler; istemcinin elinde adres yoktur. Sunucu o yolda
e-postayı zaten hiçbir yerde kullanmıyordu (challenge ile eşleştirilmiyor, kova
anahtarı değil, denetim kimliği verdict'ten geliyor) — yani zorunlu tutmak
dekoratif bir alan yaratıyordu. **Uyuşmayan e-posta REDDEDİLMEZ, yok sayılır:**
reddetmek, token'ı ele geçirmiş birine "bu token hangi hesaba ait?" sorusunu
deneme yanılmayla yanıtlatan bir oracle açardı (test #12). Token YOKKEN e-posta
zorunluluğu aynen sürer (test #13, ters yön).

---

## 7. Rollout sırası (expand–contract)

| Faz | İçerik | Geri alma |
|---|---|---|
| **0** | Migration 47: tablo + indexler. **Hiçbir kod okumaz/yazmaz.** Davranış değişimi SIFIR. | `DROP TABLE` |
| **1** | Çift yazma, bayrak `PASSWORD_RESET_CHALLENGE_ENABLED` **DEFAULT KAPALI**. İstek yolu challenge satırını da yazar; confirm HEM eski kod yolunu HEM token yolunu kabul eder. Eski yol hâlâ yetkili. | Bayrak zaten kapalı |
| **2** | Bayrak AÇILIR. Token yolu birincil olur; eski kod yolu **uçuştaki kodlar için** kabul edilmeye devam eder. | Bayrağı kapat |
| **3** | Bayrak açıldıktan `CODE_TTL_MS` (10 dk) + emniyet payı sonra: eski kod yolu kapatılır, `pwResetCode*` okumaları kaldırılır. | Kod geri alınır (kolonlar duruyor) |
| **4** | *(Ayrı karar)* `pwResetCode*` kolonlarını düşüren migration. | Ayrı karar — bugün önerilmiyor |

**Faz 0 ile 1 arasında prod'da hiçbir davranış değişmez** — bu, migration'ı
düşük riskli kılan şeydir.

---

## 8. Uçuştaki eski kodlar için geçiş planı

**Sorun:** bayrak açıldığı anda elinde 8 haneli geçerli kod olan kullanıcılar var.
Onları kırmak, tam da düzeltmeye çalıştığımız şeyi (sıfırlama yapamamak)
üretirdi.

**Plan:**
1. Faz 2'de confirm **iki yolu da** kabul eder:
   - gövdede `token` varsa → challenge yolu,
   - yoksa → eski `pwResetCode*` yolu (bugünkü kod, aynen).
2. Eski yol için `forgot-confirm:{email}` kovası **08-01'deki hâliyle kalır**
   (yalnız başarısız denemede tüketilir) — geçiş penceresinde gerileme olmaz.
3. Eski kodların ömrü `CODE_TTL_MS` = **10 dakika**. Bayrak açıldıktan
   **≥30 dakika** sonra hiçbir uçuş kodu geçerli olamaz → Faz 3 güvenli.
4. Faz 3'te eski yol kaldırılır; `pwResetCode*` kolonları DURUR (Faz 4 ayrı karar).
5. Geri alma her fazda tek yönlü değil: Faz 2'de bayrak kapatılırsa eski yol zaten
   çalışmaya devam ediyor, challenge satırları yalnız kullanılmadan süresi doluyor.

---

## 9. Zorunlu saldırı testleri → somut assertion'lar

| # | Gereksinim | Test kurgusu | Assertion |
|---|---|---|---|
| 1 | Saldırgan request kotasını doldursa bile kurbanın elindeki geçerli challenge çalışır | Kurban token alır → saldırgan `forgot-req:{email}` kovasını 4 istekle doldurur → kurban confirm eder | `200` + parola gerçekten değişti |
| 2 | Bir challenge'a 5 yanlış deneme başka challenge'ı yakmaz | Aynı kullanıcı için A ve B challenge'ı → A'ya 5 yanlış → B ile confirm | A: `attempts=5` ve ölü; B: `200` |
| 3 | Yeni request önceki geçerli challenge'ı anında bozmaz | A alınır → yeni request (B) → A ile confirm | A `200` (B canlıyken bile) |
| 4 | Paralel iki doğru kullanımda yalnız biri başarılı olur | Aynı token ile `Promise.all` iki confirm | tam olarak **1** × `200`, diğeri genel hata; `consumedAt` bir kez yazıldı |
| 5 | Başarılı reset tüm challenge'ları kapatır ve oturumları düşürür | A ve B canlı → A ile başarı → B denenir | B genel hata; tüm satırlarda `invalidatedAt` dolu; `sessionEpoch` +1 |
| 6 | Bilinmeyen/kayıtlı e-posta dışarıdan ayırt edilemez | request(bilinmeyen) vs request(kayıtlı) | aynı status, **birebir aynı gövde**; satır sayısı: bilinmeyende 0 |
| 7 | Token/hash hiçbir log, Sentry veya API cevabında görünmez | Ham token'ı yakala → tüm yüzeyleri tara | API gövdesi, `console` spy, `reportError` argümanları, `AuditLog.metadataJson` → hiçbirinde token/`tokenHash` yok. **+ kaynak-tarama pini** |
| 8 | Eşik aşımı redakte audit/uyarı üretir | 5 yanlış deneme → 6. istek | `AuditLog` satırı (`account.password_reset_blocked`) yazıldı, metadata'da token/kod/hash YOK; `reportError` bir kez (throttle'lı) |
| 9 | Süre aşımı ve cleanup pinlenir | `expiresAt` geçmişe çekilir → confirm; sweep koşturulur | confirm genel hata; sweep süresi dolmuş/tüketilmiş satırları siler, **canlı olanı SİLMEZ** |

**Ek olarak (gerileme pinleri):** her testte iki yönlü mutasyon — korumayı
kaldır (kırmızı) **ve** koşulsuz yap (yine kırmızı).

---

## 10. Temizlik ve saklama (gereksinim 9)

- `sweepPasswordResetChallenges()`: `expiresAt < now - 24h` **veya**
  (`consumedAt`/`invalidatedAt` dolu ve `createdAt < now - 24h`) satırları siler.
- Çalışma yeri: `scheduled-sync` **deep** penceresi (`sweepExpiredRateLimits`
  ve `sweepEmailOutbox` ile aynı blok) — yeni cron YOK.
- KVKK: tabloda misafir/kişisel veri YOK (yalnız `userId` + hash'ler + damgalar).
  `User` silinince `onDelete: Cascade` ile gider. İki süpürge kapsamına girmesi
  gerekmez; bu, `SCRUB KAPSAMI KURALI` açısından bilinçli ve gerekçeli bir
  istisnadır.

---

## 11. Uygulama sırasında dokunulacak dosyalar

| Dosya | Değişiklik |
|---|---|
| `prisma/schema.prisma` | Yeni model + `User` ters ilişkisi |
| `prisma/migrations/47_password_reset_challenge/migration.sql` | Yukarıdaki SQL |
| `src/lib/auth/password-reset-challenge.ts` *(yeni)* | Token üret/hash'le, challenge yarat, atomik deneme talebi, tüket, iptal et |
| `src/app/api/account/forgot-password/route.ts` | İstek: challenge yaz; Confirm: token yolu + eski yol (geçiş). ⚠️ Başarılı sıfırlamanın gövdesi (koşullu `updateMany` + `sessionEpoch` +1 + tüm challenge'ları kapatma + audit) TEK `finishReset()` fonksiyonunda toplanır — geçiş penceresinde iki yolun sürüklenmesini yapısal olarak engeller |
| `src/lib/email-outbox.ts` | Yeni kind `pw_reset_challenge`; `resetChallengeUrl` token'ı **fragment**'te yazar (`#t=`) |
| `src/components/auth/forgot-password-form.tsx` | Token'ı URL **fragment**'inden oku → `history.replaceState` ile adres çubuğundan sil → confirm gövdesine ekle |
| `next.config.mjs` | `/sifremi-unuttum` → `Referrer-Policy: no-referrer` (global bloktan SONRA) |
| `src/lib/scheduled-sync.ts` | Deep pencereye sweep çağrısı |
| `tests/integration/password-reset-challenge.test.ts` *(yeni)* | 9 saldırı testi |

---

## 12. Uygulandıktan sonra KALAN risk (dürüstçe)

1. **E-posta bombalama hâlâ mümkün:** saldırgan `forgot-req` kovası kadar
   (4/15 dk) kurbanın kutusuna sıfırlama e-postası gönderebilir. Bu kova
   kaldırılamaz; tasarım bunu **azaltmaz**, yalnız artırmaz.
2. **Yeni kod isteme yolu hâlâ kapatılabilir:** saldırgan `forgot-req`'i
   doldurursa kurban YENİ challenge alamaz — ama **elindeki challenge çalışır**
   (gereksinim 1). Yani "hiç sıfırlayamaz" değil, "yeni kod alamaz".
3. **E-posta kutusu ele geçmişse** hiçbir tasarım korumaz — kapsam dışı.
4. **`TRUSTED_PROXY_HOPS` env'i düşerse** tüm IP kovaları tek adrese iner ve
   platform genelinde 12 istek/15 dk'ya düşer — kendi kendine küresel DoS.
   ⚠️ Bu bayrak 08-01'de Railway'e **girildi ve ters DNS ile doğrulandı** (değer 2);
   yani bugün risk YOK. Ama bayrak düşerse bu tasarımdan bağımsız olarak
   forgot-password dâhil her hız limiti çöker — `docs/…§4f`'de belgeli.

### 🚧 FAZ 2 ENGELİ — OTURUM AÇIKKEN BAĞLANTI ÇALIŞMAZ (08-02, kod-doğrulandı)

`src/middleware.ts:27-32`: oturumu AÇIK bir kullanıcı `/sifremi-unuttum`'a
giderse `/dashboard`'a yönlendirilir (`AUTH_PATHS`, satır 4). Bugün zararsız —
sıfırlama sayfasına yalnız giriş ekranından gelinir, yani kullanıcı tanım gereği
çıkış yapmıştır. **Bayrak açılınca (Faz 2) gerçek bir arızaya dönüşür:** e-posta
bağlantısına, hesabına o tarayıcıdan girmiş bir kullanıcı tıklarsa panele düşer
ve sıfırlamayı hiç yapamaz.

İkinci etki (düşük şiddet): tarayıcılar yönlendirme hedefinde fragment yoksa
kaynak URL'in fragment'ini TAŞIR → adres çubuğunda `/dashboard#t=<token>` kalır.
Token sunucuya yine gitmez ve tek başına işe yaramaz (kod da gerekir); üstelik o
tarayıcıda zaten geçerli bir oturum vardır — yani saldırgan modeli "oturuma
erişebilen kişi"ye iner, ki bu token'dan çok daha değerlidir. Yine de sayfanın
`replaceState` temizliği orada ÇALIŞMAZ.

**Karar KULLANICININ** (kimlik yönlendirme semantiğini değiştirir, Faz 1'in işi
değil). Seçenekler:
- (a) `/sifremi-unuttum`'u "signed in → uzak tut" kuralının DIŞINA al. Sayfa
  zaten public ve çağırdığı uç nokta enumeration-safe; oturumu olan birinin
  şifresini sıfırlaması meşru bir istek (tam da "hesabım ele geçti" senaryosu).
  Güvenlik kaybı kod-doğrulaması ile YOK; tek satır.
- (b) Yönlendirmeyi koru, hedefe boş fragment yaz (`url.hash = "#"`) → tarayıcı
  devralmaz. Akış yine kırık kalır, yalnız token taşınmaz.
- (c) Olduğu gibi bırak → Faz 2'de oturumu açık kullanıcılar için akış kırık.

**Öneri: (a).** Faz 2 onayıyla BİRLİKTE uygulanmalı, ayrı bir karar olarak.

---

## 13. Onay bekleyen açık sorular

1. **§5 karar:** "yalnız token" (A) mı, "token + kod" (B) mi? *(Önerim: B)*
2. Sıfırlama bağlantısının TTL'i 10 dk mı kalsın, yoksa bağlantı tabanlı akış
   için 30 dk'ya mı çıksın? *(Önerim: 30 dk — kullanıcı e-postayı geç görebilir;
   tek-kullanım + tüketim damgası koruyor.)*
3. Aynı anda kaç canlı challenge tutulsun? *(Önerim: sınırsız ama `forgot-req`
   kovası zaten 4/15 dk ile fiilen sınırlıyor; sweep 24 saatte topluyor.)*
4. Faz 4 (`pwResetCode*` kolonlarını düşürme) hiç yapılsın mı? *(Önerim: şimdilik
   HAYIR — sentinel emsali gibi, kolonların durması zarar vermiyor.)*
