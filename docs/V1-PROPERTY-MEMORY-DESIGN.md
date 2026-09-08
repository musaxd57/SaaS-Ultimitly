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

## 2. V1 kapsamı (bu tur) — dahil / hariç
**Dahil:** `PropertyMemory` + `Signal` modelleri (migration 52, yerel) · `IngestEvent` tüketicisi (idempotent, sıra-bağımsız, yeniden başlatılabilir) · deterministik sinyal türetimi (rezervasyon iptal/tarih değişikliği; misafir mesajı intent'i) · KB'den başlangıç hafızası (kaynağı açık) · sinyallerden örüntü hafızası (recurring) · KVKK sınıfları (erasure SetNull, retention purge) · okuma fonksiyonu (`getPropertyMemory`) · zamanlanmış geçişte çalıştırma (hata PMS'i bloklamaz).
**Hariç:** Exception Feed/UI (V2), aksiyon/görev üretimi (V3), müsaitlik cevabı, LLM tabanlı çıkarım, review ingestion, QR/iCal kaynaklı sinyal (IngestEvent üretmiyorlar — V0.6 write service yalnız sağlayıcı yolu), mevcut V0 bayrakları.

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

## 6. Canlıda bekleyen doğrulamalar (kod hazırlığından ayrı)
Nuve'nin Hospitable verisi 402'de donuk → prod'da IngestEvent boş → V1 canlı veriyle doğrulanamaz; fixture/demo sonuçları canlı doğrulama sayılmaz. Canlı doğrulama listesi: ilk gerçek event akışında sinyal sayımı, örüntü eşiği, retention purge'ün ilk koşusu.
