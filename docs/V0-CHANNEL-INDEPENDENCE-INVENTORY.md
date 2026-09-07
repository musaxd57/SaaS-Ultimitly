# V0 Channel Independence — bağımlılık envanteri ve geçiş planı

> **2026-09-07 · başlangıç `73dbfb4` (deploy dalı, working tree temiz).**
> Dört salt-okuma ajan + dört iddianın kodla spot-doğrulaması. Bu belge **K0**
> (davranış değişikliği yok). V0 *kodu* denetim bulguları kapanana kadar
> başlamaz (yürütme sırası: kritik düzeltmeler → V0).
>
> Sözleşme: `docs/TEST-EVIDENCE-CONTRACT.md`. Her V0 dilimi K2'dir.

---

## 1. Kanıtlanmış gerçek provider bağımlılıkları

### 1a. Şema ve kimlikler

| Bağımlılık | Yer | Neden sorun |
|---|---|---|
| `Organization.hospitable{TokenEnc,RefreshTokenEnc,TokenExpiresAt,Label,ConnectedAt}` | `schema.prisma:143-155` | Kimlik bilgisi org satırında; ikinci bağlantı/sağlayıcı için yer yok. |
| `Organization.autoReplyHospitable` | `:129`; okur `automation.ts:1332,2450`; yazar `settings/route.ts` | Ürün bayrağı sağlayıcı adlı. |
| `Property.hospitableId @unique` | `:339` | **Global** unique, org-kapsamlı değil; her yeni sağlayıcı = yeni global-unique kolon. |
| `Reservation @@unique([propertyId, sourceReference])` | `:486` | `sourceReference` üç anlam taşıyor (Hospitable UUID / iCal UID / CSV serbest metin) ve **`provider` kolonu yok** → Airbnb Direct aynı konaklamayı kendi kimliğiyle getirirse **iki satır**; iki kaynak aynı string'i üretirse P2002 **sessizce dedupe-hit sayılır** (`hospitable-sync.ts:880`, `import/sync.ts:470`, `import/route.ts:408`). |
| `Conversation @@unique([propertyId, externalReservationId])` | `:598` | "Tam iki yazar" (Hospitable UUID + `qr-chat:` öneki) argümanı üçüncü adapter'da düşer. |
| `Conversation.externalConversationId` | `:517` | Unique/index YOK; thread kimliği rezervasyona bağlı, konuşmaya değil. |
| `MessageOutbox.externalReservationId` + `idempotencyKey = welcome:{org}:{sourceReference}` | `:1018,1040`; `automation.ts:2882,3049` | Teslimat hedefi VE idempotency Hospitable UUID'sine bağlı. |
| **Provenance sıfır** | `Reservation/Conversation/Message/Property` | `connectionId` · `ingestedAt` · ham olay referansı yok; yalnız iCal'de `calendarSourceId` var, Hospitable satırlarında kaynak sahipliği YOK → çift-kaynak birleştirme yazılamaz. |

### 1b. `channel` string'inden yetenek çıkarımı

- **Üç uyumsuz üretici:** `toChannel()` `hospitable-sync.ts:123-131` (`vrbo` + ham platform string'i sızar, closed-set'te yok) · `channelFromLabel()` `import/sync.ts:93-100` ("Airbnb" etiketli feed → `airbnb`, **asla `ics` yazmaz**) · elle `ics|manual` `import/route.ts:290,365`.
- **6 kopya yetenek kararı:** `automation.ts:2824, 3001, 3148, 3207, 3287, 3688` — `channel notIn ["ics","manual"]` + `calendarSourceId: null` = "mesajlanabilir". Yorum (`:2825-2835`) filtrenin yanlış olduğunu itiraf ediyor; gerçek kapı `calendarSourceId`.
- **İkinci, habersiz yetenek modeli:** `messaging.ts:44-45` ve `automation.ts:2397,3737` `channel`'a değil `externalReservationId`'nin **`qr-chat:` önekine** bakıyor.

### 1c. Outbound

