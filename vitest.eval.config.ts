import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// GERÇEK MODEL EVAL'İ İÇİN AYRI YAPILANDIRMA (Codex bulgusu, 09-08).
//
// 🚨 NEDEN AYRI — ölçülmüş iki engel, ikisi de sessizdi:
//  1. `vitest.config.ts` `env.OPENAI_API_KEY: ""` ile anahtarı ZORLA BOŞALTIR.
//     Bu, normal suite için DOĞRU ve KORUNMALI bir kapıdır (testler asla OpenAI
//     çağırmaz) — ama aynı config'le eval koşulduğunda kullanıcının anahtarı
//     hiç görünmez, senaryolar SESSİZCE atlanır ve koşu "8 skipped" ile
//     başarılı gibi durur. Yani eval'i o config'le çalıştırma talimatı YANLIŞTI.
//  2. `globalSetup` her koşuda tek kullanımlık bir Linux PostgreSQL ayağa
//     kaldırır. Eval'in veritabanına İHTİYACI YOK ve Windows'ta bu adım
//     çalışmaz — koşu daha başlamadan ölürdü.
//
// Bu config: globalSetup YOK · `OPENAI_API_KEY` HİÇ SET EDİLMEZ (kullanıcının
// kabuğundaki değer olduğu gibi geçer) · yalnız `tests/eval` toplanır.
//
// 🚨 NORMAL SUITE'İN KAPISI AYNEN DURUYOR: `vitest.config.ts` anahtarı
// boşaltmaya devam eder, yani `npm test` hiçbir koşulda gerçek model çağırmaz.
// Bu ayrım test-pinlidir (`tests/eval/...` içindeki "kapı" testleri).
// ---------------------------------------------------------------------------
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
    include: ["tests/eval/**/*.test.ts"],
    fileParallelism: false,
    // globalSetup YOK — eval veritabanı istemez.
    env: {
      // Prisma istemcisi modül grafiğinde kurulabilsin diye SAHTE bir URL yeter:
      // eval hiçbir sorgu çalıştırmaz, bağlantı AÇILMAZ. Gerçek bir URL vermek
      // yanlışlıkla bir veritabanına dokunma riski açardı.
      DATABASE_URL: "postgresql://eval@127.0.0.1:1/eval_unused?schema=public",
      AUTH_SECRET: "eval-secret-min-16-characters-long",
      // Testler hangi config altında koştuklarını BİLSİN (kapı pini).
      EVAL_CONFIG: "1",
      // ⚠️ `OPENAI_API_KEY` BİLEREK YAZILMIYOR — kullanıcının ortamından gelir.
    },
    // Gerçek model çağrısı ağ + kuyruk demek; varsayılan 5 sn yetmez.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
