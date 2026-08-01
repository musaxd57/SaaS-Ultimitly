# Migration / karar bekleyen işler — Codex'e

> **Durum:** hiçbiri UYGULANMADI. Bu belge yalnız bulguları, kod
> doğrulamalarını ve önerilen yolları taşır.
> **Tarih:** 2026-07-31, **08-01'de 4. madde eklendi** · **Kaynak:** 7 salt-okuma
> denetim turu (07-31) + derin denetim turu (08-01).
> **Neden burada:** hepsi ya migration ister ya da ürün/operasyon kararı ister;
> ikisi de kullanıcı onayı olmadan yapılmaz (CLAUDE.md kuralı).
>
> Bu turda yapılan HER ŞEY migration'sız ve geri alınabilirdi. Aşağıdakiler
> bilerek dışarıda bırakıldı.

---

## 1. Hesap silme, hukuken saklanması gereken kayıtları da siliyor

**Severity:** yüksek · **Migration:** GEREKLİ · **Karar:** ürün + hukuk

### Kod doğrulaması

`src/app/api/account/delete/route.ts:44` → `deleteAccountData(session.organizationId)`
→ `src/lib/data-retention.ts:479` → tek satır:

```ts
await tx.organization.delete({ where: { id: organizationId } });
```

Cascade ile giden tablolar (`prisma/schema.prisma`, hepsi doğrulandı):

| Model | Satır | İlişki |
|---|---|---|
| `AuditLog` | `:682` | `onDelete: Cascade` |
| `CheckoutConsent` | `:693` bloğu | `onDelete: Cascade` (yorumu da bunu söylüyor) |
| `Subscription` | `:757` bloğu | `onDelete: Cascade` |
| `Invoice` | `:809` | `onDelete: Cascade` |

### Sorun

CLAUDE.md'nin kendi LEGAL bölümü şunu yazıyor:

> Invoice **10y** (TTK m.82) · CheckoutConsent **≥3y zorunlu / 10y önerilen**
> (MSY m.20/1 + TBK m.146)

Bu süreler misafirin açık silme talebi (KVKK m.11) bağlamında yazılmış, ama
**aynı kayıtlar hesap silmede tek tıkla gidiyor.**

> ⚠️ Burada hukuki nitelendirme YAPILMIYOR. Tespit edilen şey teknik: **kod,
> projenin kendi belgelediği saklama politikasıyla çelişiyor.** Hangi kaydın ne
> kadar saklanacağı avukat sorusudur.

### Ek bulgular (aynı rotada)

- **Silme işleminin kendisi audit'e yazılmıyor:** `account/delete/route.ts`
  içinde `writeAudit` çağrısı YOK (grep: 0 eşleşme). Yazılsaydı bile `AuditLog`
  cascade ile silinirdi.
- Geriye kalan tek iz: `WebhookEvent` (org FK'sı yok, redakte) ve
  `StorageDeletion`. Yani bir org'un **var olduğuna ve silindiğine dair hiçbir
  kayıt kalmıyor.**
- Yumuşak silme / bekleme penceresi / silme öncesi zorunlu export **yok**.
  Tek şifre + tek istek, geri dönüş yok.
- Yedek ritüeli aylık olduğu için kurtarma penceresi 0–30 gün arası **rastgele**.

### Önerilen yol (sıralı — ilk adım migration'sız)

1. **Migration'sız:** silme olayını org'a bağlı OLMAYAN bir yere yaz (cascade ile
   gitmesin). Aksi hâlde her adım "hiç olmamış" görünüyor.
2. **Ürün kararı:** `deletion_pending` durumu + N günlük geri alma penceresi.
   Silme öncesi zorunlu veri indirme adımı.
3. **Migration:** `Invoice` ve `CheckoutConsent` için `onDelete: SetNull` +
   `organizationId` nullable. PII zaten `redactPaddleWebhooksForOrg` deseniyle
   ayrıca temizlenebilir — yani "finansal iskelet kalsın, kişisel veri gitsin".

⚠️ **Sıra önemli:** bugün tek müşteri kurucu olduğu için bedeli düşük.
`REGISTRATION_OPEN=1` altında ikinci ödeyen müşteri geldikten sonra bu adım
**geriye dönük yapılamaz** (silinen kayıt geri gelmez).

---

## 2. Yedekten prod'a dönüş yolu hiçbir yerde yazılı değil

**Severity:** yüksek · **Migration:** YOK · **Karar:** operasyon

### Kod doğrulaması

- `DEPLOYMENT.md` başlıkları: 1) Proje ve veritabanı · 2) Env · 3) Deploy ·
  4) Zamanlayıcı · 5) Paddle · 6) Outbox · 7) Storage · 8) Claude · 8.5) IP ·
  9) Gölge. **Yedek/geri yükleme bölümü YOK.**
- `docs/` altında yalnız takvim-URL rollback'i var
  (`restore-calendar-url-plaintext.ts`).
- `scripts/ops-restore-drill.ps1` dump'ı **geçici bir kümeye** yüklüyor —
  prod'a dönüşü değil.

### Sorun

Prova "restore çekirdeği 0,7 sn" diyor, ama gerçek felakette (yanlış silme,
bozuk deploy) şu adımların **hiçbiri yazılı değil**: hangi bağlantı dizesi ·
mevcut DB drop mu edilecek yoksa yeni servis mi · `prisma migrate deploy`
restore'dan önce mi sonra mı · `DATABASE_URL` nasıl çevrilecek ·
`ENCRYPTION_KEY`'in kasadan çıkarılması kimin işi · tahmini kesinti ne kadar.

**Prod'a dönüş yolu hiç ölçülmemiş.**

### Provanın iki kör noktası (ikisi de kod-doğrulandı)

