# V1 — Property Memory + Signals: kapsam eşlemesi ve tasarım (2026-09-08)

> Kurucu belgesi (`docs/KURUCU-TALIMATI-2026-09-07-…md`) V1'i "her daire için yaşayan hafıza" olarak tanımlar:
> bilinen güçlü/riskli yönler, olay geçmişi, örüntü ("Hot water: 4 signals / 9 months"), durum (recurring);
> `Signal` örneği: `source=guest_message · property · category=hot_water · sentiment · severity · confidence ·
> reservation_id · occurred_at`. Değişmez 13: Property Memory canonical event'i tüketir; LLM metni kalıcı
> gerçek değil; her bilgi evidence/source · confidence · observedAt · effectiveAt · lastConfirmedAt · expiry ·
> contradiction · human override taşır. Değişmez 14: veri sınıfları için saklama/türetme/silme ayrı tanımlı.
> Intelligence ayrı bounded context, event dinler; "AI bozulsa PMS çalışır".

## 1. Kurucu kapsamı ↔ mevcut canonical modeller

| Kurucu kavramı | Bu repoda karşılığı | Karar |
|---|---|---|
| Event akışı (`reservation.created`, `message.received`…) | `IngestEvent` (V0.6): `reservation.created/updated/cancelled`, `conversation.created/updated`, `message.imported`; PII'siz; `dispatchedAt` tüketici işareti | Tüketilecek tek akış. `reservation.updated`'a **değişen alan adları** eklenir (`changedFieldsJson`, PII'siz) — "tarih değişti" sinyali için. |
| `Signal` (kaynak, kategori, duygu, şiddet, güven, rezervasyon, zaman) | YOK. Yakın kavramlar: `RiskEvent` = AI kapısının KARAR günlüğü (auto_sent/human_review), `SupplyRequest` = malzeme talebi | **Yeni `Signal`**: mülk merkezli operasyonel gözlem. RiskEvent ile yaşam döngüsü farklı (karar vs. gözlem/örüntü) → çoğaltma değil (değişmez 11). SupplyRequest olduğu gibi kalır. |
| Property Memory (fact/strength/risk/pattern, evidence, confidence, zamanlar, override) | `KnowledgeBaseItem` = host'un yazdığı mülk gerçekleri ("starting point") | **Yeni `PropertyMemory`**; KB kalemleri **kaynağı açık** başlangıç hafızası (`source=kb_item`, `observedAt=kb.updatedAt` — gerçek damga, uydurma yok). Örüntü hafızası sinyallerden türer (`source=signal_pattern`). |
| Sınıflandırma (hot_water, noise…) | LLM'siz kelime ağı `classifyFallback` (intent: complaint · refund · early_departure · human_request · early_checkin · late_checkout · checkin · checkout · wifi · parking · location · cleaning · amenity) | V1 sinyal kategorileri bu kapalı kümeden + `cancellation`, `date_change`. Güven sabit ve mütevazı (kelime ağı). LLM çıkarımı V1'de YOK (guardrail/eval sonrası). |
| Güçlü yönler (review'lardan) | Review ingestion yok (değişmez 12) | V1 dışı; belgelenir. |
| Property kimliği | `Property.id` canonical; `Property.hospitableId` yalnız linkProperty'de | Hafıza/sinyal **`Property.id`** ile; `hospitableId` V1 akışına girmez → bu turda bağımlılık yok. Kayıt: kalan iş olarak açık (kapsamlı kimlik). |

## 2. V1 kapsamı — dahil / hariç (iki tur: 09-08 sabah "altyapı", 09-08 Codex turu "ürün akışı")
**Dahil (altyapı turu):** `PropertyMemory` + `Signal` modelleri (migration 52, yerel) · `IngestEvent` tüketicisi (idempotent, sıra-bağımsız, yeniden başlatılabilir) · deterministik sinyal türetimi (rezervasyon iptal/tarih değişikliği; misafir mesajı intent'i) · KB'den başlangıç hafızası (kaynağı açık) · sinyallerden örüntü hafızası (recurring) · KVKK sınıfları (erasure SetNull, retention purge) · okuma fonksiyonu (`getPropertyMemory`) · zamanlanmış geçişte çalıştırma (hata PMS'i bloklamaz).
**Dahil (ürün akışı turu, §7–§8):** Lixus-native kaynak sözleşmesi — iCal takvim beslemesi · elle `.ics/.csv` yükleme · QR misafir sohbeti aynı `IngestEvent` tablosuna, sağlayıcıdan bağımsız `recordIngestEvent` ile (satırla aynı TX, yapay olay yok) · KB yazma rotaları hafızayı ANINDA eşitler (silinen kalem → retired) · zamanlanmış geçiş sırası hafıza → event → örüntü ve iCal bacağından SONRA (aynı geçişte tüketim) · mülk sayfasında "Mülk Hafızası" kartı (okuma; okunamazsa sayfa çalışır) · Hospitable'sız kiracı uçtan uca test.
**Hariç:** Exception Feed/UI (V2), aksiyon/görev üretimi (V3), müsaitlik cevabı, LLM tabanlı çıkarım, review ingestion (değişmez 12 → "güçlü yönler" hafızası yok), bakım/görev kaynaklı sinyal (`source=maintenance`: Task olayları IngestEvent değil; V3 Actions + Tasks ile), elle tek rezervasyon rotası (`POST/PATCH /api/reservations`: değişiklik ölçümü yok → "updated" iddiası yapay olurdu; TX/erasure guard da yok — ayrı karar), mevcut V0 bayrakları.

**Önceki raporla uzlaşma (Codex 09-08):** V0.6 raporu "polling bugün, webhook yarın AYNI write service'i çağırır" dedi — doğru ama yalnız SAĞLAYICI yolu için. iCal (`import/sync.ts`), elle dosya (`api/reservations/import`) ve QR (`api/chat/[token]`) HİÇBİR ZAMAN write service'ten geçmedi: kendi TX'leri, V0.4 provenance damgası (`ingestedAt`, `connectionId` NULL) var, `IngestEvent` YOK. V1 altyapı turu bunu "kalan sınır" olarak yazdı; sonuç, tüketicinin Hospitable'sız kiracı için BOŞ çalışmasıydı → doğru sınıflandırma **"altyapı hazır, ürün akışı eksik"**. Bu turda kaynaklar write service'e TAŞINMADI (çalışan yazma yolları birebir korundu — değişmez kural); yalnız event sözleşmesine bağlandı. Kod-doğrulama: `src/` içinde `ingestEvent.create*` yazan yalnız `ingest/events.ts` + write service (pin `unit/core-channel-independence`).

## 3. Veri modeli
```
Signal      organizationId · propertyId · reservationId? (SetNull) · conversationId? (SetNull)
            source: guest_message | reservation          (kapalı küme, app-enforced)
            kind:   message.intent | reservation.cancelled | reservation.dates_changed
            category: intent kümesi | cancellation | date_change
            sentiment: negative | neutral | positive?    severity 0..1   confidence 0..1
            occurredAt = GERÇEK olay zamanı (mesajın createdAt'i / event.occurredAt) — uydurma yok
            sourceEventId (IngestEvent id) · sourceEntityType/Id (opak id) · dedupeKey @unique (org-kapsamlı)
            resolvedAt? (V2)                                  PII: metin/ad YOK
PropertyMemory organizationId · propertyId · kind: fact | risk | pattern · category · title · body?
            source: kb_item | signal_pattern | human · sourceRef (kb id / pattern anahtarı) — @@unique([propertyId, source, sourceRef])
            evidenceJson: [{type,id}] (yalnız id) · confidence · observedAt · effectiveAt? · lastConfirmedAt? · expiresAt?
            contradictedById? · humanOverrideAt? · humanOverrideUserId? · status: active | superseded | retired
IngestEvent + changedFieldsJson? (alan ADLARI)
```
İdempotency: `Signal.dedupeKey = ${organizationId}:${kind}:${sourceEntityId}[:${sourceEventId}]` — aynı olay ikinci kez işlenince P2002 → atlanır. Hafıza: unique (propertyId, source, sourceRef) → upsert.

## 4. Tüketici semantiği
- **Girdi türleri:** `message.imported` (sağlayıcı senkronu) ve `message.received` (doğrudan kanal: QR) AYNI işlenir — tüketici kaynağı okumaz, canonical satırı okur (yön/yazar satırdan: `direction=inbound` + `authorType=guest`).
- **Sıra:** `IngestEvent` `dispatchedAt IS NULL` satırları `(occurredAt, id)` sırasıyla, org başına parti. Her event **kendi TX'inde**: canonical satır **şimdiki hâliyle** okunur (event payload'sız) → türetim → sinyal insert (dedupe) → `dispatchedAt` damgası. Sırasız gelen eski event aynı satırı okuduğu için son durumu üretir; sinyal olay-başına olduğu için sıra değiştirse de küme aynı.
- **Yeniden başlatma:** yarıda kalırsa işlenmemişler `dispatchedAt=NULL` kalır, sonraki koşu devam eder; işlenmiş ama çökmüş (damga yazılmadan) satır tekrar işlenir → dedupe unique mükerrer üretmez.
- **Tekrar oynatma:** aynı event ikinci kez (damga sıfırlansa bile) → 0 yeni satır.
- **İptal/değişiklik:** `reservation.cancelled` → `cancellation` sinyali; `reservation.updated` + `changedFieldsJson ∋ arrivalDate|departureDate` → `date_change`.
- **Silme/retention:** Signal/PropertyMemory misafir PII'si taşımaz. Erasure: rezervasyon/konuşma silinirse FK SetNull, sinyal kalır (mülk hafızası). Retention: misafir mesajından türeyen sinyaller `DATA_RETENTION_MONTHS` sonrası PURGE (aynı politika, `anonymizeOldGuestData` ile birlikte); KB/insan kaynaklı hafıza saklanır. Şema kanaryası: iki tablo `GUEST_MODELS` dışı, karar yorumlu.
- **Konuşma dedupe (operatör scripti `apply-conversation-dedupe`):** DMMF envanteri `Signal.conversationId`'yi bulur (fail-closed pin kırmızı oldu → listeye alındı). SetNull'a bırakılmaz: sinyalin türediği mesaj keeper'a taşındığı için sinyal de silmeden ÖNCE keeper'a repoint edilir; aksi hâlde bağ sessizce kopar (iz kaybı, dangling değil).
- **Kiracı/mülk kapsamı:** her satır organizationId + propertyId; org A'nın event'i B'ye sinyal üretemez (test).
- **Hata izolasyonu:** tüketici scheduled-sync'te senkron geçişinden SONRA, try/catch; hata `reportError`, geçiş bloklanmaz.

## 5. Legacy/bootstrap
Yalnız `KnowledgeBaseItem` (kaynağı açık: `source=kb_item`, `observedAt=updatedAt`, `confidence=1.0` host-authored). Geçmiş mesaj/rezervasyonlardan geriye dönük sinyal ÜRETİLMEZ (sahte event/ilk alınma yok). Hafıza yalnız V1 canlıya alındıktan sonra akan event'lerden dolar.
**Çağrılma yolu (ürün akışı turu):** (1) her zamanlanmış geçişte org başına `runIntelligencePass` → `bootstrapMemoryFromKnowledgeBase(org)` (toplu: kapsam başına iki `findMany`, yalnız değişen satıra yazma; yeniden çalıştırma güvenli); (2) KB yazma rotaları `POST /api/kb` · `PATCH/DELETE /api/kb/[id]` · `POST /api/kb/[id]/copy` yazdıktan hemen sonra `refreshPropertyMemoryBestEffort(org, property)` — fırlatmaz, KB kaydı hafıza yüzünden başarısız olmaz. Kaynak güncelleme → body/title/observedAt güncellenir; pasif → retired; **hard delete → retired** (silinmez, tarihçe); tekrar aktif → active.

## 6. Canlıda bekleyen doğrulamalar (kod hazırlığından ayrı)
Nuve'nin Hospitable verisi 402'de donuk → prod'da sağlayıcı kaynaklı IngestEvent boş. Ürün akışı turundan sonra **Hospitable'sız yollar canlıda doğrulanabilir** (Nuve'nin QR sohbetleri ve varsa iCal beslemeleri Hospitable'a bağlı değil): ilk canlı kontrol listesi — (a) migration 52 sonrası `SELECT provider, kind, count(*) FROM "IngestEvent" GROUP BY 1,2` (beklenen: `ical`/`qr_chat` satırları, `hospitable` 0); (b) `SELECT source, category, count(*) FROM "Signal" GROUP BY 1,2`; (c) `SELECT source, status, count(*) FROM "PropertyMemory" GROUP BY 1,2` (KB kalemi sayısı ≈ `kb_item` active); (d) mülk sayfasında "Mülk Hafızası" kartının KB sayısıyla tutması; (e) retention purge'ün ilk deep geçişi (`DATA_RETENTION_MONTHS=24` → bugün silinecek sinyal yok). Fixture/demo sonuçları canlı doğrulama sayılmaz.

## 7. Kaynak sözleşmesi — hangi kaynak hangi hafızayı/sinyali besler (yapay olay YOK)
Tek yazıcı `src/lib/ingest/events.ts` → `recordIngestEvent(tx, ctx, entityType, entityId, kind, changedFields?)`; `provider` kapalı küme `INGEST_SOURCES = hospitable · ical · manual_file · qr_chat` (derlemede exhaustiveness). Native girişlerde `connectionId` daima null.

| Kaynak | Yazma yolu (kod, DEĞİŞMEDİ) | Event (provider) | Beslediği sinyal / hafıza |
|---|---|---|---|
| Hospitable (geçici köprü) | `ingest/write-service.ts` (polling; webhook aynı) | `reservation.created/updated/cancelled` · `conversation.*` · `message.imported` (`hospitable`, connectionId damgalı) | `cancellation` · `date_change` · `message.intent` |
| iCal takvim beslemesi | `import/sync.ts` satır TX (create/update/cancel) + kayıp uzlaştırması (bayrak, iptal anında) | `reservation.created` · `reservation.updated` (`changedFieldsJson` = alan adları) · `reservation.cancelled` (`ical`, null) | `cancellation` · `date_change` (değişmeyen satır → yazma yok → event yok) |
| Elle `.ics/.csv` yükleme | `api/reservations/import` TX (create / STATUS:CANCELLED) | `reservation.created` · `reservation.cancelled` (`manual_file`, null) | `cancellation` (dedupe-hit'te TX iptal → event de yok) |
| QR misafir sohbeti | `api/chat/[token]` TX — YALNIZ misafir satırı; bot cevabı bizim çıktımız | `message.received` (`qr_chat`, null) | `message.intent` (complaint · refund · early_departure · …); konuşma + rezervasyon bağlı |
| Bilgi Tabanı | KB rotaları + zamanlanmış geçiş | event YOK (olay değil, kaynak kaydı) | `PropertyMemory` fact (`kb_item`; pasif/silinen → retired) |
| Elle tek rezervasyon (`POST/PATCH /api/reservations`) | — | YOK (bilinçli: değişiklik ölçümü yok, "updated" yapay olurdu) | — |
| Görev/bakım (Task) | — | YOK (V3) | — |

Retention sınıfları değişmedi: `guest_message` kaynaklı sinyal (QR dahil) `DATA_RETENTION_MONTHS` sonrası purge; `reservation` kaynaklı sinyal ve KB/insan hafızası saklanır; erasure FK SetNull; PII hiçbir event/sinyalde yok.

## 8. Kurucu belgesindeki V1 kabul koşulları ↔ uygulama (`docs/KURUCU-TALIMATI-…md` §"Property Memory" 63–98, 481–556)
| Kurucu koşulu | Durum |
|---|---|
| "Her daire için yaşayan hafıza": KNOWN RISKS · INCIDENT HISTORY · PATTERN · STATUS recurring | ✅ KNOWN RISKS = örüntü hafızası (mülk × kategori, ≥3 negatif/180 gün) · INCIDENT HISTORY = sinyal listesi (kategori + şiddet + zaman; PII'siz — metin yok) · PATTERN + STATUS = `kind=pattern`, evidence id'leri, evidenceCount; mülk sayfasında görünür |
| KNOWN STRENGTHS (review'lardan) | ❌ review ingestion yok (değişmez 12) — V6 |
| `Signal`: source · property · category · sentiment · severity · confidence · reservation_id · occurred_at | ✅ tümü; `hot_water` gibi ince kategori ❌ (LLM'siz kelime ağı kümesi; `complaint` genel) — guardrail/eval sonrası |
| `source = maintenance` sinyali ("boiler_reset") | ❌ Task olayı IngestEvent değil — V3 |
| Intelligence ayrı bounded context, event dinler, "AI bozulsa PMS çalışır" | ✅ try/catch geçiş + sayfa kartı catch; sağlayıcı importu yok (pin) |
| Verinin nereden geldiği AI'nın umurunda değil (Hospitable/Airbnb/iCal/QR) | ✅ tüketici `provider` okumaz; native kaynaklar aynı tabloda (§7) |
| Hospitable'sız kiracıda anlamlı akış | ✅ uçtan uca test `integration/intelligence-native-sources` (iCal + elle dosya + QR + KB) — canlı doğrulama §6 |
| "43825010'a yarın iki kişi geliyor… check-in öncesi test gerekli" (proaktif uyarı) | ❌ V2 Exception Feed / V5 Readiness — bu tur yalnız hafızayı DOLDURUR ve GÖSTERİR |
