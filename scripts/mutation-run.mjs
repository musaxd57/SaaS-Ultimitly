#!/usr/bin/env node
// Mutasyon koşucusu — ADANMIŞ git worktree'de (09-24, dış inceleme: "mutasyon koşucusu ayrı bir worktree'de
// çalışmıyorsa, aynı anda yazılan kodla yarış yaratır"). Eski koşucular (scratchpad python betikleri) ana çalışma
// ağacındaki kaynak dosyayı değiştirip geri yüklüyordu: o sırada aynı dosyaya yazılan iş ya mutantla karışıyor ya
// geri yüklemede siliniyordu, ağaç kirliyken koşu hiç başlayamıyordu.
//
// Kullanım:
//   node scripts/mutation-run.mjs <spec.json> [--sha <commit>] [--only M1,M2] [--json <sonuç.json>] [--keep]
// spec.json: { "tests": ["tests/unit/x.test.ts"], "mutants": [{ "id": "M1", "file": "src/...", "old": "…", "new": "…",
//              "tests": ["…"] (isteğe bağlı; yoksa üst düzey liste) }] }
//
// Sözleşme (saf kararlar `scripts/mutation/core.mjs`, pin `tests/unit/mutation-runner-core.test.ts`):
//  · Hedef = COMMIT (varsayılan HEAD). Commit edilmemiş değişiklik mutasyona GİRMEZ (uyarı basılır). Ayrık worktree
//    geçici dizinde kurulur, `node_modules` sembolik bağla paylaşılır, iş bitince worktree silinir (--keep hariç).
//  · Koşucu ana çalışma ağacına HİÇBİR KOŞULDA yazmaz: her yazma worktree içinde mi diye YAPISAL olarak denetlenir.
//    Ana ağaç koşu boyunca düzenlenebilir.
//  · M0 kontrol koşusu ZORUNLU: mutasyonsuz worktree'de hedef testler yeşil değilse sonuçlar geçersiz (çıkış 2).
//  · Her mutantın çapası TAM BİR KEZ geçmeli (çıkış 3). Mutant sonrası dosya bayt bayt geri yüklenir, sha doğrulanır.
//  · 🚨 Test kurulumu PG 5433'ü her koşuda sıfırlar: başka bir vitest çalışırken BAŞLAMAZ ve her mutanttan önce yeniden
//    bakar (çıkış 5). Worktree dosya yarışını çözer, veritabanı yarışını ÇÖZMEZ — tam suit ile aynı anda koşmayın.
// Çıkış: 0 hepsi öldürüldü · 1 yaşayan var · 2 M0 kırmızı · 3 çapa hatası · 4 kurulum hatası · 5 eşzamanlı vitest.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyMutant, concurrentVitest, insideDir, summarize, validateSpec } from "./mutation/core.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const TEST_TIMEOUT_MS = 20 * 60_000;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

function assertNoConcurrentVitest() {
  const ps = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).stdout ?? "";
  const others = concurrentVitest(ps, [process.pid, process.ppid]);
  if (others.length > 0) {
    console.error(`BAŞKA BİR vitest ÇALIŞIYOR (PG 5433 paylaşılıyor) — koşu durdu:\n${others.join("\n")}`);
    process.exit(5);
  }
}

function runTests(wt, tests) {
  const r = spawnSync("npx", ["vitest", "run", ...tests], { cwd: wt, encoding: "utf8", timeout: TEST_TIMEOUT_MS });
  return { passed: r.status === 0, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.slice(-3000) };
}

const specPath = process.argv[2];
if (!specPath || specPath.startsWith("--")) {
  console.error("kullanım: node scripts/mutation-run.mjs <spec.json> [--sha <commit>] [--only M1,M2] [--json <out>] [--keep]");
  process.exit(4);
}
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const specErrors = validateSpec(spec);
if (specErrors.length > 0) {
  console.error(`spec geçersiz:\n- ${specErrors.join("\n- ")}`);
  process.exit(4);
}
const only = new Set((arg("--only") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
const mutants = spec.mutants.filter((m) => only.size === 0 || only.has(m.id));
const sha = git("rev-parse", "--verify", `${arg("--sha") ?? "HEAD"}^{commit}`);
if (git("status", "--porcelain") !== "") {
  console.warn("UYARI: ana ağaçta commit edilmemiş değişiklik var — mutasyon YALNIZ commit içeriğinde koşar:", sha.slice(0, 7));
}

assertNoConcurrentVitest();
const parent = mkdtempSync(join(tmpdir(), "lixus-mut-"));
const wt = join(parent, "wt");
const cleanup = () => {
  if (process.argv.includes("--keep")) return console.log(`worktree korunuyor: ${wt}`);
  try {
    git("worktree", "remove", "--force", wt);
  } catch {
    /* zaten yok */
  }
  rmSync(parent, { recursive: true, force: true });
  try {
    git("worktree", "prune");
  } catch {
    /* bilgi amaçlı */
  }
};

let exitCode = 0;
try {
  git("worktree", "add", "--detach", wt, sha);
  symlinkSync(join(ROOT, "node_modules"), join(wt, "node_modules"));
  console.log(`worktree ${wt} @ ${sha.slice(0, 7)} — ${mutants.length} mutant`);

  const allTests = [...new Set(mutants.flatMap((m) => m.tests ?? spec.tests))];
  const m0 = runTests(wt, allTests);
  console.log("M0", m0.passed ? "yeşil" : "KIRMIZI (kontrol kırmızı — sonuçlar geçersiz)");
  if (!m0.passed) {
    console.log(m0.tail);
    exitCode = 2;
  } else {
    const results = [];
    let anchorError = false;
    for (const m of mutants) {
      assertNoConcurrentVitest();
      const target = resolve(wt, m.file);
      if (!insideDir(wt, target) || !existsSync(target)) {
        console.log(m.id, "HATA: dosya worktree dışında ya da yok", m.file);
        anchorError = true;
        continue;
      }
      const original = readFileSync(target);
      const applied = applyMutant(original.toString("utf8"), m.old, m.new);
      if (!applied.ok) {
        console.log(m.id, `ÇAPA HATASI: ${applied.count} geçiş (tam 1 olmalı)`);
        anchorError = true;
        continue;
      }
      writeFileSync(target, applied.out);
      const r = runTests(wt, m.tests ?? spec.tests);
      writeFileSync(target, original);
      if (sha256(readFileSync(target)) !== sha256(original)) throw new Error(`${m.id}: geri yükleme doğrulanamadı`);
      const outcome = r.passed ? "survived" : "killed";
      results.push({ id: m.id, outcome });
      console.log(m.id, outcome === "killed" ? "öldürüldü" : "YAŞADI");
    }
    const s = summarize(results);
    console.log(`SONUÇ ${s.killed}/${s.total} öldürüldü${s.survived.length ? ` · yaşayan: ${s.survived.join(", ")}` : ""}`);
    const out = arg("--json");
    if (out) writeFileSync(out, JSON.stringify({ sha, results, ...s }, null, 2));
    exitCode = anchorError ? 3 : s.exitCode;
  }
} catch (err) {
  console.error("kurulum hatası:", err instanceof Error ? err.message : err);
  exitCode = 4;
} finally {
  cleanup();
}
process.exit(exitCode);