**a) Ana veri tabloları hiç ASSERT edilmiyor.** `ops-restore-drill.ps1:62-89`:
`counts.sql` Organization/Property/Reservation/Conversation/Message sayılarını
**ekrana basıyor** (`:71`) ama `assert.sql` (`:64`) yalnız dört şeye bakıyor:
migration sayısı, bitmemiş migration, CalendarSource toplamı, sentinel sayısı.

→ **0 mesaj, 0 rezervasyon, 0 konuşma içeren bir yedek provanın her adımından
yeşil geçer.** Scriptin kendi yorumu (`:81-88`) bu tuzağı tarif ediyor ama
çözümü yalnız CalendarSource'a uygulamış.

**b) Eski bir yedek provalanamıyor.** `ops-restore-drill.ps1:44-51`:

```powershell
$expectedMigrations = (Get-ChildItem "prisma\migrations" -Directory).Count
$dump = Get-ChildItem (... $DumpPattern) | Sort-Object LastWriteTime -Descending | Select-Object -First 1
```

Migration beklentisi **repodaki klasör sayısından** türetiliyor. Bu, "yedek eski,
kod yeni" durumunda **doğru bir yedeği REDDEDER** — oysa asıl felaket senaryosu
("dünkü kötü migration'ı geri al, bir hafta önceki dump'a dön") tam olarak budur.
`$DumpPattern` sabit olduğu için arşivdeki `pre-phase4` dump'ı da hiç sınanmaz.

### Önerilen yol

1. `DEPLOYMENT.md`'ye numaralı bir **"Felaket kurtarma"** bölümü: bağlantı
   dizesi → restore → `migrate deploy` sırası → `ENCRYPTION_KEY` → doğrulama →
   trafiği çevirme. (Railway Pro/PITR lansmandan önce alınacak olsa bile bu
   belge yine gerekli — PITR de aynı kararları istiyor.)
2. Provaya minimum eşik parametreleri: `-ExpectMinReservations`,
   `-ExpectMinMessages` (ya da en azından "herhangi biri 0 ise KIRMIZI").
3. `-ExpectedMigrations <N>` ve `-DumpPath` opsiyonel parametreleri: eski bir
   yedek de provalanabilsin.

---

## 3. Şema varsayılanı hâlâ "yalnız gece" — mevcut müşteriler etkilenmedi

**Severity:** orta · **Migration:** GEREKLİ (istenirse) · **Karar:** ürün +
operatör adımı

### Kod doğrulaması

`prisma/schema.prisma:130-131`:

```prisma
autoReplyStartHour  Int  @default(0)  // window start hour 0-23 (inclusive)
autoReplyEndHour    Int  @default(9)  // window end hour 0-23 (exclusive)
```

Yani şema varsayılanı **00:00–09:00** (yalnız gece), oysa satış sayfası üç yerde
"7/24" diyor (`landing-page.tsx:154, 195, 382`).

### Bugün ne yapıldı

Migration yazmak yasak olduğu için düzeltme **uygulama katmanında** yapıldı:
`NEW_ORG_AUTO_REPLY_WINDOW = {0, 0}` (`src/lib/constants.ts`), org yaratan iki
yol da açıkça yazıyor (kaynak-tarama pini var). Kod `başlangıç == bitiş → tüm
gün` kuralını zaten destekliyor (`isWithinActiveHours`).

### Kalan iki şey

**a) Sadece YENİ org'lar tüm gün açık doğuyor.** Mevcut her org — **Nuve dahil**
— kayıtlı 00:00–09:00 değeriyle devam ediyor. Yani "7/24" iddiası bugünkü canlı
müşteri için **hâlâ yanlış**, ta ki Ayarlar → Otomasyon'dan elle 0/0 yapılana
kadar.

> ⚠️ Bu bir **operatör adımı**, kod işi değil. Hiçbir yerde görev olarak yazılı
> değildi; bu satır o eksiği kapatıyor.

**b) Şema varsayılanı hâlâ yanıltıcı.** İsteyen bir migration ile `@default(9)`
→ `@default(0)` yapabilir. Davranışsal etkisi **sıfır** (uygulama katmanı zaten
açıkça yazıyor), yalnız şemayı okuyanın yanılmamasını sağlar. Düşük öncelik.

---

## 4. Yaşam-döngüsü gönderiminde "gönderildi" iddiası KANITSIZ + kalıcı hata sonsuz tekrar ediyor

**Durum:** Bulgunun GÖRÜNÜRLÜK yarısı 08-01'de uygulandı (koşu başına tek toplu,
PII'siz alarm — `reportLifecycleSendFailures`). Kalan iki yarısı KOLON ister,
o yüzden UYGULANMADI.

**Kod-doğrulaması:** `src/lib/automation.ts` — üç gönderici (`sendDueWelcomes` /
`sendDueCheckins` / `sendDueCheckouts`) claim-then-send yapıyor: damga
(`welcomeSentAt` / `checkinSentAt` / `checkoutSentAt`) POST'tan ÖNCE atılıyor.

**(a) BELİRSİZ hatada damga TUTULUYOR ve önizleme onu "gönderildi" diye
gösteriyor.** Bu bilinçli bir taviz ("duplicate, nadir sessiz kayıptan kötüdür")
ve o kısmı DEĞİŞTİRMEYİN — ama önizlemenin dili yanlış:

```
alreadySent: Boolean(r.welcomeSentAt),   // automation.ts — checkin/checkout aynısı
```

Damga İKİ farklı şeyi birden temsil ediyor: "sağlayıcı teslim etti" ve
"POST ettik ama sonucu bilmiyoruz". Host ekranda ikisini de "Gönderildi" görüyor.
Giriş talimatı KAPI KODUNU taşıdığı için bu ayrım gerçek: misafir kapıda kalır,
host ekranda "gönderildi" görür ve nerede arayacağını bilmez.

