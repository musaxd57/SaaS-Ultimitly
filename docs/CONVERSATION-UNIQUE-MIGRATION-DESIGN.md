# Conversation `@@unique([propertyId, externalReservationId])` — migration tasarımı

> ## ✅ KAPANDI — 2026-07-26. Migration 45 prod'da CANLI ve DB'den doğrulandı.
> `436722c` push edildi, CI 4/4, Railway ACTIVE, healthcheck 200.
> `_prisma_migrations`: `45_conversation_identity_unique` finished_at DOLU,
> rolled_back_at BOŞ, applied_steps_count=1 · index `indisunique=t indisvalid=t`.
> Adım 1 (QR ileri-uyumluluk) `6c06e0b` ile ÖNCE canlıya alındı.
> Aşağıdaki metin tasarım anındaki hâliyle korunmuştur (tarihsel kayıt).
>
> Durum (o an): **TASARIM. KOD YOK, MIGRATION YOK, PUSH-TO-DEPLOY YOK.**
> Tarih: 2026-07-26 · Ön koşul zinciri: preflight ✅ → Faz A (`3effd99`) ✅ →
> dry-run ✅ → **apply ✅** (apply=0, verify=0; 7 grup birleşti, 7 loser silindi,
> 29 tam-eşit duplicate düştü, benzersiz/NULL mesaj kaybı 0, FK'sız referans 0).
> Apply sonrası ölçüm: **Çakışan grup 0 · Conversation 1328 · Message 17436.**

---

## 0. Bu turda ne YAPILMADI (bilinçli)

Migration dosyası yazılmadı, `schema.prisma` değiştirilmedi, prod'a bağlanılmadı.
Sebep sadece talimat değil, **operasyonel bir gerçek**: branch
`claude/great-edison-3zqpZ` Railway'e oto-deploy ediyor ve boot komutu
`prisma migrate deploy`. Yani **migration'ı push etmek = migration'ı prod'da
çalıştırmak**. "Yaz ama çalıştırma" ancak commit'i push ETMEYEREK mümkün.
Bu yüzden aşağıdaki Adım-2 paketi, açık deploy onayı gelene kadar push edilmez.

---

## 1. Kısıtın tam tanımı

```prisma
model Conversation {
  ...
  @@unique([propertyId, externalReservationId])
}
```

Prisma'nın üreteceği DDL (m44'teki `EmailOutbox_userId_kind_version_key`
emsaliyle birebir aynı kalıp):

```sql
CREATE UNIQUE INDEX "Conversation_propertyId_externalReservationId_key"
  ON "Conversation"("propertyId", "externalReservationId");
```

### NULL semantiği — ürünün kırılmaması buna bağlı

PostgreSQL varsayılanı `NULLS DISTINCT`: `(propertyId, NULL)` çiftleri **sınırsız
tekrar edebilir**. Manuel konuşmalar `externalReservationId` yazmaz
(`src/app/api/conversations/route.ts:53` — kod-doğrulandı, alan `data`'da hiç
yok → NULL), dolayısıyla kısıt onları **hiç bağlamaz**. İSTENEN budur.

> ⛔ **`NULLS NOT DISTINCT` (PG15+) KULLANILMAYACAK.** Kullanılırsa mülk başına
> tek manuel konuşmaya inilir ve ürün kırılır. Prisma zaten üretmez; elle
> eklenmesi de yasak.

Kısıt fiilen yalnız **sync** ve **QR** satırlarını bağlar.

### `CONCURRENTLY` gerekli mi? — HAYIR

Tablo **1328 satır** (dedupe APPLY'ından SONRA ölçülen prod değeri; apply
öncesi 1335 idi, 7 loser silindi). Düz `CREATE UNIQUE INDEX` milisaniyeler sürer ve bu
sürede yalnız SHARE kilidi tutar (okumalar akmaya devam eder).
`CONCURRENTLY`'nin bedeli ise gerçek: başarısız olursa arkada **INVALID index**
bırakır ve elle `DROP` istemez — bu, boot-time `migrate deploy` için düz
index'ten **daha kötü** bir arıza modu. CLAUDE.md'deki "büyük canlı tabloya
index → CONCURRENTLY değerlendir" kuralı geçerli ama **bu tablo büyük değil**;
kural burada tetiklenmiyor.

### Mevcut index'lere etkisi

