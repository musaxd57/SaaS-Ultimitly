# `RETENTION_MESSAGE_AGE_ANCHOR` — açılış onay paketi

> **08-09 (2), P1 #3.** Kod HAZIR ve **varsayılan KAPALI** (`203f08e`).
> Kullanıcı direktifi: *"Bayrağı benim ayrıca açık onayım olmadan açma."*
> Bu belge açmadan ÖNCE cevaplanması gereken soruları, salt-okuma ölçüm
> sorgularını, ilk koşu smoke kontrolünü ve **geri alma sınırını** yazar.
>
> ⚠️ **BU BELGE BİR AÇILIŞ EMRİ DEĞİL.** Hiçbir prod/env değişikliği
> yapılmadı ve yapılmayacak.

---

## 0. NEDEN AÇILSIN — tek cümlede

Süpürge **rezervasyon başına tek atımlık**: seçici `guestName != 'Eski misafir'`
diyor ve o sentinel'i süpürgenin **kendisi** yazıyor → bir kez temizlenen
konaklama **sonsuza dek** dışarıda kalıyor. Ölçüldü: 40 ay önce çıkışlı bir
konaklama süpürüldükten **sonra** aynı konuşmaya yazılan misafir mesajı ikinci
koşuda **birebir sağ kaldı** ve bir daha asla seçilmez.

Bayrak açıkken hüküm **mesajın kendi yaşına** göre verilir: (a) seçici
tekrarlanabilir olur, (b) temizlik cutoff'tan eskiyle sınırlanır. **(b) olmadan
(a) yapılamaz** — yalnız seçiciyi genişletmek, taze mesajı olan her eski
konaklamayı sonsuza dek yeniden seçip **host'un cevaplamak için okuması gereken
canlı mesajı** silmeye çalışırdı.

---

## 1. SALT-OKUMA ETKİ ÖLÇÜMÜ

⚠️ **Hepsi `SELECT`. Hiçbiri yazmaz.** Railway → Postgres → Query.
`DATA_RETENTION_MONTHS=24` varsayımıyla cutoff `now() - interval '24 months'`.

### 1a. Kaç satır YENİ olarak temizlenecek? (kapanan sızıntı)

```sql
-- Bayrak ACILINCA ilk kosuda ANONIMLESECEK mesajlar.
-- Bunlar BUGUN kaciyor: konaklama zaten supurulmus (sentinel yazili) ama
-- mesaj cutoff'tan ESKI ve HALA temizlenmemis.
SELECT count(*) AS yeni_temizlenecek_mesaj,
       count(DISTINCT c."id")  AS etkilenen_konusma,
       count(DISTINCT r."id")  AS etkilenen_rezervasyon,
       min(m."createdAt")      AS en_eski,
       max(m."createdAt")      AS en_yeni
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
JOIN "Reservation"  r ON r."id" = c."reservationId"
WHERE m."direction" = 'inbound'
  AND m."body" <> '[saklama süresi doldu — içerik silindi]'
  AND m."createdAt" < now() - interval '24 months'
  AND r."departureDate" < now() - interval '24 months'
  AND r."guestName" = 'Eski misafir';   -- <- ZATEN supurulmus: bugun kacan kume
```

### 1b. Kaç satır ARTIK silinmeyecek? (kapanan aşırı-silme)

```sql
-- Bayrak ACILINCA KORUNACAK mesajlar. Bunlar BUGUN ilk supurge gecisinde
-- yok ediliyor: konaklama eski ama mesaj TAZE (host'un cevaplamasi gereken).
SELECT count(*) AS artik_korunacak_mesaj,
       count(DISTINCT c."id") AS etkilenen_konusma
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
JOIN "Reservation"  r ON r."id" = c."reservationId"
WHERE m."direction" = 'inbound'
  AND m."body" <> '[saklama süresi doldu — içerik silindi]'
  AND m."createdAt" >= now() - interval '24 months'   -- <- TAZE
  AND r."departureDate" < now() - interval '24 months'
  AND r."guestName" <> 'Eski misafir';                -- <- henuz supurulmemis
```

### 1c. Öksüz dal (rezervasyonsuz konuşmalar)

```sql
SELECT count(*) FILTER (WHERE m."createdAt" <  now() - interval '24 months') AS yeni_temizlenecek,
       count(*) FILTER (WHERE m."createdAt" >= now() - interval '24 months') AS artik_korunacak
FROM "Message" m
JOIN "Conversation" c ON c."id" = m."conversationId"
WHERE c."reservationId" IS NULL
  AND c."lastMessageAt" < now() - interval '24 months'
  AND m."direction" = 'inbound'
  AND m."body" <> '[saklama süresi doldu — içerik silindi]';
```

### 1d. Ölçek kontrolü (parti tavanı yeterli mi)

```sql
-- RETENTION_BATCH = 300 rezervasyon/gecis. Bu sayi 300'u cok asarsa supurge
-- birkac cron gecisine yayilir (sorun degil, ama beklentiyi belirler).
SELECT count(*) AS ilk_gecisde_secilecek_rezervasyon
FROM "Reservation" r
WHERE r."departureDate" < now() - interval '24 months'
  AND (r."guestName" <> 'Eski misafir'
       OR EXISTS (SELECT 1 FROM "Conversation" c
                  JOIN "Message" m ON m."conversationId" = c."id"
                  WHERE c."reservationId" = r."id"
                    AND m."direction" = 'inbound'
                    AND m."body" <> '[saklama süresi doldu — içerik silindi]'
                    AND m."createdAt" < now() - interval '24 months'));
```

