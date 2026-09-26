# Lixus AI — production image for Railway (and any Docker host).
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
# (kaynak: nodejs/Release schedule.json) — uretim calisma zamani ucuncu aydir
# hicbir guvenlik yamasi ALMIYORDU. Node 22'nin EOL'u 2027-04-30. Bu satir,
# CI'daki node surumu ve package.json `engines` ile TESTLE bagli
# (tests/unit/node-version-parity.test.ts): ucunden biri kayarsa CI kirmizi,
# cunku "CI 22'de test ediyor ama uretim 20 ile calisiyor" ayrismasi hicbir
# yerde hata gibi gorunmez.
#
# ⚠️ node:22-slim'de openssl ve ca-certificates YOK (imaj icinde olculdu:
# `openssl: not found`, `libssl.so.3` yok). Prisma'nin sorgu motoru libssl'e
# baglidir → apt adimi HER IKI asamada da GEREKLI, kozmetik degil.
#
# ---------------------------------------------------------------------------
# IKI ASAMALI (08-05). Onceki tek asamali imaj, `next build` icin gereken TUM
# devDependency'leri (typescript, vitest, playwright, eslint, tailwind, vite …)
# CALISAN kaba tasiyordu. Uretimde asla calistirilmayan ~700 paket, uretim
# imajinda duruyordu — ve `npm audit` bugun tam da o zincirde 1 CRITICAL
# (vitest UI: rastgele dosya okuma/calistirma) + birkac HIGH gosteriyor.
# Calistirilmayan kod da saldiri yuzeyidir: bir kez kod calistirma elde eden
# saldirgan icin oradaki her ikili bir sonraki adimdir.
#
# `runner` asamasi bagimliliklari SIFIRDAN, `--omit=dev` ile kurar; derleme
# asamasindan yalnizca urun (`.next`) tasinir.
# ---------------------------------------------------------------------------

# ═══════════════════════════ 1) BUILDER ═══════════════════════════
FROM mirror.gcr.io/library/node:22-slim AS builder

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

# ═══════════════════════════ 2) RUNNER ═══════════════════════════
FROM mirror.gcr.io/library/node:22-slim AS runner

WORKDIR /app

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

# prisma/ ONCE gelir: `prisma` paketinin postinstall'i bir sema ariyor ve
# bulamazsa uyarip geciyor — semayi once koymak o belirsizligi kaldirir ve
# jeneratoru tek ve kesin bir yerde calistirmamizi saglar.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
# Prisma istemcisi node_modules/.prisma altina URETILIR; `--omit=dev` kurulumu
# taze oldugu icin burada bir kez daha uretilmeli (derleme asamasindaki kopya
# BU kaba tasinmiyor — tasinsaydi iki farkli node_modules karisirdi).
RUN npx prisma generate

# Derlenmis urun + calisma aninda GERCEKTEN okunan dosyalar.
# ⚠️ `assets/` ATLANAMAZ: app/opengraph-image.tsx calisma aninda
# `process.cwd()/assets/og/Inter-*.woff` okuyor. `public/` statik dosyalar
# (marka gorselleri, .well-known/security.txt) + eski yol
# `public/uploads/{org}` yazma dizini. `scripts/` prestart env kapisi
# (verify-env.mjs + env-check.mjs; hicbir node_modules bagimliligi yok).
COPY --from=builder /app/.next ./.next
COPY public ./public
COPY assets ./assets
COPY scripts ./scripts
COPY next.config.mjs ./

# 🚨 ROOT DEGIL. Konteynerde kod calistirma elde eden bir saldirgan icin root,
# paket kurabilmek/imaji degistirebilmek/cekirdek yuzeyine daha genis
# erisebilmek demektir. `node` kullanicisi resmi imajda hazir gelir (uid 1000)
# ve /home/node mevcuttur (imaj icinde dogrulandi).
# ⚠️ `chown` SART: /app root'a ait olarak olusuyor ve calisma aninda YAZILAN
# yerler var — eski yol `public/uploads/{org}` (STORAGE_ENABLED kapaliyken
# bugunku uretim davranisi) ve Next'in `.next/cache`'i. chown olmadan bunlar
# EACCES verir ve hata ancak ilk fotograf yuklemesinde gorunurdu.
RUN chown -R node:node /app
USER node

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
