#!/usr/bin/env node
// ---------------------------------------------------------------------------
// `npm run env:recover` — BULUT KONTEYNERİNİ uzak dala sıfırlar (git reset --hard).
//
// 🚨 KORUMA (09-23 denetimi): bu komut eskiden package.json'da ÇIPLAK duruyordu
// (`git fetch && git reset --hard origin/<dal> && prisma generate`). CLAUDE.md'nin
// kuralı açık: "`reset --hard` YALNIZ bu konteynerde; operatörün klonunda ASLA".
// Ama kural bir METİNDİ; kurucunun Windows klonunda yanlışlıkla çalıştırılan tek bir
// `npm run env:recover` commit edilmemiş bütün yerel işi GERİ DÖNÜŞSÜZ silerdi.
//
// 🚨 İKİNCİ KİLİT — ÖLÇÜLDÜ, PAHALI YOLDAN (09-23): ilk sürüm yalnız "bulut konteyneri
// mi" diye bakıyordu. Aynı gün, koruma yazıldıktan dakikalar sonra, betik bu konteynerde
// "denemek" için doğrudan çalıştırıldı; koruma TASARIM GEREĞİ geçti ve `reset --hard`
// commit edilmemiş ~30 dosyalık işi sildi (yerel commit'ler reflog'dan, düzenlemeler
// oturum kaydından geri alındı). Konteyner de iş taşır → KİRLİ AĞAÇTA hiçbir şey
// yapılmaz; bilerek atmak için `--force`.
// Operatör için doğru komut: `git status --short` → `git pull --ff-only` (yıkıcı değil).
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const BRANCH = "claude/great-edison-3zqpZ";

/**
 * Saf karar (test-pinli): yalnız bulut konteynerinin iki işaretinden biri varsa `true`.
 * @param {Record<string, string | undefined>} [env]
 * @param {(p: string) => boolean} [exists]
 */
export function isCloudContainer(env = process.env, exists = existsSync) {
  return env.CCR_AGENT_PROXY_ENABLED !== undefined || exists("/root/.ccr");
}

/**
 * Saf karar (test-pinli): sıfırlamaya izin var mı?
 * @param {{ container: boolean, porcelain: string, force: boolean }} s
 * @returns {{ ok: true } | { ok: false, reason: "not_container" | "dirty_tree" }}
 */
export function recoverDecision({ container, porcelain, force }) {
  if (!container) return { ok: false, reason: "not_container" };
  if (porcelain.trim() !== "" && !force) return { ok: false, reason: "dirty_tree" };
  return { ok: true };
}

function main() {
  const porcelain = (() => {
    try {
      return execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
    } catch {
      return "?? git status okunamadı"; // okunamıyorsa KİRLİ say (fail-closed)
    }
  })();
  const verdict = recoverDecision({
    container: isCloudContainer(),
    porcelain,
    force: process.argv.includes("--force"),
  });
  if (!verdict.ok) {
    console.error(
      verdict.reason === "not_container"
        ? [
            "env:recover REDDEDİLDİ: bu komut yalnız Claude bulut konteynerinde çalışır.",
            "Yerel klonda `git reset --hard` commit edilmemiş işinizi GERİ DÖNÜŞSÜZ siler.",
            "Güvenli güncelleme: git status --short  →  git pull --ff-only",
          ].join("\n")
        : [
            "env:recover REDDEDİLDİ: çalışma ağacında commit edilmemiş değişiklik var.",
            "`git reset --hard` bunları GERİ DÖNÜŞSÜZ siler. Önce commit/stash edin;",
            "bilerek atmak istiyorsanız: npm run env:recover -- --force",
          ].join("\n"),
    );
    process.exit(1);
  }
  const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });
  run("git", ["fetch", "origin", BRANCH]);
  run("git", ["reset", "--hard", `origin/${BRANCH}`]);
  run("npx", ["prisma", "generate"]);
}

// Doğrudan çalıştırıldığında (npm run env:recover) — test içe aktarınca HİÇBİR ŞEY yapmaz.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
