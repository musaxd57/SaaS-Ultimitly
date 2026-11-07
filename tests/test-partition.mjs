// TEST KAPISI BÖLÜMLEMESİ (kurucu 10-16: "Veritabanlı testler tek sırada kalsın. İki kol birlikte çalışırken 3 ve 4 işçiyi karşılaştır …
// Süre ölçen testleri diğerleri bittikten sonra yalnız çalıştır. Eski seri düzen geri dönüş seçeneği olarak kalsın.")
//
// Her test dosyası TAM BİR kola düşer (pin: `tests/unit/test-partition.test.ts`):
//   • db     — `tests/integration/**` (veritabanısız olduğu ölçülen istisnalar hariç) + veritabanı isteyen birkaç unit dosyası.
//              TEK SIRA, `globalSetup` (PostgreSQL 5433) ile — işçi başına yalıtılmış veritabanı olmadan paralellik YOK.
//   • nodb   — geri kalanı; N işçiyle paralel, veritabanı adresi ULAŞILAMAZ (yanlış sınıflanmış veritabanlı test sessiz geçmez,
//              bağlantı hatasıyla KIRMIZI olur).
//   • timing — veritabanısız ama SÜRE ÖLÇEN dosyalar (`*-cost` / `*-perf` ya da saat farkı + `toBeLessThan`): iki kol bittikten SONRA,
//              tek sıra, makine boşken (paralel CPU paylaşımında 150 ms pini 173 ms ölçmüştü — `docs/arastirma-2026-10-15/test-paralellik.md`).
// Varsayılan güvenli yön: yeni bir `tests/integration` dosyası otomatik db koluna (tek sıra) girer.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Veritabanısız kolun veritabanı adresi: bağlantı ANINDA reddedilir (port 1). */
export const UNREACHABLE_DATABASE_URL = "postgresql://postgres@127.0.0.1:1/lixus_nodb_arm?schema=public";

/** `tests/integration` dışında olup veritabanı isteyen dosyalar (ölçüldü: ulaşılamaz adresle kırmızı). */
export const DB_FILES_OUTSIDE_INTEGRATION = ["tests/unit/rate-limit.test.ts"];

/** `tests/integration` içinde olup veritabanı İSTEMEYEN dosyalar (ölçüldü: ulaşılamaz adresle yeşil). */
export const DB_FREE_INTEGRATION_FILES = [
  "tests/integration/ai-source-audit.test.ts",
  "tests/integration/cron-and-leads-auth.test.ts",
  "tests/integration/email-smtp-transport.test.ts",
  "tests/integration/hospitable-oauth-context.test.ts",
  "tests/integration/hospitable.test.ts",
  "tests/integration/login-account-lockout.test.ts",
  "tests/integration/logout-route.test.ts",
  "tests/integration/messaging.test.ts",
  "tests/integration/prebooking-kb-secret-gate.test.ts",
  // (10-16 yeniden ölçüldü, 10-15 ölçümüyle birebir: ulaşılamaz adres + 4 işçi → 977 dosyadan 564 yeşil; integration'da yalnız bu 9)
];

const TEST_FILE = /\.test\.tsx?$/;
const TIMING_NAME = /-(cost|perf)\.test\.tsx?$/;
const TIMING_CLOCK = /performance\.now\(\)|Date\.now\(\)\s*-\s*[A-Za-z_$][\w$]*/;
const TIMING_ASSERT = /toBeLessThan/;

/** Süre ölçen dosya mı (paralel CPU paylaşımında kararsızlaşır). */
export function isTimingSensitive(file, source) {
  return TIMING_NAME.test(file) || (TIMING_CLOCK.test(source) && TIMING_ASSERT.test(source));
}

function walk(root, dir, out) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(root, rel, out);
    else if (TEST_FILE.test(e.name)) out.push(rel);
  }
  return out;
}

/** Ana yapılandırmanın `include`u (`tests/**\/*.test.{ts,tsx}`) ile aynı küme, sıralı. */
export function listTestFiles(root = process.cwd()) {
  return walk(root, "tests", []).sort();
}

export function partitionTestFiles(root = process.cwd()) {
  const all = listTestFiles(root);
  const db = [];
  const nodb = [];
  const timing = [];
  for (const f of all) {
    const isDb =
      (f.startsWith("tests/integration/") && !DB_FREE_INTEGRATION_FILES.includes(f)) || DB_FILES_OUTSIDE_INTEGRATION.includes(f);
    if (isDb) db.push(f);
    else if (isTimingSensitive(f, readFileSync(join(root, f), "utf8"))) timing.push(f);
    else nodb.push(f);
  }
  return { all, db, nodb, timing };
}