**Neden migration:** ayrımı yapmak için üçüncü bir durum gerekiyor — ör. rezervasyon
üzerinde `welcomeSendUnverifiedAt` (+ checkin/checkout eşleri) ya da outbox'taki
`review` emsalinin yaşam-döngüsüne taşınması. Kolonsuz ayrım YAPILAMAZ: bugün
"damga var" dışında hiçbir bilgi saklanmıyor.

**(b) KESİN hatada (4xx≠408) damga geri alınıyor → aynı rezervasyon HER senkron
turunda (2 dk) yeniden POST'lanıyor.** Karşılama sorgusunun üst tarih sınırı yok
(`arrivalDate: { gte: bugün }`), sıra `arrivalDate: "asc"` ve tavan `take: 25`.
Yani kalıcı 4xx dönen bir rezervasyon (thread kapalı / 404 / 422) girişe kadar —
aylarca — dakikada bir sağlayıcı POST'u üretir, sırada EN ÖNDE olduğu için 25'lik
tavanı işgal eder ve gerçek karşılamaları açlığa sokabilir.

⚠️ Oto-yanıtta aynı sınıf 08-01'de `autoReplyHoldUntil` ile çözüldü (geri çekilme,
damga değil) — **`Conversation`'da o kolon zaten vardı.** `Reservation`'da eşdeğeri
YOK, o yüzden aynı çözüm buraya kolon eklemeden taşınamıyor.

**Önerilen (KARAR SİZİN):** rezervasyon üzerinde deneme sayacı + geri çekilme
damgası (ör. `lifecycleSendAttempts` + `lifecycleRetryAfter`), ya da tek bir
`*SendUnverifiedAt` üçlüsüyle (a) ve (b)'yi birlikte çözmek.

**Neden şimdi uygulanmadı:** kolon eklemek migration demek; CLAUDE.md kuralı
gereği dolu tabloya kolon eklenmesi ayrı doğrulama ister ve bu belge Codex'e
gitmek üzere hazırlanıyor. Bugün uygulanan alarm, arızanın **görünmezlik**
kısmını kapattı: artık Sentry'de "welcome delivery failed for N/M reservation(s):
definitive=X, ambiguous=Y" satırı düşüyor.

---

## 4b. Kuyruk yolunda UYGULANMAYAN iki bulgu (08-01, üçüncü tur — migration DEĞİL, karar)

İki denetim ajanının bulduğu ve **bilinçli olarak uygulanmayan** iki madde. İkisi
de `DURABLE_OUTBOX_ENABLED` AÇILDIĞINDA anlam kazanır (bugün bayrak KAPALI).

### (a) `RiskEvent` kuyruk yolunda ENQUEUE anında yazılıyor, satır içi yolda teslimden SONRA

**Kod doğrulaması:** `automation.ts` — kuyruk dalında `recordRiskEvent({
finalDecision: "auto_sent", reason: "gate_passed" })` enqueue'dan hemen sonra
çağrılıyor; satır içi dalda aynı çağrı teslimat onaylandıktan sonra. Gönderim
veto edilir ya da kalıcı olarak başarısız olursa kalıcı olarak "otomatik
gönderildi" diyen bir kayıt kalıyor.

**Neden tutarsız:** `reports.ts` AI-yanıt sayacı teslim edilmemişleri ayıklıyor
(bugün `/sent` ekranı da öyle), ama Raporlar'daki "AI Risk Görünümü" kartı
RiskEvent'i yalnız riskLevel/riskType/reason ile gruplayıp teslimatı hiç
kontrol etmiyor → aynı sayfadaki iki kart ayrışabiliyor.

**Neden UYGULANMADI:** doğru düzeltme kaydı `applyDeliveryEffect`'e taşımak,
ama worker'ın elinde risk sonucu YOK (model çıktısı enqueue anında kalıyor).
Taşımak ya satıra risk alanları eklemeyi (MIGRATION) ya da kaydı iki parçaya
bölmeyi gerektirir. Bayrak kapalıyken canlıda etkisi sıfır → bayrak açılış
turuna bırakıldı.

### (b) `totals.autoReplies` "teslim edilen" değil "kuyruğa alınan" sayıyor

**Kod doğrulaması:** kuyruk yolu teslimattan ÖNCE `sent: true` döndürüyor;
`runDueChannelAutoReplies` yalnız `outcome.sent`'i sayıyor, `queued` bayrağını
hiç okumuyor → koşu raporu ve `/api/cron/sync` çıktısı "gönderildi" diyor.

**Neden UYGULANMADI:** kozmetik/gözlemlenebilirlik; `sent`/`queued` ayrımını
sayaçlara taşımak `ScheduledSyncTotals` şeklini ve üç çağrı yerini değiştirir.
Yanlış bir KARARA yol açmıyor (kimse bu sayaca bakıp mesaj göndermiyor).
Bayrak açılış turunda `queued` ayrı sayılmalı.

### (c) Kabul edilmiş taviz: enqueue ↔ teslimat arası devir penceresi yok

Devir (`human_request`) hold'u artık teslimat onaylanınca kuruluyor. Enqueue ile
drain arasında (normalde AYNI geçişte, saniyeler) misafir yeni bir mesaj yazarsa
kuyruktaki devir satırı `superseded_by_newer_message` ile iptal edilebilir.
**Eski davranış (enqueue'de hold) bu yarışı kapatıyordu ama KESİN bir arıza
üretiyordu** (worker kendi satırımızı `ai_paused` diye iptal ediyordu → devir
mesajı misafire HİÇ gitmiyordu). Nadir yarış < kesin arıza. Tam çözüm, aday
sorgusundan düşüren ayrı bir "devir bekliyor" işareti olurdu = yeni kolon =
MIGRATION. `aiSendVeto`'ya muafiyet yazmak REDDEDİLDİ (host-devraldı korumasını
deler).

---

