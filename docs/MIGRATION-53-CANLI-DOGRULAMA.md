# Migration 53 (KB onay sözleşmesi) — canlı doğrulama sorguları

## ✅ SONUÇ (2026-09-08, operatör koştu, salt-okuma)
Beş kontrolün beşi de geçti; migration 53 prod'da **doğrulandı**.
1. `53_kb_review_state` · `finished_at = 2026-09-08 16:42:44.246096+00` · `rolled_back_at` boş.
2. `source`/`reviewState` → `NOT NULL` + varsayılan **`'legacy'::text`**; `approvedAt`/`sourceRef`/
   `supersededById` nullable ve varsayılansız.
3. Tek satır: **`legacy | legacy | 32 | 0`** — 32 kalemin tamamı legacy doğdu, `approvedAt` yazılan
   satır YOK (onay zamanı uydurulmadı).
4. **`aktif_kalem = 32`, `ai_okuyabilir = 32`, `ai_disinda = 0`** — migration öncesi modele giden her
   kalem gitmeye devam ediyor. Davranış korunumunun asıl kanıtı budur.
5. `PropertyMemory` (`source='kb_item'`): `active = 32`, `retired` satırı yok.


> Commit `33b6ae8` · push 2026-09-08 16:29Z · yedek
> `lixus-prod-post-contract-2026-09-08-192649.dump` (1.476.254 bayt · TOC 226 girdi ·
> SHA256 `0F925FCCDF784A366BFE04A7E96F04019ABC3ACF8B2172D5AF8F958A795FB45B`).
> **Hepsi SALT-OKUMA.** Railway → Postgres → Data/Query, ya da `psql "$DATABASE_URL"`.

## 1) Migration uygulandı mı?
```sql
SELECT migration_name, started_at, finished_at, applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name LIKE '53%';
```
**Beklenen:** tek satır, `finished_at` DOLU, `applied_steps_count = 1`.
`finished_at` NULL ise migration YARIDA kalmıştır → deploy'u durdur, logu oku, bana yaz.

## 2) Kolonlar ve varsayılanlar doğru mu?
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'KnowledgeBaseItem'
  AND column_name IN ('source','reviewState','approvedAt','sourceRef','supersededById')
ORDER BY column_name;
```
**Beklenen:**

| kolon | tip | null? | varsayılan |
|---|---|---|---|
| approvedAt | timestamp | YES | (yok) |
| reviewState | text | NO | `'legacy'::text` |
| source | text | NO | `'legacy'::text` |
| sourceRef | text | YES | (yok) |
| supersededById | text | YES | (yok) |

🚨 `source`/`reviewState` varsayılanı `'host_manual'`/`'approved'` görünüyorsa **DUR** — sözleşme
"kaynağını beyan etmeyen satır legacy'dir" diyor; başka bir varsayılan sahte onay üretir.

## 3) Mevcut satırların hepsi legacy mi? (asıl kanıt)
```sql
SELECT source, "reviewState", count(*) AS adet,
       count(*) FILTER (WHERE "approvedAt" IS NOT NULL) AS onay_zamani_olan
FROM "KnowledgeBaseItem"
GROUP BY 1, 2
ORDER BY 3 DESC;
```
**Beklenen:** TEK satır → `legacy | legacy | <toplam kalem> | 0`.
- `draft` sıfır olmalı (bugün taslak üreten kod yolu YOK).
- `onay_zamani_olan` sıfır olmalı — migration onay zamanı UYDURMADI.
- `host_manual|approved` satırı ancak **migration'dan SONRA** panelden yeni kalem eklendiyse çıkar;
  o da beklenen davranıştır (POST açıkça yazar).

## 4) AI erişimi korundu mu? (davranış kanıtı)
```sql
SELECT
  count(*) FILTER (WHERE "isActive")                                   AS aktif_kalem,
  count(*) FILTER (WHERE "isActive"
                     AND "reviewState" IN ('legacy','approved'))       AS ai_okuyabilir,
  count(*) FILTER (WHERE "isActive"
                     AND "reviewState" NOT IN ('legacy','approved'))   AS ai_disinda
FROM "KnowledgeBaseItem";
```
**Beklenen:** `aktif_kalem = ai_okuyabilir` ve `ai_disinda = 0`.
Bu iki sayı ayrışırsa migration öncesi modele giden bir kalem artık gitmiyor demektir → **DUR**.

## 5) Mülk hafızası bozulmadı mı? (V1 ile kesişim)
```sql
SELECT status, count(*) FROM "PropertyMemory" WHERE source = 'kb_item' GROUP BY 1;
```
**Beklenen:** 09-08 sabahındaki ilk geçişteki 32 aktif satır AYNEN duruyor. `retired` sayısı ARTMIŞSA
bir kalem hafızadan düşmüş demektir — bu migration bunu YAPMAMALI (hiçbir satır `draft` olmadı) → **DUR**.

## Geri alma
Beş kolon da nullable/varsayılanlı ve okuma yolları kolonsuz eski hâlle aynı sonucu verir
(allowlist yalnız `legacy`+`approved` içeriyor). Acil durumda:
```sql
ALTER TABLE "KnowledgeBaseItem"
  DROP COLUMN "source", DROP COLUMN "reviewState", DROP COLUMN "approvedAt",
  DROP COLUMN "sourceRef", DROP COLUMN "supersededById";
```
⚠️ Bu, uygulama kodu da geri alınmadan yapılırsa rotalar patlar — önce dalı `7155117`'ye döndür,
sonra kolonları düşür. Pratikte gerekmez: kolonlar veri SİLMİYOR, yalnız ekliyor.
