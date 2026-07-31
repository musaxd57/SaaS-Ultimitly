# Migration / karar bekleyen işler — Codex'e

> **Durum:** hiçbiri UYGULANMADI. Bu belge yalnız bulguları, kod
> doğrulamalarını ve önerilen yolları taşır.
> **Tarih:** 2026-07-31 · **Kaynak:** aynı gün koşan 7 salt-okuma denetim turu.
> **Neden burada:** üçü de ya migration ister ya da ürün/operasyon kararı ister;
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

## 4. Bekleyen eski migration işleri (CLAUDE.md'den — hatırlatma)

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
