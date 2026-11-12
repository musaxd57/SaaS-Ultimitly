#!/usr/bin/env node
// SÜRE KOLU — YÜK ALTINDA (11-12, CI 1793; `docs/INCELEME-2026-11-12-ci-1793-sure-pini.md`).
//
// Private depoda CI küçük (yavaş) makinede koşar; yerelde yeşil olan bir süre pini orada sınıra dayanabilir. Bu betik yavaş makineyi
// taklit eder: işlemciyi dolduran N boş döngü başlatır (4 çekirdekte 6 ≈ 2 kat, 8 ≈ 2,5 kat yavaşlık) ve süre kolunu tek sıra koşar.
// Yeni bir süre pini yazınca (`tests/helpers/linear-cost.ts`) ya da bir pin CI'da kırmızı olunca: `node scripts/timing-under-load.mjs 8`.
// Belirli dosyalar için: `node scripts/timing-under-load.mjs 8 tests/unit/x-cost.test.ts`.
// 🚨 Bu da bir vitest koşusudur — tam kapı ya da mutasyon koşarken BAŞLATMA (süre kolu veritabanı kullanmaz ama işlemciyi paylaşır ve
// mutasyon koşucusu başka vitest görünce durur).
import { spawn, spawnSync } from "node:child_process";

const hogs = Number.parseInt(process.argv[2] ?? "6", 10);
if (!Number.isInteger(hogs) || hogs < 0 || hogs > 64) {
  console.error("kullanım: node scripts/timing-under-load.mjs <yiyici sayısı 0–64> [test dosyaları…]");
  process.exit(2);
}
const files = process.argv.slice(3);
const children = Array.from({ length: hogs }, () => spawn(process.execPath, ["-e", "for(;;){}"], { stdio: "ignore" }));
const stop = () => {
  for (const c of children) c.kill("SIGKILL");
};
process.on("SIGINT", () => {
  stop();
  process.exit(130);
});
console.log(`[timing-under-load] ${hogs} işlemci yiyici + süre kolu${files.length > 0 ? ` (${files.length} dosya)` : ""}`);
const r = spawnSync("npx", ["vitest", "run", "-c", "vitest.timing.config.ts", ...files], { stdio: "inherit" });
stop();
process.exit(r.status ?? 1);