- `sendOnChannel` (`messaging.ts:36-63`): `ChannelTarget.channel` **alınıyor ama hiç okunmuyor** (kod-doğrulandı). Tek dallanma `qr-chat:` öneki; değilse koşulsuz `hospitable.sendMessage`. **Soyutlama var, dispatch yok.**
- `outbox/worker.ts:111-135` `defaultSend/defaultReconcile` aynı varsayım; `DrainDeps.send/reconcile/tokenFor` (`:85-94`) DI kancası VAR — tek gerçek genişleme noktası.
- Hata sınıflandırması üç dosyada aynı `/HTTP (\d{3})/` regex'i (`messaging.ts:76-91`, `outbox/state.ts:151-167`, `provider-errors.ts:25-47`); 402→`blocked` Hospitable aboneliğine özel.
- Claim SQL'i "2/dk/rezervasyon" Hospitable kuralını `externalReservationId` üzerinden PARTITION ediyor (`worker.ts:237-248`).

### 1d. Ingest

- **Webhook YOK, yalnız polling** (`scheduled-sync.ts:254` + manuel `hospitable/sync/route.ts`). İki yol ortak — ama ortak olan şey ayrı bir yazma servisi değil, `syncHospitable` fonksiyonunun kendisi.
- Normalizasyon 3 küçük private fonksiyonda (`toChannel`, `mapReservationStatus`, `isGuestMessage`); `importThread`/`upsertReservationCalendar` imzaları **`HospitableReservation`/`HospitableMessage` alıyor** (`:786`, `:1034`) — provider tipi DB yazma katmanına iniyor.
- Domain event/outbox **yok**; yan işler TX sonrası inline.
- iCal (`import/sync.ts`) reservation-only ✅; `calendarSourceId` sahipliği tek yönlü (Hospitable yazmıyor).

### 1e. Çekirdek import grafiği (kod-doğrulandı)

```
automation.ts        → getOrgHospitableToken ×6  + sendOnChannel      [SIZINTI]
outbox/worker.ts     → hospitable.sendMessage + getOrgHospitableToken  [SIZINTI, DI kancalı]
reservations-cleanup → hospitable.listReservations + token             [SIZINTI]
scheduled-sync.ts    → syncHospitable + isPrimaryOrg + HospitableError [SIZINTI]
messaging.ts         → hospitable.sendMessage                          [tek çıkış adaptörü — daraltılacak]
api.ts:161           → err.name === "HospitableError" && 402           [paylaşılan HTTP katmanında sınıf adı]
unverified-sweep.ts  → hospitable*Enc okuyup "org canlı mı" kararı     [retention çekirdeği]
data-export.ts:87    → autoReplyHospitable                             [KVKK ihracı]
ai/** · tasks/** · billing/** · reports · erasure · data-retention · guest-chat → SIFIR   ✅
```
**Toplam: 9 dosya / ~30 satır.** V0'ın gerçek işi `automation.ts` + `outbox/worker.ts` + `messaging.ts` üçgeni + kimlik deposu.

### 1f. Yaşam döngüsü / tenant

- **Tenant kapsamı sağlam:** kapsamsız `findFirst({ where: { sourceReference } })` **bulunamadı**; 8 entegrasyon dosyası çapraz-org 404 asserte ediyor. Zayıflık: kapsam konvansiyonla, tiple değil.
- Erasure tombstone anahtarları: `source_reference | guest_external_id | guest_email | guest_phone`; `guest_external_id` Hospitable'a özgü; **`blocksGuestStay` yalnız `hospitable-sync.ts:307`'de** — yeni sağlayıcı = beşinci ingress, kapı eklenmezse silinmiş misafir geri doğar.
- Audit: yalnız `hospitable.connect/disconnect`; **refresh ve otomatik revoke audit'lenmiyor** (`hospitable-credentials.ts:124-197`).
- Export provider-neutral şekilli ama bağlantı bağlamını taşımıyor.

### 1g. Test altyapısı

