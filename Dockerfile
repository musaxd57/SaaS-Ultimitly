# GuestOps AI — production image for Railway (and any Docker host).
#
# We use a plain, explicit Dockerfile instead of Railway's Nixpacks autodetect.
# Nixpacks builds Node via Nix (node 18 + npm 9) and that toolchain produced a
# broken bundle on Railway — `next build` failed prerendering the auto-generated
# /404 and /_error pages with "<Html> should not be imported outside of
# pages/_document", even though the identical commit builds cleanly on Node
# 18/20/22 + npm ci locally. Pinning the toolchain here (official node:20-slim)
# makes the build deterministic and reproducible: what builds locally builds on
# Railway.
#
# Base image is pulled from Google's public mirror of the Docker official
# library (identical digest to docker.io/library/node:20-slim) to avoid Docker
# Hub's anonymous pull rate limits.
FROM mirror.gcr.io/library/node:20-slim

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
# next build`.
ENV NODE_ENV=production
ENV DATABASE_URL="file:/tmp/build.db"
RUN npm run build

EXPOSE 3000

# At startup: apply the schema to the (persistent volume) database, then serve.
# `next start` binds to Railway's injected $PORT automatically.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
