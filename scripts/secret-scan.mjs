#!/usr/bin/env node
// Sır taraması — CI'ın `secret-scan` işiyle AYNI araç, AYNI sürüm, AYNI sha256, AYNI yapılandırma (`.gitleaks.toml`). 11-13 (CI 1801): bütün
// testler yeşilken CI yalnız bu iş yüzünden kırmızıya döndü — yerel kapıda karşılığı yoktu ("CI'da olup yerelde olmayan her denetim aynı
// sınıftır"). Push'tan ÖNCE koşulur: `node scripts/secret-scan.mjs` (ya da `npm run secret-scan`).
//
// · Sürüm / adres / sha256 TEK KAYNAK: `.github/workflows/ci.yml` okunur (iki yerde ayrı sabit tutulmaz; pin `tests/unit/secret-scan-script.test.ts`).
// · Taranan ağaç CI ile aynı: commit edilmiş dosyalar (`git archive HEAD`) — yerel derleme artıkları (`.next`) ve izlenmeyen dosyalar dışarıda.
// · İkili `~/.cache/lixus-gitleaks/<sürüm>/` altında saklanır; sha256 tutmazsa kullanılmaz.
// Çıkış: 0 temiz · 1 sızıntı bulundu · 2 araç indirilemedi / doğrulanamadı (tarama YAPILMADI — "temiz" sayılmaz).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** CI iş tanımından gitleaks adresi, sürümü ve sha256'sı (saf; testli). */
export function parseCiGitleaks(ciYaml) {
  const url = /curl -sSL -o \S+ (https:\/\/github\.com\/gitleaks\/gitleaks\/releases\/download\/v([\d.]+)\/gitleaks_[\d.]+_linux_x64\.tar\.gz)/.exec(ciYaml);
  const sha = /echo "([0-9a-f]{64})\s+\S*gl\.tgz" \| sha256sum -c -/.exec(ciYaml);
  if (!url || !sha) return null;
  return { url: url[1], version: url[2], sha256: sha[1] };
}

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const spec = parseCiGitleaks(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
  if (!spec) fail(2, "secret-scan: ci.yml içinde gitleaks adresi / sha256 bulunamadı — tarama YAPILMADI.");
  const dir = join(homedir(), ".cache", "lixus-gitleaks", spec.version);
  const bin = join(dir, "gitleaks");
  if (!existsSync(bin)) {
    mkdirSync(dir, { recursive: true });
    const tgz = join(dir, "gl.tgz");
    const dl = spawnSync("curl", ["-sSL", "-o", tgz, spec.url], { stdio: "inherit" });
    if (dl.status !== 0) fail(2, "secret-scan: gitleaks indirilemedi — tarama YAPILMADI (ağ?).");
    const got = createHash("sha256").update(readFileSync(tgz)).digest("hex");
    if (got !== spec.sha256) {
      rmSync(tgz, { force: true });
      fail(2, `secret-scan: sha256 tutmadı (${got}) — ikili KULLANILMADI, tarama YAPILMADI.`);
    }
    execFileSync("tar", ["xzf", tgz, "-C", dir, "gitleaks"]);
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, "VERIFIED"), `${spec.sha256}\n`);
  }
  // CI ile aynı ağaç: commit edilmiş dosyalar.
  const tree = mkdtempSync(join(tmpdir(), "secret-scan-"));
  try {
    execFileSync("sh", ["-c", `git -C "${root}" archive HEAD | tar -x -C "${tree}"`]);
    const run = spawnSync(bin, ["dir", ".", "--no-banner", "--redact", "--config", ".gitleaks.toml", "--exit-code", "1"], { cwd: tree, stdio: "inherit" });
    if (run.status === 0) console.log("secret-scan: temiz (HEAD).");
    process.exit(run.status === 0 ? 0 : 1);
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