| Index | Karar | Gerekçe |
|---|---|---|
| `@@index([externalReservationId])` | **KALIR** | Yeni bileşik index'in ÖNCÜ kolonu `propertyId`; `externalReservationId`-tek-başına aramayı karşılayamaz |
| `@@index([propertyId])` | **DOKUNULMAZ** | Zaten `[propertyId, status, lastMessageAt]` tarafından fazlalık hâle getirilmişti — bu turun konusu değil, index düşürmek AYRI karar |
| Yeni bileşik unique | eklenir | — |

Kapsam disiplini: bu migration **yalnız ekler**, hiçbir şey düşürmez.

---

## 2. 🚨 BLOKLAYAN BULGU — QR yolu migration'a hazır DEĞİL

`src/app/api/chat/[token]/route.ts:135-175`, `ensureGuestChatConversation`:

```ts
} catch (err) {
  if (!isUniqueViolation(err, ["id"])) throw err;   // ← YALNIZ PK kabul ediliyor
  return qrConversationId;
}
```

İki eşzamanlı "ilk tarama" **aynı iki kısıtı birden** ihlal eder:
deterministik PK `qrconv_{reservationId}` **ve** (migration sonrası)
`(propertyId, "qr-chat:{propertyId}:{reservationId}")`. PostgreSQL P2002'yi
hangi index üzerinden raporlayacağını **garanti etmez**. Bileşik unique
üzerinden raporlarsa:

`isUniqueViolation(err, ["id"])` → `false` (fonksiyon tam-küme eşitliği arar,
`src/lib/db-errors.ts` kod-doğrulandı: `cols.length === columns.length &&
columns.every(...)`) → **hata rethrow edilir → misafire QR sohbette 500.**

Bu, FOR UPDATE kilit sıralamasında reddettiğimiz "planlayıcıya güven"
varsayımının aynısı. **Migration'dan ÖNCE kapatılmalı.**

**Düzeltme (Adım 1):** iki kısıttan HERHANGİ biri kabul edilir —

```ts
const raced =
  isUniqueViolation(err, ["id"]) ||
  isUniqueViolation(err, ["propertyId", "externalReservationId"]);
if (!raced) throw err;
return qrConversationId;   // kazananın satırı; her iki yolda da AYNI id
```

Güvenli, çünkü ikisi de **aynı** deterministik satırı işaret eder: marker
`propertyId`+`reservationId` gömer, PK `reservationId` gömer → çakışan taraf
tanımı gereği aynı rezervasyonun aynı QR konuşmasıdır.

### Aynı fonksiyondaki BAYAT YORUM da düzeltilecek

