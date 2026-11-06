import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// M-2 (Opus R1): onarım betiği (`scripts/membership-backfill.ts`) hedef AÇIKÇA verilmeden KOŞMAZ — Prisma yoksa kökteki `.env`'i yükler,
// yerel geliştirme veritabanını sayıp "0 eksik" derdi; operatör üretimdeki 503'ü çözülmüş sanardı. Hedef ilk satırda, parolasız basılır.
// Betik gerçek süreçte koşturulur (davranış); veritabanına yalnız erişilemeyen kapıyla (1) gidilir — hiçbir şey okunmaz / yazılmaz.
// ---------------------------------------------------------------------------

const TSX = join(process.cwd(), "node_modules", ".bin", "tsx");

function run(env: Record<string, string | undefined>) {
  const e: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete e[k];
    else e[k] = v;
  }
  delete e.MEMBERSHIP_BACKFILL_APPLY;
  delete e.MEMBERSHIP_BACKFILL_EXPECT;
  return spawnSync(TSX, ["scripts/membership-backfill.ts"], { env: e, encoding: "utf8", timeout: 60_000 });
}

describe("onarım betiği — hedef açıkça verilmeden koşmaz", () => {
  it.each([
    ["ortamda yok", undefined],
    ["boş", ""],
    ["yalnız boşluk", "   "],
  ])("🚨 DATABASE_URL %s → çıkış 2, sayım YOK (yerel .env'e düşmez)", (_label, value) => {
    const r = run({ DATABASE_URL: value });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/DATABASE_URL acikca verilmedi/);
    expect(r.stdout).not.toMatch(/Uyelik satiri|HEDEF:/);
  });

  it("hedef İLK iş basılır (sunucu:kapı/veritabanı, yerel|UZAK) ve parola hiçbir çıktıda görünmez; erişilemeyen veritabanında sayım yapılamaz → çıkış 1", () => {
    const r = run({ DATABASE_URL: "postgresql://kullanici:GIZLI-PAROLA@127.0.0.1:1/lixus_hedef?schema=public" });
    expect(r.stdout.split("\n").find((l) => l.startsWith("HEDEF:"))).toBe("HEDEF: 127.0.0.1:1/lixus_hedef (yerel)");
    expect(`${r.stdout}${r.stderr}`).not.toContain("GIZLI-PAROLA");
    expect(r.stdout).not.toMatch(/Uyelik satiri HIC olmayan kullanici : \d/);
    expect(r.status).toBe(1);
  }, 60_000);
});