## 4c. Hospitable bağlantısı koptuğunda HOST'a bildirim gitmiyor (ürün/e-posta kararı)

**Migration DEĞİL — yeni bir MÜŞTERİ E-POSTASI türü, yani ürün + e-posta akışı
kararı.** CLAUDE.md kuralı: "para/e-posta akışına dokunan şeyler kullanıcı
onayıyla açılır" → tek başıma eklenmedi.

### Kod doğrulaması (08-01, dördüncü tur)

- `hospitable-credentials.ts` — refresh token ölünce (`authFailure`) bağlantı
  alanları temizleniyor (`hospitableTokenEnc`/`RefreshTokenEnc`/`ExpiresAt`/
  `Label`/`ConnectedAt` → null).
- Ardından `getOrgHospitableToken` **null** döner → `scheduled-sync` o org'u
  sessizce atlar. Hospitable'a hiç çağrı yapılmadığı için `hospitable-sync`'teki
  401/403 uyarısı **hiç tetiklenmez**.
- `email-templates.ts`'te "hospitable" geçen HİÇBİR şablon yok (grep 0). Mevcut
  şablonlar: taskAssigned · complaintEscalation · reservationCreated ·
  trialEndingSoon · trialEnded · qrEscalation.
- Tek sinyal **operatöre** (kurucuya) giden `reportError`. Bu tur o sinyal
  ayrıştırıldı: artık `hospitable-oauth-disconnected org:{id}` ayrı context'i
  var ve yalnız silme GERÇEKTEN olduğunda (`count === 1`) atılıyor — geçici
  hıçkırıkla karışmıyor.

### Sonuç

Host, ayarlara kendisi bakmadıkça bağlantısının koptuğunu **öğrenmez**; bu arada
misafir mesajları hiç içeri girmez ve hiç yanıtlanmaz. Ödeyen bir müşteri için
sessiz tam kesinti.

### Önerilen (KULLANICI ONAYI GEREKİR)

Silme yazmasından ÖNCE org owner'ına tek satırlık "Hospitable bağlantınız
yenilenemedi, yeniden bağlanın" e-postası + **sonucunun okunması**
(CLAIM-THEN-NOTIFY: silme = claim, e-posta = yan etki). Şablon metni ve gönderim
politikası kullanıcı kararı.

---

## 4g. Codex listesi bittikten SONRA bulunan, KAPSAM DIŞI bırakılanlar (08-01)

Bağımsız denetim ajanı, yedi maddeyi doğrularken KAPSAM DIŞI iki gerçek bulgu
daha çıkardı. Kullanıcının talimatı açıktı ("bunları yap ve dur"), o yüzden
KODLANMADI — ama üstü örtülmesin diye buraya yazıldı. İkisi de **DAR** ve
migration istemiyor.

### (a) `forgot-password` rotasında AYNI kilitleme deseni duruyor

`src/app/api/account/forgot-password/route.ts` — `forgot-confirm:{email}` kovası
(8 / 10 dk) sıfırlama KODU kontrol edilmeden ÖNCE ve KOŞULSUZ tüketiliyor. Yani
Codex'in madde 1'de kapattığı sınıfın birebir aynısı: kurbanın e-postasını bilen
biri, kurbanın MEŞRU sıfırlama kodunu 10 dakika boyunca kullanılamaz yapabilir.

