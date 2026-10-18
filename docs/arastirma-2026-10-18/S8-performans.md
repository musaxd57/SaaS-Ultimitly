# Performans incelemesi S8 (gece-4, 10-17) — açık kalemler

> Kaynak: gece-4 geniş incelemesinin S8 (hız / performans) raporu, AYNEN aşağıda (İngilizce). Ölçümler atılabilir bir yerel
> PostgreSQL'de, depodaki GERÇEK fonksiyonlarla, sentetik veriyle alındı (10 işletme × 15 mülk × 1.500 rezervasyon × ~13 mesaj; gerçek
> veri yok). Ölçüm betikleri oturum notlarında kaldı (yerel veritabanını sıfırlayan adımlar içerdiği için depoya ALINMADI).
> Sabah raporu: `docs/SABAH-RAPORU-2026-10-18.md` §3.

| Kalem | Durum (10-18) |
|---|---|
| S8-01 FK dizinleri (mülk / hesap silme 15,6 sn → 0,1 sn) | ✅ migration 77 |
| S8-02 Sync'te rezervasyon başına ~12 sorgu | AÇIK — bugünkü ölçekte (≈10 daire) etkisiz; 20+ büyük işletmede 2 dk'lık geçişi aşar. Railway açılınca ölçümle |
| S8-03 Değişmeyen örüntü her geçişte yeniden yazılıyordu | ✅ `1800d8bd` (saatte bir tazeleme) |
| S8-04 Zekâ geçişi her seferinde bütün KB'yi + olay listesini okuyor | KISMEN: olay okuması ✅ migration 78 (10-18 yeniden ölçüm: 40 bin olayda 3,9 ms → 0,05 ms) · KB'nin her geçişte tam okunması AÇIK (bugün KB yazma rotaları hafızayı zaten anında eşitliyor; geçiş yalnız emniyet ağı → ölçümle) |
| S8-05 AuditLog dizinleri | ✅ migration 77 · karar anahtarlarının konuşma başına yeniden okunması AÇIK |
| S8-06 Gelen kutusu "son mesaj" için bütün mesajları okuyor | AÇIK — bugünkü hacimde 30 sn'de bir ~270 KB |
| S3-07 Kalıcı kuyruk (anahtar kapalı): talep sorgusu kilitlenen katmanda sınırsız + 5 sn işlem süresi; büyük birikimde boşaltıcı takılabilir | AÇIK — çözüm önerisi: `{ timeout: 30_000 }` + kilit katmanında LIMIT + `(organizationId, externalReservationId, claimedAt)` dizini; FIFO anlamını bozmadan ölçümle |
| S3-09 Kalıcı kuyruk: teslim düzelticisi `sent` geçmişini her geçişte baştan tarıyor (sentAt dizini yok, `ORDER BY id`) | AÇIK — `@@index([status, sentAt])` (migration) ya da `sentAt` sırası; düzeltme penceresi de kısaltılabilir (T8.12) |
| S3-04 Kalıcı kuyruk: ödeme bekleyen yaşam döngüsü satırları hiç iptal edilmiyor, her geçişte ödeme yoklaması büyüyor | AÇIK — konaklaması bitmiş satırları bekletme kümesinden çıkar / iptal et |
| S3-08 Operatör "Kuyruk sağlığı" bilerek bekletilen satırı kırmızı gösteriyor (alarm yolu düzeltildi, panel okuması değil) | AÇIK — panel `queueStallStates` ile aynı SQL'i kullansın |

---

# S8 — performance & speed review (night 10-17)

Method note: I built a throw-away PostgreSQL 16 on port 5499 (data in /var/tmp/s8-pg-probe, NOT the shared 5433 test DB), applied every
`prisma/migrations/*/migration.sql` with plain psql (no prisma CLI), seeded 10 orgs x 15 properties x 1,500 reservations x 1,500
conversations x ~13.3 messages (= 20,000 messages PER ORG, 200,000 total; message bodies ~400 chars; plus 50,000 Signal rows) and ran the
REAL repo functions against it through a tsx harness that injects a query-logging PrismaClient into `globalThis.prisma`
(probe scripts kept in session notes, not in the repo). Every number below with "measured" was produced that way. No repo file was touched.
Prisma is 6.2.1 with NO `relationJoins` preview feature -> relation loading is the multi-query "query" strategy.

