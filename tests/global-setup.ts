import { execSync } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";

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

export default function setup() {
  // Cross-platform escape hatch (Codex audit): the provisioning below is
  // Linux-only (`su postgres`, /tmp, GNU ls). On Windows/macOS point
  // TEST_DATABASE_URL at any empty local PostgreSQL database and the harness
  // only pushes the schema into it — no server provisioning, no teardown.
  // vitest.config.ts uses the same variable for the suite's DATABASE_URL.
  const external = process.env.TEST_DATABASE_URL?.trim();
  if (external) {
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

  execSync(`su postgres -c "${BIN}/initdb -D ${PGDATA} -U postgres --auth=trust"`, {
    stdio: "ignore",
  });
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
