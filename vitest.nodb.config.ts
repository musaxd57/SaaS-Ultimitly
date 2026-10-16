import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import { partitionTestFiles, UNREACHABLE_DATABASE_URL } from "./tests/test-partition.mjs";

// VERİTABANISIZ KOL (kurucu 10-16): veritabanlı kolla AYNI ANDA, N işçiyle paralel. `globalSetup` YOK; veritabanı adresi ULAŞILAMAZ
// → yanlış sınıflanmış veritabanlı bir test sessiz geçmez, bağlantı hatasıyla kırmızı olur. Süre ölçen dosyalar bu kolda DEĞİL (en sonda,
// tek sıra — `vitest.timing.config.ts`). İşçi sayısı `TEST_NODB_WORKERS` (ölçülerek seçildi: `docs/arastirma-2026-10-15/test-paralellik.md`).
const workers = Math.max(1, Number(process.env.TEST_NODB_WORKERS) || 3);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: partitionTestFiles().nodb,
    fileParallelism: true,
    globalSetup: [],
    pool: "forks",
    poolOptions: { forks: { minForks: 1, maxForks: workers } },
    env: { ...base.test?.env, DATABASE_URL: UNREACHABLE_DATABASE_URL },
  },
});
