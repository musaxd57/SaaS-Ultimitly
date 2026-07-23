# Boot: `prisma db push` → `prisma migrate deploy` — cutover runbook

**Why:** today the container boots with `prisma db push`, which diffs the schema
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

## Phase 2 — baseline the PROD database (one-time, run by you)

This writes a single `_prisma_migrations` row recording `0_init` as already
applied. **It runs no SQL and touches zero app data** — it just tells Prisma
"these tables already exist, don't recreate them."

Run it against **prod** (from a shell where `DATABASE_URL` points at the prod DB —
e.g. the Railway service shell, or `railway run`):

```bash
npx prisma migrate resolve --applied 0_init
```

Expected output: `Migration 0_init marked as applied.`

Verify (optional): `npx prisma migrate status` → should say the database is up to
date / `0_init` applied. Prod is still serving on the old `db push` boot at this
point — nothing has changed for users yet.

> ⚠️ Do NOT run this against an EMPTY database. It only baselines an EXISTING
> populated DB. A fresh/empty DB should just get `migrate deploy` (Phase 3), which
> creates the tables.

## Phase 3 — flip the boot command (the cutover; auto-deploys)

Only after Phase 2 succeeds. Change the last line of `Dockerfile`:

```dockerfile
# from:
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
# to:
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
```

Commit + push → Railway redeploys → boot runs `migrate deploy`. Because prod is
already baselined and there are no migrations after `0_init`, it prints
**"No pending migrations to apply."** and serves normally. (A fresh/empty DB, e.g.
a new environment, gets all 20 tables created instead.)

Watch the first deploy's logs together to confirm a clean boot.

## Rollback

If the flipped boot ever misbehaves, `git revert` the Phase-3 (Dockerfile) commit
and push → boot returns to `db push`, which ignores `_prisma_migrations` and
no-ops against the already-matching schema → prod recovers cleanly. Because the
cutover applies **zero** DDL (only the already-applied `0_init` exists), there is
nothing half-applied to unwind.

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
