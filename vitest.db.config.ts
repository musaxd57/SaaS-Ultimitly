import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import { partitionTestFiles } from "./tests/test-partition.mjs";

// VERİTABANLI KOL (kurucu 10-16): `tests/integration/**` (ölçülmüş veritabanısız istisnalar hariç) + veritabanı isteyen unit dosyaları.
// Ana yapılandırmanın aynısı — TEK SIRA (`fileParallelism: false`), PostgreSQL `globalSetup` ile. Bölümleme: `tests/test-partition.mjs`.
export default defineConfig({
  ...base,
  test: { ...base.test, include: partitionTestFiles().db },
});
