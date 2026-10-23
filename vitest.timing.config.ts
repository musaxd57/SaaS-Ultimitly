import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import { partitionTestFiles, UNREACHABLE_DATABASE_URL } from "./tests/test-partition.mjs";

// SÜRE ÖLÇEN KOL (kurucu 10-16: "Süre ölçen testleri diğerleri bittikten sonra yalnız çalıştır"): iki kol BİTTİKTEN sonra, tek sıra,
// makine boşken. Veritabanısız (adres ulaşılamaz), `globalSetup` YOK.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: partitionTestFiles().timing,
    globalSetup: [],
    env: { ...base.test?.env, DATABASE_URL: UNREACHABLE_DATABASE_URL },
  },
});
