# Faz 2 migration paketleri — HAZIR YAMA (10-16, ana dala UYGULANMADI)

Kurucu 10-16: "Gerekli migration'ları hazırlamaktan kaçınma." Bu klasör şema farkını ve gerçek migration SQL'ini taşır; `prisma/` altına
KOPYALANMADI. Uygulama = kurucu onayı + taze `pg_dump` + ilgili kodla birlikte (kod, aşağıdaki soruların cevabından sonra yazılır).
Tasarım, değişmez listeleri, okuyan / yazan kod yolları, kırmızı-önce testleri ve sorular: `docs/TASARIM-2026-10-16-faz2-migration-paketleri.md`.

| Önerilen no | Paket | Ne | Dolu tablo |
|---|---|---|---|
| 69 | `m_outbox_dizin` | `MessageOutbox(conversationId, status)` dizini (I3, O1 Seçenek A) | dizin; kuyruk bugün boş → düz dizin |
| 70 | `m_kb_surum` | `KnowledgeBaseItem.version INT NOT NULL DEFAULT 0` (S5) | varsayılanlı kolon (PG 11+ tablo yeniden yazılmaz) |
| 71 | `m_oncelik` | `Task.prioritySource TEXT` + `priorityNeedsReview BOOLEAN NOT NULL DEFAULT false` | boş + varsayılanlı kolon |
| 72 | `m_bildirim` | `NotificationOutbox` (O2 + Codex C2; metin / adres saklanmaz) | yeni tablo |
| 73 | `m_defter` | `RequestLedger` (S1 + S2 tek tablo; 24 sa) | yeni tablo |
| 74 | `m_iade` | `InvoiceAdjustment` (S3; asıl fatura değişmez) | yeni tablo |
| 75 | `m_odeme_niyeti` | `CheckoutIntent` (Codex C1; işletme başına tek açık Paddle işlemi, `openKey` tekil) | yeni tablo |

Numaralar YALNIZ `prisma/migrations/<NN>_<ad>` klasörü oluşunca kesinleşir (`docs/MIGRATION-MANIFEST.md`); paketler bağımsız sırayla da
uygulanabilir (69–71 kolon / dizin, 72–75 yeni tablo).

## Doğrulama (10-16, geçici PostgreSQL 16 kümesi, port 5440 — test kümesi 5433'e dokunulmadı; iş bitince silindi)
- `prisma migrate diff --from-schema-datamodel` (taban → paket) ile üretildi; `prisma validate` geçerli.
- Taze veritabanı: 1–68 + 69–75 `migrate deploy` → "All migrations have been successfully applied".
- Sıfır fark: `--from-migrations → --to-schema-datamodel` ve uygulanmış veritabanı → şema, ikisi de "empty migration".
- Dolu tablo: 68'e kadar uygula, `Organization` / `Property` / `KnowledgeBaseItem` / `Task` satırı ekle, sonra 69–75 → başarılı; eski görevlerde
  `prioritySource` NULL, `priorityNeedsReview` false; KB `version` 0.

## Dosyalar
- `schema.diff` — `prisma/schema.prisma` için birleşik fark (yedi paket birlikte; geri ilişkiler `Organization` / `User` / `CheckoutConsent`).
- `migrations/<NN>_<ad>/migration.sql` — üretilen SQL (elle düzenlenmedi).
