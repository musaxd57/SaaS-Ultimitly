# GuestOps AI — production image for Railway (and any Docker host).
#
# We use a plain, explicit Dockerfile instead of Railway's Nixpacks autodetect.
# Nixpacks builds Node via Nix (node 18 + npm 9) and that toolchain produced a
# broken bundle on Railway — `next build` failed prerendering the auto-generated
# /404 and /_error pages with "<Html> should not be imported outside of
# pages/_document", even though the identical commit builds cleanly on Node
# 18/20/22 + npm ci locally. Pinning the toolchain here (official node:22-slim)
# makes the build deterministic and reproducible: what builds locally builds on
# Railway.
#
# Base image is pulled from Google's public mirror of the Docker official
# library (identical digest to docker.io/library/node:22-slim) to avoid Docker
# Hub's anonymous pull rate limits.
#
# 🚨 NODE 22 (08-05'te 20'den yukseltildi). Node 20 **2026-04-30'da EOL oldu**
# (kaynak: nodejs/Release schedule.json) — yani uretim calisma zamani ucuncu
# aydir hicbir guvenlik yamasi ALMIYORDU. Node 22'nin EOL'u 2027-04-30.
#
# Kanit: bu depo Node 22.22.2 uzerinde tam test paketi (2685 test) + `next build`
# + gercek production sunumu ile dogrulandi; CI de ayni turda 22'ye alindi.
# Docker imajinin KENDISI yerelde derlenemedi (bu ortamda Docker daemon yok) —
# derleme hatasi olursa Railway yeni deploy'u YAYINLAMAZ ve calisan surum
# hizmet vermeye devam eder (site DUSMEZ), ama deploy o dusuzelene kadar durur.
#
# ⚠️ Bu satir, CI'daki node surumu ve package.json `engines` ile TESTLE bagli
# (tests/unit/node-version-parity.test.ts). Uc yerden biri kayarsa CI kirmizi:
# "CI 22'de test ediyor ama uretim 20 ile calisiyor" sessiz ayrismasi, tam da bu
# sinifin en pahali hatasidir.
FROM mirror.gcr.io/library/node:22-slim

WORKDIR /app

# OpenSSL is required by Prisma's query engine at build and runtime.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching). NODE_ENV is still unset
# here so npm installs devDependencies too — they are needed by `next build`
# (typescript, tailwind, postcss, ...).
COPY package.json package-lock.json ./
RUN npm ci

# Now the source. node_modules and .next are excluded via .dockerignore so the
# freshly installed dependencies and a clean build are preserved.
COPY . .

# Build. A dummy DATABASE_URL satisfies any build-time references; the real one
# is provided by Railway at runtime. `npm run build` runs `prisma generate &&
# next build`. The dummy URL only needs the right shape (postgresql://) so the
# Prisma client instantiates during build; the real one is injected by Railway
# at runtime and no build step connects to it.
ENV NODE_ENV=production
ENV DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=public"
RUN npm run build

EXPOSE 3000

# At startup: apply any pending migrations (prisma/migrations/), then serve.
# `next start` binds to Railway's injected $PORT automatically.
#
# `npm run start` ALWAYS runs the `prestart` hook first (npm lifecycle) =
# `node scripts/verify-env.mjs`, the boot env gate: in production a missing/
# placeholder AUTH_SECRET or a missing/derived ENCRYPTION_KEY exits NON-ZERO
# HERE, so `next start` never runs and a misconfigured deploy never goes live
# (instead of "Ready but every request 500s"). NODE_ENV=production is set above,
# so the gate is active at boot.
#
# Was `prisma db push` (schema-diff on every boot — no history, no review; this
# is how the chatToken @unique outage happened: adding a unique constraint to a
# populated table made db push refuse and crash-loop the boot). `migrate deploy`
# only applies committed, reviewed migration files from prisma/migrations/ — no
# surprise diffing. Prod was one-time baselined (`migrate resolve --applied
# 0_init`) before this flipped, so this run is a no-op until a NEW migration is
# added. See docs/MIGRATION_CUTOVER.md for the full cutover + rollback.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run start"]
