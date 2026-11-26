#!/usr/bin/env node
// Sır taraması — CI'ın `secret-scan` işiyle AYNI araç, AYNI sürüm, AYNI sha256, AYNI yapılandırma (`.gitleaks.toml`). 11-13 (CI 1801): bütün
// testler yeşilken CI yalnız bu iş yüzünden kırmızıya döndü — yerel kapıda karşılığı yoktu ("CI'da olup yerelde olmayan her denetim aynı
// sınıftır"). `npm test` kapısı bunu iki kolla aynı anda koşar (`scripts/test-gate.mjs`); elle: `npm run secret-scan`.
//
// · Sürüm / adres / sha256 TEK KAYNAK: `.github/workflows/ci.yml` okunur (pin `tests/unit/secret-scan-script.test.ts`).
// · Taranan ağaç CI ile aynı: commit edilmiş dosyalar (`git archive HEAD`) — yerel derleme artıkları (`.next`) ve izlenmeyen dosyalar dışarıda.
// · İkili `~/.cache/lixus-gitleaks/<sürüm>/` altında; arşivin sha256'sı indirmede, çıkarılan ikilinin sha256'sı HER koşuda doğrulanır
//   (Opus 11-13 B3: yarım / bozuk önbellek "sızıntı bulundu" diyordu) — tutmazsa önbellek silinip yeniden indirilir.
// Çıkış: 0 temiz · 1 sızıntı bulundu · 2 araç indirilemedi / doğrulanamadı / çalışmadı (tarama YAPILMADI — "temiz" sayılmaz).
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LEAK_EXIT_CODE, parseCiGitleaks, scanExitCode } from "./secret-scan-core.mjs";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function fail(code, msg) {
  console.error(msg);
  process.exit(code);
}

function ensureBinary(spec) {
  const dir = join(homedir(), ".cache", "lixus-gitleaks", spec.version);
  const bin = join(dir, "gitleaks");
  const stamp = join(dir, "BINARY_SHA256");
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, "utf8").trim() === sha256(bin)) return bin;
  // Önbellek yok, yarım ya da bozuk → baştan.
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tgz = join(dir, "gl.tgz");
  const dl = spawnSync("curl", ["-sSL", "-o", tgz, spec.url], { stdio: "inherit" });
  if (dl.status !== 0 || !existsSync(tgz)) fail(2, "secret-scan: gitleaks indirilemedi — tarama YAPILMADI (ağ?).");
  const got = sha256(tgz);
  if (got !== spec.sha256) {
    rmSync(dir, { recursive: true, force: true });
    fail(2, `secret-scan: sha256 tutmadı (${got}) — ikili KULLANILMADI, tarama YAPILMADI.`);
  }
  execFileSync("tar", ["xzf", tgz, "-C", dir, "gitleaks"]);
  chmodSync(bin, 0o755);
  writeFileSync(stamp, `${sha256(bin)}\n`);
  rmSync(tgz, { force: true });
  return bin;
}

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const spec = parseCiGitleaks(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
if (!spec) fail(2, "secret-scan: ci.yml içinde gitleaks adresi / sha256 bulunamadı — tarama YAPILMADI.");
const bin = ensureBinary(spec);
// CI ile aynı ağaç: commit edilmiş dosyalar.
const tree = mkdtempSync(join(tmpdir(), "secret-scan-"));
let code = 2;
try {
  execFileSync("sh", ["-c", `git -C "${root}" archive HEAD | tar -x -C "${tree}"`]);
  const run = spawnSync(bin, ["dir", ".", "--no-banner", "--redact", "--config", ".gitleaks.toml", "--exit-code", String(LEAK_EXIT_CODE)], { cwd: tree, stdio: "inherit" });
  code = scanExitCode(run);
  console.log(code === 0 ? "secret-scan: temiz (HEAD)." : code === 1 ? "secret-scan: SIZINTI bulundu (yukarıda)." : "secret-scan: tarama YAPILAMADI (araç çalışmadı).");
} finally {
  rmSync(tree, { recursive: true, force: true });
}
process.exit(code);
