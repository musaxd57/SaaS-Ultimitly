import { defineConfig } from "vitest/config";
import base from "./vitest.config";
import { partitionTestFiles } from "./tests/test-partition.mjs";

// VERİTABANLI KOL (kurucu 10-16): `tests/integration/**` (ölçülmüş veritabanısız istisnalar hariç) + veritabanı isteyen unit dosyaları.
// Ana yapılandırmanın aynısı — TEK SIRA (`fileParallelism: false`), PostgreSQL `globalSetup` ile. Bölümleme: `tests/test-partition.mjs`.
// Test başına süre sınırı 20 sn (varsayılan 5): bu kol veritabanısız kolla AYNI ANDA koşar ve işlemciyi paylaşır — CI #1517'de CPU-ağır
// kâhin testi (`channel-thread-window-oracle`, tohum başına beş tam okuma) 5 sn'yi aştı (doğrulama hatası değil, zaman aşımı). Bu kolda
// süre ÖLÇEN test yok (en sonda tek başına koşan `timing` kolu, sınırı değişmedi); sınır yalnız asılı kalan testi keser.
export const PARALLEL_ARM_TEST_TIMEOUT_MS = 20_000;
export default defineConfig({
  ...base,
  test: { ...base.test, include: partitionTestFiles().db, testTimeout: PARALLEL_ARM_TEST_TIMEOUT_MS, hookTimeout: 30_000 },
});
