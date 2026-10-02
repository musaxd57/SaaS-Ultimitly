import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CANLI HAT ÖLÇERİ İÇİN AYRI YAPILANDIRMA (09-30, `tests/eval/live-pipeline.eval.test.ts`).
//
// Ürünün kanal akışı veritabanı ister; normal suite'in veritabanı (5433) her `vitest run`da SIFIRLANIR ve anahtarı ZORLA boşaltır,
// eval yapılandırmasının ise veritabanı yok. Bu yapılandırma:
//  · YALNIZ `TEST_DATABASE_URL` ile çalışır (ayrı, atılabilir yerel veritabanı — 5433 DEĞİL); yoksa hiç başlamaz. `global-setup`
//    o yolda sunucu kurmaz / 5433'e dokunmaz: yalnız F08 kapısından geçirip şemayı basar (`scripts/test-db-guard.mjs`).
//  · `OPENAI_API_KEY`i boşaltmaz (gerçek model çağrısı ölçümün kendisi).
//  · Yalnız canlı hat ölçerlerini toplar (kanal + QR misafir sohbeti, 10-02).
// Kullanım: docs/LUNA-GECIS-HAZIRLIGI-2026-09-30.md §4.
// ---------------------------------------------------------------------------

const external = process.env.TEST_DATABASE_URL?.trim() ?? "";
const port = /^postgresql:\/\/[^@]*@(?:localhost|127\.0\.0\.1):(\d+)\//.exec(external)?.[1];
if (!external || !port || port === "5433") {
  throw new Error("vitest.eval-live.config: TEST_DATABASE_URL ayrı bir yerel veritabanını göstermeli (5433 test harness'ının)");
}

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["tests/eval/live-pipeline.eval.test.ts", "tests/eval/qr-live-pipeline.eval.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: external,
      AUTH_SECRET: "eval-live-secret-min-16-characters",
    },
  },
});