---

## 2. ETKİLENECEK SATIRLARIN SINIFLANDIRMASI

| Sınıf | Ne olur | Geri alınabilir mi | Not |
|---|---|---|---|
| **A. Eski + temizlenmemiş inbound mesaj gövdesi** (1a) | `body` → sabit metin, `senderName` → `Misafir`, `aiSuggestedReply` → NULL | ❌ **HAYIR** | Kapanan sızıntı. Asıl kazanç bu. |
| **B. Taze inbound mesaj, eski konaklamada** (1b) | **Hiçbir şey** — artık korunur | — | Bugünkü **aşırı-silme** durur. Bayrak açılınca bu satırlar KURTULUR. |
| **C. Rezervasyon PII'si** (`guestName`/`phone`/`email`) | Zaten bugünkü davranış; değişmez | ❌ | Bayraktan bağımsız. |
| **D. Giden (outbound) gövdeler** | Yalnız **ad redaksiyonu** (host'un iş kaydı kalır) | ❌ | Değişmedi. |
| **E. Görev başlığı/açıklaması, `TaskUpdate.note`** | Bugünkü davranış | ❌ | Değişmedi. |
| **F. Öksüz konuşmalar** (1c) | A ve B ile aynı mantık | ❌ (A yönü) | Kardeş dal, aynı sınır. |

🚨 **A ve F GERİ ALINAMAZ.** Anonimleştirme yıkıcıdır; `pg_dump` dışında
kurtarma yolu **yoktur**.

---

## 3. AÇMADAN ÖNCE — ÖN KOŞULLAR

1. **TAZE `pg_dump` alınmış ve DOĞRULANMIŞ olmalı** (`pg_restore -l` ile arşiv
   okunabilirliği teyit edilir). Deponun kendi ritüeli:
   `ops-backup-prod.ps1`. ⚠️ Yedeksiz açılmaz — geri alma yolu **budur**.
2. **1a/1b/1c/1d koşulmuş ve sayılar okunmuş** olmalı. Beklenmedik büyük bir
   sayı (ör. 1a çok yüksek) "daha çok temizlik" değil, **önce anlaşılması
   gereken bir durum** demektir.
3. `DATA_RETENTION_MONTHS`'ın gerçekten `24` olduğu Railway'den teyit edilmeli
   (sorgulardaki `24 months` ona bağlı).
4. **Açık onay.** Bu belge onay yerine geçmez.

---

## 4. AÇILIŞ VE İLK KOŞU SMOKE

1. Railway env: `RETENTION_MESSAGE_AGE_ANCHOR=1` → redeploy.
2. ⚠️ **İlk cron geçişinde koşar** (2 dakika). Bekleme penceresi kısa.
3. **Smoke (salt okuma, sırayla):**
   - **1a sorgusunu TEKRAR koş** → sayı **azalmış** olmalı (ideal: 0, ya da
     parti tavanı yüzünden birkaç geçişte inen bir sayı).
   - **1b sorgusunu TEKRAR koş** → sayı **değişmemiş** olmalı. ⚠️ **Bu satır
     düşerse DUR ve bayrağı kapat**: taze mesaj siliniyor demektir; kapatmanın
     amacı tam olarak buydu.
   - Panelden bir **eski konuşma** aç → gövdeler `[saklama süresi doldu…]`
     görünmeli, başlık/tip okunur kalmalı.
   - Panelden **son 24 aydaki** bir konuşma aç → **hiçbir şey değişmemiş**
     olmalı.
   - `[scheduled-sync]` log'unda hata/alarm **olmamalı**.
4. Bir sonraki geçişte 1a sayısı **artmıyorsa** terminasyon doğrulanmıştır
   (test-pinli: dört ardışık geçiş satırı yeniden yazmıyor).

---

## 5. GERİ ALMA SINIRI — dürüstçe

| Ne | Geri alınabilir mi |
|---|---|
| **Bayrağın kendisi** | ✅ `RETENTION_MESSAGE_AGE_ANCHOR` env'ini **sil** → davranış birebir eskiye döner. Deploy gerekir mi: env değişikliği Railway'de redeploy tetikler; kod değişikliği **gerekmez**. |
| **Zaten anonimleştirilmiş satırlar** | ❌ **HAYIR.** Env'i silmek geçmişi geri getirmez. Tek yol `pg_dump`'tan restore. |
| **Kısmi geri alma** | ❌ Yok. Süpürge satır satır seçici çalışır ama "sadece şu org'u geri al" diye bir yol yoktur. |

🚨 **BU YÜZDEN SIRA ÖNEMLİ:** yedek → ölçüm → onay → aç → smoke. Bayrağı
kapatmak yalnız **bundan sonrasını** durdurur.

---

## 6. BU BELGE YAZILDIĞINDA DOĞRU OLANLAR

- Kod `203f08e` ile push'lu, bayrak **varsayılan KAPALI**.
- **İki test bugünkü KUSURLU davranışı da açıkça pinliyor** — yani bayrak
  açılmadan canlıda hiçbir satır farklı işlenmez.
- Üç mutasyon iki yönde kırmızı: bayrağı varsayılan AÇIK yap · bayrağı hiç
  açılamaz yap (ölü kaçış kapısı) · yaş sınırını sil.
- Terminasyon test-pinli.
- **Ölçüm sorguları bu ortamdan KOŞULMADI** — üretim DB'sine erişimim yok ve
  olmamalı. Sayılar operatör tarafından okunacak.