- **28 dosya** kendi inline `vi.mock("@/lib/hospitable*")`ını yazıyor; ortak provider fake **yok**. `tests/helpers/fake-storage.ts` birebir emsal.
- 12 dosya `@/lib/messaging`'i mock'luyor → `sendOnChannel` fiilen zaten seam.
- "X modülü Y'yi import etmemeli" pini **yok**; `api-route-scoping.test.ts` iskeleti kullanılabilir.

---

## 2. KORUNACAK mevcut abstraction'lar (yeniden icat edilmez)

| Var olan | Neden doğru yerde |
|---|---|
| `ChannelTarget` + `sendOnChannel` (`messaging.ts`) | Transport-agnostik imza; yalnız gövdesi tek-sağlayıcı. **Dispatch buraya gelir.** |
| `DrainDeps.send/reconcile/tokenFor` (`worker.ts:85-94`) | Enjekte edilebilir; adapter kaydı buraya bağlanır. |
| `SendOutcome` / `SendResultKind` (`outbox/state.ts`) | definitive/ambiguous/rate_limited/blocked zaten ayrı — provider-neutral hata sınıfları için taban. |
| `MessageOutbox` hedef snapshot'ı (`channel` + `externalReservationId`) | Şekil doğru; yalnız `provider/connectionId` eksik. |
| `Reservation.calendarSourceId` sahiplik deseni | "Kaynak sahipliği ile çift yazımı önle" — genelleştirilecek örnek. |
| `loadErasureGuard` + advisory lock RACE MODEL | Her ingress'e aynen bağlanır. |
| `api-route-scoping.test.ts` kaynak-tarama iskeleti | Mimari pin şablonu. |

---

## 3. Hedef mimari (V0 sonu)

```
                 Lixus Core (automation · ai · tasks · retention · erasure · guest-chat · billing)
                                   │  yalnız canonical model + Capability
                          ┌────────┴────────┐
                          │  Channel Layer  │   ChannelConnection (provider, capabilities,
                          │  (dispatch)     │   credentials, cursor, health, audit)
                          └───┬─────────┬───┘
                   HospitableAdapter   ICalAdapter        [gelecek: AirbnbDirect · Booking · Vrbo]
                   (temporary bridge)  (reservation-only)
```

