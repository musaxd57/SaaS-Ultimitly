# V1 Property Memory + Signals — canlıya alma ve CANLI ÜRÜN AKIŞI doğrulaması (operatör planı)

> Codex kararı (2026-09-08): yeni revizyon turu YOK; açık kalan vizyon parçaları (bakım sinyalleri, güçlü yönler,
> proaktif check-in uyarısı) belgelerde görünür kaldığı sürece mevcut kapsam yayına çıkabilir. Sıra: taze yedek →
> migration 52 için AÇIK push onayı → yayın → **tablo sayımı DEĞİL, ürün akışı** doğrulaması. Bu belge o sırayı
> operatör adımlarına çevirir. Kod hazırlığı ve test kanıtı: envanter §14/§14b, tasarım `docs/V1-PROPERTY-MEMORY-DESIGN.md`.

## 0. Ne yayına çıkıyor (2 yerel commit; migration 52 içerir)
- `16f70f5` altyapı: `Signal` + `PropertyMemory` tabloları, `IngestEvent.changedFieldsJson` (nullable), tüketici, KB
  bootstrap, örüntü, retention. **Migration 52 = 2 CREATE TABLE + 1 nullable ADD COLUMN + index/FK; dolu tabloya
  unique/required/drop YOK.**
- `4e9b1b1` ürün akışı: iCal / elle dosya / QR → `IngestEvent`; KB rotaları hafızayı anında eşitler; mülk sayfasında
  "Mülk Hafızası" kartı; intelligence bacağı iCal bacağından sonra. Migration'sız.
- Yeni env/bayrak YOK. `CHANNEL_CONNECTION_READ` ve diğer V0 bayrakları DEĞİŞMEZ.

**Yayın anında BEKLENEN yan etki:** ilk zamanlanmış geçişte (≤2 dk) her "busy" org için KB bootstrap koşar → aktif her
`KnowledgeBaseItem` için bir `PropertyMemory` satırı (source `kb_item`, `observedAt` = KB `updatedAt`) oluşur. Bu sahte
event DEĞİLDİR: kaynak açık, zaman damgası KB'nin gerçek damgası. `IngestEvent`/`Signal` ise yalnız GERÇEK yeni olay
(besleme değişikliği, QR mesajı, dosya yükleme, Hospitable senkronu) olursa dolar.

## 1. Push kapısı (envanter §10 ile aynı)
1. Operatör klonu (`LixusPreflight-43ccd3c`): `git status --short` temiz olmalı; **`reset --hard` ASLA**.
2. Taze prod yedeği (salt-okuma; DATABASE_URL SecureString ile istenir, argv/geçmişe yazılmaz):
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops-backup-prod.ps1
   ```
   Çıktı: dump adı · bayt · TOC · `pg_restore -l` ✅ · SHA256. **"YEDEK TAMAM" görülmeden ilerlenmez.** SHA not edilir
   (restore provası ister).
3. Kurucunun AÇIK onayı ("push et", yedek kanıtıyla) → Claude fast-forward push (`4c1efea..4e9b1b1`; force/rebase/amend YOK).
4. CI 5/5 (run: migration-chain 52 taze DB'de) → Railway "Wait for CI" → `migrate deploy` (kısa: CREATE TABLE) → ACTIVE.
5. Salt-okuma doğrulama (operatör psql, bölüm 2). Sonra bölüm 3 (ürün akışı).

## 2. Salt-okuma kontroller (psql; tümü SELECT)
```sql
-- (a) migration 52 tamam, geri alınmamış, yarım migration yok
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
 WHERE migration_name LIKE '52%' OR finished_at IS NULL OR rolled_back_at IS NOT NULL;
-- (b) tablolar/kolon var
SELECT to_regclass('"Signal"') AS signal_tbl, to_regclass('"PropertyMemory"') AS memory_tbl,
       (SELECT count(*) FROM information_schema.columns WHERE table_name='IngestEvent' AND column_name='changedFieldsJson') AS changed_col;
