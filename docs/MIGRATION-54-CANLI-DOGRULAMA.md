# Migration 54 (temellendirme izlenebilirliği) — canlı doğrulama

> Commit `a621724..d972b87` · push 2026-09-08 19:18Z · yedek
> `lixus-prod-post-contract-2026-09-08-221546.dump` (1.476.647 bayt · TOC 226 girdi ·
> SHA256 `F7F0BA3B6E0D750176FF6915A16D0B6937F10E97F5CD4FA3763CEABD878D7B18`).
> **Hepsi SALT-OKUMA.** Migration 53'te işe yarayan blokla aynı; `$query` yerine aşağıdaki metni koy.
> 🚨 Bu belgenin sonunda **geri alma** yok — 54'ün tüm kolonları yeni ve nullable, yani geri alma
> gerektirecek bir veri dönüşümü YOK. Bir sorun olursa dalı geri almak yeterli.

## Beklenen tablo — 53'ten FARKLI
Migration 53'te "mevcut satırlar `legacy` doğmalı" diye bir dönüşüm vardı. Burada YOK: yedi kolon da
**yepyeni ve nullable**. Bu yüzden beklenen sonuç şu:
- Mevcut `RiskEvent` satırlarının **hepsinde yedi kolon da NULL** (o kararlar ölçülmedi — 0 DEĞİL, NULL).
- Yalnız **migration'dan SONRAKİ** QR/oto-yanıt kararları sayaç yazar.
- Yani hemen sonra bakarsan büyük ihtimalle **hiç dolu satır göremezsin**; bu ARIZA DEĞİL. Dolu satır
  görmek için önce bir QR mesajı göndermen gerekir (§B).

---

## A. Deploy sonrası (tek blok, salt-okuma)

```sql
-- 1) Migration uygulandı mı?
SELECT migration_name, finished_at, rolled_back_at
FROM "_prisma_migrations" WHERE migration_name LIKE '54%';

-- 2) Yedi kolon ve tipleri
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='RiskEvent'
  AND column_name IN ('kbRetrieved','kbDropped','kbPendingApproval','kbNewestUpdatedAt',
                      'kbEvidenceJson','srcDeclared','srcVerified')
ORDER BY column_name;

-- 3) Mevcut satırlar: hepsi ÖLÇÜLMEMİŞ (NULL) olmalı
SELECT count(*) AS toplam,
       count("kbRetrieved")       AS olculen_kb,
       count("srcDeclared")       AS olculen_beyan,
       count("kbEvidenceJson")    AS kanit_yazili
FROM "RiskEvent";

-- 4) Bilgi tabanı BOZULMADI mı (53'ün doğrulaması hâlâ geçerli mi)
SELECT count(*) FILTER (WHERE "isActive")                                 AS aktif_kalem,
       count(*) FILTER (WHERE "isActive" AND "reviewState" IN ('legacy','approved')) AS ai_okuyabilir,
       count(*) FILTER (WHERE "reviewState" = 'draft')                    AS taslak
FROM "KnowledgeBaseItem";
```

**Beklenen**
| # | Beklenen | DUR koşulu |
|---|---|---|
| 1 | `54_risk_event_grounding`, `finished_at` DOLU, `rolled_back_at` boş | `finished_at` NULL → migration yarıda kaldı |
| 2 | 7 satır; hepsi `is_nullable = YES`, `column_default` BOŞ; `kbEvidenceJson` `text`, `kbNewestUpdatedAt` `timestamp` | herhangi biri NOT NULL ya da varsayılanlı → DUR |
| 3 | `olculen_kb = 0`, `olculen_beyan = 0`, `kanit_yazili = 0` (eski kararlar ölçülmedi) | 0'dan büyükse: migration'dan sonra karar gelmiş olabilir, tarih kontrol et |
| 4 | `aktif_kalem = ai_okuyabilir` (32 = 32), `taslak = 0` | ayrışırsa **DUR** — A1'in davranış korunumu bozulmuş |

---

## B. Canlı akış doğrulaması — metinden öneri → onay → aktif KB → AI bağlamı

> Test mülkü: `cmtsiavia0001qs2qxar7n8d9` (QR canlı testinin yapıldığı mülk).
> 🚨 Gerçek misafir verisi kullanma; mevcut kayıtları silme.

