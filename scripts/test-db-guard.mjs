// TEST VERİTABANI KAPISI — "disposable" olduğu KANITLANMAMIŞ bir DB'ye asla
// `prisma db push --accept-data-loss` / toptan `deleteMany` yapılmaz (Codex F08).
//
// 🚨 KAPATILAN AÇIK: `tests/global-setup.ts` herhangi bir `TEST_DATABASE_URL`
// gördüğünde, hedefin ne olduğuna bakmadan `prisma db push --accept-data-loss`
// koşuyordu; ardından `tests/helpers/db.ts` her testte TÜM tabloları
// `deleteMany` ile boşaltıyor. Kabuğunda yanlış URL taşıyan bir geliştirici
// (ya da URL'i `TEST_` diye kopyalayan bir CI ayarı) prod'u ya da dolu bir dev
// DB'sini tek `npm test` ile silebilirdi. `db:reset`/`db:push` için
// `guard-local-db.mjs` vardı; test hazırlığı o kapının DIŞINDAYDI.
//
// KURAL (üç katman, hepsi geçmeli):
//   1. Loopback değilse `TEST_DB_ALLOW_REMOTE=1` ŞART (açık niyet).
//   2. DB, harness'in KENDİ işaretini taşımalı (veritabanı yorumu:
//      `lixus-test-harness:v1`). İşaret `prisma db push`/`--force-reset`'ten
//      SAĞ ÇIKAR (public şemasına değil veritabanına bağlı) — bir tabloya
//      yazılan işaret `db push` tarafından silinirdi.
//   3. İşaret yoksa DB ancak BOŞSA (hiç kullanıcı tablosu yok) sahiplenilir ve
//      işaretlenir. Dolu + işaretsiz DB için tek yol `TEST_DB_ADOPT=1`
//      (`ALLOW_PROD_SEED` ile aynı sınıf: bilinçli, tek seferlik kaçış).
//
// ⚠️ URL'de "test" kelimesi aramak KORUMA DEĞİLDİR ve burada yapılmaz; hüküm
// ağ konumu + DB'nin kendi beyanı üzerinden verilir.
// ⚠️ Hiçbir hata mesajı URL'i basmaz (kimlik bilgisi taşır).
// ⚠️ Linux'ta harness KENDİ geçici Postgres'ini kurar (5433) — bu kapı yalnız
//    harici `TEST_DATABASE_URL` yolunu ilgilendirir. CI o yolu kullanmaz.

import { isLocalDatabaseUrl } from "./db-url.mjs";

export const HARNESS_MARK = "lixus-test-harness:v1";

function refuse(reason) {
  const e = new Error(`[test-db-guard] Refusing: ${reason}`);
  e.code = "TEST_DB_REFUSED";
  return e;
}

/**
 * Saf karar: bağlantı AÇMADAN önce ağ konumu, sonra DB beyanı (`probe`).
 * `probe(url)` → `{ marked: boolean, userTables: number }`.
 * Döner: `{ admitted: true, adopt: boolean }` — `adopt` = işaret YAZILMALI.
 * Reddedince fırlatır (`code: "TEST_DB_REFUSED"`).
 */
export async function decideTestDbAdmission({ url, env = process.env, probe }) {
  try {
    // yalnız ayrıştırılabilirlik; değer hiçbir yere yazılmaz
    new URL(url ?? "");
  } catch {
    throw refuse("TEST_DATABASE_URL ayrıştırılamadı (değer gizli tutuluyor).");
  }
  if (!isLocalDatabaseUrl(url) && env.TEST_DB_ALLOW_REMOTE !== "1") {
    throw refuse(
      "TEST_DATABASE_URL loopback değil. Harici bir test DB'si için TEST_DB_ALLOW_REMOTE=1 " +
        "gerekir ve DB harness işaretini taşımalıdır.",
    );
  }
  const { marked, userTables } = await probe(url);
  if (marked) return { admitted: true, adopt: false };
  if (userTables === 0) return { admitted: true, adopt: true }; // boş DB → sahiplen
  if (env.TEST_DB_ADOPT === "1") return { admitted: true, adopt: true };
  throw refuse(
    `hedef DB boş değil (${userTables} tablo) ve harness işareti yok. Bu bir dev/prod DB'si olabilir. ` +
      "Gerçekten atılabilir bir test DB'siyse BİR KEZ TEST_DB_ADOPT=1 ile koş; işaret yazılır ve bir daha sorulmaz.",
  );
}

/** Gerçek beyan okuması (Prisma raw; şema kurulu olmak ZORUNDA DEĞİL). */
export async function probeTestDb(url) {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const [m] = await client.$queryRawUnsafe(
      "SELECT COALESCE(shobj_description((SELECT oid FROM pg_database WHERE datname = current_database()), 'pg_database') = $1, false) AS marked",
      HARNESS_MARK,
    );
    const [t] = await client.$queryRawUnsafe(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_type = 'BASE TABLE'",
    );
    return { marked: Boolean(m?.marked), userTables: Number(t?.n ?? 0) };
  } finally {
    await client.$disconnect();
  }
}

/** İşareti yaz (veritabanı yorumu). Yalnız `adopt: true` kararından sonra çağrılır. */
export async function markTestDb(url) {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    const [row] = await client.$queryRawUnsafe("SELECT current_database() AS db");
    const name = String(row.db).replace(/"/g, '""');
    // COMMENT ON DATABASE parametre almaz → değer sabit bir literal (kullanıcı girdisi değil).
    await client.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${HARNESS_MARK}'`);
  } finally {
    await client.$disconnect();
  }
}

/** global-setup'ın çağırdığı tek giriş: karar + gerekirse işaret. Reddedince fırlatır. */
export async function guardTestDatabase(url, env = process.env) {
  const decision = await decideTestDbAdmission({ url, env, probe: probeTestDb });
  if (decision.adopt) await markTestDb(url);
  return decision;
}
