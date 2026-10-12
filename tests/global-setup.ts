import { execSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { guardTestDatabase } from "../scripts/test-db-guard.mjs";

// Provisions a throwaway PostgreSQL instance for the integration suite, pushes
// the Prisma schema into it, and tears it down afterwards. Postgres refuses to
// run as root, so the server is initialised and started as the unprivileged
// `postgres` system user (the test runner itself runs as root in CI/sandbox).
//
// The connection string here MUST match DATABASE_URL in vitest.config.ts.

const PGDATA = "/tmp/guestops-pgtest";
const PORT = "5433";
const SOCK = "/tmp";
const DB = "guestops_test";

function pgBin(): string {
  return execSync("ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1").toString().trim();
}

export default async function setup() {
  // Cross-platform escape hatch (Codex audit): the provisioning below is
  // Linux-only (`su postgres`, /tmp, GNU ls). On Windows/macOS point
  // TEST_DATABASE_URL at any empty local PostgreSQL database and the harness
  // only pushes the schema into it — no server provisioning, no teardown.
  // vitest.config.ts uses the same variable for the suite's DATABASE_URL.
  const external = process.env.TEST_DATABASE_URL?.trim();
  if (external) {
    // 🚨 KAPI PUSH'TAN ÖNCE (Codex F08). Eskiden herhangi bir URL doğrudan
    // `db push --accept-data-loss`a gidiyordu ve ardından her test tüm tabloları
    // boşaltıyor (`helpers/db.ts resetDb`). Hedefin ATILABİLİR olduğu artık
    // kanıtlanır: loopback (ya da açık TEST_DB_ALLOW_REMOTE=1) + DB'nin kendi
    // harness işareti; işaretsiz DB yalnız BOŞSA (ya da TEST_DB_ADOPT=1 ile bir
    // kez) sahiplenilir. Reddedince fırlatır → vitest hiç başlamaz. URL basılmaz.
    await guardTestDatabase(external);
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: external },
    });
    return () => {};
  }

  const BIN = pgBin();

  // Start clean: stop any leftover server on this data dir, wipe it, re-init.
  try {
    execSync(`su postgres -c "${BIN}/pg_ctl -D ${PGDATA} stop -m immediate"`, { stdio: "ignore" });
  } catch {
    // nothing running — fine
  }
  rmSync(PGDATA, { recursive: true, force: true });
  mkdirSync(PGDATA, { recursive: true });
  execSync(`chown postgres:postgres ${PGDATA}`);

  // Kodlama + yerel ayar AÇIK (canlıyla aynı UTF8): belirtilmezse ortamdan gelir — CI konteynerinde LANG boş → SQL_ASCII, yerelde
  // C.UTF-8 → UTF8; ham SQL'deki Unicode karakter kalıpları iki ortamda farklı davranıyordu (10-12, CI #1420). C.UTF-8 yerel ayarı
  // olmayan imajda `C` ile yine UTF8 kurulur (sıralama aynı — UTF-8 bayt sırası = kod noktası sırası); ikisi de düşerse initdb'nin
  // KENDİ hata çıktısıyla durur (Haiku 10-12: sessiz düşüş bütün paketi sebepsiz kırmızı yapardı).
  const initdb = (locale: string) =>
    execSync(`su postgres -c "${BIN}/initdb -D ${PGDATA} -U postgres --auth=trust -E UTF8 --locale=${locale}"`, { stdio: "pipe" });
  try {
    initdb("C.UTF-8");
  } catch {
    rmSync(PGDATA, { recursive: true, force: true });
    mkdirSync(PGDATA, { recursive: true });
    execSync(`chown postgres:postgres ${PGDATA}`);
    try {
      initdb("C");
    } catch (err) {
      const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
      throw new Error(`test kümesi initdb başarısız (UTF8): ${stderr}`);
    }
  }
  execSync(
    `su postgres -c "${BIN}/pg_ctl -D ${PGDATA} -o '-p ${PORT} -k ${SOCK}' -w -l ${PGDATA}/server.log start"`,
    { stdio: "ignore" },
  );
  execSync(`${BIN}/createdb -h ${SOCK} -p ${PORT} -U postgres ${DB}`, { stdio: "ignore" });

  execSync("npx prisma db push --accept-data-loss --skip-generate", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: `postgresql://postgres@localhost:${PORT}/${DB}?schema=public`,
    },
  });

  return () => {
    try {
      execSync(`su postgres -c "${BIN}/pg_ctl -D ${PGDATA} stop -m immediate"`, { stdio: "ignore" });
    } catch {
      // already gone
    }
  };
}
