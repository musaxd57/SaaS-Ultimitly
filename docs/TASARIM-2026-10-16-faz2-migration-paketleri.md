# Faz 2 migration paketleri — ayrıntılı şema tasarım notu (10-16, salt okuma)

> **Hazır yama (gerçek SQL, taze + dolu PostgreSQL'de sıfır fark doğrulandı): `docs/hazir-yamalar/faz2-2026-10-16/`** — ana dala
> UYGULANMADI; uygulama = kurucu onayı + taze `pg_dump` + ilgili kod (aşağıdaki soruların cevabından sonra). Satır numaraları 10-16 öğleden sonra
> hâlidir (`efb561b`).

> Çalışma ağacı `/home/user/wt-night` (HEAD `efb561b`). KOD YAZILMADI, test / prisma KOŞULMADI. Her iddia dosya:satır ile; doğrulanamayan
> "DOĞRULANMADI", Paddle davranışı "PADDLE-VARSAYIM" diye işaretli (Paddle belgesi bu ortamdan açılamıyor; `odeme.md:146` aynı sınır).
> Numara kuralı: numara YALNIZ `prisma/migrations/<NN>_<ad>` klasörü oluşunca kesinleşir (`docs/MIGRATION-MANIFEST.md:3-4`). Bu notta
> paketler ADLA anılır; sonda yalnız ÖNERİ sırası var.
> Dil kuralı (Codex C6, `codex-1016-verify.md:148-189`): yeni tablolar için "kişisel veri yok" DENMEZ; "doğrudan tanımlayıcı / serbest metin
> taşımaz, takma adlı kimlik taşır (kişisel veri) + saklama süresi" denir.

## 0. Ortak envanter — yeni model / kolon eklenince güncellenmesi ZORUNLU listeler

| # | Liste / test | Ne zaman kırmızı olur | Dosya:satır |
|---|---|---|---|
| E1 | KVKK dışa aktarma kapsamı (büyüyemez sınıflandırma) | şemaya YENİ MODEL eklenince (EXPORTED ya da gerekçeli EXCLUDED'a girmezse) | `tests/unit/data-export-coverage.test.ts:14-37` (EXPORTED), `:40-69` (EXCLUDED), `:81-86` (pin); döküm kaynağı `src/lib/data-export.ts` |
| E2 | Konuşma birleştirme DMMF envanteri | yeni modelde `conversationId` SKALER alanı ya da `Conversation`'a sahip-taraf ilişki varsa | `scripts/apply-conversation-dedupe.ts:104-123` (`HANDLED_REFERENCES`), `:125-142` (tarama: `f.name === "conversationId"`), `:145-153` (fail-closed); pin `tests/integration/conversation-dedupe-apply.test.ts:268-279` (tam liste); ikiz liste `src/lib/conversations-cleanup.ts:171` (`CLEANUP_REPOINTED_MODELS`) + pin `tests/integration/conversations-cleanup.test.ts:352` |
| E3 | Süpürge paritesi + şema kanaryası (misafir modelleri) | `Message · Conversation · Reservation · Task · TaskUpdate · MessageOutbox · AiGeneration · AiReviewLabel`'a YENİ KOLON eklenince sayaç değişir; bu modellere yazan yeni süpürge kolonu iki süpürgede birden olmalı | `tests/unit/scrub-scope-parity.test.ts:27-37` (`GUEST_MODELS`), `:136-170` (beklenen kapsam), sayaçlar `:218-225` (Message 17 · Conversation 26 · Reservation 38 · Task 15 · TaskUpdate 6 · MessageOutbox 23) |
| E4 | Değişmez 3 (dış kimlik bağlantı kapsamsız eşsiz sayılmaz — büyüyemez liste) | yeni `@unique`/`@@unique` bir `external*`, `provider*Id`, `sourceReference`, `*ListingId` adlı alan içerir ve `connectionId/calendarSourceId` içermezse | `tests/unit/channel-invariants-ratchet.test.ts:45` (ad kalıbı `^(?:external\w*\|hospitable\w*\|sourceReference\|provider\w*Id\|\w*ListingId)$`), `:50-56` (bilinen liste), `:65-71` (pin) |
| E5 | Hesap silme | işletme silmesi YALNIZ `Organization` kademesine dayanır → yeni org-kapsamlı model `organizationId` + `onDelete: Cascade` taşımazsa satır kalır (ayrı test listesi YOK; kural koddadır) | `src/lib/data-retention.ts:897-997` (`deleteAccountData`; `:931` "Everything else cascades from the organization row") |
| E6 | Misafir silme (erasure) | misafirden türeyen METİN / kimlik taşıyan yeni kolon `erasure.ts`'e de yazılmalı (E3 paritesi yalnız E3 modellerini görür) | `src/lib/erasure.ts:451` (QR `outbound-send:qr-in:` kilitleri), `:586-626` (outbox, iz, söz, geçmişten öğren) |
| E7 | Test veritabanı temizliği | org FK'si OLMAYAN yeni tablo `resetDb`'ye açıkça eklenmeli (kademe silmez) | `tests/helpers/db.ts:6-44` |
| E8 | Periyodik süpürge | süreli tablo (24 sa / 90 gün …) için `hourly(...)` bacağı | `src/lib/scheduled-sync.ts:832-906` (emsaller: `purgeAutomatedSends` `:902`, `pruneOperationalEvents` `:867`, `purgeEmailOutbox` `:900`) |
| E9 | Kiracı kapsamı (rota) | YENİ rota eklenirse | `tests/unit/api-route-scoping.test.ts`, `tests/unit/api-route-role-gate.test.ts` |
| E10 | Saklama-imha politikası belgesi (test DEĞİL) | yeni süreli tablo | `docs/saklama-ve-imha-politikasi.md` (yeni tabloların hiçbiri listede yok — `GuestCommitment`/`OperationalEvent` de yok; ayrı belge borcu) |

Şemada "her `organizationId` taşıyan modelin FK'si Cascade mi" diye bir TEST YOK (grep: `tests/` altında `onDelete` yalnız iki konuşma testinde). E5 bu yüzden
tasarım kuralıdır; her paket için aşağıda ayrıca yazıldı. Öneri (kurucu sorusu değil, test borcu): DMMF'den "organizationId alanı olan her model ya
`Organization`'a Cascade ilişki taşır ya da gerekçeli listededir" pini (`TrialIdentity` SetNull, `StorageDeletion` FK'siz bilinçli).

Ortak açılış kuralı (`prisma/schema.prisma:9`, CLAUDE.md): dolu tabloya `@unique` / zorunlu-varsayılansız / drop YOK. 67 ve 68'deki desen KISMİ dizin değil,
"yeni NULL'lanabilir kolon + düz `CREATE UNIQUE INDEX` (eski satırlar NULL, PostgreSQL'de NULL'lar çakışmaz)" (`prisma/migrations/67_kb_client_request_id/migration.sql:1-11`,
`68_…/migration.sql:1-24`). Gerçek kısmi dizin (`WHERE`) şemada hiç yok (grep: `UNIQUE INDEX … WHERE` 0 eşleşme); Prisma kısmi dizini şemada
TANIMLAYAMAZ → ham SQL'e yazılırsa `prisma migrate diff` her seferinde dizini "fark" görür (DOĞRULANMADI — bu Prisma 6 sürümünde ölçülmeli). Bu
yüzden aşağıdaki tasarımlar kısmi dizinden KAÇINIR; gerektiği yerde "durum kolonu + NULL'lanabilir tekil anahtar" (NULL = kapsam dışı) kullanılır.

---

## 1. M-defter — ortak işlem defteri (S1 + S2)

### 1.1 Amaç
Kurucu 10-16: "S1 elle gönderim kalıcı işlem kimliği · S2 işlem defteri tablosu → Faz 2 (tek tablo)" (`docs/arastirma-2026-10-15/KURUCU-SORULARI.md:517`).
S1: kalıcı kuyruk KAPALIYKEN elle cevapta `requestId` hiç kullanılmıyor; koruma yalnız 120 sn gövde-özeti kalkanı → yanıtı kaybolan mesajın
3 dk sonraki tekrarı misafire İKİNCİ kez gider (`idempotency.md:29-34`; kod `src/lib/host-send.ts:102-117`, `src/lib/outbound-claim.ts:27,44-63`).
S2: elle rezervasyon / elle konuşma / elle görev / şablon oluşturma uçlarında tekrar koruması YOK (`idempotency.md:260-271, 300-304, 273-275, 234`).
Codex C2 şartı (`codex-1016-verify.md:44-77`): defter "zaten var" dediğinde yan etkiler KAYBOLMAMALI → yerel yan etki aynı işlemde, dış yan etki
kalıcı kuyrukta (→ M-bildirim).

### 1.2 Prisma taslağı (YENİ tablo)
```prisma
/// İŞLEM DEFTERİ (M-defter; kurucu 10-16 S1 + S2 "tek tablo"). Bir istemci işleminin (istek kimliği) sunucudaki TEK sonucuna bağı.
/// METİN SAKLANMAZ: içerik yalnız anahtarlı özet (HMAC) + iç kayıt bağı. Takma adlı kimlik taşır (işletme / istek / kayıt kimliği) → kişisel
/// veri sayılır; ömür 24 sa (süpürge). Konuşma kimliği KOLON DEĞİL (bilinçli, ↓1.4 E2): hedef kimliği özetin içine girer.
model RequestLedger {
  id             String    @id @default(cuid())
  organizationId String
  /// kapalı küme (kod, `lib/request-ledger.ts`): reservation.create · conversation.create · task.create · template.create · reply.send
  scope          String
  /// istemcinin işlem kimliği — biçim `^[A-Za-z0-9-]{8,64}$` (src/lib/validators.ts:143-146 ile aynı)
  requestId      String
  /// HMAC-SHA256(AUTH_SECRET, "ledger:v1|" + scope + "|" + hedef kimliği (mülk / konuşma) + "|" + kanonik gövde) base64url, ilk 32 karakter
  payloadHash    String
  /// running (yalnız reply.send: teslim sürüyor) · committed (kayıt yazıldı, işlem dışı yan etki bekliyor) · completed · ambiguous
  /// (reply.send: sağlayıcı sonucu belirsiz) — kapalı küme, `lib/request-ledger.ts`
  state          String
  /// çalışan sahibin jetonu (fencing; running / committed kurtarma) — `outbound-claim.ts:113-115` deseni
  holder         String?
  /// çalışan kilidin süresi (running / committed) — dolunca yeniden deneme devralabilir / kurtarma koşar
  leaseUntil     DateTime?
  /// "reservation:<id>" · "conversation:<id>" · "task:<id>" · "template:<id>" · "message:<id>" — yalnız iç kimlik
  resultRef      String?
  /// süpürme anı: oluşturmada now + 24 sa; running'de leaseUntil + 24 sa
  expiresAt      DateTime
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, scope, requestId])
  @@index([expiresAt])
}
```
`Organization` modeline `requestLedger RequestLedger[]` geri ilişkisi (`prisma/schema.prisma:167-192` listesi).
Kısmi dizin GEREKMEZ (bütün satırlar kimlikli). Migration SQL (taslak, gerçek SQL `prisma migrate diff --from-migrations … --shadow-database-url
postgresql://postgres@localhost:5432/shadow` ile üretilir — ASLA prod URL):
```sql
CREATE TABLE "RequestLedger" ("id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "scope" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL, "state" TEXT NOT NULL, "holder" TEXT, "leaseUntil" TIMESTAMP(3), "resultRef" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequestLedger_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "RequestLedger_organizationId_scope_requestId_key" ON "RequestLedger"("organizationId", "scope", "requestId");
CREATE INDEX "RequestLedger_expiresAt_idx" ON "RequestLedger"("expiresAt");
ALTER TABLE "RequestLedger" ADD CONSTRAINT "RequestLedger_organizationId_fkey" FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
Durum geçişleri (kodda kapalı küme):
- **Yerel oluşturma (S2):** defter satırı asıl kayıtla AYNI etkileşimli işlemde INSERT. Yerel yan etki (yaşam döngüsü görevleri) aynı işlemde
  (`createReservationTasks`'ın `tx` alan çekirdeği; danışma kilidi `src/lib/automation.ts:1174` zaten işlem içi), dış yan etki (e-posta)
  M-bildirim satırı olarak aynı işlemde → satır doğrudan `completed`. İşlem dışında kalan yan etki varsa (`conversation.create` →
  `applyInboundMessageRules`, `src/app/api/conversations/route.ts:77`) satır `committed` + `holder` + `leaseUntil` yazılır, yan etki bitince CAS ile
  `completed`; tekrar `committed` + süresi dolmuş görürse kurtarmayı KENDİ koşar (brandur "kurtarma noktası", Codex C2) — yalnız yan etki
  tekrar güvenliyse (↓ soru 2).
- **Tekrar (P2002):** işlem geri alınır; dışarıda satır okunur → `payloadHash` farklı = 409 (mevcut metin `reply/route.ts:111` emsali) · aynı +
  `completed` = `resultRef`'teki kayıt veritabanından okunup **200** · `running`/`committed` ve süresi dolmamış = 409 "işleniyor" (PostgreSQL
  ikinci eşzamanlı INSERT'i birincinin COMMIT'ine kadar bekletir; bu dal yalnız `running`/`committed` için).
- **reply.send (S1, kuyruk kapalı yol):** teslimden ÖNCE ayrı kısa işlemde `running` + jeton + `leaseUntil = now + 120 sn` (mevcut
  `CLAIM_TTL_MS`, `outbound-claim.ts:27`). Başarı: `message.create` ile AYNI işlemde `updateMany where holder = jeton → completed, resultRef
  "message:<id>", expiresAt +24 sa` (bugünkü `completeKeyedOutboundSend` fencing deseni `outbound-claim.ts:171-190`). Kesin ret: satır silinir
  (aynı kimlik hemen yeniden denenebilir — bugünkü `releaseOutboundSend` davranışı). Belirsiz: `ambiguous` (↓ soru 1). Gövde-özeti kalkanı
  (`claimOutboundSend`) kimliksiz eski istemci ve iki sekme için AYNEN kalır (`idempotency.md:41`). Kalıcı kuyruk AÇIKKEN bu deftere girilmez
  (zaten `MessageOutbox @@unique([organizationId, idempotencyKey])`, `prisma/schema.prisma:1198`).
- Kapsam DIŞI (bilinçli, iki ayrı tekillik olmasın): söz (`GuestCommitment.clientRequestId`, migration 68), bilgi tabanı (migration 67),
  QR misafir mesajı (`SystemLock` `qr-in:` 24 sa kaydı, `outbound-claim.ts:81-93`). QR'ın deftere taşınması Codex C10 "kalıcı tekillik"
  maddesiyle AYRI karar.

### 1.3 Dolu tabloda açılış güvenliği / geriye doldurma
Yalnız YENİ tablo + yeni tablonun tekil dizini → dolu tabloya dokunulmaz, açılışta patlama yolu yok. Geriye doldurma YOK (geçmişe sahte işlem
üretilmez). Tablo küçük (24 sa ömür; `idempotency.md:433` tahmini günde birkaç yüz satır) → düz dizin, CONCURRENTLY gereksiz. Geri alma:
tabloyu okumayan sürüme dönmek yeter (tablo boşta kalır); `DROP TABLE` ile tam geri (kayıp yalnız ≤ 24 sa tekrar hafızası).

### 1.4 Değişmez listeleri
| Liste | Yapılacak | Gerekçe / kategori |
|---|---|---|
| E1 `data-export-coverage.test.ts:40-69` | `RequestLedger` → EXCLUDED: "İşlem defteri (tekrar güvenliği) — iç işletim; takma adlı kimlik + anahtarlı içerik özeti, metin yok, 24 sa" | yeni model sınıflandırılmazsa `:84` kırmızı |
| E2 `apply-conversation-dedupe.ts:104-123` + `conversations-cleanup.ts:171` | DEĞİŞMEZ — tabloda `conversationId` skaler / `Conversation` ilişkisi YOK (bilinçli). Hedef konuşma `payloadHash`'e girer; birleştirmede kaybedenin defter satırı 24 sa içinde süpürülür. Kayıp konuşmanın `message:<id>` bağı birleştirmede taşınan mesaja işaret etmeye devam eder (mesaj kimliği korunur, ayıklanan kopyada kayıt bulunamaz → 200 + `message: null`, bugünkü `host-send.ts:53` sözleşmesi) | kolon eklenseydi E2'nin iki listesi + iki pini (`conversation-dedupe-apply.test.ts:268`, `conversations-cleanup.test.ts:352`) güncellenmek ZORUNDA olurdu; 24 saatlik satır için taşıma karmaşası gereksiz |
| E3 `scrub-scope-parity.test.ts` | DEĞİŞMEZ (misafir modellerine kolon eklenmiyor; yeni tablo `GUEST_MODELS`'e girmez — metin yok) | — |
| E4 `channel-invariants-ratchet.test.ts:45` | DEĞİŞMEZ — `requestId`/`resultRef` ad kalıbına uymaz | — |
| E5 hesap silme | `organizationId` FK `onDelete: Cascade` ŞART (taslakta var) | `data-retention.ts:931` kademeye dayanır |
| E6 misafir silme | ÖNERİ: `erasure.ts`'te silinen rezervasyon / konuşma / mesaj kimliklerine işaret eden satırlar `deleteMany({ where: { organizationId, resultRef: { in: [...] } } })` (`erasure.ts:586-626` bloğunun yanına). Zorunlu değil (24 sa) ama "takma adlı iz" kalmaz | KVKK: `reply.send` özeti EV SAHİBİ metninin özetidir (misafir adı içerebilir) |
| E7 `tests/helpers/db.ts` | gerek yok (org kademesi) | — |
| E8 süpürge | `scheduled-sync.ts:902` yanına `hourly("request-ledger-purge", …, () => purgeRequestLedger())` — `expiresAt < now` sil | ömür 24 sa |
| E9 rota | yeni rota YOK | — |

### 1.5 Okuyan / yazan kod yolları
- YENİ yaprak modül `src/lib/request-ledger.ts`: `withRequestLedger(tx, { organizationId, scope, requestId, payload }, create)` + `claimLedgerSend`
  / `completeLedgerSend(tx, …)` / `releaseLedgerSend` / `markLedgerAmbiguous` + `purgeRequestLedger`. Özet anahtarı `AUTH_SECRET`
  (`outbound-claim.ts:101-105` deseni; sır yoksa yalnız test).
- `src/app/api/reservations/route.ts:56-88`: `reservation.create` + defter + görevler + bildirim satırları TEK işlem; `applyReservationCreatedRules`
  (`src/lib/automation.ts:1354-1414`) ikiye ayrılır: işlem içi çekirdek (görev + M-bildirim satırı) ve bugünkü e-posta döngüsü kaldırılır.
- `src/lib/automation.ts:1148-1178` `createReservationTasks` → `createReservationTasksTx(tx, id)` çekirdeği (dış imza aynı kalır).
- `src/app/api/conversations/route.ts:58-77` (konuşma + ilk mesaj + defter `committed`; kurallar sonra; `completed` CAS).
- `src/app/api/tasks/route.ts:63`, `src/app/api/templates/route.ts:54` (düz `create` → defterli).
- `src/app/api/conversations/[id]/reply/route.ts:86-101` + `src/lib/host-send.ts:102-152` (S1). ÇEVİRİ kalkandan SONRA (`reply/route.ts:55-83`
  bugün önce — `idempotency.md:37-38` Boşluk C; çift tıkta iki ücretli çeviri).
- Doğrulayıcılar `src/lib/validators.ts`: `reservationSchema`, `conversationCreateSchema`, görev ve şablon şemalarına isteğe bağlı `requestId`
  (`:143-146` ile aynı kalıp; eski istemci göndermezse bugünkü davranış).
- İstemci: `src/components/inbox/conversation-thread.tsx:183, 269-281` `requestIdRef` deseni ortak kancaya; `components/inbox/conversation-form.tsx:45,138`,
  `components/tasks/task-form.tsx:34,133`, rezervasyon ve şablon formları (dosya adları DOĞRULANMADI — `grep` ile çıkarılacak). D1 kuralı
  (form başına kimlik, ağ hatası / 409 sonrası değişmez, başarıda yenilenir — `KURUCU-SORULARI.md:190-192`) aynen.

### 1.6 Testler (kırmızı-önce)
1. Rezervasyon çift POST (`Promise.all`, aynı `requestId`): BUGÜN `reservation.count = 2`, görev 4, her sahibe 2 e-posta → BEKLENEN 1 / 2 / sahip
   başına 1 bildirim satırı; ikinci yanıt 200 + aynı kimlik. KONTROL: kimliksiz iki POST → 2 (eski davranış korunur).
2. Aynı kimlik + farklı içerik → 409 (bugün iki 201).
3. Çökme (Codex C2): işlem COMMIT olduktan sonra rota hata fırlatır (enjeksiyon) → aynı kimlikle tekrar 200 + aynı rezervasyon; görevler VAR (aynı
   işlem), bildirim satırları VAR → boşaltma bir kez gönderir. Naif defterde görev 0 olurdu (kırmızı-önce bu varyantla).
4. S1 (`idempotency.md:48-54` senaryosu, gerçek PG): ilk POST 201 → gövde-özeti kilidi süresi dolmuş yapılır → aynı `requestId` + aynı gövde →
   BUGÜN 201 + `mockSend` 2 kez · BEKLENEN 200 + aynı mesaj, `mockSend` 1. Eşzamanlı `Promise.all` → tek gönderim. Farklı kimlik + aynı metin
   (kalkan dolmuşken) → iki gönderim (bilinçli tekrar çalışır). Kesin ret → aynı kimlik hemen yeniden gönderilebilir.
5. Kiracı sınırı: B işletmesi A'nın `requestId`'sini kullanır → bağımsız kayıt (tekillik `organizationId` içerir).
6. İki ayrı Node süreci (`tests/integration/idempotency-two-workers.test.ts` emsali) + süpürge testi (24 sa sonra aynı kimlik = yeni işlem).
7. Mutasyon (`scripts/mutation-run.mjs`): defter INSERT'ini kaldır → 1 kırmızı; özetten hedef kimliğini çıkar → "başka konuşmada aynı kimlik"
   testi kırmızı; `completed` yerine hiç durum yazma → 3 kırmızı.

### 1.7 Kurucuya soru
1. **S1 belirsiz sonuç:** ÖRNEK — ev sahibi "Saat 15:00'te kapıda olacağım" gönderir, sağlayıcı zaman aşımı verir (mesaj gitmiş OLABİLİR). Bugün:
   "Gönderim doğrulanamadı…" + 120 sn sonra aynı metin yeniden gider (çift mesaj riski). Önerim: aynı işlem kimliğiyle 24 saat boyunca yeniden
   gönderim YOK → "Gönderim doğrulanamadı — konuşmada mesajı göremiyorsanız 'Yeni mesaj olarak gönder'e basın" (bilinçli yeni kimlik). Mesaj
   2 dk'lık senkronla panele gelince satır kendiliğinden "gönderildi" sayılmaz (sağlayıcı kimliği yok) — eşleşme ayrı iş. Böyle yapalım mı?
2. **Elle konuşma + şikâyet ilk mesajı, yarıda kalan işlem:** konuşma yazıldı, sunucu tam o anda düştü → acil görev + "Acil Şikayet" e-postası hiç
   oluşmadı. Önerim: tekrar isteği kuralları YENİDEN koşar; çift e-posta olmasın diye "Acil Şikayet" e-postası da M-bildirim kuyruğuna girer (üçüncü
   tür `complaint_created`). Kabul mü, yoksa bu uç M-defterin ilk dilimi dışında mı kalsın (bugünkü gibi)?
3. **Sıra:** `reservation.create` kapsamı M-bildirim ile AYNI yayında açılsın (yoksa çökmede "Yeni Rezervasyon" e-postası kalıcı kaybolur —
   bugün de kaybolur, ama bugün tekrar yeni rezervasyon açtığı için e-posta en az bir kez gider). Önerim: aynı yayın.

---

## 2. M-kb-surum — `KnowledgeBaseItem.version` (S5)

### 2.1 Amaç
Kurucu 10-16: "S5 bilgi tabanı sürüm alanı (bayat kayıt atomik ret, yazılan metin korunur, fark gösterilir) → Faz 2" (`KURUCU-SORULARI.md:518`).
Bugün son kaydeden kazanır: PATCH `findFirst` → koşulsuz `update` (`src/app/api/kb/[id]/route.ts:31-35, 87-90`) → eski sekmeden kaydetme
düzeltilmiş Wi-Fi şifresini geri getirir (`idempotency.md:468, 517-525`). Araştırmanın migration'sız önerisi `expectedUpdatedAt` idi; kurucu sürüm
alanını seçti.

### 2.2 Prisma taslağı (dolu tabloya varsayılanlı kolon)
```prisma
model KnowledgeBaseItem {
  // … mevcut alanlar …
  /// Sürüm (M-kb-surum, kurucu 10-16 S5): satırın HER yazımında +1 (`version: { increment: 1 }`, atomik). Düzenleme açıldığı andaki sürümü
  /// taşır; yazma `updateMany({ where: { id, version: beklenen } })` → 0 satır = bayat (409). Eski satırlar 0'dan başlar.
  version Int @default(0)
}
```
```sql
-- AlterTable (66 emsali: varsayılanlı NOT NULL kolon dolu tabloda güvenli — PG 11+ sabit varsayılan meta-veri değişikliği, tablo yeniden yazılmaz)
ALTER TABLE "KnowledgeBaseItem" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
```
Emsal: `prisma/migrations/66_property_instruction_by_operator/migration.sql:3` (`BOOLEAN NOT NULL DEFAULT false`), `13_…/migration.sql:2-4`
(aynı gerekçe yazılı). Dizin GEREKMEZ (yazma birincil anahtarla; `version` yalnız koşulda).

### 2.3 Açılış güvenliği / geriye doldurma
Zorunlu ama VARSAYILANLI → "required-no-default" yasağına girmez. Geriye doldurma YOK (hepsi 0; ilk düzenlemede 1). Tekil dizin YOK. Eski kod
sürümü kolonu bilmez → PATCH artırmaz; yeni sürüme dönüşte sürüm geride kalır ama yalnız eşitlik karşılaştırılır (açık sekme yeni sürümü
okuyunca tutarlı) → güvenli. Geri alma: kolonu okumayan sürüm; `DROP COLUMN` veri kaybı yalnız sürüm sayacı.

### 2.4 Değişmez listeleri
| Liste | Etki |
|---|---|
| E1 dışa aktarma | DEĞİŞMEZ — model zaten EXPORTED (`data-export-coverage.test.ts:25`); döküm alan listesi seçili (`src/lib/data-export.ts:212-216`), sürüm eklenmesi gerekmez (iç sayaç) |
| E2 / E3 / E4 | DEĞİŞMEZ (KB misafir modeli değil, konuşma alanı yok, dış kimlik yok) |
| E5 / E6 | DEĞİŞMEZ (mülk kademesi; kolon kişisel veri taşımaz — salt sayaç) |
| İç sözleşme | yanıt süzgeci `withoutClientRequestId` (`src/lib/kb/request-id.ts`) `version`'ı GEÇİRMELİ (istemci ona muhtaç) — testle pinlenmeli |

### 2.5 Okuyan / yazan kod yolları (HER yazıcı artırmalı — biri unutulursa CAS sessizce delinir)
Kodda `knowledgeBaseItem.update/updateMany` yazıcısı ÜÇ (grep, `src/` + `scripts/`; ham SQL yazıcısı yok):
1. `src/app/api/kb/[id]/route.ts:87-90` PATCH → `updateMany({ where: { id, version: d.expectedVersion }, data: { …d, version: { increment: 1 } } })`;
   0 satır → güncel satırı oku, 409 + `{ code: "kb_stale", current: { title, content, category, language, isActive, version } }` (kurucu: "yazılan metin
   korunur, fark gösterilir" — istemci kendi formunu SİLMEZ). Boş kaydet (`:78-85`) sürümü ARTIRMAZ (kurucu 10-12 "boş Kaydet yeni düzenlendi saymasın").
   Doğrulayıcı `kbUpdateSchema` (`src/lib/validators.ts:271`) → `expectedVersion: z.number().int().min(0).optional()` (yoksa bugünkü davranış:
   önbellekteki eski arayüz kırılmasın; ↓ soru 2).
2. `src/app/api/kb/[id]/copy/route.ts:147-160` D2 kopya güncellemesi: koşul `updatedAt` + `copiedContentHash` → `version` ile değiştirilir ya da
   yanına eklenir; `data`'ya `version: { increment: 1 }`.
3. `src/lib/ai-suggestions/act.ts:150-160` Wi-Fi önerisi onayı: bugün işlem içinde `findFirst` → `update` (satır kilidi yok; arada gelen PATCH ezilir,
   READ COMMITTED) → `updateMany where { id, version: kb.version }` + 0 satırda `{ status: "gone" }` (anahtar `AI_ACTION_SUGGESTIONS_ENABLED` KAPALI).
- Okuyucular: `GET /api/kb` (`src/app/api/kb/route.ts:17-25`) sürümü döndürür; istemci `src/components/knowledge/kb-manager.tsx:378-381`
  (`saveEdit`) ve `:221-224` (`toggleActive`) `expectedVersion` yollar; 409'da form metni korunur + güncel hâl yan yana.
- Yeni yazıcı ekleyen olursa: kaynak pini — `src/` altında `knowledgeBaseItem.update(` / `updateMany(` çağrısı `version: { increment: 1 }` içermiyorsa
  kırmızı (yapısal pin; davranışsal testlerin yanında, CLAUDE.md "kaynak taraması tek yönlüdür → davranışsal test" kuralıyla birlikte).

### 2.6 Testler (kırmızı-önce)
1. İki sekme: A ve B sürüm 0'ı okur; B "Lale_2026" kaydeder (→1); A eski sürümle başka satırı kaydeder → BUGÜN 200 + şifre eski hâline döner ·
   BEKLENEN 409 `kb_stale`, şifre "Lale_2026" kalır, yanıtta güncel içerik var.
2. Eşzamanlı (`Promise.all`) iki PATCH aynı sürümle → biri 200, biri 409; sürüm 1.
3. Boş kaydet → sürüm 0 kalır, `updatedAt` ilerlemez (mevcut pin korunur).
4. Wi-Fi önerisi: öneri okuması ile yazma arasına PATCH enjekte (`vi.spyOn` — AYRI dosya, CLAUDE.md Prisma temsilcisi sızıntı kuralı) → BUGÜN
   ezilir · BEKLENEN `gone`.
5. D2 kopya güncellemesi sürümü artırır; kopya güncellendikten sonra eski sürümle PATCH → 409.
6. `expectedVersion`'sız eski istemci → bugünkü davranış (soru 2'nin cevabına göre).
7. Mutasyon: PATCH koşulundan `version` çıkar → 1 ve 2 kırmızı; `increment` çıkar → 2 kırmızı; copy rotasında `increment` çıkar → 5 kırmızı.

### 2.7 Kurucuya soru
1. **Hangi değişiklik "bayat" sayılır?** ÖRNEK: sekme A'da Wi-Fi kaleminin METNİNİ düzenliyorsunuz; sekme B'de aynı kalemi yalnız PASİFE aldınız.
   A'da Kaydet → (a) 409 "Bu bilgi siz düzenlerken başka yerde değişti (pasife alındı). Yazdığınız metin duruyor." · (b) yalnız metin alanları
   değiştiyse 409, aktif/pasif değişikliği bağımsız. Önerim (a) — tek sayaç, basit ve atomik.
2. **Sürümsüz istek (eski açık sekme, yayından önce yüklenmiş sayfa):** (a) bugünkü gibi kabul (son kaydeden kazanır) · (b) 409 "Sayfa güncellendi,
   yenileyin". Önerim (b) yayından 1 gün sonra; ilk gün (a). Basitlik isterseniz baştan (b).
3. 409 metni (müşteriye giden): "Bu bilgi siz düzenlerken başka bir yerde güncellendi. Yazdığınız metin aşağıda duruyor; güncel hâli yanında."
   Uygun mu?

---

## 3. M-odeme-niyeti — işletme başına tek açık Paddle işlemi (Codex C1)

### 3.1 Amaç
Codex C1 (doğrulandı, `codex-1016-verify.md:3-42`): iki sekme kapıdan önce geçerse iki onay + iki AYRI ödeme ekranı açılır → iki tahsilat. Ödeme ekranı
istemcide her açılışta yeni Paddle işlemi kurar (`src/components/settings/paddle-plans.tsx:283-289`, `transactionId` yok); sunucu kapısı yalnız onay
anında bakar (`src/app/api/billing/consent/route.ts:72-86`); "ödemeniz işleniyor" kilidi yalnız ilk sekmenin `checkout.completed`'ından sonra
İSTEMCİDEN yazılır (`paddle-plans.tsx:191-203` → `src/lib/billing/checkout-pending.ts:28-35`), açık ikinci ekranı durdurmaz. Hedef: sunucunun açtığı
TEK Paddle işlemi; iki sekme aynı işlemi gösterir; aynı işlem iki kez ödenemez (PADDLE-VARSAYIM ↓).

### 3.2 Neden YENİ tablo (CheckoutConsent'e kolon değil)
`CheckoutConsent` mesafeli satış onayının DELİL kaydıdır: "delil kaydı sonradan yeniden yazılmaz" (`consent/route.ts:96-101` yorumu), satır başına
tek kabul (`prisma/schema.prisma:886-914`). Ödeme niyeti ise değişen durum makinesidir (açık → tamamlandı / iptal / süresi doldu). İkisini bir satırda
tutmak delil kaydını güncellenir yapar. Ayrıca "işletme başına tek açık" kısıtı delil tablosunda kısmi dizin isterdi.

### 3.3 Prisma taslağı (YENİ tablo)
```prisma
/// ÖDEME NİYETİ (M-odeme-niyeti, Codex C1). İşletme başına en çok BİR açık Paddle işlemi: iki sekme aynı işlemi açar.
/// Delil kaydı `CheckoutConsent`te kalır (değişmez); burada yalnız işlem durumu. Takma adlı kimlik taşır (işletme, onay, Paddle işlem kimliği).
model CheckoutIntent {
  id             String    @id @default(cuid())
  organizationId String
  /// İşlemi açan onay (Paddle `custom_data.consentId` BU olur → webhook bugünkü gibi onaydan bağlar)
  consentId      String
  planCode       String
  priceId        String
  /// Paddle işlem kimliği (txn_…); NULL = Paddle çağrısı sürüyor ya da cevabı kayboldu
  providerRef    String?   @unique
  /// opening · open · completed · canceled · expired · failed (kapalı küme, `lib/billing/checkout-intent.ts`)
  status         String
  /// "Açık niyet" tekil anahtarı: opening / open iken = organizationId, kapanınca NULL. Kısmi dizin YERİNE (NULL'lar çakışmaz).
  openKey        String?   @unique
  /// Ödeme ekranının geçerliliği. ≤ webhook onay tazeliği 24 sa (`src/app/api/webhooks/paddle/route.ts:49, 63-71`) — aşarsa ödeme "bağlanamayan" düşer
  expiresAt      DateTime
  closedAt       DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  consent      CheckoutConsent @relation(fields: [consentId], references: [id], onDelete: Cascade)

  @@index([organizationId, createdAt])
  @@index([status, expiresAt])
}
```
`Organization` ve `CheckoutConsent` modellerine geri ilişki. Ad seçimi: `providerRef` (Invoice / Subscription ile aynı, `schema.prisma:985, 1028`);
`providerTransactionId` gibi bir ad E4 kalıbına (`provider\w*Id`) takılır ve büyüyemez listeye satır ister — kaçınılır.

Durum makinesi (tek boğaz `lib/billing/checkout-intent.ts`):
1. Onay rotası (bugünkü kapılar AYNEN: katalog, canlı abonelik, `checkoutPendingActive`) → işlemde: onay satırı + niyet `opening` (`openKey =
   organizationId`). Tekil ihlal (P2002) = başka sekmenin niyeti var → onu oku:
   - `open`, aynı `priceId`, süresi dolmamış → AYNI `providerRef` döner (onay kaydı yine yazılır — her kabul bir delil; ama ödeme ekranı ilk niyetin işlemi).
   - `open`, FARKLI fiyat → eski işlem Paddle'da iptal edilir (PADDLE-VARSAYIM: `ready`/`draft` işlem iptal edilebilir), CAS ile `canceled` + `openKey
     NULL`, yeni niyet açılır. İptal Paddle'da reddedilirse (ödeme başlamış) → yeni ekran AÇILMAZ (↓ soru 1).
   - `opening` ve süresi dolmamış kısa kiralama (ör. 30 sn) → 409 "Ödeme ekranı hazırlanıyor, birkaç saniye sonra tekrar deneyin".
2. İşlem DIŞINDA Paddle `POST /transactions` (items + `custom_data { organizationId, consentId }` SUNUCUDAN — istemci değiştiremez; PADDLE-VARSAYIM:
   oluşturulan işlem `ready` döner ve ödeme ekranı `transactionId` ile açılır). Mevcut istemci `paddleRequest` (`src/lib/payments/paddle.ts:251-260`).
   Başarı → `open` + `providerRef`. Kesin ret (`classifyPaddleFailure` `:397`) → `failed` + `openKey NULL`. Belirsiz (zaman aşımı) → `failed` + `openKey
   NULL`: kimliği bizde olmayan işlemi kimse açamaz (ödeme ekranı yalnız kimlikle açılır) → yetim `ready` işlem ödenemez (PADDLE-VARSAYIM: Paddle
   `ready` işlem için müşteriye kendiliğinden e-posta / ödeme bağlantısı göndermez — sandbox'ta doğrulanmalı).
3. İstemci `Paddle.Checkout.open({ transactionId })` (PADDLE-VARSAYIM: Paddle.js v2 seçeneği; `items`/`customData` artık istemciden gitmez).
4. Webhook `transaction.completed` / `transaction.paid` (`route.ts:759-760`, `applyTransactionEvent` `:488-580`): `providerRef` eşleşen niyet
   `completed` + `openKey NULL` (aynı yerde fatura yazılıyor). `transaction.payment_failed` (`:761-766`) niyeti KAPATMAZ (aynı işlem yeniden
   denenebilir; PADDLE-VARSAYIM).
5. "Tamamlandı ama webhook yok" (Codex C1 pencere b/c): `open` niyet varken yeni onay isteği → önce `GET /transactions/{providerRef}` (PADDLE-VARSAYIM:
   durum alanı `completed`/`paid`) → ödenmişse `completed` + "Ödemeniz işleniyor" (yeni ekran yok). C11'deki "körlemesine yeniden ödetme yok" ilkesi.
6. Süpürge: `expiresAt` geçmiş `open` → Paddle'da iptal dene → `expired` + `openKey NULL`; kapanmış niyetler 90 gün sonra silinir (OperationalEvent ile aynı süre).
İstemci kilidi (`checkout-pending`) İLK yayında kalır (ek koruma); niyet kalıcılaşınca kaldırılması ayrı karar.

### 3.4 Açılış güvenliği / geriye doldurma
Yeni tablo + yeni tablonun iki tekil dizini → dolu tabloya dokunulmaz. Geriye doldurma YOK (geçmiş onaylar için niyet uydurulmaz; eski onayla açılmış
ödeme ekranı webhook'ta bugünkü yoldan bağlanır — niyet bulunmazsa yalnız fatura yazılır, davranış bugünkü). Geri alma: eski istemci sürümü
`items` ile açar, tablo boşta kalır.

### 3.5 Değişmez listeleri
| Liste | Yapılacak |
|---|---|
| E1 | ⚠️ KARAR: önerim EXCLUDED — "Ödeme ekranı durumu — iç işletim; delil `CheckoutConsent` ve sonuç `Invoice` dökümde; takma adlı Paddle işlem kimliği, kapanıştan 90 gün sonra silinir". Alternatif: EXPORTED (`prisma.checkoutIntent.findMany`). Avukat paketine madde |
| E2 / E3 | DEĞİŞMEZ |
| E4 | DEĞİŞMEZ — `providerRef` kalıba uymaz (`channel-invariants-ratchet.test.ts:45`); `@unique` olsa da liste büyümez |
| E5 hesap silme | org Cascade + onay Cascade. ⚠️ Açık niyetli işletme silinirse Paddle'daki `ready` işlem yetim kalır; silme ön koşuluna (`data-retention.ts:936-940`, `src/app/api/account/delete/route.ts:81-93`) "açık niyet varsa önce Paddle'da iptal" adımı ÖNERİSİ (açık sekme ödeme yaparsa bugün `alertUnlinkedPayment` alarmı çalışır — `route.ts:149, 500-502`) |
| E6 | DEĞİŞMEZ (misafir verisi yok) |
| E8 | süpürge bacağı (`scheduled-sync.ts:832-906`) — süresi dolanı kapat + 90 gün sil |
| E9 | yeni rota gerekmez (onay rotası niyeti döndürür); ayrı uç açılırsa `withOwner` + rota envanteri |

### 3.6 Okuyan / yazan kod yolları
- `src/app/api/billing/consent/route.ts:88-113` → onay + niyet; yanıt `{ consentId, transactionId }`.
- YENİ `src/lib/billing/checkout-intent.ts` (aç / yeniden kullan / iptal / Paddle okuma / süpürge).
- `src/lib/payments/paddle.ts:251-260` `paddleRequest` (oluştur / oku / iptal yardımcıları eklenir).
- `src/components/settings/paddle-plans.tsx:256-290` (`transactionId` ile açılış; `customData` sunucuda).
- `src/app/api/webhooks/paddle/route.ts:488-580` (niyeti kapat), `:761-766` (başarısız ödemede kilit kalkar, niyet açık kalır).
- Mevcut testler bilinçli sınırı pinliyor ve DEĞİŞECEK: `tests/integration/billing-consent-concurrent.test.ts` (iki 201 + iki ayrı onay beklenir —
  onay iki kalır ama `transactionId` AYNI olmalı), `checkout-pending-second-subscription.test.ts:92-199`.

### 3.7 Testler (kırmızı-önce; Paddle sahte istemcisiyle, gerçek PG)
1. İki sekme aynı plan (`Promise.all` iki onay) → BUGÜN yanıtta işlem yok, her sekme kendi işlemini açar · BEKLENEN aynı `transactionId`, Paddle
   oluşturma 1 kez.
2. Farklı plan → eski işlem iptal çağrısı 1 kez, yeni işlem; iptal reddedilirse yeni işlem YOK.
3. Paddle oluşturma zaman aşımı → niyet `failed`, `openKey` boş → sonraki deneme yeni işlem (takılı kalmaz).
4. Webhook `transaction.completed` → niyet `completed`; ardından onay → "zaten aktif / işleniyor" (ödeme ekranı yok).
5. Açık niyet + webhook gelmedi + Paddle okuması "completed" → yeni ekran YOK.
6. Kiracı: B işletmesinin onayı A'nın işlem kimliğini asla almaz (anahtar `organizationId`).
7. Süpürge: süresi dolan açık niyet `expired`, `openKey` boşalır.
8. Mutasyon: `openKey` yazımını kaldır → 1 kırmızı; webhook'ta niyet kapatmayı kaldır → 4 kırmızı.

### 3.8 Kurucuya soru (para akışı → ilk denemeler birlikte; Paddle sandbox ŞART)
1. **Başka plan seçilince:** ÖRNEK — sekme 1'de Pro ödeme ekranı açık, sekme 2'de İşletme seçiliyor. Önerim: sekme 1'in işlemi iptal edilir, sekme 2
   açılır; sekme 1'de ödemeye basılırsa Paddle "işlem iptal edildi" der (PADDLE-VARSAYIM). Sekme 1'de ödeme zaten başlamışsa sekme 2'ye:
   "Açık bir ödemeniz var. Tamamlanmasını bekleyin ya da birkaç dakika sonra tekrar deneyin." Uygun mu?
2. **Ödeme ekranı geçerlilik süresi:** önerim 3 sa (bugünkü onay tazeliği `checkout-pending/route.ts:17`); webhook sınırı 24 sa. Uygun mu?
3. Paddle sandbox denemesi (oluştur → iki sekmede aç → bir kez öde → ikinci sekmede ödeme denemesi) bu ortamdan yapılamaz; sizinle birlikte.

---

## 4. M-iade — iade / ters ibraz düzeltme kayıtları (Ödeme S3)

### 4.1 Amaç
Kurucu 10-16: "Ödeme S3 iade / ters ibraz (onaylı iade tutarı, kısmen / tamamen, ters ibraz ayrı durum + alarm + geri alınması; fatura değişmez,
düzeltme kaydı) → Faz 2" (`KURUCU-SORULARI.md:519`). Bugün `adjustment.*` olayları kaydedilip HİÇBİR şey yapılmaz (dağıtıcı yalnız `subscription.*`,
`transaction.completed/paid`, `transaction.payment_failed` tanır — `src/app/api/webhooks/paddle/route.ts:756-766`); iade edilmiş ödeme dökümde
"paid" (`src/lib/data-export.ts:236-242`), ters ibrazda alarm YOK (`odeme.md:151-152`). Araştırmanın ilk önerisi `Invoice.status = "refunded"`
(migration'sız, `odeme.md:199-201`) idi; kurucu "fatura değişmez, düzeltme kaydı" dedi → yeni tablo.

### 4.2 Prisma taslağı (YENİ tablo)
```prisma
/// FATURA DÜZELTME KAYDI (M-iade, kurucu 10-16 S3). Paddle düzeltmesi (adjustment) başına TEK satır; asıl `Invoice` DEĞİŞMEZ (durumu "paid" kalır).
/// İade / kısmi iade / ters ibraz / ters ibrazın geri alınması burada. Bağ: `transactionRef` = `Invoice.providerRef` (FK YOK — olay sırası garanti
/// değil, düzeltme faturadan önce gelebilir; `odeme.md:158`). Takma adlı kimlik + tutar; misafir verisi yok. İşletme yaşadıkça saklanır (Invoice gibi).
model InvoiceAdjustment {
  id             String    @id @default(cuid())
  organizationId String
  provider       String    @default("paddle")
  /// Paddle düzeltme kimliği (adj_…) — tekilleştirme anahtarı
  providerRef    String
  /// Paddle işlem kimliği (txn_…) — Invoice(provider, providerRef) ile eşleşir
  transactionRef String
  /// kapalı küme: refund · credit · chargeback · chargeback_warning · chargeback_reverse (PADDLE-VARSAYIM: Paddle `action` değerleri)
  action         String
  /// kapalı küme: pending_approval · approved · rejected (iade) · open · reversed (ters ibraz) (PADDLE-VARSAYIM: Paddle `status` + bizim türetmemiz)
  status         String
  /// full · partial (Paddle `type` yoksa Invoice tutarıyla kıyasla türetilir; NULL = bilinmiyor)
  scope          String?
  /// Onaylanan / bildirilen tutar (kuruş). U39 kuralı: yalnız `^\d{1,10}$`; okunamazsa satır YAZILMAZ, inceleme (`route.ts:518-529` emsali)
  amountMinor    Int?
  currency       String?
  /// Sıra koruması: uygulanan en yeni olayın occurred_at'i (Subscription.lastEventAt emsali, `schema.prisma:998-1001`)
  lastEventAt    DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([provider, providerRef])
  @@index([organizationId, transactionRef])
}
```
Ad seçimi E4 için bilinçli: `providerRef` / `transactionRef` kalıba (`provider\w*Id`) uymaz; `providerAdjustmentId` adı büyüyemez listeye satır
isterdi (`channel-invariants-ratchet.test.ts:45, 50-56`).

İşletme bağlama (YALNIZ yetkili kaynaktan; `custom_data` istemci verisidir, kullanılmaz — `route.ts:606-609` ilkesi):
`transactionRef` → `Invoice(provider:"paddle", providerRef)` → `organizationId`; yoksa `subscription_id` → `Subscription(provider, providerRef)`;
ikisi de yoksa satır YAZILMAZ, olay `needs_review: unlinked` (mevcut yol `route.ts:767-784`, `src/lib/billing/payment-review.ts:15-23`).

### 4.3 Açılış güvenliği / geriye doldurma
Yeni tablo → güvenli. Geriye doldurma: OPSİYONEL ve yalnız mevcut `WebhookEvent` satırlarından (`eventType LIKE 'adjustment.%'`, `payloadJson`'dan
okuyarak) — ama 12 ay sonra küçültülmüş yükler (`minimizeOldPaddleWebhooks`, `src/lib/scheduled-sync.ts:874`) tutar taşımayabilir → ÖNERİM
migration içinde DEĞİL, ayrı salt-okuma sayım + onaylı betik (Railway açılınca; prod'da kaç `adjustment.*` olayı olduğu DOĞRULANMADI).
Eski "processed" olaylar Paddle'dan yeniden gönderilirse `duplicate` döner (`route.ts:737-741`) → kurtarma için önce `status = "error"` (çalışma kitabı
notu, `odeme.md:159` (b)).

### 4.4 Değişmez listeleri
| Liste | Yapılacak |
|---|---|
| E1 | **EXPORTED**: `InvoiceAdjustment: "prisma.invoiceAdjustment.findMany"` (`data-export-coverage.test.ts:14-37`) + `src/lib/data-export.ts:236-249` yanına seçili alanlar (id, transactionRef, action, status, scope, amountMinor, currency, createdAt). Gerekçe: dökümde Invoice "paid" görünürken iadesini gizlemek yanıltıcı (bugünkü kusur) |
| E2 / E3 / E6 | DEĞİŞMEZ (konuşma / misafir verisi yok) |
| E4 | DEĞİŞMEZ (adlar kalıba uymaz) |
| E5 | org Cascade (Invoice ile aynı; CLAUDE.md "Hesap silme Invoice/Consent/AuditLog'u da siler" açık işi bu tabloyu da kapsar) |
| Hesap silme redaksiyonu | `redactPaddleWebhooksForOrg` (`src/lib/data-retention.ts:782-885`) düzeltme olaylarını Pass 2 (müşteri kimliği) ile bulur — PADDLE-VARSAYIM: düzeltme yükünde `customer_id` var. Yoksa `providerRefs` kümesine (`:795-807`) bu tablonun `transactionRef`'leri de eklenmeli ve Pass 1 bağlantısı `data.transaction_id`'yi de tanımalı |
| E8 | süpürge YOK (Invoice ile aynı saklama) |
| Ödeme incelemesi | `PaymentReviewCode` (`payment-review.ts:12-21`) kapalı kümesine `chargeback` + eylem metni; `codeOf` (`:30-33`) güncellenir |

### 4.5 Okuyan / yazan kod yolları
- `src/app/api/webhooks/paddle/route.ts:756-766` dağıtıcıya `adjustment.created` / `adjustment.updated` dalı → YENİ `applyAdjustmentEvent(data, occurredAt)`
  (`applyTransactionEvent` `:488-580` deseni: bağlama → katı tutar → `upsert` by (provider, providerRef) + `lastEventAt` koşullu güncelleme (atomik
  WHERE, `route.ts:303-310` emsali) → P2002 = ilk yazan kazanır).
- Ters ibraz: `alertOnTransition("paddle-webhook:chargeback:<txn>", …)` (`src/lib/alert-state.ts:54-109`) — işlem başına bir alarm, 24 sa hatırlatma;
  `chargeback_reverse` → satır `reversed` + `clearAlertState` (`:111-114`) + operatöre tek "geri alındı" bilgisi (yeni e-posta → ↓ soru 2).
- Erişim (`src/lib/billing/subscription.ts` `getEntitlement`) DEĞİŞMEZ (↓ soru 1).
- Döküm `src/lib/data-export.ts:236-249`; operatör paneli "Ödeme incelemesi" (`src/app/(app)/admin/page.tsx`).
- Paddle bildirim ayarında `adjustment.created` / `adjustment.updated` türleri AÇIK olmalı (Railway açılış listesi maddesi; `transaction.payment_failed`
  notunun emsali `route.ts:762-763`).

### 4.6 Testler (kırmızı-önce, gerçek PG, imzalı sahte olay)
1. `adjustment.created` (refund, pending_approval) → BUGÜN satır yok · BEKLENEN satır `pending_approval`, Invoice "paid" kalır, alarm yok.
2. `adjustment.updated` approved, 30000 / fatura 89900 → `approved`, `scope = partial`, tutar 30000; **Invoice satırı bayt bayt aynı** (kurucu "fatura değişmez" pini).
3. Sıra: `updated` önce, `created` sonra → son durum `approved` (eski olay ezmez).
4. Eşzamanlı aynı olay iki teslim → tek satır.
5. `chargeback` → tek alarm + inceleme listesinde `chargeback`; ikinci teslim alarm üretmez; `chargeback_reverse` → `reversed`, alarm durumu silinir.
6. Bağlanamayan işlem (fatura / abonelik yok) → `needs_review: unlinked`, satır yok. `custom_data.organizationId` başka işletmeyi gösterse bile satır
   faturanın işletmesine yazılır (kiracı testi).
7. Tutar "100abc" / eksik → satır yok + inceleme (U39 kuralı).
8. Döküm: düzeltme satırı dökümde.
9. Mutasyon: `lastEventAt` koşulunu kaldır → 3 kırmızı; bağlamayı `custom_data`'ya çevir → 6 kırmızı.

### 4.7 Kurucuya soru
1. **Ters ibrazda erişim:** tablo özetinde (`KURUCU-SORULARI.md:519`) erişim kararı YOK (araştırma sorusu `odeme.md:205`). ÖRNEK — Lale yıllık planı ödedi,
   3 gün sonra bankasından itiraz etti → (a) önerim: erişim AYNEN, operatöre alarm, karar sizde · (b) ters ibraz açıkken oto-mesaj kapalı (ödemesiz say).
2. **"Geri alındı" bildirimi:** ters ibraz banka tarafından geri çevrilince (`chargeback_reverse`) operatöre ikinci e-posta mı, yalnız panelde durum mu?
   Önerim: tek kısa e-posta ("Paddle işlem txn_… ters ibraz geri alındı — ödeme sizde kaldı").
3. **Geçmiş olaylar:** canlıda hiç `adjustment.*` olayı var mı bilinmiyor — Railway açılınca salt-okuma sayım; >0 ise ayrı onayla geriye doldurma.

---

## 5. M-bildirim — ev sahibi / personel bildirim kalıcı kuyruğu (O2 + Codex C2)

### 5.1 Amaç
Kurucu 10-16: "O2 görev ataması bildirimi kalıcı kuyruktan (atama + bildirim birlikte; yeniden atanınca eski bildirim gitmez) → Faz 2"
(`KURUCU-SORULARI.md:520`). Bugün atama e-postası işlem DIŞINDA `void emailService.sendReporting(...)` (`src/app/api/tasks/[id]/route.ts:200-224`):
sağlayıcı arızasında kaybolur, yalnız hata uyarısı (`docs/TASARIM-2026-10-16-transactional-outbox.md:30-31`). Codex C2 (`codex-1016-verify.md:57-77`):
M-defter "zaten var" dediğinde elle rezervasyonun "Yeni Rezervasyon" e-postası (`src/lib/automation.ts:1365-1413`, kuyruksuz) kalıcı kaybolur →
aynı kuyruk ikinci tür olarak ŞART (M-defter bağımlılığı).

### 5.2 Prisma taslağı (YENİ tablo)
```prisma
/// BİLDİRİM KUYRUĞU (M-bildirim; kurucu 10-16 O2 + Codex C2). Bildirim NİYETİ iş verisiyle AYNI işlemde yazılır. E-posta METNİ ve ALICI ADRESİ
/// SAKLANMAZ: gönderim anında güncel kayıttan kurulur (personel görünümü, misafir silmesi / maskeleme kendiliğinden geçerli). Takma adlı kimlik taşır
/// (alıcı kullanıcı, görev / rezervasyon kimliği); gönderildikten 14 gün sonra silinir (EmailOutbox ile aynı).
model NotificationOutbox {
  id              String    @id @default(cuid())
  organizationId  String
  /// kapalı küme (`lib/notification-outbox.ts`): task_assigned · reservation_created
  kind            String
  recipientUserId String
  /// konu kaydı — opak, FK YOK (görev / rezervasyon silinince gönderim anında "subject_gone" ile iptal)
  subjectId       String
  /// task_assigned:<taskId>:<atama anı ms> · reservation_created:<reservationId>
  dedupeKey       String
  /// pending · sending · sent · failed · canceled (kapalı küme)
  status          String    @default("pending")
  attemptCount    Int       @default(0)
  nextAttemptAt   DateTime  @default(now())
  claimedBy       String?
  claimExpiresAt  DateTime?
  sentAt          DateTime?
  /// kısa kapalı kod: "HTTP 500" · "timeout" · "superseded" · "subject_gone" · "recipient_gone" — ham sağlayıcı metni / adres YOK
  lastError       String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  recipient    User         @relation(fields: [recipientUserId], references: [id], onDelete: Cascade)

  @@unique([organizationId, recipientUserId, dedupeKey])
  @@index([status, nextAttemptAt])
  @@index([subjectId, kind])
}
```
`Organization` ve `User` modellerine geri ilişki. Alıcı FK'si Cascade: kullanıcı ekipten çıkarılınca bekleyen bildirimi de gider (EmailOutbox emsali,
`prisma/schema.prisma:1554`).

Kurallar (tek boğaz `lib/notification-outbox.ts`, `EmailOutbox` + `MessageOutbox` desenleri):
- **Atama + bildirim tek işlem:** `tasks/[id]` PATCH işlemi (`route.ts:137-189`) içinde, atanan değiştiyse (`:123` koşulu aynen) ① aynı görevin
  `pending` atama bildirimleri `canceled` + `lastError "superseded"` ② yeni satır. Saatte 3 tavanı (`:32-33, 200`) satır yazmadan önce aynen.
- **Gönderim anı güncellik kapısı** (EmailOutbox "güncellik kapısı" emsali, `TASARIM-2026-10-16-transactional-outbox.md:18`): işçi görevi yeniden
  okur; `assignedToId !== recipientUserId` → `canceled "superseded"`, görev yok → `subject_gone`. Metin o anda `taskAssignedEmail` ile; alıcı
  personelse `staffTaskProjection` (`route.ts:202`) — gönderim anındaki rolüne göre.
- **Rezervasyon:** elle rezervasyon işleminde (M-defter) sahip/yönetici başına bir satır; işçi rezervasyon yoksa ya da iptalse → `canceled` (↓ soru 2).
- **Boşaltma:** `FOR UPDATE SKIP LOCKED` (`src/lib/email-outbox.ts:496` emsali) + işlem sonrası hızlı uyandırma (`kickEmailOutboxDrain` `:192` emsali) +
  15 sn yoklayıcı (`src/instrumentation.ts:152-169`) + 2 dk senkron yedeği. Sağlayıcıya `Idempotency-Key: notification-outbox/<satır>` (`src/lib/email-core.ts:87-113`;
  409 "aynı anahtar başka içerik" = belirsiz, körlemesine tekrar yok — Opus F9). Kalıcı başarısızlıkta bugünkü toplu `reportError` (`automation.ts:1408-1413`).

### 5.3 Açılış güvenliği / geriye doldurma
Yeni tablo → güvenli. Geriye doldurma YOK (geçmiş atamaların bildirimi yeniden gönderilmez). Geri alma: eski sürüm doğrudan gönderir; kuyrukta
`pending` kalan satırlar eski sürümde GİTMEZ (eski sürüm tabloyu bilmez) → geri dönüşten önce kuyruk boşalmalı (çalışma kitabı maddesi; O1 §7 emsali,
`TASARIM-2026-10-16-transactional-outbox.md:103-111`).

### 5.4 Değişmez listeleri
| Liste | Yapılacak |
|---|---|
| E1 | EXCLUDED: "Bildirim gönderim kuyruğu — iç işletim; metin / adres yok, takma adlı kimlik (alıcı, görev / rezervasyon), 14 gün" (EmailOutbox satırı `data-export-coverage.test.ts:59` emsali) |
| E2 | DEĞİŞMEZ (`conversationId` yok). ⚠️ İleride `complaint_created` türü eklenirse (M-defter soru 2) konu = konuşma olur; tarayıcı (`apply-conversation-dedupe.ts:138`) yalnız `conversationId` ADINI görür → birleştirmede kaybedenin bildirimi gönderim anında `subject_gone` ile iptal olur. Bu bilinçli kör nokta o tür eklenirken testle pinlenmeli (ya da kolon `conversationId` adıyla eklenip E2'nin iki listesine girer) |
| E3 / E4 / E6 | DEĞİŞMEZ (misafir modeline kolon yok; dış kimlik yok; metin saklanmadığı için misafir silmesi gönderim anında maskeli veriyi görür) |
| E5 | org Cascade + kullanıcı Cascade |
| E7 | gerek yok (kademe) |
| E8 | `purgeNotificationOutbox` (`scheduled-sync.ts:900` `purgeEmailOutbox` emsali): `sent/canceled/failed` + 14 gün |
| Kuyruk sağlığı | `src/lib/outbox/health.ts:37-60` (`queueHealth`) ve `:116-160` (`queueStallStates`) ÜÇÜNCÜ kuyruk; `/api/health?strict=1` `queue_stalled` (`src/app/api/health/route.ts:130`) ve O3 alarmı bu kuyruğu da görmeli — yoksa takılı bildirim sessiz kalır |
| E9 | yeni rota yok |

### 5.5 Okuyan / yazan kod yolları
- `src/app/api/tasks/[id]/route.ts:114-126, 137-189, 196-224` (bildirim işlem içine; `void` gönderim kalkar).
- `src/lib/automation.ts:1354-1414` (`applyReservationCreatedRules` e-posta döngüsü → satır yazımı; M-defter ile aynı işlem).
- YENİ `src/lib/notification-outbox.ts` (yaz / iptal / boşalt / süpür); `src/instrumentation.ts:152-169` yoklayıcıya ekleme; `src/lib/scheduled-sync.ts:766-780`
  (boşaltma) ve `:900` (süpürge).
- `src/lib/outbox/health.ts`, operatör paneli kuyruk sağlığı.
- Kapsam DIŞI (bilinçli): Lead (demo talebi) bildirimi — işletmesiz (`schema.prisma:49-64`), org FK'li tabloya girmez; QR / acil e-postaları zaten
  "işaret + geri al" deseninde (`TASARIM-2026-10-16-transactional-outbox.md:26-28`). O5 / O6 (Gönderim Kuyruğu ekranı zamanları, önizlemeli toplu
  yeniden dene) Faz 2 ama MIGRATION'SIZ (`KURUCU-SORULARI.md:486-490, 523`) → bu pakete girmez.

### 5.6 Testler (kırmızı-önce)
1. Sağlayıcı ilk denemede 500 → BUGÜN e-posta kaybolur (tek atış, yalnız uyarı) · BEKLENEN satır `pending` kalır, sonraki boşaltmada bir kez gider.
2. Sağlayıcı kapalıyken A'ya ata → B'ye ata → sağlayıcı açılır → yalnız B'ye e-posta (A `superseded`). BUGÜN A anında (arızada hiç) gönderiliyor.
3. Atama işlemi bildirim yazımından sonra hata (enjeksiyon) → atama da bildirim de YOK (tek işlem).
4. Gönderim anında görev silinmiş → `subject_gone`; alıcı personel → metinde misafir adı YOK (`staffTaskProjection` pini korunur).
5. Saatte 3 tavanı: 4. atama satır yazmaz (bugünkü davranış).
6. İki boşaltma eşzamanlı → tek gönderim; iki denemede de aynı `Idempotency-Key`.
7. Elle rezervasyon + çökme (M-defter test 3 ile ortak) → e-posta boşaltmayla gider.
8. Kuyruk sağlığı: vadesi geçmiş bildirim satırı 15 dk → `queue_stalled`.
9. Mutasyon: güncellik kapısını kaldır → 2 kırmızı; iptal adımını kaldır → 2 kırmızı (kapı yakalar mı ayrıca ölçülür — eşdeğer mutant olabilir, gerekçe yazılır).

### 5.7 Kurucuya soru
1. **Kapsam:** O2 (görev ataması) + C2 için elle rezervasyon "Yeni Rezervasyon" e-postası — ikisi birlikte mi? Önerim evet (M-defter'in çökme güvenliği buna bağlı).
2. **Gönderilmeden iptal edilen rezervasyon:** ÖRNEK — ev sahibi rezervasyonu girer, 10 sn içinde siler / iptal eder → bugün "Yeni Rezervasyon" e-postası yine gider.
   Önerim: kuyruk gönderim anında bakar, silinmiş / iptal → e-posta gitmez. Uygun mu?
3. Atama e-postası bugün anında; kuyrukla da hızlı uyandırmayla saniyeler içinde, en geç 15 sn (yoklayıcı). Fark edilir bir değişiklik yok — bilgi.

---

## 6. M-oncelik — `Task.prioritySource` + "öncelik belirsiz" işareti

### 6.1 Amaç
Kurucu 10-16 "arıza önceliğini yapay zekâ belirlesin; ev sahibi değiştirebilir; belirsizse incelemeye; sert tehlike korumaları kalır; öncelik ≠
misafire söz" (`docs/TASARIM-2026-10-16-faz3-konu-bazli-cevap.md:55-80`, Codex C12 `codex-1016-verify.md:340-379`). Öncelik DEĞERİ için migration yok
(`Task.priority` zaten urgent · standard · low, `prisma/schema.prisma:733`); eksik olan KAYNAK ("ev sahibi elle seçtiyse yapay zekâ bir daha
yazmaz") ve "belirsiz → ev sahibi doğrulasın" işareti (`faz3…md:75-76`). Davranış Faz 3 anahtarı `AI_FAULT_PRIORITY_ENABLED` arkasında (KAPALI doğar);
bu paket yalnız şema + ev sahibi düzenlemesinin kaynağı yazması.

### 6.2 Prisma taslağı (dolu tabloya iki kolon)
```prisma
model Task {
  // … mevcut alanlar …
  /// Önceliği kim belirledi (M-oncelik): host (ev sahibi / yönetici elle — oluşturma ya da PATCH) · rule (sözcük kuralı / güvenlik ağı) · ai
  /// (anlama katmanının ciddiyet okuması). NULL = sabit varsayılan (yaşam döngüsü) ya da bu kolondan ÖNCEKİ satır — "bilinmiyor", host SAYILMAZ.
  /// `host` iken otomatik yol önceliğe DOKUNMAZ (yükseltme dahil).
  prioritySource      String?
  /// Öncelik belirsiz → ev sahibi doğrulamalı (model "unclear" dedi ya da katman düştü ve sözcük kuralı kullanıldı). Ev sahibi önceliği
  /// değiştirince ya da "doğru" deyince false.
  priorityNeedsReview Boolean @default(false)
}
```
```sql
ALTER TABLE "Task" ADD COLUMN "prioritySource" TEXT,
ADD COLUMN "priorityNeedsReview" BOOLEAN NOT NULL DEFAULT false;
```
Alternatif (daha az kolon): `priorityNeedsReview` yerine `prioritySource = "ai_unclear"` değeri — ama ev sahibi "doğru" deyince kaynak bilgisi
kaybolur; iki kolon önerilir. Dizin GEREKMEZ (filtre olursa `(propertyId, priorityNeedsReview)` ileride; Task tablosu büyük olabilir → o zaman
CONCURRENTLY değerlendirmesi; bu pakette dizin YOK).

### 6.3 Açılış güvenliği / geriye doldurma
Biri NULL'lanabilir, biri varsayılanlı → ikisi de dolu tabloda güvenli (66 emsali). Geriye doldurma YOK — bilinçli: eski satırların kaynağı
bilinmiyor; `origin = "manual"` satırlarına "host" yazmak cazip ama YANLIŞ olabilir (manual varsayılanı korumacı damgadır, `schema.prisma:742-747`
"unstamped row is PROTECTED") → NULL kalır; otomatik yükseltme NULL'u "host değil" sayar AMA yalnız `origin ∈ {ai}` satırlarda çalışır (↓ 6.5), yani eski
elle görevlere yine dokunulmaz. KB `legacy` dürüstlük ilkesinin aynısı (`schema.prisma:805-815`).

### 6.4 Değişmez listeleri
| Liste | Yapılacak |
|---|---|
| E3 şema kanaryası | **ZORUNLU**: `Task: 15` → `17` (`tests/unit/scrub-scope-parity.test.ts:221`) + karar yorumu: "`Task.prioritySource` (String?, M-oncelik) → KAPSAM DIŞI: kapalı küme kaynak etiketi · `Task.priorityNeedsReview` (Boolean) → KAPSAM DIŞI: işaret; ikisi misafirin metnini de kimliğini de taşımaz". Parite / beklenen kapsam listesi (`:136-170`) DEĞİŞMEZ |
| E1 dışa aktarma | model zaten EXPORTED; döküm alan listesi seçili (`src/lib/data-export.ts:202-206`) → ⚠️ küçük karar: `prioritySource` eklensin mi (ev sahibinin kendi seçimi dökümde görünür). Önerim ekle (test etkisi yok) |
| E2 / E4 / E5 / E6 | DEĞİŞMEZ |
| Personel görünümü | `staffTaskProjection` (`src/lib/tasks/staff-view.ts:60`) alanları aynen geçirir; işaret personele anlamsız → istemcide gösterilmez (yalnız yönetici panosu) |

### 6.5 Okuyan / yazan kod yolları
- Yazanlar: `POST /api/tasks` (`src/app/api/tasks/route.ts:63`) → "host" (form önceliği HER ZAMAN gönderir — durum varsayılanı "standard",
  `src/components/tasks/task-form.tsx:29, 112-113`; seçilmiş / varsayılan ayrımı yapılamaz, ev sahibi formu onayladığı için "host") · `PATCH /api/tasks/[id]` `priority` (`route.ts:93, 162`) →
  "host" + `priorityNeedsReview false` · mesajdan görev `createOperationalTaskFromMessage` (`src/lib/tasks/create.ts:76-90`) → "rule" (Faz 3 anahtarı
  açıkken "ai" + belirsizse işaret) · şikâyet görevi (`src/lib/automation.ts:1507-1525`, `priority: "urgent"`) → "rule" · söz görevi
  (`src/lib/guest-commitments.ts`) ve yaşam döngüsü (`automation.ts:1148-1207`) → NULL (sabit varsayılan).
- Yükseltme (Codex C12 ek, `codex-1016-verify.md:377-379`): bugün aynı gün aynı cihazın tekrar bildirimi `duplicate` döner, önceliğe dokunmaz
  (`create.ts:58-73`). Faz 3'te: kilit altında (`:57` danışma kilidi zaten var) `updateMany({ where: { id, origin: "ai", OR: [{ prioritySource: null },
  { prioritySource: { not: "host" } }], priority: { in: <daha düşükler> } } })` — ASLA düşürmez, `host`'a dokunmaz. ⚠️ Prisma `not` NULL'u dışlar
  (`checkout-pending.ts:33` notu) → NULL ayrıca `OR` ile.
- Okuyanlar: `src/components/tasks/task-board.tsx`, `task-form.tsx` (rozet + "öncelik doğrulanmalı" etiketi — müşteriye görünen YENİ metin → soru),
  `src/lib/tasks/detect.ts:33, 331` tip (`"urgent" | "standard"` → `low` eklenirse genişler).
- Misafir yolu: öncelik / kaynak / işaret istem ve cevap yoluna GİRMEZ (pin: Faz 3 `faz3…md:70`, C12 "öncelik misafire gitmez").

### 6.6 Testler (kırmızı-önce)
1. Ev sahibi PATCH ile `standard → urgent` → `prioritySource = host`, işaret false. Sonra aynı cihaz için yeni misafir bildirimi (daha düşük / daha
   yüksek) → öncelik DEĞİŞMEZ. (Bugün kaynak yok → "yapay zekâ bir daha yazmaz" kuralı sınanamaz; kırmızı-önce: kaynak alanı yokken test derlenmez —
   davranışsal kırmızı için yükseltme dalı önce eklenir, `host` koruması olmadan ezdiği gösterilir.)
2. Yükseltme: "Klima çalışmıyor" (standard, ai) → aynı gün "çocuklar donuyor, ısıtma hiç yok" (yüksek) → açık görev yükselir; tersi düşürmez.
3. Eski satır (`prioritySource NULL`, `origin manual`) → otomatik yol dokunmaz.
4. Kanarya: `Task` sayacı 17 + yorum (kolon eklenip yorum yazılmazsa test kırmızı — kanaryanın amacı).
5. Misafir istemine sızma pini: `prioritySource` / `priorityNeedsReview` adı ve değeri cevap istemlerinde geçmez (kaynak taraması + davranışsal).
6. Mutasyon: `host` korumasını kaldır → 1 kırmızı; "asla düşürme" koşulunu kaldır → 2 kırmızı.

### 6.7 Kurucuya soru
1. **Etiket metni (ev sahibine görünen):** ÖRNEK — "Dairede hiç su yok" mesajında model emin değil → görev kartında "Öncelik: Normal · doğrulayın"
   rozeti. Metin "doğrulayın" mı, "kontrol edin" mi? Yoksa yalnız normal görev, rozet yok mu? (Faz 3 belgesindeki soru 2 ile aynı, `faz3…md:90-91`.)
2. Migration'ı Faz 3 anahtarından ÖNCE yayınlamak (kolonlar boş durur, yalnız ev sahibi düzenlemesi "host" yazar): önerim evet — anahtar açılınca
   geçmiş elle seçimler de korunmuş olur.
3. (I1, `KURUCU-SORULARI.md:537-544`) Söze kısa KONU alanı (A seçeneği, migration) cevabınız "A" olursa aynı yayına `GuestCommitment.topic String?`
   eklenebilir (dolu tabloda NULL'lanabilir kolon, güvenli; E2/E3 etkisi yok — model `GUEST_MODELS`'te değil, `conversationId` zaten listede). Ekleyelim mi?

---

## 7. M-outbox-dizin — `MessageOutbox(conversationId, status)` dizini (I3, O1 Seçenek A)

### 7.1 Amaç
Kurucu sorusu I3 (`KURUCU-SORULARI.md:547`): "dizinin garanti ettiği / etmediği §7'de; onay verirsen taslağı Faz 2 ile gösteririm". Davranış artık
dizinden BAĞIMSIZ: "teslim edilmemiş taslak" süzgeçleri kuyruk satırının varlığına bağlandı (Opus F3, `src/lib/outbox/presence.ts:1-30`,
`TASARIM-2026-10-16-transactional-outbox.md:112-115`). Dizin YALNIZ MALİYET içindir (`:115-120`): bugün tabloda `conversationId` dizini yok
(`prisma/migrations/29_message_outbox/migration.sql:35-41` — yalnız `(status, availableAt)`, `(organizationId, status)`, tekil `(organizationId,
idempotencyKey)`).

### 7.2 Prisma taslağı
```prisma
model MessageOutbox {
  // … mevcut …
  // Konuşma başına okuma (M-outbox-dizin, kurucu I3): teslim edilmemiş taslak süzgeçleri + işçinin konuşma başına FIFO alt sorgusu.
  @@index([conversationId, status])
}
```
```sql
CREATE INDEX "MessageOutbox_conversationId_status_idx" ON "MessageOutbox"("conversationId", "status");
```
Neden `(conversationId, status)` (tek kolon değil): dört okuyucunun dördü de `conversationId = ? AND status IN (…)`:
- `src/lib/operator-replies.ts:19-27` (selam / önceki cevap sayımı, HER cevap turunda),
- `src/lib/automation.ts:1831-1839` (bağlam süzgeci),
- `src/lib/outbox/worker.ts:312-321` (talep sorgusunun `NOT EXISTS` FIFO alt sorgusu — HER boşaltma turunda, aday satır başına),
- konuşma birleştirme / temizlik taşımaları (`scripts/apply-conversation-dedupe.ts:437-486`, `where: { conversationId: { in: loserIds } }`).

### 7.3 Açılış güvenliği
Yalnız dizin; kolon / kısıt yok. Tablo canlıda büyük olasılıkla BOŞ (`DURABLE_OUTBOX_ENABLED` hiç açılmadı — CLAUDE.md "BİLİNÇLİ KAPALI" satırı; canlı satır
sayısı DOĞRULANMADI, Railway kapalı) → düz `CREATE INDEX` anlık; CONCURRENTLY GEREKSİZ (ve `prisma migrate deploy` CONCURRENTLY'yi işlem içinde
koşamaz — DOĞRULANMADI, Prisma 6.2.1 davranışı ölçülmedi). **Bu yüzden O1 açılmadan ÖNCE** yayınlanmalı: tablo dolduktan sonra aynı dizin ya
kilit (yazmaları bekletir) ya da CONCURRENTLY + INVALID dizin riski ister (CLAUDE.md kuralı). Geriye doldurma YOK. Geri alma: `DROP INDEX`.

### 7.4 Değişmez listeleri
E1–E9 DEĞİŞMEZ: E3 kanaryası kolon sayar, dizin saymaz (`scrub-scope-parity.test.ts:43-61` ayrıştırıcısı `@@` satırlarını almaz); E4 yalnız tekil
kısıtlara bakar (`channel-invariants-ratchet.test.ts:16-41`).

### 7.5 Dizinin garanti ettiği / etmediği (I3 cevabı için)
- Garanti ETTİĞİ: yalnız sorgu maliyeti (konuşma başına okuma tam tablo taraması yerine dizin atlaması). Davranış farkı YOK.
- Garanti ETMEDİĞİ: teslim, yeniden deneme, sıralama, tekillik, geri dönüş güvenliği (bunlar boşaltma ve `presence.ts`'te; F3 ile dizinsiz kapandı).

### 7.6 Testler
Davranış değişmediği için kırmızı-önce davranış testi YOK (gerekçe: CLAUDE.md "test gerekmiyor gerekçeli"). Yapılacaklar: (1) taze PG'de sıfır
sapma (`prisma migrate diff`), (2) ÖLÇÜM (test değil): 100.000 satırlık yapay kuyrukta `EXPLAIN (ANALYZE)` önce / sonra — talep sorgusu ve
`operator-replies` için; rapora sayı. (3) İsteğe bağlı şema pini: `MessageOutbox` için `@@index([conversationId, status])` var (dizin sessizce
silinirse ölçüm kaybolmasın).

### 7.7 Kurucuya soru
I3'ün son onayı: "Dizin yalnız hız içindir; davranış zaten dizinsiz düzeldi. O1 açılmadan önce, kuyruk boşken ekleyelim mi?" Önerim evet.

---

## 8. Bu turda KAPSAM DIŞI (bir satır)
- **M-takip:** takip numarası 2. dilim sütunları kurucu kararı bekliyor (soru 6 + F5/F6/F7, `KURUCU-SORULARI.md:34, 40`); eski belgelerdeki "67/68" numarası
  yanlış (`MIGRATION-MANIFEST.md:33`) — karar gelmeden şema yazılmaz.
- **M-kart:** Codex C3 durum çelişkisi (kartlı deneme `trialing` → kapı `active`te temizleniyor, müşteri kilitli kalırdı) düzeltilmeden yazılmaz
  (`MIGRATION-MANIFEST.md:34`, `codex-1016-verify.md:79-80`); kodda hiçbir parçası yok.

---

## 9. Önerilen yayın sırası, bağımlılıklar, numara önerisi

Durum: repodaki son klasör `68_kb_copy_source_and_commitment_request_id` (origin `claude/great-edison-3zqpZ`'de — `git ls-tree` ile görüldü); canlı
(prod) en son 58 (`MIGRATION-MANIFEST.md:5`). Railway açılınca `migrate deploy` 59 → sonu tek seferde uygular.

| Sıra | Paket | Bağımlılık | Risk | Neden bu sırada | Numara ÖNERİSİ |
|---|---|---|---|---|---|
| 1 | M-outbox-dizin | yok | en düşük (yalnız dizin) | O1 açılmadan ÖNCE, kuyruk boşken (dolu tabloda dizin = kilit ya da CONCURRENTLY riski) | 69 |
| 2 | M-kb-surum | yok | düşük (varsayılanlı kolon) | müşteriye görünen tek değişiklik 409 metni; bağımsız | 70 |
| 3 | M-oncelik | yok (davranış Faz 3 anahtarına bağlı) | düşük (NULL + varsayılanlı kolon; E3 kanaryası) | şema önce, anahtar sonra — ev sahibi seçimleri baştan "host" yazılsın | 71 |
| 4 | M-bildirim | yok | orta (yeni kuyruk + sağlık / alarm) | M-defter'in `reservation.create` kapsamı ŞART koşar (Codex C2) | 72 |
| 5 | M-defter | **M-bildirim** (aynı yayın ya da sonra) | orta (beş uç + misafire giden S1) | S1 misafire gidene dokunur → soru 1 cevabı şart | 73 |
| 6 | M-iade | yok (Paddle bildirim ayarı: `adjustment.*` açık) | orta (para kaydı, erişime dokunmaz) | Paddle sandbox olayıyla doğrulanmalı | 74 |
| 7 | M-odeme-niyeti | yok (M-iade ile aynı webhook dosyası → aynı turda çakışma riski, ayrı commit) | en yüksek (ödeme akışı + istemci değişir) | Paddle sandbox + kurucu ile ilk denemeler; PADDLE-VARSAYIM'lar doğrulanmadan yazılmaz | 75 |

Notlar:
- **Numara KESİN DEĞİL:** numara yalnız `prisma/migrations/<NN>_<ad>` klasörü oluşunca verilir (`MIGRATION-MANIFEST.md:3-4`); kurucu sırayı değiştirirse
  numaralar klasör oluşma sırasını izler, bu tabloyu değil. Belgelerde ADLA anılmaya devam edilmeli (C4 dersi).
- Paket başına AYRI klasör öneririm (geri alma ve manifest takibi paket bazında); aynı yayında birden çok klasör tek `pg_dump` + tek onayla gidebilir
  (CLAUDE.md "Migration içeren push = taze pg_dump + açık onay").
- Her klasör: `prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --shadow-database-url
  postgresql://postgres@localhost:5432/shadow --script` (ASLA prod URL) + taze PG'de sıfır sapma + `MIGRATION-MANIFEST.md` §1'e satır.
- 1–3 birlikte tek "küçük kolonlar" yayını olabilir (hepsi dolu tabloda güvenli, birbirinden bağımsız). 4+5 birlikte. 6 ve 7 ayrı ayrı (para).
- I1-A cevabı "evet" olursa `GuestCommitment.topic` (NULL'lanabilir kolon) 3. paketin yanına ayrı küçük klasör olarak eklenebilir.
- Ortak test borcu (paketten bağımsız): "`organizationId` taşıyan her model `Organization`'a Cascade bağlı ya da gerekçeli istisna" DMMF pini (§0 E5).

## 10. Doğrulanamayanlar (özet)
- PADDLE-VARSAYIM: sunucuda `POST /transactions` + `Checkout.open({ transactionId })`; aynı işlemin iki kez ödenemeyişi; `ready` işlemin iptal edilebilmesi
  ve kendiliğinden e-posta gitmemesi; `GET /transactions/{id}` durum alanı; düzeltme olaylarının `action` / `status` / `type` değerleri ve yükte
  `customer_id` bulunması. Kaynak sınırı: `odeme.md:146, 233-234`.
- DOĞRULANMADI: Prisma 6.2.1'in ham SQL kısmi dizini `migrate diff`'te nasıl gördüğü; `migrate deploy`'un CONCURRENTLY ile davranışı; canlı `MessageOutbox`
  satır sayısı ve canlı `adjustment.*` olay sayısı (Railway kapalı); rezervasyon / şablon form bileşenlerinin dosya adları (M-defter 1.5).