### B.1 — Host akışı (arayüzden)
1. **Bilgi Tabanı** sayfasını aç. Üstte **"Kurulum ve eksikler"** panelini gör.
   - Beklenen: test mülkü için eksik kategoriler listeli, her satırda **"Şablonla doldur"**.
   - Başlıkta *"İnceleme adayları — kesin tespit değil"* yazmalı.
2. **"Metinden bilgi çıkar"** → **Aç** → mülk olarak test mülkünü seç → şu metni yapıştır:
   ```
   Merhaba {isim}, hoş geldiniz.
   Otopark bina altındadır ve misafirlerimiz için ücretsizdir.
   Çöpleri binanın yan sokağındaki konteynere bırakabilirsiniz.
   Çıkış saati 11:00'dir.
   ```
3. **Önizle**. Kontrol et — **hiçbir şey kaydedilmemiş olmalı**:
   - 2 bilgi önerisi (Otopark, Çöp), ikisi de seçili
   - "Bunlar mülk ayarlarında tutulur — bilgi kaydı olarak eklenmez: **Çıkış saati: 11:00**"
   - "**1 satır atlandı**" → açınca: *Satır 1: içinde doldurulmamış yer tutucu var*
   - 🚨 Burada sayfayı yenilersen bilgi tabanında **yeni kayıt OLMAMALI**.
4. **Seçilenleri ekle (2)** → "2 bilgi eklendi" bildirimi.
5. Sağdaki listede iki yeni kayıt görünmeli. **"Kurulum ve eksikler"** panelinde otopark/çöp satırları
   **düşmüş** olmalı.

### B.2 — Onay soyu doğru mu (salt-okuma)
```sql
SELECT category, source, "reviewState", ("approvedAt" IS NOT NULL) AS onay_zamani_var
FROM "KnowledgeBaseItem"
WHERE "propertyId" = 'cmtsiavia0001qs2qxar7n8d9'
ORDER BY "createdAt" DESC LIMIT 5;
```
**Beklenen:** yeni iki satır `host_manual | approved | t`.
🚨 `legacy` çıkarsa: kayıt A5 yolundan değil başka bir yerden gelmiş demektir — bana yaz.

### B.3 — AI bağlamına GERÇEKTEN girdi mi (QR'dan)
1. Test mülkünün QR sohbetini aç, **"Otopark var mı?"** diye sor.
2. Beklenen: **devir DEĞİL, cevap**; ve cevap senin yazdığın metne dayanmalı ("bina altı", "ücretsiz").
3. Sonra salt-okuma:
```sql
SELECT "occurredAt", reason, "finalDecision",
       "kbRetrieved", "kbPendingApproval", "srcDeclared", "srcVerified",
       "kbNewestUpdatedAt" IS NOT NULL AS tazelik_yazili,
       left("kbEvidenceJson", 200) AS kanit
FROM "RiskEvent"
WHERE surface = 'guest_chat'
ORDER BY "occurredAt" DESC LIMIT 3;
```
**Beklenen (en üst satır):**
- `kbRetrieved` ≥ 2 · `kbPendingApproval` = 0
- `finalDecision` = `auto_sent`, `reason` = `gate_passed`
- `srcDeclared` ≥ 1 ve `srcVerified` ≥ 1 → **temellendirilmiş cevap**
- `kanit` içinde `{"retrieved":[{"type":"kb_item","id":"...","v":"..."}],"used":["kb:parking"]}`

**DUR koşulları**
- `kbRetrieved = 0` → kalem modele gitmemiş; A1 kapısı ya da mülk eşleşmesi bozuk.
- `srcDeclared > 0` ama `srcVerified = 0` → model olmayan kaynağa atıf yapmış (**uydurma atıf**); cevabı
  gönderdiyse ayrıca incelemeliyiz.
- `kanit` NULL → kanıt yazılamamış; ayrıştırma kapısına takılmış olabilir.

### B.4 — Kanıt misafire SIZMIYOR (gözle)
QR sohbet ekranında gelen cevabın içinde **kalem kimliği, tarih damgası ya da `kb:` etiketi
GÖRÜNMEMELİ**. Görünürse hemen yaz — davranışsal test bunu kapatıyor ama canlı gözle de doğrulanmalı.

---

## C. Değişmeyecekler
- `QR_INFORMATIONAL_BAND_ENABLED` **KAPALI kalır** (gerçek model eval'i bitmeden açılmaz).
- Bu turda hiçbir sayaç gönderim kararına girmiyor: `RiskEvent` yazılamasa bile misafirin cevabı bozulmaz.