---------------------------------------------------------------------------------------------------------------------------------

## S8-01 · P2 · PERF (migration = index only; customer would notice: yes, a "delete property / delete account" request that hangs)
**Foreign-key columns without an index -> every Reservation / Conversation delete seq-scans Conversation, Signal, SupplyRequest.**
- Catalog query on the migrated schema lists FK columns with NO supporting index:
  `Conversation.reservationId -> Reservation (ON DELETE SET NULL)`, `Signal.conversationId -> Conversation (SET NULL)`,
  `Signal.reservationId -> Reservation (SET NULL)`, `SupplyRequest.reservationId -> Reservation (SET NULL)`,
  (+ tiny/irrelevant: `MessageTemplate.propertyId`, `AuditLog.actorUserId`, `CheckoutConsent.userId`, `TaskUpdate.userId`, `Invoice.subscriptionId`).
  Source: prisma/schema.prisma Conversation (`@@index` list has no reservationId), Signal (no index on conversationId/reservationId).
- Why it bites: PostgreSQL fires the FK action once PER DELETED PARENT ROW and, with no index on the referencing column, each firing
  is a sequential scan of the child table. Request paths that delete reservations/conversations in bulk: `DELETE /api/properties/[id]`
  (cascades 100s of reservations), `deleteAccountData` (account delete, org cascade), retention/erasure, conversation-dedupe apply.
- Measured (scratch DB, 15,000 conversations, 200,000 messages, 50,000 Signal rows):
  - delete ONE property (100 reservations, 100 conversations, 1.3k messages): **1,146 ms** without the indexes -> **10.7 ms** with them (107x).
  - delete ONE whole org (1,500 reservations/conversations, 20k messages): **15.6 s** -> **89 ms** (175x). Cost grows with
    (rows deleted) x (child table size): 10x the data = ~100x the time. A single statement this long also exceeds typical proxy timeouts.
- Fix (smallest): one migration with four plain indexes (tables are small/empty while Railway is closed -> plain CREATE INDEX, no
  CONCURRENTLY): `Conversation(reservationId)`, `Signal(conversationId)`, `Signal(reservationId)`, `SupplyRequest(reservationId)`.
  Rule in CLAUDE.md: "Index + new table is safe"; push with migration still needs the pg_dump + explicit approval.
- Side benefit: the retention sweep (`data-retention.ts:214` `conversation.findMany({ where: { reservationId: { in: 300 ids } } })`)
  and `attention.ts:804-815` (`reservation.conversations take 1`) currently also seq-scan Conversation; they become index lookups.
- Verified: pg_constraint/pg_index catalog query, then BEGIN; DELETE ...; ROLLBACK timings above, then CREATE INDEX x3 and re-measure.


---------------------------------------------------------------------------------------------------------------------------------

## S8-02 · P2 · PERF (no guest/customer-visible change; but it is the throughput ceiling of the whole product)
**Hospitable sync does ~12-13 SQL statements per reservation per 2-minute pass, even when nothing changed.**
- src/lib/hospitable-sync.ts:275-380 (loop over every listing x every reservation in the window) calling, per reservation:
  `prisma.$transaction` { BEGIN, `pg_advisory_xact_lock` (erasure lock), ErasureTombstone read (`loadErasureGuard`), Property.findUnique,
  Reservation.findFirst (`upsertCanonicalReservation`, src/lib/ingest/write-service.ts:117-134), COMMIT } -> `createReservationTasks`
  quick path (src/lib/automation.ts:1169-1176: Reservation.findUnique + Property + Organization (nested select = 2 extra statements)
  + Task.findMany) -> `removeAutoTasksForCancelledReservation` (Reservation status read) -> `conversation.findFirst` skip-check (:393).
- Measured with the REAL functions on the scratch DB (org1: 341 reservations in the narrow window = 30 days back + 120 forward;
  every row unchanged, tasks already present): **4,433 / 4,092 statements per org per pass (13.0 / 12.0 per reservation); wall 4.5 s / 3.9 s
  per org per pass on a LOCAL unix socket** (DB time only 75 ms - the cost is per-statement client/driver overhead ~1 ms + the
  org-wide advisory lock/tx per row). On Railway add 0.5-2 ms network RTT per statement: ~16-20 ms per reservation -> 6-7 s per org per pass.
