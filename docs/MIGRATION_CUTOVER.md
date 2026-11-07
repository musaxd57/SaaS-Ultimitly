# Boot: `prisma db push` → `prisma migrate deploy` — cutover runbook

**Why:** the container used to boot with `prisma db push`, which diffed the schema
against the live DB every deploy. That is how the `chatToken @unique` outage
happened (adding a unique constraint to a populated table → boot crash-loop).
Moving to `prisma migrate deploy` means every schema change ships as a **reviewed
migration file**, applied deterministically, with no surprise diffing.

**Status: DONE (2026-07-02).** Phase 1 (baseline migration committed), Phase 2
(prod baselined — user ran `migrate resolve --applied 0_init` against the live
Railway Postgres, confirmed: `Migration 0_init marked as applied.`), and Phase 3
(Dockerfile flipped to `migrate deploy`, pushed) are all complete. Prod boots on
real migrations now; any future schema change ships as a reviewed migration file
under `prisma/migrations/`, not a live schema-diff.

**Verified live:** Railway deploy log shows "Deployment successful" on the first
`migrate deploy` boot; dashboard loads with real data (messages, tasks,
checkouts) immediately after. Cutover confirmed working end-to-end.

Verified locally end-to-end on a throwaway Postgres: the baseline has **zero
drift** vs a `db push`'d schema; a plain `migrate deploy` on the populated DB
fails **P3005** (proving the baseline step is mandatory first); `resolve --applied`
then `deploy` is a clean no-op.

---

## Phase 2 + 3 — how the cutover was done (historical record)

Phase 2 baselined the LIVE prod DB with `npx prisma migrate resolve --applied 0_init`
(writes one `_prisma_migrations` row, zero SQL/data touched; verified with
`migrate status`). Phase 3 flipped the Dockerfile CMD from `db push` to
`migrate deploy` — prod printed "No pending migrations to apply." and served
normally. ⚠️ `resolve --applied` is ONLY for an existing populated DB; a fresh/empty
DB just gets `migrate deploy`, which creates the tables.

**Rollback (still valid):** if a `migrate deploy` boot ever misbehaves with nothing
half-applied, `git revert` the Dockerfile commit → `db push` boot no-ops against the
matching schema and prod recovers. (With 44 real migrations now in the chain this is
a last resort — prefer fixing forward.)

## From then on — how to add a schema change (current project protocol)

1. Edit `prisma/schema.prisma`.
2. Generate the migration SQL with **`prisma migrate diff`** (the project standard —
   NOT `migrate dev`). `--from-migrations` needs a **shadow database** (Prisma
   replays the migration history into it), and the schema has no `shadowDatabaseUrl`,
   so pass it explicitly — a **throwaway local DB, NEVER the production URL** (the
   shadow DB gets wiped):
   `npx prisma migrate diff --from-migrations ./prisma/migrations
   --to-schema-datamodel ./prisma/schema.prisma
   --shadow-database-url postgresql://postgres@localhost:5432/shadow --script`
   → save under a new zero-padded `prisma/migrations/NN_<change>/migration.sql` folder.
3. Verify on a throwaway Postgres: `migrate deploy` 00→N from scratch, then the same
   `migrate diff … --shadow-database-url … --exit-code` (zero drift). CI's
   migration-chain job runs exactly this pair (see `.github/workflows/ci.yml`).
4. Push → prod boot's `migrate deploy` applies exactly that reviewed migration.

⚠️ The old rule **still applies**: adding `@unique` / required-without-default /
a drop to a POPULATED table fails at `migrate deploy` if live data violates it —
the failure just moved from a surprise boot-diff to a reviewable migration. The
working protocol (see m18-20 in CLAUDE.md) is: clean/verify prod duplicates
FIRST, then ship the constraint as its own migration.
