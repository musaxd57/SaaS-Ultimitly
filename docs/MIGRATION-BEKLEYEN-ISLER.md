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