- Scale: narrow pass = 10 orgs x 341 = 3,410 reservations ~ 55-70 s of strictly serial work per 120 s cycle (50% duty cycle); the hourly
  "deep" window (540 back / 365 forward = ~1,500 reservations/org) = ~25-30 s per org, ~5 min for 10 orgs. 20+ orgs of this size push a
  pass past the 2-minute cadence (`running` guard then answers "locked" and passes are skipped = message latency grows) and toward the
  12-minute PASS_BUDGET (orgs get skipped). Statements/pass at 10 orgs: ~44k narrow, ~150k deep.
- Smallest fix (no behavior change): per listing do ONE bulk pre-read of the window's existing rows instead of per-row reads:
  `reservation.findMany({ where: { propertyId, sourceReference: { in: ids } } })` + `conversation.findMany({ where: { propertyId, externalReservationId: { in } },
  select: id, reservationId, syncCursorAt, skippedReason })` + one `task.findMany({ where: { reservationId: { in } } })`; diff in memory with the
  same field comparisons `upsertCanonicalReservation` already does; open the erasure-lock tx ONLY for rows that are new or whose diff is non-empty
  (the unchanged-row transaction is a pure read that writes nothing, so skipping it cannot change what is written; the lock is
  there to order WRITES against erasure). Also pass `upsertOut`/status to skip `removeAutoTasksForCancelledReservation` when the row is not cancelled.
  Expected: ~12 x N -> ~3 per listing + ~6 per changed row (>95% fewer statements).
- Verified: read the loop end to end; ran upsertCanonicalReservation + createReservationTasks + removeAutoTasksForCancelledReservation +
  conversation.findFirst on 341 real rows twice with a query-logging client (probe s8-resv-loop.ts), histogram printed per statement.

## S8-03 · P2 · PERF (DB write amplification, WAL/bloat; customer would not notice directly)
**`refreshPatternMemory` re-writes EVERY active pattern row on EVERY 2-minute pass.** src/modules/intelligence/memory/patterns.ts:50-69.
- For each (property x category) group with >= 3 negative signals in 180 days it runs `propertyMemory.upsert(... update: data)` where `data`
  contains `lastConfirmedAt: now` and a fresh `evidenceJson`, unconditionally. Nothing compares with the stored row, so a pattern that has
  not changed is UPDATEd 720 times a day.
- Measured (real `runIntelligencePass("org1")`, 15 properties x 8 categories x 5 negative signals = 120 active patterns): pass #2 and #3
  (nothing new) = **125 statements, 120 of them writes ("patternsUpserted":120)**, 218-242 ms wall locally (30 ms DB time; the rest is 125
  sequential round trips). On Railway ~125 x (1.5 ms) = ~0.2-0.4 s per org per pass. 10 orgs x 120 patterns x 720 passes =
  **864,000 row updates / day** (each row carries the whole evidence id list as JSON -> dead tuples, autovacuum churn, WAL).
  Realistic pattern counts are lower, but cost is linear: 720 UPDATEs/day PER active pattern.
- `lastConfirmedAt` has NO reader in src (grep: only written in patterns.ts, rates.ts) so skipping the write loses nothing visible.
- Fix: read the existing `signal_pattern` rows first (the code already does that AFTER the upserts for the retire step: reorder), compare
  (title, observedAt, confidence, evidence count/ids), upsert only when different; refresh `lastConfirmedAt` at most hourly (or only when
  something changed). Keep the retire loop as is. Tests that pin "lastConfirmedAt = computation time" need the hourly refresh variant.

## S8-04 · P3 · PERF
**Intelligence pass re-reads full history every pass, per org.** (all measured on the real functions, org1 = 450 KB items, 20k ingest events)
- `bootstrapMemoryFromKnowledgeBase` (src/modules/intelligence/memory/bootstrap.ts:33-52) selects ALL KB items WITH `content` and ALL
  kb_item PropertyMemory rows WITH `body`, then compares in JS: 19 ms DB time + ~0.7-1.4 MB transferred per org per pass (4,500 items = 6.9 MB
  for 10 orgs every 2 minutes ~ 200 MB/h of pure re-reads). Because `PropertyMemory.observedAt` is stored as `kb.updatedAt`, comparing
  (id, updatedAt, isActive, reviewState) from a narrow select is enough; fetch `content` only for the changed ids.
