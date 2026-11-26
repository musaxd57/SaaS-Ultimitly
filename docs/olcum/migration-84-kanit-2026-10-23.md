# Migration 84 kanıtı (kurucu 10-23 D: "evet, kanıtıyla")

Ortam: yerel PG 16, ayrı küme (5440), boş veritabanı `proof84` — üretim verisi YOK (CLAUDE.md: prod dump yerele yüklenmez).

1. Migration 1–83 uygulandı (migration 84 öncesi kod, `2b1f2ee8`), 3 öğe satırı yazıldı: biri cevaplandı + cevap bağı, biri ev sahibinde +
   e-posta damgası, biri açık.
2. Migration 84 uygulandı (`prisma migrate deploy`, `974a1f46`).
3. Sonuç:

| kontrol | sonuç |
|---|---|
| durum / `notifiedAt` / `answeredByMessageId` (önce ↔ sonra, satır satır `diff`) | AYNEN (fark yok) |
| yeni kolonlar | her satırda `ordinal = 0`, `topic = NULL` |
| indeksler | eski `(conversationId, messageId, kind)` tekilliği kalktı, `(…, ordinal)` tekilliği var; öteki indeksler aynen |
| mesaj tablosu | 0 satır — migration mesaj yazmaz, göndermez |
| aynı mesaj + tür için `ordinal = 1` satırı | eklenir (gerçek ikinci istek) |
| aynı `ordinal = 1` satırı İKİNCİ kez | REDDEDİLİR (`duplicate key … ordinal_key`) → yeniden işleme satır çoğaltamaz |
| taze PG'de sıfır sapma (`prisma migrate diff --from-migrations … --to-schema-datamodel …`) | boş migration |

Önce (`id|tür|durum|notifiedAt|answeredByMessageId`):
```
i1|wifi|answered|-|m2
i2|payment_invoice|pending_host|2026-10-20 10:00:00|-
i3|amenities|open|-|-
```
Sonra:
```
i1|wifi|answered|-|m2
i2|payment_invoice|pending_host|2026-10-20 10:00:00|-
i3|amenities|open|-|-
```

Yedek / geri yükleme doğrulaması bu kanıtın DIŞINDA (kurucu D) — Railway açılışında yayından önce taze `pg_dump`.