**Dar düzeltme (login'in aynısı):** kovayı yalnız YANLIŞ koddan sonra tüket. Kod
başına deneme sınırı (`pwResetCodeAttempts`) zaten ayrı ve duruyor.

⚠️ §4e'deki "hesap-kovası açıklarını kapat ✅ TAMAM" satırı YALNIZCA GİRİŞ rotası
içindir; bu satır o iddiayı sınırlandırır.

### (b) 2FA/kurtarma kodu denemelerinde hesap-bazlı sınır YOK

Giriş kovası artık yalnız PAROLA hatalarında tüketiliyor. 2FA dalına ancak parola
DOĞRUYKEN gelinir, yani TOTP/kurtarma kodu denemeleri hiçbir hesap-bazlı kovayı
doldurmuyor: parolayı bilen + IP döndüren biri kodları hesap sınırından bağımsız
deneyebilir.

**REGRESYON DEĞİL** — eski `peek` kapısı da TOTP hatalarıyla dolmuyordu; tek fark,
bunu anlatan yorumun bu turda silinmiş olmasıydı (yorum geri kondu).

**Dar düzeltme:** yanlış kod/kurtarma kodu dalında ayrı bir `login-2fa:{userId}`
kovası tüket. 2FA'nın kendi atomik burn + `timingSafeEqual` korumaları duruyor.

---

## 4f. CODEX LİSTESİ (08-01) — madde 6 ve 7: KOD DEĞİL, KARAR

### Madde 6 — `TRUSTED_PROXY_HOPS`: teşhis yöntemi (koddan env değişmez)

**Koddan hiçbir env değeri değiştirilmedi ve değiştirilmeyecek.** Değer yalnız
Railway panelinden, ÖLÇEREK girilir. Yöntem:

1. **Operatör olarak `/admin` → “Operasyon Teşhisi” kartını aç.** Kart, o isteğin
   GERÇEK `x-forwarded-for` zincirini ve her `TRUSTED_PROXY_HOPS` değerinin hangi
   adresi seçeceğini ÖNİZLER. Karar bakışla verilir, bayrak körlemesine çevrilmez.
2. **Zincirdeki adımları TERS DNS ile kimliklendir.** IP sorgu siteleri YANILTIR —
   daha önce kullanıcının sorgusu Google tüneline (`googlezip.net`) düşüp alakasız
   bir adres göstermişti. Doğru araç ters DNS:
   - ISS adı görünüyorsa (`…srv.turk.net`, `dynamic.ttnet.com.tr`) → **gerçek müşteri**.
   - Ters DNS YOKSA / veri-merkezi adıysa (`datapacket.com`) → **altyapı**.
3. **Doğru değer = kartta GERÇEK MÜŞTERİ adresini seçen satır.**

**08-01 ölçümü (kanıtlı):** zincir `188.119.60.236, 212.102.36.193` →
`188.119.60.236` ters DNS `236.60.119.188.srv.turk.net` (TurkNet = müşteri),
`212.102.36.193` ters DNS YOK (altyapı). Kart “`TRUSTED_PROXY_HOPS=2` → 188.119.60.236
← aktif” ve “limitleyicinin kullandığı: 188.119.60.236” diyor. **Değer 2 DOĞRU ve
kullanıcı tarafından Railway'e girildi.**

**⚠️ YÖN KURALI (değişmedi):** az tahmin etmek GÜVENLİ (herkes tek kovaya düşer,
kimlik seçilemez), fazla tahmin etmek TEHLİKELİ (saldırgan zinciri beklenen
uzunluğa getirip seçilen adımı kendi yazar). Emin değilsen küçük değer.

**⚠️ Geçmiş delil satırları BİLEREK DÜZELTİLMEZ.** `User.acceptedIp` (KVKK açık
rıza kanıtı), `CheckoutConsent.ip` (ödeme onayı kanıtı) ve login/2FA/şifre-sıfırlama
audit metadata'sı bayrak öncesinde edge adresini taşıyor. Yeni satırlar doğru olur;
delil kaydı sonradan yeniden yazılmaz.

---

### Madde 7 — Cascade + saklama: SEÇENEKLER ve VERİ KAYBI ETKİSİ

**Migration YAZILMADI.** Hukuk kararı olmadan yazılmaz. Karar netleşsin diye
seçenekler ve her birinin bedeli aşağıda.

#### Bugünkü durum (kod-doğrulandı)

`Organization` silinince şu tablolar **cascade** ile gidiyor: `Invoice`,
`CheckoutConsent`, `Subscription`, `AuditLog`. Silme işleminin kendisi audit'e
**yazılmıyor** (grep 0) → bir org'un var olduğuna ve silindiğine dair **hiçbir iz**
kalmıyor.

CLAUDE.md'nin kendi LEGAL notu ise şunu söylüyor: `Invoice` **10 yıl** (TTK m.82),
`CheckoutConsent` **≥3 yıl zorunlu / 10 yıl önerilen** (MSY m.20/1 + TBK m.146),
e-ileti onay/ret **3 yıl** (Tic. İletişim Yön. m.13). Yani bugünkü davranış ile
belgelenen saklama yükümlülüğü **çelişiyor**.

⚠️ **Bu turda hesap silme ARTIK aktif ödeme aboneliği varken ENGELLENİYOR** (madde 2),
yani "ödeyen müşteri silinip fatura kaydı da yok oluyor" yolu daralmış durumda —
ama iptal edilmiş bir aboneliğin geçmiş faturaları hâlâ cascade ile gidiyor.

#### Seçenek A — Saklanacak tabloların bağını KOPAR (Codex'in önerdiği yön)

`Invoice`/`CheckoutConsent`(/gerekirse `Subscription`) üzerinde `organizationId`
**nullable + `onDelete: SetNull`**; silmede org bağı kopar, satır kalır.

- **Veri kaybı:** yok (satırlar korunur).
- **⚠️ YETMEZ:** Codex'in vurgusu — satırın org silindikten SONRA da **anlamlı ve
  PII'siz** kalması gerekir. Bugün `Invoice`/`CheckoutConsent` üzerinde e-posta/ad
  gibi alanlar varsa onlar da anonimleştirilmeli, yoksa "sildik" vaadi yalan olur.
- **Ek gereksinim:** silinen org'un kimliğini taşımayan, PII'siz bağımsız bir
  `DeletionRecord` (ne zaman, hangi opak referans, hangi yasal dayanak) — bugün
  silmenin hiçbir izi olmadığı için bu ayrı bir eksik.
- **Yan etki:** raporlama/muhasebe sorguları `organizationId`'nin NULL olabileceğini
  bilmeli.

#### Seçenek B — Yumuşak silme + bekleme süresi

`deletionRequestedAt` / `deletionEffectiveAt`; org hemen erişim dışı, gerçek imha
yasal süre dolunca.

- **Veri kaybı:** yok.
- **Bedel:** "hemen sildim" vaadi değişir (metin + KVKK sayfası güncellenir),
  bekleme penceresinde veri DURUYOR — bu, m.7 "resen imha" ile açıkça
  gerekçelendirilmeli. **Avukat sorusu.**

#### Seçenek C — Bugünkü davranış korunur, metin dürüstleştirilir

Cascade kalır; gizlilik/silme metni "fatura kayıtlarınız da silinir" der.

- **Veri kaybı:** var ve KASITLI.
- **Risk:** TTK m.82 / MSY m.20 ile çelişebilir → **saf hukuk sorusu**, kod sorusu değil.

#### Sorulacaklar (avukata)

1. Yabancı (İtalyan) tüzel kişi Türk tüketiciye satış yaparken `Invoice`/
   `CheckoutConsent` için hangi saklama süresi bağlayıcı?
2. Müşteri "hesabımı sil" dediğinde bu kayıtları saklamak m.5/2-ç'ye dayanabilir mi;
   dayanıyorsa gizlilik metninde nasıl açıklanmalı?
3. Silme işleminin kendisi için PII'siz bir `DeletionRecord` tutmak gerekli mi?
4. Bekleme süreli (yumuşak) silme kabul edilebilir mi, kabul edilirse üst sınır?

**⚠️ İkinci ödeyen müşteriden SONRA geriye dönük yapılamaz** — kayıtlar bir kez
silindiğinde geri gelmez. Karar ONDAN ÖNCE alınmalı.

---

### Madde 4'ün açık kalan UX bedeli (soru, kod değil)

Kayıt artık var olan e-postada da genel 201 dönüyor (enumeration kapandı). Bedeli:
hesabı olduğunu unutan gerçek kullanıcı "kutunuzu kontrol edin" görür ama e-posta
almaz. Standart çözüm **"zaten hesabınız var, giriş yapın"** e-postasıdır —
YENİ bir müşteri e-postası türü, yani ürün + e-posta akışı kararı. Tek başıma
eklenmedi. Bugünkü kaçış yolu: giriş sayfasındaki "doğrulama e-postasını yeniden
gönder".

---

## 4e. CODEX KARARLARI (08-01) — migration etiketleri DÜZELTİLDİ

Codex belgeyi gözden geçirdi. Aşağıdaki dört karar **bu belgedeki eski etiketleri
EZER**; gerekçeleri kod-doğrulandı ve katılıyorum (biri hariç, ↓ekleme).

### K1. §4'teki YAŞAM-DÖNGÜSÜ MIGRATION'I İPTAL — kolon EKLENMEZ

Eski metin `Reservation`'a "üçüncü durum" kolonu + `autoReplyHoldUntil` eşdeğeri
öneriyordu. **Yanlış:** `MessageOutbox` zaten `messageType`, `attemptCount`,
`availableAt`, `lastErrorKind`, `providerMessageId`, `sentAt` taşıyor.
`Reservation`'a ikinci bir yeniden-deneme durum makinesi koymak **iki ayrı gerçek**
üretir. Doğru sıra: outbox tarafındaki kalan işler (RiskEvent zamanlaması,
`queued`/`sent` ayrımı, devir penceresi — hepsi §4b'de) kapanır → `DURABLE_OUTBOX_ENABLED`
kontrollü açılır → yaşam-döngüsü zaten outbox durum makinesine devrolur ve sorun
kendiliğinden çözülür. `Reservation.lifecycleRetryAfter` benzeri kolonlar **EKLENMEZ**.

**⚠️ EKLEMEM (Codex'in planındaki boşluk):** bayrak AÇILANA KADAR bayrak-KAPALI
yaşam-döngüsü yolu üretimde hâlâ kalıcı 4xx'te her geçiş yeniden POST'luyor
(Nuve'nin 402'si tam bu durum). Bunun için kolona GEREK YOK: `SystemLock` zaten
alarm pencerelerinde aynı amaçla kullanılıyor →
`lifecycle-backoff:{kind}:{reservationId}` anahtarıyla **migration'sız** geri
çekilme yazılabilir. Bayrak açılışı gecikirse bu yapılmalı; açılış yakınsa gereksiz.

### K2. CSV KÖKENİ İÇİN MIGRATION GERÇEKTEN GEREKLİ — `ingestionOrigin`

`channel` yeterli değil (CSV satırı da "airbnb"/"booking" yazabilir);
`calendarSourceId = NULL` hem CSV hem Hospitable satırlarında bulunuyor.

```
ingestionOrigin String?  // hospitable | calendar_source | csv | file_ics | manual
```

Aşamalı: (1) **hemen** kökeni kanıtlanamayan satırı otomatik temizleme →
**BU TURDA YAPILDI** (`cleanupStaleReservations` artık fail-closed: silme için
satırın Hospitable senkronunda yaratılmış bir KONUŞMASI şart, kanıtsız satır
`unprovableSkipped` olarak sayılır ve rapora çıkar); (2) nullable kolonu additive
migration ile ekle; (3) tüm yeni yazma yollarına doğru kökeni yazdır;
(4) yalnız kanıtlanabilen eski satırları backfill et; (5) `NULL` kalanı **asla**
otomatik silme; (6) %100 kapsama kanıtlanmadan `NOT NULL` YAPMA.

### K3. BAĞLANTI SAĞLIĞI: `Organization.lastStatus` DEĞİL, AYRI MODEL

Airbnb/Booking doğrudan bağlantıları geldiğinde org üzerindeki genel kolonlar kötü
ölçekleniyor. Doğrusu:

```
IntegrationConnection
  organizationId · provider · status
  lastAttemptAt · lastSuccessAt · lastErrorKind · statusChangedAt
  @@unique([organizationId, provider])
```

Ham sağlayıcı cevabı, token veya PII **tutulmaz**. Mevcut Hospitable token alanları
ilk aşamada TAŞINMAZ — bu tablo yalnız sağlık durumu yönetir. (§4d(f)'nin yerine.)

### K4. HESAP SİLME MIGRATION'I HUKUK KARARINA BAĞLI

Neyin kaç yıl saklanacağı avukat tarafından kesinleşmeden yapılmaz. Sonrasında:
`deletionRequestedAt`/`deletionEffectiveAt` bekleme süresi · PII'siz bağımsız
`DeletionRecord` · saklanacak kayıtlarda `organizationId` nullable + `SetNull` ·
gerekli yasal anlık görüntüler · misafir ve kullanıcı PII'sinin anonimleştirilmesi.
**Yalnızca `organizationId`'yi nullable yapmak YETMEZ** — kayıtlar org silindikten
sonra da anlamlı ve PII'siz kalmalı. (§1'in yerine.)

### Diğer migration'lar (Codex sıralaması)

`Message.authorType NOT NULL` mantıklı/düşük risk (önce prod NULL preflight) ·
`totalAmount Float → Decimal` AYRI para turu, başka migration'la birleştirilmez ·
`emailCanonical` deneme-suistimali politikası kararlaşana kadar bekler ·
`CalendarSource.url` DROP (m47) acil değil, sentinel işi görüyor ·
`autoReplyEndHour 9→0` kozmetik, bekleyebilir.

### Uygulama sırası (Codex) — bu turda nereye kadar gelindi

1. ~~`TRUSTED_PROXY_HOPS=2`'yi körlemesine değil, Operasyon Teşhisi ekranında
   doğrulayarak ekle~~ ✅ **TAMAM** — kullanıcı ekledi; ters DNS kanıtı:
   `188.119.60.236` → `236.60.119.188.srv.turk.net` (TurkNet = gerçek müşteri),
   `212.102.36.193` → ters DNS yok (altyapı). Kart "limitleyicinin kullandığı:
   188.119.60.236" diyor.
2. ~~Impersonation ve login hesap-kovası açıklarını migration'sız kapat~~ ✅ **TAMAM**
   (`requireSession` artık impersonation'da `isSuperAdmin`'i yeniden doğruluyor;
   `login-acct` kovası artık kapı DEĞİL: yalnız BAŞARISIZ doğrulamada tüketiliyor,
   doğru parola ondan hiç etkilenmiyor).
3. ~~Cleanup'ı hemen fail-closed yap~~ ✅ **TAMAM** (↑K2).
4. `Reservation.ingestionOrigin` migration'ı — **SIRADAKİ**.
5. `IntegrationConnection` sağlık migration'ı — ayrı tur.
6. Hesap silme/retention migration'ı — hukuk kararı sonrası.
7. `authorType NOT NULL` ve diğer contract işleri — en son.

---

## 4d. Beşinci denetim turunda UYGULANMAYAN bulgular (08-01) — gerekçeleriyle

Beş ajan + kendi ampirik taramam. Aşağıdakiler **bilinçli olarak uygulanmadı**;
her biri ya ENV, ya ürün kararı, ya migration ister.

### (a) 🚨 `TRUSTED_PROXY_HOPS=2` — RAILWAY ENV, KULLANICI GİRECEK (en yüksek etki)

Bayrak set edilmediği sürece `pickClientHop(parts, 1)` zincirin **en sağındakini**
(Railway edge'i) döndürür → **tüm** hız limitleri kişi başına değil GLOBAL çalışır.
Ajanın çıkardığı somut sömürü: tek bir host'tan 5 dakikada 11 `POST /api/auth/login`
→ `login:<railway-edge>` kovası dolar → **hiçbir müşteri giriş yapamaz** (429), ~2
istek/dk ile süresiz sürdürülebilir. Aynı çöküş `register` (5/sa), `leads` (5/sa),
`demo-ai` (6/sa), `guestchat-ip` (20/dk), `ical` (60/dk — Airbnb/Booking takvim
çekimi durur), `verify-resend`, `forgot` için de geçerli. **Kod değişikliği YOK** —
/admin "Operasyon Teşhisi" kartındaki önizlemeyle doğrulayıp Railway'e ekleyin.

### (b) Impersonation oturumu süper-admin yetkisini YENİDEN doğrulamıyor

`requireSession` yalnız kullanıcı + aktör epoch'unu kontrol ediyor, `isSuperAdmin`
çağrısı yok. Sonuç: bir e-postayı `SUPERADMIN_EMAILS`'ten SİLMEK açık impersonation
oturumlarını **sonlandırmıyor**; middleware token'ı her istekte 14 gün uzattığı için
kişi müşteri org'unda owner yetkisiyle süresiz çalışmaya devam edebilir. Tek gerçek
iptal, şifre değişimiyle epoch bump'ı. **Dar düzeltme:** `requireSession` içinde
`session.actorUserId` varken `isSuperAdmin(session)` de doğrulansın (false → 401).
**Neden uygulanmadı:** her API isteğine bir kontrol ekliyor ve oturum-geçersizleştirme
semantiğini değiştiriyor — canlı kimlik yolunda kullanıcı onayı istiyorum.

### (c) Sayfa katmanındaki rol kontrolü BAYAT JWT'den okuyor

`middleware.ts` staff yönlendirmesini JWT'deki `role` ile yapıyor ve her istekte
token'ı **aynı rolle yeniden imzalayıp** 14 günü sıfırlıyor → DB'de düşürülen bir rol
sayfa yolunda asla yürürlüğe girmiyor (`requireAuth` DB rolünü okuyor ama sayfaların
çoğunda rol kontrolü YOK; yazma yolları kapalı, **okuma** açık kalıyor).
Bugün etkisi sınırlı: CLAUDE.md'nin yazdığı gibi **rol değiştiren yüzey YOK** (düşürme
elle SQL). **Dar düzeltme:** `sent/queue/page.tsx` ve `tasks/new/page.tsx` emsalindeki
tek satırlık `canManage` redirect'i rol kontrolü olmayan `(app)` sayfalarına da
eklensin — **ekip yönetimi eklenmeden ÖNCE ŞART** (sessionEpoch bump'ıyla birlikte).

### (d) ✅ UYGULANDI (08-01, Codex madde 1) — `login-acct` kovası kapı olmaktan çıktı

Başarılı denemeler de sayıldığı için e-postasını bilen biri hedefi kalıcı giriş
dışı bırakabilir: 15 dakikada 21 istek (~1,4/dk) → kurban DOĞRU şifresiyle bile 429.
Aynı desen `forgot-confirm:{email}`. **Dar düzeltme:** hesap kovasını yalnız
BAŞARISIZ doğrulamadan sonra tüket (IP kovası zaten önde). **Neden uygulanmadı:**
kimlik doğrulama sırasını değiştirmek zamanlama-sızıntısı yüzeyine dokunuyor
(`dummyVerifyPassword` dengesi) — ayrı ve dikkatli bir tur hak ediyor.

### (e) ✅ UYGULANDI (08-01, Codex madde 4) — kayıt rotası genel yanıt döndürüyor

`POST /api/auth/register` var olan e-postada açıkça "zaten kayıtlı" diyor; giriş,
şifre-sıfırlama ve doğrulama-tekrar yollarının hepsi enumeration-korumalı. **Neden
uygulanmadı:** tekdüze yanıt, "zaten hesabınız var" e-postası gerektirir = yeni bir
müşteri e-postası türü = ürün + e-posta akışı kararı.

### (f) Hospitable bağlantı SAĞLIĞI panelde görünmüyor

`connected` yalnız "şifreli token çözülüyor mu" demek. Abonelik 402'ye düşünce
(canlı hesabın bugünkü durumu) Ayarlar hâlâ yeşil **"Bağlı."** diyor, mesaj akışı
sessizce duruyor. **MIGRATION İSTER:** `Organization`'da `lastSyncedAt`/`lastStatus`/
`lastError` üçlüsü yok (bu alanlar yalnız `CalendarSource`'ta var).

### (g) "Hayalet rezervasyon" temizliğinde CSV sınırı

Bu turda iCal satırları `calendarSourceId` ile kapsam dışına alındı, ama **CSV ile
içe aktarılan satırların da `calendarSourceId`'si NULL** — onlar hâlâ aynı kümede.
Tam ayrım satırın KÖKENİNİ tutan bir kolon ister = MIGRATION.

### (h) Ölü kod ve tek-kaynak sapmaları (temizlik, davranış değişmez)

- `assertTransition` ve `CLAIMABLE_STATUSES` (`outbox/state.ts`) **0 referans**;
  gerçek kapı `canTransition`. Yorum var olmayan bir korumayı anlatıyor.
  `recoverStaleClaims` `settle`'ı atlayarak doğrudan yazıyor (hiçbir kapıdan geçmiyor).
- `getOccupancyForecast` ve `getResponseTimeStats` (`reports.ts`) üretimde **çağrılmıyor**
  (ilkinin tek çağıranı bir test). 07-27'deki DST düzeltmesi hiç koşmayan koda yapılmış.
- `ai/openai-compat.ts` "TEK KAYNAK … üç çağrı yeri" diyor ama **iki** dosya import
  ediyor; ana yanıt (`ai/index.ts`) ve çeviri gövdeyi elle kuruyor. Ölçülebilir sapma:
  stil-profili çağrısında **hiçbir çıktı tavanı yok** ve model↔endpoint uyum kontrolü
  o yollarda hiç koşmuyor.
- `sendDueAlerts` JSDoc'u iki kez yanlış ("ALERT_EMAIL ile açılır" — kullanılmıyor;
  "e-posta hataları yutulur" — artık okunuyor ve claim geri alınıyor).
- `human_hold` görünürlük yazması ULAŞILAMAZ: aday sorgusu `autoReplyHoldUntil`
  geleceğe dönük satırları zaten dışarıda bırakıyor → inbox etiketi hiç render edilemez.
  (`outside_hours` emsalindeki gibi aday sorgusunun DIŞINDA yazılmalı.)
- `Task` süpürgesi rezervasyon-kapsamlı dalda `sourceMessageId` bağını kullanmıyor →
  konuşma SONRADAN rezervasyona bağlanırsa görev iki dalın da dışında kalıyor (KVKK).

### (i) Müşteri gözü — küçük ama gerçek

- Görev fotoğrafları `STORAGE_ENABLED` kapalıyken **ephemeral** diske yazılıyor ve UI
  "Fotoğraf kaydedildi." diyor; deploy'da kayboluyorlar. Bucket turuna kadar tek satır
  uyarı gerekir.
- Raporlar "AI **yanıtladı**" sayısı `aiAssisted` (host'un onaylayıp KENDİ gönderdiği)
  taslakları ve yaşam-döngüsü mesajlarını da içeriyor; Gönderilenler çipi içermiyor →
  iki ekran farklı sayı gösteriyor. Metin/sayım kararı.
- `daily_budget` etiketi "sınır yenilenince" diyor ama pencere ilk çağrıya çapalı kayan
  24 saat; `dailyBudgetMessage` zaten "Yaklaşık N saat sonra" üretiyor, etiket kullanmıyor.
  Ayrıca panelde kotanın ne kadarının kullanıldığını gösteren **hiçbir yüzey yok**.

---

## 5. Bekleyen eski migration işleri (CLAUDE.md'den — hatırlatma)

Bunlar bugünün bulgusu değil, listede duruyor:

- **`Message.authorType` Faz-B** (NOT NULL). Ön koşul: prod'da `NULL` sayısı 0.
- **Para Faz-B/C** (Decimal tek kaynak → Float düşür). Ön koşul: prod
  reconciliation = 0 ✅ (07-13).
- **`emailCanonical` kolonu + deneme uygunluğu** — bilinçli yazılmadı, kullanıcı
  onayı gerekir.
- **m47 (`CalendarSource.url` kolonunu DROP)** — bilinçli YAZILMADI. Sentinel işi
  görüyor; istenirse ayrı karar.
- **`Task @@unique([propertyId, dedupeKey])`** — bilinçli DIŞARIDA (done → aynı
  gün yeniden açılabilmeli).

---

## Bu belgeye eklenmeyenler ve neden

- **KB sayım TOCTOU'ları** (say-sonra-yarat): kullanım kapısı, en fazla birkaç
  kayıt kazandırır. Migration ya da kilit eklemek maliyetine değmiyor.
- **Pasif KB kaydı tavansız:** satır büyümesi var ama AI okumadığı için plan
  atlatma değil. İzlenecek, acil değil.
- **`alertEmail` yalnız org üyesi kabul ediyor:** ekip-ekleme yüzeyi olmadığı
  için alan fiilen sahibin kendi adresine kilitli. Güvenlik gerekçesi doğru
  (açık e-posta rölesiydi), ama ürün kararı gerekiyor: ya doğrulama akışı
  (adrese kod → onay) ya da metni "yalnız hesabınızın e-postası" diye düzeltmek.
  Migration istemez; ürün kararı olduğu için burada değil, not olarak duruyor.