-- (c) ilk geçişten (≤2 dk) sonra: KB hafızası ≈ aktif KB kalemi
SELECT source, status, count(*) FROM "PropertyMemory" GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) AS active_kb FROM "KnowledgeBaseItem" WHERE "isActive";
--   beklenen: kb_item/active = active_kb; retired 0; signal_pattern 0 (henüz sinyal yok)
-- (d) event/sinyal (yalnız gerçek olay varsa dolar; ilk gün 0 olabilir)
SELECT provider, kind, count(*) FROM "IngestEvent" GROUP BY 1,2 ORDER BY 1,2;
SELECT source, category, count(*) FROM "Signal" GROUP BY 1,2 ORDER BY 1,2;
SELECT count(*) AS undispatched FROM "IngestEvent" WHERE "dispatchedAt" IS NULL;  -- 2 dk sonra 0 beklenir
```
Alarm kutusu: `intelligence-pass org:` / `kb-memory org:` konulu `reportError` e-postası GELMEMELİ (gelirse geçiş
PMS'i bloklamaz ama hafıza eşitlenmez → raporla, yayını geri alma).

## 3. Canlı ÜRÜN AKIŞI doğrulaması (Codex: "kod ve test hazır" ≠ "canlı akış çalışıyor")
Hospitable'a bağımlı DEĞİL (Nuve 402'de olsa da yapılabilir). **Kontrollü testler ayrı bir TEST MÜLKÜNDE** yapılır ve
sonunda mülk silinir (cascade: Signal/PropertyMemory/rezervasyon/konuşma gider; `IngestEvent` satırları PII'siz "olay
oldu" kaydı olarak kalır — beklenen). Gerçek mülkte yalnız A adımı (KB) yapılır; o da gerçek bir düzenlemedir.

**A. KB → mülk hafızası (gerçek mülkte, güvenli).**
1. Mülkler → bir mülk → "Mülk Hafızası" kartı: "Bilgi Tabanı'ndan N kalem" = o mülkün aktif KB kalemi sayısı (Bilgi
   Tabanı kartıyla aynı sayı). Sinyal yok → "Henüz sinyal yok…" metni.
2. Bilgi Tabanı'nda o mülkün bir kalemini düzenle (zararsız bir kelime ekle) → mülk sayfasını yenile → sayı aynı;
   SQL: `SELECT title, "observedAt", status FROM "PropertyMemory" WHERE "propertyId"='…' AND source='kb_item'` →
   `observedAt` = KB'nin yeni `updatedAt`'i (anında; geçiş beklemeden).
3. Kalemi pasife al → kart sayısı N−1, SQL status `retired`; tekrar aktif → N, `active`. (Silme de aynı: `retired`.)
   ✅ Ölçüt: kart ve SQL, KB ile geçiş beklemeden tutuyor.
   **Bulgu (kurucu, 09-08, ilk canlı deneme):** akış çalıştı ("çalışıyor gibi") ama geçiş SESSİZDİ — yalnız küçük ikon
   değişiyordu. Düzeltme: başarıda ortak toast ("Bilgi pasifleştirildi." / "Bilgi aktifleştirildi.", sağ-alt, otomatik
   kapanır); hatada başarı toast'ı yok. Test `tests/ui/kb-toggle-feedback` (kırmızı-önce). Misafir mesajı bacağı (B)
   bağlı hesap olmadığından QR ile, rezervasyon bacağı (C) elle `.ics` ile doğrulanır — kurucu C'ye geçti.

**B. QR misafir mesajı → şikayet sinyali (test mülkü).**
1. Test mülkü oluştur, QR sohbeti aç, aktif bir TEST rezervasyonu gir (bugünü kapsayan tarihler; kanal "manual").
2. QR bağlantısından misafir gibi gönder: "Sıcak su gelmiyor, duş soğuk." (şikayet kelime ağı; AI'nın cevabı önemsiz —
   kaçış/escalation e-postası gelebilir, test mülkü olduğu için beklenen).
3. ≤2 dk (zamanlanmış geçiş) sonra mülk sayfası kartı: "Şikayet · <tarih> · Misafir mesajı" rozeti (kırmızı ton).
   SQL: `SELECT kind, provider, "connectionId" FROM "IngestEvent" ORDER BY "occurredAt" DESC LIMIT 3` → `message.received /
   qr_chat / NULL`; `SELECT source, category, "conversationId" IS NOT NULL AS bagli FROM "Signal" WHERE "propertyId"='…'`
   → `guest_message / complaint / true`. Aynı mesaj ikinci kez GÖNDERİLMEZ; ikinci bir farklı mesaj ikinci sinyal üretir.
   ✅ Ölçüt: gerçek QR olayı ≤2 dk içinde beklenen sinyale ve kartta görünen satıra dönüştü.

**C. Rezervasyon olayı → iptal sinyali (test mülkü; kontrollü yol = test beslemesi).**
Gerçek Airbnb iCal iptali zorlanamaz → aynı sözleşmeyi kullanan KONTROLLÜ besleme ile doğrulama, gerçek beslemede pasif
gözlem. ⚠️ Düzeltme (09-08, kod-doğrulandı): elle `.ics/.csv` yüklemesinin arayüzde MENÜSÜ YOK — yalnız API rotası
(`POST /api/reservations/import`, `file`+`propertyId`); bu belgenin önceki "Rezervasyonlar → İçe aktar" ifadesi yanlıştı.
Kontrollü yol, mülk sayfasındaki **Takvim kaynakları** üzerinden gerçek iCal sözleşmesidir (provider `ical`):
1. `test-reservation.ics` (tek VEVENT, `UID:lixus-v1-test-2026-09-08-001@lixusai.com`, 14–17 Eki 2026, sahte ad) herkese
   açık bir Gist'e konur; Raw URL (HTTPS 443, yönlendirme yok) test mülküne Takvim kaynağı olarak eklenir. Yeni kaynak
   ≤2 dk'da (ya da kaynak satırındaki senkron düğmesiyle anında) çekilir. SQL: `IngestEvent` son satır
   `reservation.created / ical`. Sinyal yok (created sinyal değildir).
2. Gist içeriği `test-reservation-cancelled.ics` (aynı UID + `STATUS:CANCELLED`) ile değiştirilir, senkron düğmesi →
   rezervasyon iptal; SQL: `reservation.cancelled / ical`; ≤2 dk sonra `Signal` `reservation / cancellation` ve kart:
   "İptal · 14 Eki 2026 · Rezervasyon". Test verisi/mülk SİLİNMEZ (Codex).
3. Pasif gözlem (gerçek besleme): sonraki gerçek tarih değişikliği/iptalde `IngestEvent` `ical` + `Signal` `date_change`/
   `cancellation` beklenir; ilk 1–2 haftada `SELECT provider, kind, count(*) …` ile izle. Değişmeyen besleme event ÜRETMEZ
   (0 = arıza değil).
   ✅ Ölçüt: dosya yolunda iptal sinyali kartta; gerçek beslemede ilk değişiklikte event/sinyal.

**D. Temizlik:** test mülkünü sil (cascade). Gerçek mülkte A adımındaki KB düzenlemesini geri al (isteğe bağlı).

## 4. "Canlı ürün akışı çalışıyor" beyanı için gereken kanıt (rapora aynen yazılır)
A2/A3 SQL çıktıları · B3 kart ekran görüntüsü + SQL · C2 kart + SQL · bölüm 2 (a)–(d) çıktıları · alarm kutusu boş.
Eksik kalan vizyon parçaları rapora AÇIKÇA yazılır: bakım sinyalleri (V3), güçlü yönler (review, V6), proaktif
check-in uyarısı (V2/V5), ince kategori (LLM'siz).

## 5. Geri alma
Kod additive; migration 52 yalnız yeni tablo/nullable kolon. Geri alma = önceki deploy'a dönmek (tablolar durur, zararsız;
`IngestEvent.changedFieldsJson` NULL kalır). Veri geri alma gerekmez. Yeni bayrak olmadığı için "kapatılacak anahtar" yok;
gerekirse intelligence bacağı yalnız kod değişikliğiyle susturulur (try/catch zaten PMS'i korur).