**Değişmezler (test-pinli olacak):**
- Core `hospitable*` import etmez, `hospitable*` alanı okumaz, `channel` string'inden yetenek çıkarmaz → `tests/unit/core-channel-independence.test.ts`.
- Her connector `capabilities` ilan eder (`reservations.read`, `messages.read`, `messages.send`, `webhook`, …); iCal yalnız `reservations.read`.
- Her satır provenance taşır: `connectionId` + `ingestedAt` (+ ham olay ref'i gerektiğinde).
- `qr-chat:` iç-thread ayrımı **string önekinden** çıkarılıp açık bir alana/ kanala taşınır (kırılması en olası değişmez #3).
- Erasure guard **her** ingress'te (beşinci dahil).

---

## 4. Kontrollü geçiş sırası (her adım ayrı K2 turu, ayrı geri alma)

| # | Dilim | Şema? | Prod riski | Geri alma |
|---|---|---|---|---|
| **V0.1** | **Outbound dispatch** — `sendOnChannel`/`DrainDeps` gerçek adapter seçimi yapar; tek kayıtlı adapter Hospitable → davranış birebir. Characterization + shadow-compare + mimari pin. | **Hayır** | Sıfır (aynı çağrı, bir katman altında) | Commit revert |
| V0.2 | Provider fake altyapısı (`tests/helpers/fake-channel.ts`) + connector conformance kiti (duplicate/out-of-order/replay/cancel/modify/reconnect/refresh/revoke/outage/ambiguous/tenant-cross). | Hayır | Sıfır | — |
| V0.3 | `ChannelConnection` tablosu (**additive**, nullable) + dual-write: `hospitable*` org kolonları yazılmaya devam eder, aynı anda connection satırı yazılır; backfill idempotent; read-switch bayrakla; audit'e refresh/revoke eklenir. | **Evet** | Düşük (expand) | Bayrak kapat; kolonlar durur |
| V0.4 | Provenance: `Reservation/Conversation/Message.connectionId` + `ingestedAt` (additive, nullable); Hospitable satırları org'un tek connection'ına backfill. | **Evet** | Düşük | Kolonlar NULL kalır |
| V0.5 | 6 kopya `channel notIn` → tek `messagingCapable(reservation)` predicate'i (connection capability + `calendarSourceId` + iç-thread bayrağı). Önizleme==gerçek paritesi korunur. | Hayır | Orta (lifecycle gönderim kümesi) | Revert; shadow-compare önce |
| V0.6 | Ingest write service + versioned domain event (outbox tablosu); polling ve gelecekteki webhook aynı servise. `importThread` imzasından provider tipi çıkar. | **Evet** | Orta | Expand-contract |
| V0.7 | `hospitable*` org kolonlarının contract'ı (drop) — **yalnız** V0.3 read-switch ≥2 hafta canlıda sorunsuzsa. | **Evet (drop)** | Yüksek | pg_dump |

**Kimlik kararı (V0.4'te verilecek, migration ister):** `sourceReference` unique'i **bozulmaz** (canlı tablo). Çift-kaynak koruması `calendarSourceId` emsaliyle **bağlantı sahipliği** üzerinden kurulur; ikinci sağlayıcı aynı ilanı beslerse kullanıcı tarafından belirlenen yetkili kaynak kazanır. Tahminî (tarih/misafir) birleştirme **yapılmaz**.

---

## 5. İlk dilim = V0.1 — neden bu

- Prompt şartı: *"mevcut çalışan üretim yollarından en az biri gerçekten yeni sınırdan geçmeli"* → oto-yanıt, lifecycle ve elle reply'ın **hepsi** `sendOnChannel`'dan geçiyor; dispatch'i gerçekleştirmek üçünü birden yeni sınırdan geçirir.
- Migration yok → pg_dump/onay kapısına takılmaz, hemen doğrulanabilir.
- Mevcut seam (`12 test mock'luyor`) → characterization testleri yazması ucuz.
- Kırılma yüzeyi küçük ve ölçülebilir: eski `sendMessage` çağrısı ile yeni adapter çağrısının **aynı argümanlarla** yapıldığı shadow-compare ile kanıtlanır.

**V0.1 kanıt planı:** kırmızı-önce (`core-channel-independence` pini kırmızı; "adapter seçilmedi" testi kırmızı) → dispatch → mutasyon-1 (registry'yi boşalt → gönderim durur) → mutasyon-2 (her hedefi Hospitable'a yolla, `qr-chat:` dahil → iç-thread testi kırmızı) → 7 kapı.

---

## 6. Bilerek V0 DIŞINDA

Property Memory · Exception Feed · Availability Engine · RAG · Ask Lixus · Proof AI · Revenue Brain · tahminî Airbnb endpoint'i/payload'ı (sandbox+doküman yokken **yazılmaz**; yalnız provider-neutral sözleşme + fixture) · Review tablosu (ingestion kaynağı yok) · Issue tablosu (Task'tan farklı yaşam döngüsü kanıtlanmadı).

---

## 7. Airbnb Direct öncesi kalan mimari/güvenlik riskleri (V0 kapatmaz)

- Token refresh/revoke **audit'siz** (V0.3'te kapanır).
- `guest_external_id` tombstone'u sağlayıcıya özgü; `blocksGuestStay` tek yolda.
- Hata sınıflandırması Hospitable hata **metnine** regex'li — Airbnb hata gövdesi farklı olacak.
- `Property.hospitableId` global unique deseni ölçeklenmez.
- `api.ts:161` paylaşılan HTTP katmanı sağlayıcı sınıf adına dallanıyor.
- Kritik akış boşluğu: inbound→AI→outbox→audit **tek uçtan uca test yok** (TEST-EVIDENCE-CONTRACT §3).

---

## 8. V0.1 DURUMU — UYGULANDI (2026-09-07, commit `2034aba`)

**Ne yapıldı (migration YOK, env YOK, bayrak YOK):**
- `src/lib/channels/outbound.ts` — `resolveOutboundRoute` (boş hedef / `qr-chat:` → local; aksi
  external, sağlayıcı TEK yerde `"hospitable"`), `OutboundAdapter` (provider + capabilities +
  tek-atış `send`), kayıt + test override, `dispatchOutbound` (adaptör yok / yetenek yok /
  kimlik-bilgisi↔sağlayıcı uyuşmazlığı → fırlatmaz, tipli `definitive_failure`).
- `src/lib/channels/hospitable-outbound.ts` — `hospitable.sendMessage`'ın src/ içindeki **tek**
  çağıranı; aynı argümanlar `(id, body, token, { retries: 0 })`; `kind` HTTP durumundan tipli.
- `src/lib/channels/index.ts` — bootstrap; çekirdek yalnız bunu import eder.
- Bağlanan üç üretim yolu: `messaging.ts sendOnChannel` (oto-yanıt · holding-ack · lifecycle ·
  elle yanıt bunu çağırır) ve `outbox/worker.ts defaultSend`; `classifySendResult` tipli `kind`i
  regex'ten önce tercih eder. `SendResult.status` (istemci), `SendOutcome.kind`,
  `OutboxSendOutcome.kind` additive.

**Ne yapılmadı (bilinçli):** V0 örnek adları mekanik uygulanmadı — `ChannelConnection`,
capability registry, delivery-receipt durumları YOK. Kimlik bilgisi çağıran tarafından çözülür
ve `undefined` dahil olduğu gibi iletilir (istemcinin env fallback'i, kurucu org'un legacy
yolu; `tests/integration/messaging.test.ts` bunu pinliyor) → fail-closed V0.3'ün işi. Tek
semantik sıkılaştırma: worker `qr-chat:` satırını artık LOCAL sayar (ulaşılmaz; belgeli, pinli).

**Kanıt (sözleşme §2):** kırmızı-önce 9 test (mimari pin 3 + dispatch entegrasyonu 6 —
worker VARSAYILAN bağımlılıklarla, `sendOnChannel`, gerçek `sendDueWelcomes`, elle yanıt rotası;
sızıntı dedektörü = mock'lu istemci) → yeşil; shadow-compare (gerçek adaptör eski argümanlarla);
sınıflandırma paritesi (her HTTP durumu); kapı testleri. Mutasyonlar iki yönde: worker sınırın
dışına çıkar (3 kırmızı) · `qr-chat:` kuralı silinir (4) · her şey local/aşırı (10 kontrol) ·
kind yok sayılır (1) · adaptör kind sabit (8) · kimlik/yetenek kapısı silinir (1+1) · status
düşürülür (1). Dosyalar: `tests/unit/core-channel-independence`,
`tests/integration/outbound-dispatch`, `tests/unit/outbound-classification-parity`,
`tests/unit/outbound-dispatch-guards`.

**KOD / CI / DEPLOY / PROD SMOKE:** KOD ✅ (yerel kapılar: typecheck · eslint · audit-check ·
tam `npm test` 3458 test / 305 dosya · `next build` ✅) · CI ✅ run #938 (`34125242427`, HEAD `fc399c0`, 2026-09-07 13:03–13:09 UTC) 5/5:
`verify` (typecheck · lint · tam test) · `build` · `e2e` · `migration-chain` · `security-audit`
· DEPLOY: Railway "Wait for CI" → oto (ACTIVE teyidi bu ortamdan görülemez) · PROD SMOKE: yapılmadı; ilk gerçek gönderimde
Gönderilenler'de `externalId` dolu olmalı (adaptör → istemci yolu), Sentry'de
`no outbound adapter` metni GÖRÜLMEMELİ.

**Sıradaki dilim — V0.2 (migration yok):** ortak provider fake'i (`tests/helpers/fake-channel.ts`
— bugün `outbound-dispatch.test.ts` içindeki yerel `fakeAdapter`ın genelleştirilmesi) +
connector conformance kiti. V0.3 (`ChannelConnection`, additive) migration ister → onay kapısı.