Satır 148-150: *"externalReservationId'ye tablo-geneli @@unique koymak
Hospitable satırlarını da bağlardı (**aynı rezervasyonun birden çok gerçek
thread'i meşru**)"*.

Bu, CLAUDE.md'nin "migration'dan önce karara bağla" dediği **tek çelişkili
sinyaldi**. Prod preflight kararı verdi: 7 çakışan grubun **7'sinde de
`externalConversationId` AYNI** — sağlayıcı tek thread veriyor, çift satır
bizim yarışımızdı. Yorum artık yanlış ve gelecekteki bir okuyucuyu kısıtı
kaldırmaya ikna edebilir → düzeltilecek.

---

## 3. Diğer yazma yollarının hazırlık durumu (kod-doğrulandı)

`Conversation` yaratan **tam olarak üç** yol var (`grep conversation.create`):

| Yol | Dosya | `externalReservationId` | Migration'a hazır mı |
|---|---|---|---|
| Sync | `hospitable-sync.ts:764` | sağlayıcı rezervasyon UUID'si | ✅ **HAZIR** — NS-43 kilidi + tek-seferlik P2002 retry'ı `["propertyId","externalReservationId"]` için ZATEN yazılmış (`:355-382`), bugün uykuda, migration ile **silahlanır** |
| QR | `chat/[token]/route.ts:155` | `qr-chat:{propertyId}:{reservationId}` | ⚠️ **HAYIR** — §2'deki boşluk |
| Manuel | `api/conversations/route.ts:53` | yazılmaz → **NULL** | ✅ kısıt hiç bağlamaz |

**Değer uzayları çakışmaz:** QR marker'ı `qr-chat:` önekli, Hospitable'ınki çıplak
UUID → bir QR satırı bir sync satırıyla asla aynı anahtarı üretemez.

**iCal hiç Conversation yaratmaz** (yalnız `Reservation`) → kapsam dışı.

---

## 4. Boot riski ve geri alma

**Arıza modu:** index oluşturulamazsa (o an bir çift varsa) `migrate deploy`
başarısız olur → konteyner boot edemez → **outage**. Bu, `chatToken` dersinin
birebir aynısı; hafife alınmayacak.

**Neden bu sefer güvenli (üç bağımsız gerekçe):**
1. Apply sonrası ölçüm **0 çakışan grup** (dry-run exit 0 = `conflicting = planned + fail_closed = 0`, kod-doğrulandı).
2. Faz A (`3effd99`, Railway'de ACTIVE) NS-43 advisory kilidiyle **yeni çift üretilmesini yapısal olarak engelliyor** — 7 grup kapalı bir kümeydi ve boşaltıldı.
3. §3'teki üç yolun hiçbiri çakışan bir çift üretemez (değer uzayları ayrık + manuel NULL).

**Yine de deploy anında son kapı:** migration'ı push etmeden hemen önce
salt-okuma dry-run tekrar koşulur; `Çakışan grup 0` görülmeden push edilmez.

**Rollback runbook** (boot patlarsa, sırayla):
```sql
DROP INDEX IF EXISTS "Conversation_propertyId_externalReservationId_key";
```
```bash
npx prisma migrate resolve --rolled-back 45_conversation_identity_unique
```
Ardından `schema.prisma`'daki `@@unique` geri alınıp yeniden deploy. Migration
**salt-ekleme** olduğu için veri kaybı yolu yok; geri alma yalnız index düşürür.

---

## 5. Adım planı

### Adım 1 — QR forward-compat (MIGRATION YOK, push GÜVENLİ)
- `ensureGuestChatConversation` iki kısıtı da kabul etsin (§2)
- Bayat yorumu düzelt (§2)
- **Kırmızı-önce test:** composite-unique kurulu test DB'sinde iki eşzamanlı ilk-tarama → tek konuşma, 500 YOK, mesaj kaybı YOK. Düzeltme geri alınınca test kırmızıya dönmeli.
- Full suite + typecheck + lint + build + CI 4/4 → push

### Adım 2 — migration paketi (push = DEPLOY, açık onay ŞART)
- `schema.prisma`'ya `@@unique([propertyId, externalReservationId])`
- `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url postgresql://postgres@localhost:5432/shadow --script` → `prisma/migrations/45_conversation_identity_unique/migration.sql`
- Taze throwaway PG'de **00→45 `migrate deploy`** + `migrate diff --exit-code` ile **sıfır-drift** doğrulaması
- **Zorunlu sıra adım (6):** uzatılmış kilit süresiyle iki paralel sync → **TEK conversation + TEK mesaj seti** pinlenir. (Bugün mevcut kırmızı-önce kanıt bunun yarısı: kilit kaldırılınca unique'in P2002 fırlattığı `conversation-dedupe-apply.test.ts`'te zaten pinli — eksik olan, kilit + unique BİRLİKTEyken tek satır/tek mesaj iddiası.)
- Test harness `db push` kullandığı için `@@unique` şemaya girdiği an tüm entegrasyon testleri kısıtla koşar — **regresyon buradan yakalanır**
- Push, ancak: (a) Adım 1 canlıda, (b) taze `pg_dump` alınmış, (c) o an dry-run `Çakışan grup 0` diyor, (d) kullanıcı deploy'u izlemeye hazır — dördü birden sağlanınca

---

## 6. Açık kalan tek belirsizlik (dürüst kayıt)

`developer.hospitable.com` üç URL'de de HTTP 403 döndüğü için **resmî API
dokümanı hâlâ okunamadı**. Bileşik anahtarın doğruluğu üç bağımsız sinyale
dayanıyor (kod invariant'ı · tekil `conversation_id` alanı · `/conversations`
ucunun HİÇ olmaması) + prod preflight'ın 7/7 aynı-thread ölçümü. Bu, *bizim
kullandığımız API yüzeyi* için yeterli kanıt; Hospitable'ın tüm veri modeli
için değil. Ağ erişimi olan bir ortamdan teyit hâlâ borç — ama kısıtı
bloklamıyor, çünkü ölçüm gerçek prod verisinden geldi.
