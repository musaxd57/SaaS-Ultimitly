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

---

## 9. V0.2 DURUMU — UYGULANDI (2026-09-07)

**Ne yapıldı (migration YOK, env YOK):**
- `tests/helpers/fake-channel.ts` — ortak sağlayıcı fake'i (`FakeOutboundProvider`): kiracı sahipliği
  (sahipsiz/bilinmeyen rezervasyon → 404 definitive), **dedupe YOK** (aynı gövde iki kez → iki teslim —
  tekilleştirme çekirdeğin işi), 429+Retry-After / 402 / 5xx / 408 / ağ zaman aşımı, "POST ulaştı ama
  yanıt kayboldu" (teslim + ambiguous), kimlik-bilgisisiz çağrı ağa çıkmaz, hata metni token taşımaz.
  `deliveries` (misafire gerçekten ulaşan) ve `attempts` (ağ çağrısı) sayaçları — iddialar bunlar üzerinden.
- `tests/helpers/outbound-conformance.ts` — **connector conformance kiti**: 14 senaryo, sağlayıcı-özel
  hiçbir şey bilmez; `ConformanceHarness` arayüzü (arrange/attempts/deliveries/lastToken). Gelecek adaptör
  (Airbnb Direct) aynı kiti geçmek zorunda.
- `tests/unit/outbound-adapter-conformance.test.ts` — kit HEM fake'e HEM gerçek Hospitable adaptörüne
  (yalnız global `fetch` stub'lı; `sendMessage`/`hospitableFetch` gerçek) koşar → fake'in varsayımları
  gerçek adaptörle doğrulanır; biri saparsa kit kırmızı (mutasyonla ölçüldü, iki yönde).
- `tests/integration/outbound-fake-flows.test.ts` — çekirdek akışları × fake (gerçek worker, gerçek rotalar,
  gerçek DB): başarı · yinelenen istek · belirsiz gönderim (ASLA ikinci POST) · 429 · 402+reactivate ·
  bağlantı kesildi · 401 iptali · kiracı sınırı · elle yanıt rotasında belirsizde claim tutulur.
- **Kit bulgusu → tek src düzeltmesi:** gerçek adaptör "kimlik bilgisi yok" hâlini `ambiguous` sayıyordu
  (istemci ağa çıkmadan fırlatır, HTTP durumu yok). Artık token yok VE env fallback yok → `definitive_failure`,
  deneme 0 (`hospitable-outbound.ts`). Prod yolları etkilenmez; V0.1 §8'deki "undefined olduğu gibi
  iletilir" notu artık "env fallback VARKEN" diye okunmalı.

**Kalan sınırlar (dürüstçe):**
- Kit yalnız **outbound** sözleşmesini kapsar. Ingest tarafı (duplicate/out-of-order/replay/cancel/modify
  event'leri) V0.6 (ingest write service) ile birlikte; bugün ingest adaptörü yok, `syncHospitable`
  fonksiyonun kendisi.
- `auth_revoked` ayrı sınıf DEĞİL: 401/403 bugün `definitive_failure` → 6 deneme → `failed`. Doğrusu
  bağlantı-yaşam-döngüsü olayı (V0.3 `ChannelConnection` ile: satır beklesin, host yeniden bağlansın).
  Kit bugünkü davranışı açıkça bu etiketle pinliyor.
- Belirsiz gönderimde `defaultReconcile` sağlayıcı geçmişinden doğrulayamaz (Hospitable idempotency
  anahtarı vermiyor) → `review` (insan). Fake bu sınırı değiştirmez, görünür kılar.
- Fake tek sağlayıcı slot'unu (`hospitable`) kullanır; `OutboundProvider` union'ı ikinci sağlayıcıyla
  genişlediğinde fake parametrik hâle gelir (tek satır).

**KOD / CI / DEPLOY / PROD SMOKE:** KOD ✅ (yerel: typecheck · eslint · audit-check · tam `npm test`
**3502 test / 308 dosya** · `next build`) · CI ✅ run #946 (`34131768132`, HEAD `93fa5f2`, 2026-09-07
14:13–14:23 UTC, 5/5: verify · build · e2e · migration-chain · security-audit) · DEPLOY: oto (yalnız "hiç
kimlik yok" dalı değişti; canlıda ulaşılmaz) · PROD SMOKE: gerekmiyor (davranış değişimi ulaşılmaz dalda).

**Sıradaki dilim — V0.3 (`ChannelConnection`, additive migration → taze `pg_dump` + açık onay kapısı):**
credential'lar org kolonlarından bağlantı satırına dual-write; `auth_revoked` sınıfı ve "bağlantı koptu →
satır bekler" semantiği; `resolveOutboundRoute` sağlayıcıyı bağlantıdan alır.

---

## 10. V0.3 DURUMU — YEREL, PUSH EDİLMEDİ (2026-09-07)

> 🚨 **Bu dilim MIGRATION içerir (49_channel_connection).** Commit yalnız bu konteynerin yerel
> dalında; oto-deploy dalına (`origin/claude/great-edison-3zqpZ`) **push edilmedi**. Push kapısı:
> taze doğrulanmış `pg_dump` + kurucunun AÇIK prod onayı (↓"Operatör kapısı"). CI bu commit'te
> KOŞMADI (push yok); kapılar yerelde koşuldu (↓). Konteyner sıfırlanırsa yerel commit kaybolur —
> yedek için ayrı bir dala push izni gerekir (sistem kuralı: başka dala izinsiz push yok).

**Başlangıç → bitiş:** `751233c` (origin ile aynı) → yerel `V0.3` commit'i (↓hash raporda).

**Tasarım — mevcut davranışlardan türetildi (kod-doğrulandı):**
- Kimlik bilgisi bugün `Organization.hospitable{TokenEnc,RefreshTokenEnc,TokenExpiresAt,Label,ConnectedAt}`;
  yaşam döngüsü durumu yok (revoked ≠ disconnected ayrımı yok), refresh yarışı ciphertext blob'u üzerinden
  fenced (F04), ikinci sağlayıcı/hesap için yer yok. Kuyruk satırı hangi bağlantı altında kuyruklandığını
  bilmiyor.
- **`ChannelConnection`** (yeni tablo): `(organizationId, provider)` başına TEK satır; `status`
  active|disconnected|revoked; şifreli token blob'ları (aynı crypto-core anahtarı — backfill ciphertext'i
  AYNEN kopyalar, yeniden şifreleme yok); `generation` her kimlik-bilgisi yazımında artar (bağlan /
  yeniden bağlan / refresh / kaldır / revoke) = refresh yarışının ikinci CAS çapası; `revokedReason`
  kapalı küme (`refresh_invalid_grant` | `send_401` | `send_403`); `lastRefreshAt`.
  Disconnect/reconnect satırı YENİDEN KULLANIR (id sabit) → kuyruk damgaları kopmaz.
- **`MessageOutbox.connectionId`** (nullable, FK YOK, index yok): enqueue anındaki aktif bağlantı
  (provenance). Legacy satırlar (49 öncesi) null ve aynen teslim olur.
- **Dual-write (expand):** `setOrgHospitableToken` / `setOrgHospitableOAuthTokens` / `clearOrgHospitableToken`
  / refresh persist / refresh invalid_grant → org kolonları VE bağlantı satırı **tek TX'te**, aynı
  ciphertext (bir kez şifrelenir). Refresh persist iki CAS'a bağlı: org refresh blob'u (F04) + bağlantı
  `generation`; biri 0 satır eşlerse TX geri alınır, gecikmiş token ne yazılır ne verilir. Satır yoksa
  (backfill gecikmesi) `create` ile yakınsar; arada satır belirmişse (reconnect yarışı) P2002 = stale.
- **Okuma anahtarı `CHANNEL_CONNECTION_READ=1`** (varsayılan KAPALI): açıkken mevcut bağlantı satırı
  otoritedir (aktif değilse "bağlı değil"), satırı olmayan org için org kolonları fallback. Kapalıyken
  davranış birebir eski. `getConnectionInfo` (UI) hâlâ org kolonlarından okur — dual-write tutarlı tutar.
- **Backfill (idempotent):** `backfillChannelConnections()` — kolonda token'ı olup satırı olmayan org'lara
  aktif satır; `scheduled-sync` her geçişin başında çağırır (normalde 0 satır; hata raporlanır, geçişi
  bloklamaz). Satırı olan org'a dokunmaz; eşzamanlı çakışma (P2002) yutulur.
- **`auth_revoked`** (yeni `SendResultKind`; 401/403 hem tipli yol hem metin regex'i): satır `pending`e
  park edilir, **deneme tüketilmez** (429/402 paritesi), `handleProviderAuthFailure(org, status)`:
  OAuth ve son 10 dk içinde refresh edilmemişse → süre şimdiye çekilir (bir sonraki okuma refresh
  eder; bağlantı aktif kalır); PAT ya da taze refresh'e rağmen 401 → org kolonları CAS ile temizlenir
  (yeni bağlanmış token silinmez) + bağlantı `revoked` + audit `channel.connection_revoked` + alarm.
  Sonraki geçişlerde satır `disconnected` olarak bekler (sağlayıcıya çağrı YOK); host yeniden
  bağlanınca AYNI satır aktifleşir ve satır tam bir kez teslim olur.
- **Kiracı ↔ bağlantı:** worker, satırın `connectionId`si başka org'a aitse göndermez (sending →
  canceled `connection_tenant_mismatch`; reconciling → review) + alarm.

**Migration 49 (yerel doğrulama):** `prisma migrate diff --script` ile üretildi; yalnız additive
(`ALTER TABLE "MessageOutbox" ADD COLUMN "connectionId" TEXT` — nullable, rewrite yok; `CREATE TABLE
"ChannelConnection"` + index + unique + FK cascade). Taze PG'de 00→49 `migrate deploy` ✅, sıfır drift ✅
(`--exit-code`). Dolu tabloya unique/required-no-default/drop YOK.

**Kanıt (sözleşme §2):** kırmızı-önce 17 test 5 dosyada (bağlantı satırı yok / 401 definitive / damga
yok / okuma anahtarı yok) → yeşil. Dosyalar: `integration/channel-connection-lifecycle` (8: bağlan→kaldır→
yeniden bağlan aynı satır · refresh generation · refresh↔disconnect · refresh↔reconnect · invalid_grant →
revoked+audit · geçici hata dokunmaz · kiracı · okuma anahtarı paritesi/otoritesi),
`integration/channel-connection-migration` (4: backfill ciphertext aynen + idempotent · kapalı/açık
parite PAT+OAuth · legacy kuyruk satırı teslim · yarışan bağlanma), `integration/outbox-connection` (8:
damga · kaldır→bekle→yeniden bağlan tek teslim · PAT 401 → park+revoked+temizle+audit → yeniden bağlan tek
teslim · 403 · OAuth 401 → refresh zorla → teslim · kiracı uyuşmazlığı cancel · kontrol), kit/fake/parite
401/403 → `auth_revoked`, `hospitable-credentials` persist-retry casusu `$transaction`a taşındı.
**Mutasyonlar (iki yön):** org CAS tek başına kaldırıldı → YEŞİL (bağlantı CAS tutuyor) · bağlantı CAS tek
başına kaldırıldı → YEŞİL (org CAS tutuyor) · ikisi birden → 2 KIRMIZI (derinlikli savunma ölçüldü) ·
disconnect satıra dokunmuyor → 2 · worker auth_revoked dalı silindi → 4 · OAuth 401 hemen revoke/aşırı → 1
(kontrol) · backfill hiç çalışmıyor → 1 · damga yok → 2 · kiracı kontrolü yok → 1 · okuma anahtarı yok → 1.

**Geri alma:** additive — eski kod yeni kolon/tabloyu görmez ve org kolonları source-of-truth kalır;
kod geri alınırsa tablo zararsız durur (istenirse ileride drop migration'ı). Okuma anahtarı hiç
açılmadıysa geri alma = commit revert. Anahtar açıldıysa önce env'i sil (davranış kolonlara döner).

**Operatör kapısı (push ÖNCESİ, sırayla):** (1) taze `pg_dump` (Railway PG; `pg_dump -Fc` + `pg_restore -l`
kataloğu + SHA256) ve yedeğin ayrı yerde olduğunun teyidi; (2) kurucunun AÇIK "push et" onayı; (3) push →
CI 5/5 (migration-chain job 49'u taze DB'de koşar) → Railway `migrate deploy` (ADD COLUMN nullable +
CREATE TABLE; kısa DDL kilidi; tablo boş doğar); (4) deploy sonrası ilk sync geçişi backfill'i koşar:
`SELECT count(*) FROM "ChannelConnection"` = bağlı org sayısı; (5) `CHANNEL_CONNECTION_READ` ≥1 hafta
KAPALI kalır; açmadan önce parite: bağlı her org için org kolonu ile bağlantı satırı ciphertext'i eşit
olmalı (dual-write'ın kanıtı); (6) anahtar açılır; sorun olursa env silinir (anında geri).

**Push kapısı adım (1) KANITI (2026-09-07 18:33, operatör klonu `LixusPreflight-43ccd3c` @ `751233c`,
`ops-backup-prod.ps1`, PostgreSQL 18):** `lixus-prod-post-contract-2026-09-07-183354.dump` · 1.449.478 bayt ·
TOC 197 girdi · `pg_restore -l` ✅ · SHA256
`0F02038D5D7AA9EF14E93986751FF2805EACA570F7095B174EA7A106ECD21D1B`. Restore provası bu yedekle henüz koşulmadı.

**Adım (2)–(4) KANITI (2026-09-07):** kurucu onayı → fast-forward push `751233c..0270eb3` → CI run #950 5/5
(migration-chain 49 taze DB'de) → prod `_prisma_migrations`: `49_channel_connection` finished 15:49:33Z,
rolled_back boş, yarım migration 0, `MessageOutbox.connectionId` var. **Backfill 0 satır ve bu BEKLENEN:**
prod'da 9 org, hiçbirinde `hospitableTokenEnc` yok, `hospitable.connect/disconnect` audit'i hiç yok; Lale
Ayarlar'da "Sistemin ortak (env) Hospitable bağlantısı" — yani `PRIMARY_ORG_ID` env fallback'i. Env fallback
V0.7'ye kadar kalır; o org'un kuyruk satırları `connectionId` NULL (legacy yol). Ciphertext paritesi boş kümede
anlamsız → `CHANNEL_CONNECTION_READ` DB'ye kaydedilmiş ilk gerçek bağlantı olmadan AÇILMAZ.

**Bilerek kapsam dışı / kalan sınırlar:** sync yolu 401'de bağlantıyı revoke ETMEZ (yalnız raporlar) —
geçici sağlayıcı arızasında herkesi düşürme riski yüzünden ayrı karar; `(org, provider)` başına tek
bağlantı (çoklu hesap = dolu tabloda unique değişikliği, ayrı migration); env fallback (`HOSPITABLE_API_TOKEN`,
kurucu) hâlâ var — V0.7'de kalkar; `getConnectionInfo` kolonlardan okur; OAuth 401 döngü kilidi 10 dk
(`lastRefreshAt`) — eşik ölçümle değişebilir. **Conformance/fake testleri canlı sağlayıcı doğrulaması
DEĞİLDİR**: gerçek adaptör yalnız HTTP stub'ıyla sınandı; Hospitable'ın gerçek 401/403/429 gövdeleri
canlıda gözlenmedi (Lale 402'de).

---

## 11. V0.4 DURUMU — CANLI (2026-09-07; iki doğruluk turu ile düzeltildi, migration 50 prod'da 19:29Z)

> ✅ **CANLI.** Kapı §10 ile aynen: taze `pg_dump` 22:02 (SHA `A36BCA89…42E459`) → kurucu "push et" → fast-forward
> `ed481b6..c378a97` (3 commit) → CI run #954 5/5 (migration-chain 50 taze DB'de) → Railway deploy → prod
> `_prisma_migrations` `50_provenance` finished **2026-09-07 19:29:18Z**, rolled_back boş, yarım migration 0, 9 kolon
> üç tabloda mevcut. **Prod sayımı (deploy anı):** Reservation 1538 · Conversation 1328 · Message 17.436 — hepsi
> `legacy` (damgasız; çıkarım backfill'i BİLEREK yok), `ingested` 0 (deploy'dan beri yeni ingest yok; Lale 402'de
> donuk), `bound` 0 ve ChannelConnection 0 (bağlantı satırı yok, env fallback). `CHANNEL_CONNECTION_READ` KAPALI.
> V0.5 (`messagingCapable`)
> bu tura ALINMADI: talimat "migration gerektirmiyorsa V0.4+V0.5 aynı turda" idi, V0.4 migration istedi →
> V0.5 kapıdan sonra ayrı tur (migration'sız).

**Başlangıç → bitiş:** `ed481b6` (origin) → yerel V0.4 (`47b61b5`) → **doğruluk turu** (kurucu talimatı: ayırt
edilemeyen legacy satır damgalanmaz; "mevcut bağlantıyı aktar" tarihsel kanıt değil; `ingestedAt` açık tanım
+ tekrar senkron eskiyi yeni göstermez; dedupe farklı dolu bağlantıyı sessizce birleştirmez, zaman farkı ayrı).
İlk taslaktaki **çıkarım backfill'i (`backfillProvenance` + `provenanceBackfilledAt` işareti + scheduled-sync
kancası) KALDIRILDI**: legacy satırın bağlantı kimliği org/provider tekilliğinden ÇIKARILABİLİR ama
KANITLANAMAZ (env fallback geçmişi, elle UI belirsizliği) — kanıtlanamayan damga basılmaz.

**Sözleşme (şema yorumu + `src/lib/channels/provenance.ts`; kod-doğrulandı):**
- `connectionId` (String?, FK/index YOK) = satırın **KANITLANMIŞ** sağlayıcı bağlantısı. Yalnız iki yolla
  yazılır: (a) **ingest** — satırı yaratan ingress o an aktif bağlantı altındaydı; (b) **gözlem** — satır
  NULL damgalıyken sonraki bir Hospitable senkronu onu O bağlantıdan gerçekten çekti (NULL→X doldurma:
  `...(connectionId && !existing.connectionId ? { connectionId } : {})`). ASLA X→Y, ASLA X→NULL (bağlantısız
  koşu dolu damgayı ezmez). Mesaj satırı yeniden yazılmadığı için gözlemle dolmaz (yalnız create).
  iCal (`calendarSourceId`), QR (`qr-chat:`), elle dosya, env fallback → NULL. Giden Message: outbox'ta
  kuyruklandığı bağlantı (`enqueue`); doğrudan gönderim yolu NULL (V0.5/V0.6).
- `ingestedAt` (DateTime?) = **İLK ALINMA**: bir ingress satırı YARATTIĞI an. Değişmez — hiçbir update yolu
  dokunmaz (Hospitable rezervasyon/konuşma update, iCal update, dosyadan iptal). Freshness / "son görülme" /
  "son içerik değişimi" BU DEĞİLDİR (iCal: `feedLastSeenAt`; thread: `syncCursorAt`; gerekirse V0.6'da ayrı
  `lastObservedAt`). Host'un elle girdiği satır, AI/bot cevabı, doğrudan gönderim → NULL. `Message.createdAt`
  sağlayıcı zamanıdır; `ingestedAt` bizim aldığımız an → gecikme analizi için ayrı anlam taşır.
- **`connectionEvidence` (String?, kapalı küme app-enforced: `ingest` | `observed` | `outbound`)** = damganın
  NASIL yazıldığı; `connectionId` ile birlikte yazılır, birlikte ezilmez. **Kurucu senaryosu (doğruluk turu 2):**
  env fallback ile alınmış (`ingestedAt` dolu, `connectionId` NULL) satır sonradan gerçek bağlantıdan senkronize
  edilince NULL→X dolar; iki kolon (connectionId + ingestedAt) tek başına "ilk alınma bu bağlantıdan" iddiasını
  TAŞIYAMAZ — ilk taslağın sınıflandırıcısı tam olarak bu yanlış iddiayı üretiyordu (`unbound → ingest`, test
  pinliydi). Kanıt türü satırda açıkça durduğu için sınıf `observed` kalır, `ingest` iddiası çıkmaz.
- **Beş sınıf** (`describeProvenance`, tahmin yok): `ingest` (satırı yaratan ingress bu bağlantı altındaydı)
  · `observed` (NULL iken gözlemlendi — ilk alınma kaynağı iddia edilmez, `ingestedAt` dolu olsa bile) ·
  `outbound` (giden Message, kuyruklandığı bağlantı — gözlem değil) · `unbound` (ilk alınma kanıtlı, bağlantı
  yok: env fallback/iCal/QR/dosya) · `legacy` (hiçbiri). Türü olmayan dolu damga (olmaması gereken durum) en az
  iddialı sınıfa (`observed`) düşer, asla `ingest` etiketi almaz.
- **Adoption ≠ tarihsel kanıt:** bağlantı satırının doğması (bağlanma / "mevcut bağlantıyı aktar") HİÇBİR
  geçmiş satırı damgalamaz; yalnız sonraki senkronun gerçekten gözlemlediği satır `observed` olur; senkron
  penceresi (90/540 gün) dışındaki legacy satır NULL kalır = bilinmiyor (dürüst).
- **Kimlik kararı (§4):** `sourceReference` unique'i bozulmadı; sahiplik provenance ile (iCal `calendarSourceId`,
  sağlayıcı `connectionId`); tahminî birleştirme YOK; öncelik kuralı V0.6 ingest write service'inde.

**Dedupe (dry-run/apply politika tabloları, kapsayıcı `Record` yeni kolonu zorladı):**
- Conversation `connectionId: single_non_null` → iki FARKLI dolu değer = kaynak çelişkisi → FAIL-CLOSED, kendi
  kovası **`connection_conflict`** (sessiz birleştirme yok); NULL↔dolu çelişki değil (kanıt keeper'a taşınır,
  `mergedConversationFields`). `connectionEvidence: single_non_null` aynı kovada (damgayla birlikte taşınır;
  aynı bağlantı için iki kopya farklı tür söylüyorsa hangi hikâye doğru bilinmez → fail-closed). `ingestedAt: keeper_wins` → kopyalar doğal olarak farklı anda alınır: çelişki
  DEĞİL ama sayılır (`keeper_wins_differences`) — zaman farkı bağlantı çelişkisinden AYRI değerlendirilir.
- Message: yeni `provenance_id` politikası — döngüde içerik kıyasından ÖNCE ve AYRI: farklı dolu bağlantı →
  **`message_connection_conflict`** (içerik çelişkisi sayılmaz); `ingestedAt: provenance` (kıyaslanmaz; NULL↔dolu
  bağlantı + farklı zaman = tam kopya, düşer).

**Migration 50 (yerel doğrulama):** yalnız 9 nullable `ADD COLUMN` (3 tablo × connectionId/connectionEvidence/
ingestedAt); default
YOK (`@default(now())` mevcut satırlara migration anını yazar = sahte provenance), FK/index YOK, rewrite YOK.
Taze PG 00→50 `migrate deploy` ✅, sıfır drift ✅, işaret kolonu YOK ✅, shadow diff boş ✅.

**Kanıt (sözleşme §2):**
- İlk tur kırmızı-önce 13/13 (`Unknown argument`, `is not a function`) → yeşil. Doğruluk turu: dedupe çelişki
  testleri koddan önce yazıldı → 3/5 kırmızı ("planned 1" = keeper_wins gerçekten sessiz birleştiriyordu; kova
  yok; mesaj kontrolü yok) → 5/5 yeşil. Ingest sözleşmesi (ilk alınma değişmezliği, gözlemle doldurma,
  adoption ≠ kanıt) ilk turun kodu kaldırıldıktan sonra yazıldığı için kırmızısı MUTASYONLA gösterildi (↓N1–N6).
- Doğruluk turu 2 (kurucu senaryosu) koddan önce: 7 kırmızı (`expected 'ingest' to be 'observed'` dahil) →
  yeşil; mutasyon E1–E6 (doldurma `ingest` yazar · konuşma doldurma `ingest` yazar · create tür yazmaz · enqueue
  `ingest` yazar · sınıflandırıcı türü yok sayar · ikinci gözlem türü ezer) hepsi KIRMIZI.
- Dosyalar: `integration/provenance-ingest` (7: aktif bağlantıyla ingest her iki yön · **ilk alınma
  değişmez: içerik değişmeyen VE değişen tekrar senkron** · env fallback → bağlan (gözlemle NULL→X, ilk alınma
  sabit, mesaj yeniden yazılmaz) → kaldır (X korunur, yeni satır unbound) · **adoption ≠ kanıt: bağlantı doğunca
  hepsi legacy; gözlemlenen `observed`, pencere dışı legacy** · iCal unbound + değişen feed ilk alınmayı
  değiştirmez · .csv unbound · QR misafir unbound/bot damgasız · enqueue Message damgası),
  `unit/provenance-classes` (beş sınıf + kurucu senaryosu + türsüz damga), `integration/conversation-dedupe-dryrun` (+5: connection_conflict ·
  NULL↔dolu planlanır · zaman farkı ≠ çelişki (keeper_wins sayılır) · message_connection_conflict ≠ içerik ·
  NULL↔dolu + farklı zaman tam kopya), `unit/scrub-scope-parity` (kanarya: Message 16, Conversation 25,
  Reservation 34, karar yorumlu).
- **Mutasyonlar, iki yön, hepsi KIRMIZI:** ilk tur M1–M13'ten hâlâ geçerli olanlar (mesaj damgası yok · iCal/QR
  ingestedAt yok · enqueue damgası yok) + doğruluk turu N1 rezervasyon gözlemle doldurma yok · N2 update damgayı
  koşulsuz yazar (X→NULL) · N3 rezervasyon update ingestedAt yeniden yazar (eski satır "yeni") · N4 konuşma
  update ingestedAt yeniden yazar · N5 konuşma gözlemle doldurma yok · N6 iCal update ingestedAt yeniden yazar ·
  N7 dedupe connectionId keeper_wins (sessiz birleştirme) · N8 mesaj bağlantı kontrolü yok · N9 ingestedAt farkı
  çelişki sayılır · N10 NULL↔dolu çelişki sayılır · N11 `observed` "ingest" sayılır.

**Kapılar (son yerel ağaç, doğruluk turu 2 sonrası):** tam suit 3539/313 yeşil · `tsc --noEmit` temiz · `eslint .`
temiz · `next build` temiz · `audit:check` yeşil (0 triajsız) · zincir 00→50 taze PG + sıfır drift + shadow diff boş.
CI: koşmadı (push yok).

**Geri alma:** additive — kod revert edilirse kolonlar zararsız durur (NULL); yazılmış damgalar kanıttır,
geri alınacak çıkarım YOK. Bayrak yok (bugün hiçbir karar bu kolonları okumaz; V0.5/V0.6 tüketir).

**Push kapısı adım (1) KANITI (2026-09-07 22:02, operatör klonu `LixusPreflight-43ccd3c`, `ops-backup-prod.ps1`,
PostgreSQL 18):** `lixus-prod-post-contract-2026-09-07-220244.dump` · 1.452.573 bayt · TOC 203 girdi (V0.3 tablosu
dahil; 197→203 tutarlı) · `pg_restore -l` ✅ · SHA256
`A36BCA89063464B63CC20DE15B2BACD517777C59074212DEB833373FEA42E459`. Adım (2) açık "push et" BEKLENİYOR.

**Operatör kapısı:** §10 adımları aynen (taze `pg_dump` + SHA + açık onay → push → CI 5/5, migration-chain 50 →
Railway `migrate deploy` (9 nullable ADD COLUMN) → deploy sonrası salt-okuma kontrol: `_prisma_migrations`
`50_provenance` finished; ilk senkrondan sonra `SELECT count(*) FROM "Reservation" WHERE "ingestedAt" IS NOT NULL`
artmalı; `connectionId` bugün prod'da HİÇ dolmaz (bağlantı satırı yok, env fallback) — beklenen).

**Kalan sınırlar:** legacy satırların büyük kısmı `legacy` sınıfında kalır (kanıt yok; yalnız pencere içi
gözlem doldurur) · doğrudan gönderim yolunun Message satırı damgasız (V0.5/V0.6) · Lale env fallback'te
olduğu sürece yeni satırlar `unbound` (adoption sonrası yalnız YENİ ve GÖZLEMLENEN satırlar dolar) ·
`importThread`/`upsertReservationCalendar` ek parametresi opsiyonel (testler doğrudan çağırıyor) ·
conformance/fake = canlı sağlayıcı doğrulaması DEĞİL.

---

## 12. V0.5 CANLI + V0.6 DURUMU — YEREL, PUSH EDİLMEDİ (2026-09-07)

### V0.5 — `messagingCapable` tek kaynak ✅ CANLI (`19d5527`, CI run #958 5/5, migration YOK)
`src/lib/channels/capability.ts`: `PROVIDER_MESSAGEABLE_RESERVATION_WHERE` (= `sourceReference` dolu +
`calendarSourceId` null + `channel notIn [ics, manual]`; eski 6 literal'e BİREBİR eşit — shadow-compare pini) ve
`PROVIDER_THREAD_CONVERSATION_WHERE` (+ `isInternalThread`, `INTERNAL_THREAD_PREFIX` tek yer). `automation.ts`'teki
6 rezervasyon + 2 konuşma kopyası fragment spread'ine indi → önizleme == gerçek YAPISAL. Org düzeyi yetenek
(kimlik çözümü, env fallback) DEĞİŞMEDİ (`getOrgHospitableToken` kapısı; V0.7'de bağlantıdan). QR/local
(iç thread), Hospitable ve env fallback davranışı korundu (davranışsal test: `integration/messaging-capability` —
previewWelcomes == sendDueWelcomes aynı küme; ics/csv/feed/referanssız dışarı; env fallback gönderir;
bağlantısız org önizler ama göndermez; QR thread kanal oto-yanıtına girmez). Mutasyon K1–K7 hepsi kırmızı.

### V0.6 — Ingest write service + canonical tipler + domain event (migration 51 — ✅ CANLI 2026-09-08 03:13Z)
> Kapı §10 ile aynı: taze doğrulanmış `pg_dump` + kurucunun AÇIK "push et" onayı. CI bu commit'te KOŞMADI;
> kapılar yerelde (↓). V0.7'ye geçilmedi.

**Sözleşme (kod-doğrulandı):**
- **`channels/ingest.ts`** — okuma yönü sözleşmesi: `IngestAdapter { listProperties · listReservations · listMessages }`
  canonical döner (`CanonicalProperty/Reservation/Message`, kapalı durum kümesi, `terminal` bayrağı, misafir
  alt nesnesi); tipli `IngestError.kind` (auth_revoked · rate_limited · outage · not_found · no_credential);
  adaptör DEDUPE YAPMAZ, SIRALAMAZ, çıkarım yapmaz; kimliksiz çağrı ağa çıkmaz; hata metni token taşımaz.
  Kayıt defteri `channels/index.ts` (`registerIngestAdapter`, `__setIngestAdapterForTest`).
- **`channels/hospitable-ingest.ts`** — `@/lib/hospitable` OKUMA fonksiyonlarının src/ içindeki tek çağıranı
  (+ sağlayıcı-adlı `api/hospitable/diagnostics`; pin `unit/core-channel-independence`). Normalizasyon
  (`toChannel`, `mapReservationStatus`, `isGuestMessage`, `senderFullName`, `reservationGuestName`, terminal)
  hospitable-sync'ten BİREBİR taşındı. Bilinen sınır (envanter 1b, değişmedi): `toChannel` bilinmeyen
  platform string'ini ham geçirir (`other`'a katlamak görünür etiketi değiştirir; ayrı karar).
- **`ingest/write-service.ts`** — canonical yazma servisi (çekirdek; sağlayıcı importu YOK):
  `upsertCanonicalReservation` + `importCanonicalThread` (+ NS-43 kimlik kilidi, test kancası). Gövdeler
  hospitable-sync'ten taşındı: KVKK resurrection/era guard'ları, imleç idempotency'si, adopt-and-heal, P2002
  dedupe-hit, gövdesiz mesaj sayacı, çit geri alma AYNEN. **Sağlayıcı tipi imzadan çıktı** (`importThread(
  HospitableReservation…)` → `importCanonicalThread(CanonicalReservation…)`; envanter §4 V0.6 hedefi).
  **Tek bilinçli davranış farkı:** rezervasyon/konuşma UPDATE yalnız gerçekten değişen alan varsa yazılır
  (eskiden her senkron koşulsuz UPDATE) — domain event "değişti" demek için ölçmek zorunda; değişmeyen senkron
  ne yazar ne event üretir (replay testi `updatedAt`'in sabit kaldığını pinler). Provenance V0.4 aynen.
- **`IngestEvent`** (migration 51, yeni tablo): transactional outbox — satırla AYNI TX'te yazılır. **PII'SİZ:**
  `organizationId · provider · connectionId · entityType · entityId (bizim id) · kind · schemaVersion=1 ·
  occurredAt · dispatchedAt`; misafir metni/adı ve sağlayıcı kimliği YOK (KVKK süpürgeleri bilmez; kanarya
  dışı — bilinçli). Kinds: `reservation.created|updated|cancelled · conversation.created|updated ·
  message.imported`. Org cascade; `entityId`'ye FK yok (satır silinse de "olay oldu" kaydı kalır). Tüketici
  bugün YOK (V1 Property Memory / Exception Feed); `dispatchedAt` gelecek için.
- **`hospitable-sync.ts`** artık orkestrasyon: token → adaptör → canonical → erasure kilidi/guard → write
  service → yan etkiler (görev, supply, çit). Polling bugün, webhook yarın AYNI write service'i çağırır.
  `reservations-cleanup.ts` de adaptöre geçti (§1e sızıntısı kapandı). `noteHospitableError` tipli
  `IngestError.status` okur.

**Migration 51 (yerel doğrulama):** yalnız `CREATE TABLE "IngestEvent"` + 2 index + FK cascade (additive, dolu
tabloya dokunmaz). Taze PG 00→51 `migrate deploy` ✅ (52 finished), sıfır drift ✅, shadow diff boş ✅.

**Kanıt (sözleşme §2):**
- Kırmızı-önce: `unit/ingest-adapter-conformance` (adaptör yokken import hatası → 30/30 yeşil: fake 15 + gerçek
  adaptör/fetch stub 15 — normalizasyon, dedupe YAPMAZ, sıralamaz, durum kümesi, gövdesiz mesaj, sayfalama,
  kiracı sınırı (stub varsayımı), 401/403/404/429/503/ağ tipli hata, kimliksiz ağa çıkmaz);
  `integration/ingest-write-service` (refactor öncesi 7/10 kırmızı: senkron fake'i görmüyordu → 10/10 yeşil):
  ilk ingest + event'ler · REPLAY idempotent (satır/event/updatedAt sabit) · BATCH İÇİ TEKRAR · SIRASI DEĞİŞMİŞ
  (kronolojik saklama, durum son mesajdan, geç gelen eski mesaj sonraki batch'te alınır) · DEĞİŞİKLİK
  (`reservation.updated`; maskelenen ad geriletilmez, event yok) · İPTAL (`reservation.cancelled`, replay ikinci
  event üretmez) · KİRACI SINIRI (token→mülk görünürlüğü; org'lar birbirine dokunmaz; event'ler org-kapsamlı) ·
  TOMBSTONE (erasure sonrası yeni mesajlı replay hiçbir şey yazmaz, `skipped` tam 1) · PROVENANCE (unbound →
  observed/ingest; event bağlantı damgası) · GÖVDESİZ mesaj.
- Mevcut senkron testleri değişmeden yeşil (hospitable-sync 38, kimlik kilidi, p2002 retry, erasure, dedupe
  apply/dry-run, scheduled-sync, cleanup) → davranış korundu. `importThread` çağıran 2 test canonical imzaya geçti.
- **Mutasyonlar (iki yön):** adaptör I1–I7 hepsi kırmızı (dedupe eder · sıralar · 403 yanlış sınıf · kimliksiz
  ağa çıkar · durum eşlemesi eksik · fake kiracı sınırını gevşetir · fake kimliksiz ağa çıkar). Yazma yolu W1–W7,
  W9, W10 kırmızı (değişiklik ölçümü yok · iptal 'updated' · mesaj event'i yok · gözlemle doldurma yok · batch
  dedupe yok · kronoloji yok · event bağlantı damgası yanlış · create'te kanıt türü yok · KVKK resurrection guard
  yok). **Tombstone derinlikli savunma ÖLÇÜLDÜ:** yalnız TX içi guard kaldırıldı → yeşil (ön kapı tutar); yalnız ön
  kapı kaldırıldı → yeşil (TX içi guard tutar); ikisi birden → KIRMIZI.
- ⚠️ **Conformance/fake ≠ canlı sağlayıcı doğrulaması.** Gerçek adaptör yalnız HTTP stub'ıyla sınandı; "token'ın
  görmediği mülk → boş liste" varsayımı canlıda gözlenmedi; gerçek 401/403/429 gövdeleri gözlenmedi.

**Kapılar (son yerel ağaç, tek başına koşuldu):** tam suit 3588/317 yeşil · `tsc --noEmit` temiz · `eslint .` temiz ·
`next build` temiz · `audit:check` yeşil (0 triajsız) · zincir 00→51 taze PG + sıfır drift + shadow diff boş.
CI: koşmadı (push yok).

**Geri alma:** V0.6 kodu revert edilirse `IngestEvent` tablosu zararsız durur (tüketici yok); write service ile
eski importThread davranışı aynı (yalnız "değişmeyen UPDATE atlanır" farkı geri döner). Bayrak yok.

**Push kapısı adım (1)+(2) KANITI (2026-09-08 06:00, operatör klonu `LixusPreflight-43ccd3c`, `ops-backup-prod.ps1`):**
`lixus-prod-post-contract-2026-09-08-060002.dump` · 1.457.780 bayt · TOC 203 · `pg_restore -l` ✅ · SHA256
`EF6366944195EC28CF6A4BB98BD16716F24EA187BC6078D3D371F1D2CC194002` · kurucu "push et yedek tamam" (06:0x).

**Adım (3)–(4) KANITI (2026-09-08):** fast-forward push `19d5527..0a7a2a4` (V0.6 `a2e60fe` + V0.7 `c1f8a2e` + belge)
→ CI run #960 5/5 (03:11Z; migration-chain 51 taze DB'de) → prod `_prisma_migrations` `51_ingest_event` finished
03:13:28Z, rolled_back boş, yarım migration 0, `IngestEvent` tablosu var ve BOŞ (Lale 402'de donuk, yeni ingest yok
— beklenen), `ChannelConnection` 0, `MessageOutbox.lastErrorCode='connection_inactive'` 0. `CHANNEL_CONNECTION_READ`
KAPALI. V0.7 kod hazırlığı aynı deploy'da canlı (migration'sız; kolon DROP'u operatör planına bağlı).

**Operatör kapısı (referans):** §10 adımları aynen — taze `pg_dump` + SHA + açık "push et" → CI 5/5
(migration-chain 51 taze DB'de) → Railway `migrate deploy` (CREATE TABLE; kısa) → salt-okuma kontrol:
`_prisma_migrations` `51_ingest_event` finished; ilk senkrondan sonra `SELECT kind, count(*) FROM "IngestEvent"
GROUP BY kind` (Lale 402'de donuk → 0 beklenebilir); `CHANNEL_CONNECTION_READ` KAPALI kalır.

**Kalan sınırlar / V0.7 öncesi:** webhook yok (yalnız polling; write service hazır) · event tüketicisi yok ·
`toChannel` ham platform geçişi · env fallback + `getConnectionInfo` org kolonlarından (V0.7) · `reservations-cleanup`
hâlâ `hospitableId`'ye bakar (Property kimliği V0.7 kapsamı) · `api/hospitable/diagnostics` istemciyi doğrudan
kullanır (sağlayıcı-adlı operatör yüzeyi, bilinçli).

**Çalışma tarzı dersi (bu turda ölçüldü, CLAUDE.md'ye yazıldı):** tam suit koşarken BAŞKA vitest KOŞMA —
`tests/global-setup.ts` her `vitest run`'da PG 5433'ü `stop -m immediate` + `initdb` ile sıfırlar; paralel koşu
süren suit'in DB'sini öldürür (42–59 sahte kırmızı dosya, `Can't reach database server`). Süreç öldürürken
`pkill -f "vitest run"` KALIBI kendi kabuğunla ve `node (vitest)` ana süreciyle eşleşmez: yetim ana süreç bitince
teardown'ı yeni koşunun PG'sini kapatır — `pkill -f "node \(vitest"` + doğrulama (`ps | grep "[v]itest"`) şart.

---

## 13. V0.7 KOD HAZIRLIĞI — ✅ CANLI 2026-09-08 (deploy `0a7a2a4`; kolon DROP'u YOK, operatör planına bağlı)

> Kapsam doğrulaması: envanter §4 V0.7 = `hospitable*` org kolonlarının contract'ı (drop), ön koşul
> "okuma anahtarı ≥2 hafta canlıda sorunsuz" — SAĞLANMADI (anahtar hiç açılmadı; prod'da bağlantı satırı
> yok). CLAUDE.md drop'u bu koşul olmadan yasaklar. Bu tur = geçişin **kod hazırlığı**: env fallback ve
> UI bağlantı bilgisi ChannelConnection'a; durumlar doğru ve sağlayıcı sağlığından ayrı; kuyruk
> yönlendirmesi damgalı bağlantıya bağlı; diğer kolon okuyucuları çift kaynaklı. **Migration YOK.**
> Canlı geçiş adımları AYRI belgede: `docs/V0.7-CANLI-GECIS-OPERATOR-PLANI.md`. Commit yerel: V0.6'nın
> (migration 51) üstünde durduğu için kapı aynı (taze `pg_dump` + açık onay).

**Sözleşme (kod-doğrulandı):**
- **`resolveHospitableCredential(org, { forConnectionId })`** — TEK kimlik çözümleyici (`getOrgHospitableToken`
  sarmalayıcı). Kaynak sırası: (anahtar açıksa) satır → org kolonları → env (yalnız kurucu org). Dönüş
  `{ token, source: connection|org_columns|env, connectionId, reason }`; `connectionId` satır varsa ve aktifse
  onun id'si (env → null). **Damgalı kuyruk satırı yalnız damgalandığı bağlantıdan gider:** satır
  revoked/disconnected/silinmiş → `connection_inactive` (env'e SESSİZCE DÜŞMEZ); başka org'un satırı →
  `connection_tenant_mismatch`. Damgasız satır (env altında kuyruklanan) env ile gider.
- **`getConnectionInfo`** — ChannelConnection satırı otorite (yoksa org kolonları, backfill öncesi); SAKLI
  veriden, sağlayıcıya çağrı YOK (test: istemci fonksiyonları mock'ta fırlatır). Beş durum: `connected` ·
  `env_fallback` · `disconnected` · `revoked` (+`revokedReason`) · `never_connected`; ek alanlar
  `credentialSource (db|env)`, `connectionId` (tarihçe), `disconnectedAt`, `revokedAt`. Kurucu org'un kendi
  bağlantısı revoked/disconnected olsa da env erişimi KORUNUR: `state` kendi bağlantısının durumu,
  `connected`/`credentialSource=env` env gerçeği — iki gerçek birlikte (Lale).
- **Worker** — V0.3 kiracı kontrolünün yanında: damgalı satırın bağlantısı aktif değilse (ya da satır yoksa)
  satır bekler (`pending`/`ambiguous`, `lastErrorCode=connection_inactive`, deneme tüketilmez); host yeniden
  bağlanınca AYNI satır aktifleşir, mesaj tam bir kez gider (yeni PAT ile).
- **UI** (`hospitable-connect-card`): revoked kırmızı (sebep + "yeniden bağlanın" + env devredeyse notu),
  disconnected amber, env fallback ve connected eski metin. Admin paneli: satırdan durum etiketi
  ("İptal edildi (send_401) · ortak (env) devrede" gibi). **Çift kaynak:** `scheduled-sync` boş-org
  atlaması ve `unverified-sweep` canlılık kontrolü bağlantı satırını da sayar (contract'ta kolon düşünce
  davranış değişmez).
- **Geçmişe damga YOK:** revoke/disconnect hiçbir Reservation/Message damgasını yeniden yazmaz (test-pinli).

**Kanıt (sözleşme §2):** kırmızı-önce `integration/connection-state` (25: beş durum × anahtar kapalı/açık
paritesi · revoked+env kurucu erişimi · kiracı · resolver forConnectionId: aynı satır / revoked+env →
inactive / disconnected / başka org → tenant_mismatch / silinmiş satır · sarmalayıcı paritesi; 24/25
kırmızı → yeşil) + `integration/outbox-connection` (+2: damgalı satır + revoked + env → bekler, env ile
GİTMEZ, yeniden bağlanınca tek teslim yeni PAT ile — refactor öncesi env ile GİTTİ (kırmızı); env altında
kuyruklanan NULL damgalı satır env ile teslim). Mevcut V0.3 yarış testleri (refresh↔disconnect,
refresh↔reconnect, invalid_grant, PAT/OAuth 401) değişmeden yeşil. Hedefli 24 dosya 278 test yeşil.
**Mutasyonlar (iki yön, 8/8 KIRMIZI):** S1 revoked "revoked" sayılmaz · S2 env fallback yok (kurucu erişimi
düşer) · S3 damgalı-inaktif satır env'e düşer · S4 aktif damgalı satır da inactive (aşırı) · S5 tenant_mismatch
→ inactive · S6 worker parkı yok · S7 worker aktif satırı da bekletir (aşırı) · S8 durum türetirken sağlayıcıya
çağrı (14 kırmızı: "bağlantı var ≠ sağlıklı" pini).

**Kapılar (son yerel ağaç, tek başına koşuldu):** tam suit 3615/318 yeşil · `tsc --noEmit` temiz · `eslint .` temiz ·
`next build` temiz · `audit:check` yeşil (0 triajsız) · migration zinciri değişmedi (00→51). CI: koşmadı (push yok).

**Kalan sınırlar / contract öncesi:** `backfillChannelConnections`, `hospitable-token-diagnostics-core`,
`hospitable/connect` rotası ve credentials'ın org-kolon dalı hâlâ kolon okur (contract turunda satır-tek-
kaynak) · env fallback bir satır DEĞİL (bilinçli: satır = kimlik bilgisi taşıyan kayıt; env durumu
`credentialSource=env` ile açık) · bağlantı "sağlığı" (son başarılı senkron, 401 sayısı) ayrı sinyal,
bu turda UI'a alınmadı · HTTP stub ≠ canlı doğrulama.

---

## 14. V1 PROPERTY MEMORY + SIGNALS — ALTYAPI (09-08 sabah) + ÜRÜN AKIŞI (09-08 Codex turu, §14b); YEREL, PUSH EDİLMEDİ

> **Durum sınıflandırması (Codex 09-08):** sabahki tur = "altyapı hazır, ürün akışı eksik" — tüketici yalnız Hospitable
> write service event'lerini görüyordu; Hospitable'sız kiracı için hiçbir şey üretmiyordu, KB bootstrap'ı çağıran
> yüzey ve okuma yüzeyi yoktu. §14b bu boşlukları kapatır.

> Kurucu kararıyla başladı (09-08). Tasarım ve kapsam eşlemesi: `docs/V1-PROPERTY-MEMORY-DESIGN.md`.
> **Migration 52 içerir** (`Signal`, `PropertyMemory`, `IngestEvent.changedFieldsJson`) → kapı §10 ile aynı
> (taze `pg_dump` + açık "push et"). CI bu commit'te KOŞMADI; kapılar yerelde (↓). V0 geçiş bayrakları
> değişmedi; müsaitlik cevabı / dış aksiyon / V2+ yok.

**Kod hazırlığı (bounded context `src/modules/intelligence`, sağlayıcı importu YOK — mimari pin):**
- `signals/derive.ts` — saf, LLM'siz: gelen misafir mesajı → kelime ağı intent'i (`classifyFallback`;
  `general` sinyal değil; host/AI satırı asla) → `message.intent` sinyali (kategori, negatif/nötr, şiddet
  0.2–0.7, güven kelime ağının verdiği 0.55–0.7); `reservation.cancelled` → `cancellation`;
  `reservation.updated` + değişen alan ∋ arrivalDate|departureDate → `date_change`. occurredAt: mesajın GERÇEK
  zamanı / olayın gözlem zamanı (iptalin gerçek anı iddia edilmez). PII taşınmaz.
- `consumer.ts` — `IngestEvent` tüketicisi: damgasızlar (occurredAt,id) sırasıyla; canonical satır şimdiki
  hâliyle okunur; her event kendi TX'inde `createMany({skipDuplicates})` (unique `dedupeKey` → ON CONFLICT DO
  NOTHING, TX abort yok) + `dispatchedAt` damgası. Yarıda kalma/yeniden başlatma/tekrar işleme mükerrer
  üretmez. Org filtresi; satırı silinmiş event damgalanır (orphaned sayacı).
- `memory/bootstrap.ts` — KB'den başlangıç hafızası: `source=kb_item`, `sourceRef=kb.id`, `observedAt=kb.updatedAt`
  (gerçek), `confidence=1`; idempotent; pasif kalem → retired. Geçmişe sahte event/ilk alınma ÜRETİLMEZ.
- `memory/patterns.ts` — örüntü: mülk × kategori, 180 günde ≥3 negatif sinyal → `kind=pattern`,
  `source=signal_pattern`, evidence = sinyal id'leri, `observedAt` = son sinyal, `lastConfirmedAt` = hesap anı,
  güven 0.6→0.9; eşiğin altına düşen retired.
- `retention.ts` — misafir-kaynaklı sinyal `DATA_RETENTION_MONTHS` sonrası purge (değişmez 14; sınıf: guest-derived);
  rezervasyon-kaynaklı sinyal ve KB/insan hafızası saklanır. Erasure: FK SetNull, satır PII'siz kalır.
- `memory/read.ts` — `getPropertyMemory(org, property)` (V2/UI için okuma yüzeyi). `index.ts` —
  `runIntelligencePass(org)`; `scheduled-sync` org geçişinde alerts'ten SONRA, try/catch (PMS bloklanmaz);
  retention bloğunda `purgeExpiredSignals(retentionCutoff())`.
- `IngestEvent.changedFieldsJson` — yalnız alan ADLARI (PII'siz), write service `reservation.updated`'da yazar.
- `Property.hospitableId` V1 akışına girmez (hafıza/sinyal `Property.id` ile) — bu turda bağımlılık yok.
- `scripts/apply-conversation-dedupe.ts` — DMMF referans envanteri `Signal.conversationId`'yi buldu ve tasarımı gereği
  fail-closed durdu (tam suit 14 kırmızı); `Signal` `repoint` listesine alındı: FK `SetNull` olsa da sinyal silmeden
  ÖNCE keeper'a taşınır (türediği mesaj keeper'dadır; SetNull bağı sessizce koparırdı). Envanter pini 5 model.

**Migration 52 (yerel doğrulama):** 1 nullable ADD COLUMN (`IngestEvent`, prod'da boş) + 2 CREATE TABLE + index +
FK (org cascade; reservation/conversation SetNull). Taze PG 00→52 ✅ (53 finished), sıfır drift ✅, shadow diff boş ✅.

**Kanıt (sözleşme §2):** kırmızı-önce `integration/intelligence-consumer` (modül yokken import hatası → 9/9 yeşil):
şikayet → sinyal (occurredAt = mesaj zamanı; host cevabı ŞİKAYET KELİMELİ olsa da sinyal yok; general yok) ·
TEKRAR İŞLEME (damga sıfırlansa bile 0 yeni) · SIRASIZ (event zamanları ters → aynı küme) · YARIDA KALMA
(ilk olaydan sonra çökme → kalan damgasız; yeniden başlatınca tamamlanır, mükerrer yok) · İPTAL/DEĞİŞİKLİK
(cancellation · date_change · ad değişikliği sinyal değil · replay ikinci sinyal üretmez) · KİRACI/MÜLK (A/B) ·
SİLME/RETENTION (erasure sonrası PII'siz; purge sinyali siler, ESKİ KB hafızasına dokunmaz) · KB bootstrap
(observedAt = KB updatedAt, idempotent, retired, kiracı) · örüntü (eşik altı yok; ≥3 → pattern, kanıt id'leri,
observedAt = son sinyal; idempotent) + `getPropertyMemory`. `integration/scheduled-sync-intelligence-hook` (org
başına bir kez; hata bloklamaz). Mimari pin `unit/core-channel-independence` (+1). Kanarya kararı yorumu.
**Mutasyonlar (12, iki yön, hepsi KIRMIZI):** dedupe yok · occurredAt = işleme zamanı · host satırı sinyal ·
general sinyal · created sinyal · tarih alanına bakmama · org filtresi yok · retention hafızayı siler · bootstrap
observedAt = şimdi · örüntü eşiği 2 · bootstrap idempotent değil · (V1-12) dedupe apply'da Signal repoint bloğu
kaldırılınca `integration/conversation-dedupe-apply` "FK'sız referanslar" kırmızı (signal 1→0). (İlk ölçümde 2'si
fikstür zayıflığından yeşildi; fikstür keskinleştirildi, yeniden ölçüldü.)

**Kapılar (son yerel ağaç, tek başına koşuldu):** tam suit 3627/320 yeşil (580 sn) · `tsc --noEmit` temiz · `eslint .`
temiz · `next build` temiz · `audit:check` yeşil (0 triajsız) · migration zinciri taze PG 00→52 (53 finished,
son `52_property_memory_signals`) sıfır drift, shadow diff boş. CI: koşmadı (push yok). Suit'in ilk koşusunda
dedupe apply envanter pini 14 kırmızı verdi (tasarım gereği fail-closed) → Signal repoint eklendi, yeniden koşuldu.

**Canlıda bekleyen doğrulamalar (kod hazırlığından AYRI):** prod'da `IngestEvent` BOŞ (Lale 402'de donuk) →
tüketici canlıda henüz hiçbir şey üretmez; ilk gerçek akışta: sinyal sayımı `SELECT category, count(*) FROM
"Signal" GROUP BY category`, örüntü eşiği gözlemi, retention purge'ün ilk deep geçişi, KB bootstrap'ın çağrılması
(operatör/UI adımı — henüz çağıran yüzey yok: sonraki adım). Fixture/demo sonuçları canlı doğrulama DEĞİLDİR.

**Kalan sınırlar (altyapı turu sonunda — §14b ile ÇÖZÜLENLER işaretli):** ~~QR/iCal kaynaklı olaylar IngestEvent
üretmiyor~~ (§14b) · güçlü yön (strength) hafızası yok (review ingestion yok) · LLM çıkarımı yok (guardrail/eval sonrası) ·
~~UI yüzeyi yok~~ (§14b: mülk sayfası kartı) · ~~bootstrap'ı çağıran yüzey yok~~ (§14b) · bağlantı sağlığı sinyali yok.

### 14b. Ürün akışı turu (Codex 2026-09-08) — kaynak sözleşmesi · Hospitable'sız kiracı · KB çağrı yolu · okuma yüzeyi

**Uzlaşma (önceki rapor ↔ gerçek kod):** "polling ve webhook aynı write service" ifadesi yalnız SAĞLAYICI yolu içindi.
Kod-doğrulama: `src/` içinde `ingestEvent.create*` yalnız `ingest/write-service.ts`'teydi; iCal (`import/sync.ts`), elle
dosya (`api/reservations/import`) ve QR (`api/chat/[token]`) kendi TX'lerinde satır yazıyor, provenance damgalıyor
(V0.4) ama event ÜRETMİYORDU. `runScheduledSync` intelligence bacağı Hospitable'sız org'a da uğruyordu (busy = mülkü
var) ama tüketecek olay yoktu. Tasarım belgesi §2 "Uzlaşma" paragrafı + §7 sözleşme tablosu + §8 kurucu kabul
koşulları karşılaştırması.

**Kod (davranış koruyan; yazma yolları taşınmadı, yalnız event'e bağlandı):**
- `src/lib/ingest/events.ts` — TEK yazıcı `recordIngestEvent`; `INGEST_SOURCES = hospitable · ical · manual_file · qr_chat`
  (kapalı küme, derlemede exhaustiveness); `IngestContext.provider: IngestSource`; yeni kind `message.received` (doğrudan
  kanal) — `message.imported` (sağlayıcı senkronu) ile tüketici tarafında aynı. Write service artık buradan import eder
  (sözleşme tipleri re-export; dış imza değişmedi).
- `import/sync.ts` — satır TX'inde create → `reservation.created`; update → `reservation.updated` + `changedFieldsJson`
  (arrivalDate/departureDate/status/calendarSourceId/guestName/notes yalnız ADLAR; scrubbed satırda ad/not yok);
  STATUS:CANCELLED → `reservation.cancelled`. Kayıp uzlaştırması (bayrak) iptal ettiğinde de `reservation.cancelled`
  (org bir kez okunur, yalnız iptal olursa). Değişmeyen satır → yazma yok → event yok (ölçülen "boş geçiş boş" korunur).
- `api/reservations/import` — create/cancel TX'lerinde `manual_file` event'i; dedupe-hit TX iptali event'i de düşürür.
- `api/chat/[token]` — `recordGuestChatExchange` YALNIZ misafir satırı için `message.received` (bot cevabı event değil);
  org kapsamı `ctx.property.organizationId`.
- `modules/intelligence`: consumer `message.received` işler · `runIntelligencePass` = KB bootstrap → event → örüntü ·
  `bootstrapMemoryFromKnowledgeBase` toplu (kapsam başına iki findMany) + **silinen KB kalemi → retired** ·
  `refreshPropertyMemoryBestEffort` (fırlatmaz) · `labels.ts` (Türkçe etiket, sağlayıcı adı yok).
- KB rotaları (`POST /api/kb` · `PATCH/DELETE /api/kb/[id]` · `copy`) yazdıktan sonra hafızayı mülk kapsamında eşitler;
  DELETE önce mülkü okur (hard delete sonrası kapsam bilinmeliydi).
- `scheduled-sync.ts` — intelligence bacağı iCal bacağından SONRA (aynı geçişte tüketim); try/catch aynen.
- Mülk sayfası (`(app)/properties/[id]`) — "Mülk Hafızası" kartı: KB'den kalem sayısı · örüntüler (evidenceCount) · son
  8 sinyal (kategori, tarih, kaynak türü rozeti); `getPropertyMemory(...).catch(() => null)` → "okunamadı", sayfa çalışır.

**Kanıt (sözleşme §2):** kırmızı-önce `integration/intelligence-native-sources` (sözleşme modülü yokken import hatası →
8/8 yeşil) — gerçek `runScheduledSync` + gerçek rotalar (feed HTTP ve model mock), org'un Hospitable token'ı/bağlantısı/
env'i YOK: (1) iCal → `reservation.created` (provider ical, connectionId null) AYNI geçişte tüketilir, KB → hafıza
(observedAt = KB updatedAt), sinyal yok · (2) besleme değişince `reservation.updated` (changedFieldsJson ⊇ arrival/
departure, guestName YOK) + `reservation.cancelled` → `date_change` + `cancellation`; değişmeyen geçiş: event/sinyal/
hafıza updatedAt SABİT · (3) QR şikayet → `message.received` (qr_chat) tek event (bot cevabı yok) → `complaint` sinyali
konuşma+rezervasyon+mesaj id bağlı, occurredAt = mesaj createdAt; replay 0 yeni · (4) elle .ics → created; aynı dosya
dedupe (event yok); STATUS:CANCELLED → cancelled (manual_file) → iptal sinyali · (5) KİRACI: A'nın akışı B'de event/
sinyal/hafıza üretmez; B'nin okuma yüzeyi A mülkünü görmez · (6) KB rotaları: POST → aktif, PATCH içerik → güncel, pasif
→ retired, aktif → active, DELETE → retired; geçiş tekrarı değiştirmez; okuma yüzeyi retired'ı göstermez · (7) RETENTION:
QR sinyali cutoff'tan eskiyse purge, iptal sinyali + KB hafızası kalır. `integration/feed-disappearance` (+1: uzlaştırma
iptali → event; ilk kayıp event değil). `unit/core-channel-independence` (+1: `ingestEvent.create*` yalnız events.ts +
write service; üç native yol `recordIngestEvent` çağırır). `unit/intelligence-labels` (3). Mevcut iCal/import/QR/KB/
consumer/write-service testleri değişmeden yeşil (13 dosya 143 test hedefli koşu).
**Mutasyonlar (13, iki yön, hepsi KIRMIZI):** P1 iCal create event yok · P2 update değişen alan adları boş · P3 STATUS:
CANCELLED event yok · P4 QR event yok · P5 tüketici `message.received`'i görmez · P6 geçiş bootstrap'ı çağırmaz · P7
silinen KB kalemi retire edilmez · P8 KB DELETE rotası eşitlemez · P9 AŞIRI: değişmeyen satır da event üretir (replay
testi 5 event) · P10 okuma yüzeyi org filtresi yok · P11 intelligence bacağı iCal'den ÖNCE (eski sıra: aynı geçişte
tüketilmez) · P12 elle dosya iptal event yok · P13 uzlaştırma iptali event yok.

**Kapılar (son yerel ağaç, tek başına koşuldu):** tam suit 3640/322 yeşil (481 sn) · `tsc --noEmit` temiz · `eslint .`
temiz · `next build` temiz · `audit:check` yeşil (0 triajsız) · şema DEĞİŞMEDİ (migration 52 zinciri sabahki doğrulamayla
aynı: taze PG 00→52, sıfır drift, shadow diff boş). CI: koşmadı (push yok). Migration 52 push kapısı aynı (§10).

**Canlıda bekleyen (kod hazırlığından AYRI):** tasarım belgesi §6 — Hospitable'sız yollar Lale'nin 402'sinden BAĞIMSIZ
canlıda doğrulanabilir (QR sohbetleri, iCal beslemeleri); migration 52 sonrası ilk salt-okuma kontrolleri orada. Bu
dosyadaki fixture sonuçları canlı doğrulama DEĞİLDİR.

**Bilinçli dışarıda:** elle tek rezervasyon rotası (`POST/PATCH /api/reservations`: değişiklik ölçümü/TX/guard yok →
"updated" iddiası yapay olurdu; ayrı karar) · Task/bakım olayları (V3) · review/güçlü yön (V6) · ince kategori (LLM'siz) ·
webhook girişi (write service hazır, kalan V0 işi).

**Codex kararı (09-08, tur sonu):** yeni revizyon YOK; açık vizyon parçaları belgelerde görünür kaldıkça mevcut kapsam
yayına çıkabilir. Sıra: taze yedek → migration 52 için AÇIK push onayı → yayın → tablo sayımı değil ÜRÜN AKIŞI doğrulaması
(KB kalemi hafızada; gerçek iCal/QR olayı beklenen sinyale dönüşüyor). Operatör planı:
`docs/V1-CANLI-DOGRULAMA-OPERATOR-PLANI.md`. Bu belge tamamlanmadan "canlı ürün akışı çalışıyor" DENMEZ.

**Push kapısı adım (1)+(2) KANITI (2026-09-08 08:56, operatör klonu `LixusPreflight-43ccd3c`, `ops-backup-prod.ps1`,
PostgreSQL 18):** `lixus-prod-post-contract-2026-09-08-085615.dump` · 1.460.362 bayt · TOC 209 · `pg_restore -l` ✅
("YEDEK TAMAM") · SHA256 `4B89A42F5B14CF4D7C16B2891486C380BC13027B47E71F689CDC4269421FC954` · kurucu: "yedek aldım …
fast-forward push et" (Codex metniyle; force yok, bayraklar değişmez, canlı ürün testleri ayrı takip, V2 yok).

**Adım (3) KANITI (2026-09-08):** fast-forward push `4c1efea..7aa228f` (V1 altyapı `16f70f5` + ürün akışı `4e9b1b1` +
operatör planı `49bec50` + kanıt `7aa228f`; origin == yerel) → CI run #964 (push) **5/5 success** 05:59:36Z→06:09:47Z:
build · e2e (Playwright smoke) · migration-chain (**00→52 taze DB'de `migrate deploy` + sıfır drift**) · security-audit ·
verify (type-check · lint · tests). PR-event run #965 her zamanki gibi skipped. Railway "Wait for CI" → deploy.
**Adım (4) KANITI (2026-09-08, operatör psql, plan bölüm 2):** `_prisma_migrations` `52_property_memory_signals`
finished **06:11:42Z**, rolled_back boş, yarım migration 0 · `Signal` + `PropertyMemory` tabloları ve
`IngestEvent.changedFieldsJson` var · ilk zamanlanmış geçiş koştu: `PropertyMemory kb_item/active = 32` =
`KnowledgeBaseItem isActive = 32` (retired 0; bu satırları yalnız yeni kodun KB bootstrap'ı yazar → yeni sürüm canlı) ·
`IngestEvent` 0, `Signal` 0 (gerçek yeni olay yok — beklenen), undispatched 0. Railway ACTIVE panelden ayrıca teyit
edilmedi; kanıt DB davranışından. Bayraklar değişmedi; `CHANNEL_CONNECTION_READ` kapalı.
**Canlı ÜRÜN AKIŞI (plan bölüm 3: KB → hafıza kartı · QR → şikayet sinyali · dosya/.ics → iptal sinyali · iCal
beslemesi) KISMEN doğrulandı; TAMAMI bitmeden "canlı ürün akışı çalışıyor" DENMEZ.**
- **A (KB → kart): ✅** gerçek mülkte çalıştı; bulgu: pasif/aktif geçişi sessizdi → toast eklendi
  (`tests/ui/kb-toggle-feedback`, kırmızı-önce 2/3 → 3/3; hata yolunda başarı toast'ı yok pinli).
- **C (dosya → iptal → sinyal): ✅ CANLI KANIT (kurucu, 09-08, test mülkü `cmtsbfyh60001pk2qw9z048fj`)** — tek
  rezervasyonlu `.ics` → önizleme "1 eklenecek" → "1 eklendi" → Onaylı; aynı UID'li iptal dosyası → önizleme
  "1 iptal edilecek" → **"1 iptal edildi, 0 atlandı"** → İptal; Mülk Hafızası kartında **"İptal · 08 Eyl 2026 ·
  Rezervasyon"**. **Kanıt ARAYÜZDENDİR:** `IngestEvent`/`Signal` satırları DOĞRUDAN SORGULANMADI. Kart
  `getPropertyMemory` ile `Signal`i okuduğu için sinyalin varlığı arayüzden çıkarılabilir; ara `IngestEvent`
  kaydı ise gözlenmedi (kod yolu testlerle pinli, canlı satır görülmedi).
  **Kart OLAY tarihini gösterir** (`Signal.occurredAt` = `IngestEvent.occurredAt`; iptalin sağlayıcıdaki gerçek anı
  iddia edilmez) — planın "14 Eki" beklentisi konaklama tarihiydi, YANLIŞTI, plan düzeltildi. Kanıt yalnız TEK
  REZERVASYONLU DOSYA yolunu kapsar.
- **Doğrulanmadı:** B (QR → şikayet sinyali) · **URL üzerinden iCal beslemesi** · toplu/çok satırlı dosya ·
  `date_change` · örüntü hafızası.
- **AÇIK BULGU (kapanmadı):** Gist beslemesinde "1 atlandı", rezervasyon Onaylı kaldı →
  `docs/TESHIS-2026-09-08-ical-iptal-atlandi.md` (en olası: Raw bağlantı revizyon SHA'sına sabit → besleme iptalsiz
  sürümü veriyor → `unchanged`). Kaynak silinmedi; URL yolu ayrıca doğrulanmalı.