- `processIngestEvents` (src/modules/intelligence/consumer.ts:94-98) `WHERE dispatchedAt IS NULL AND organizationId = X ORDER BY occurredAt
  LIMIT 500`: no index covers `dispatchedAt` (only (organizationId, occurredAt) and (entityType, entityId)), so PG walks ALL of the org's
  events (`Rows Removed by Filter: 19980`, 388 buffers, 6.2 ms at 20k events/org) every pass; IngestEvent is never purged -> grows forever
  (a year later 5x). Fix: partial index `CREATE INDEX ... ON "IngestEvent"("organizationId","occurredAt") WHERE "dispatchedAt" IS NULL`
  (migration; index only) or a retention sweep for dispatched events.
- `refreshPatternMemory` first query loads all negative signals of 180 days (6,000 rows for 10 orgs here) - fine, but unbounded.

## S8-05 · P3 · PERF
**AuditLog has only `(organizationId)`; two hot readers filter/sort on `createdAt`/`action`.**
- Operator page src/app/(app)/admin/page.tsx:67-79 `auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 })` -> parallel seq scan +
  top-N sort of the WHOLE table: 24 ms at 100,000 rows (grows linearly; nothing indexes createdAt).
- `decidedSuggestionKeys` / `suggestionDecisions` (src/lib/ai-suggestions/load.ts:111-131) `WHERE organizationId AND action IN (...) AND
  createdAt >= since`: bitmap scan of ALL of the org's audit rows then filter (5.7 ms at 10k rows/org, 1,818 heap blocks). It runs once per
  `getConversationSuggestions` call = per conversation in the commitment sweep and once per conversation-page render, although its result is
  org-wide (see S8-08).
- Fix: `@@index([organizationId, action, createdAt])` and `@@index([createdAt])` on AuditLog (index only), and hoist the org-wide key set out
  of the per-conversation loop.

## S8-06 · P3 · PERF
**Nested `take: 1` on a to-many relation under many parents loads ALL child rows (Prisma 6.2.1 query strategy, no relationJoins).**
- Proof: the SQL Prisma emits for the inbox list (src/app/(app)/inbox/page.tsx:78) is
  `SELECT id, body, conversationId FROM Message WHERE conversationId IN ($1..$50) ORDER BY createdAt DESC, id DESC` with NO LIMIT
  (`OFFSET $51` only) - the "take: 1" per conversation is applied in memory. So rendering 50 rows transfers every message body of those 50
  conversations: 665 rows / ~270 KB here (13.3 msgs x 400 chars); a long-stay guest with 150 messages makes it 10x. `AutoRefresh seconds={30}` re-runs it
  every 30 s per open tab.
- Same pattern: src/app/(app)/dashboard/page.tsx:82 (include = ALL columns of every message of 5 conversations), attention.ts:313-320 (200
  conversations x all their messages with the author filter; 1,100 rows for org1), attention.ts:446 (provider-outage conversations),
  automation.ts:5560 `sendDueAlerts` (`messages: { take: HISTORY_MESSAGE_CAP }` with NO select under 50 'new' conversations every pass).
- Measured `sendDueAlerts("org1")` with 42 stuck-`new` conversations (546 messages): 5 statements, 11 ms DB time but 85-90 ms wall, i.e. ~75 ms of
  synchronous JS per org per pass: row decoding + 42 x (`classifyFallback` 1.4 ms + `isSafetyEmergencyText` 0.9 ms - measured by probe s8-classify-cost.ts)
  re-classifying the SAME unchanged messages every 2 minutes (results are deterministic per message id; no memo).
- Fix options (smallest first): (a) inbox: one raw query `SELECT ... FROM unnest($ids) c(id) CROSS JOIN LATERAL (SELECT body FROM "Message" WHERE
  "conversationId" = c.id ORDER BY "createdAt" DESC, id DESC LIMIT 1)` using the existing (conversationId, createdAt) index; (b) denormalize a
  `lastMessagePreview`; (c) sendDueAlerts: `select` only id/direction/body/createdAt/authorType/senderName/systemEventType/channelSenderRole and memoize
  "no alert hit" per message id for the process lifetime (a plain Map capped at a few thousand entries).
