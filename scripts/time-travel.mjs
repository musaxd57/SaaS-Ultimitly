#!/usr/bin/env node
// ---------------------------------------------------------------------------
// ZAMAN YOLCULUĞU — testleri saat N gün ileri (ya da geri) alınmış hâlde koşar.
//
// Neden (11-13): "sabit tarihli fikstür + saati kendisi okuyan ürün yolu" testleri yazıldıkları gün yeşildir, takvim o tarihe gelince
// ürün değişmeden kırmızıya döner. Dört dosya böyleydi; biri 13 Kasım gecesi tam kapıda patladı, üçü 16 Kasım 00:00'da (İstanbul)
// patlayacaktı. Tarama ancak kırmızıyı gördükten SONRA yapılabildi. Bu betik aynı kırmızıyı takvim gelmeden gösterir.
//
// Nasıl: küçük bir önyükleme kitaplığı (`scripts/time-travel/timeshift.c`, LD_PRELOAD) gerçek zaman saatini kaydırır; süre ölçen tekdüze
// saat DEĞİŞMEZ (zamanlayıcılar ve süre pinleri etkilenmez). Alt süreçler — test veritabanı dahil — aynı kaymayı görür, yani uygulamanın
// saati ile veritabanının saati tutarlı kalır.
//
// Üç saat de aynı kaymayı görmeli: uygulama (önyükleme), test veritabanı (önyükleme alt sürece geçer; kitaplık veritabanı kullanıcısına
// okunur olmalı) ve veritabanı istemcisinin yerel motoru (kopyasına bağlanır — aşağıda). Biri kaymazsa ilgisiz testler kırmızıya döner.
//
// Kullanım (yalnız Linux + gcc + patchelf; CI'da KOŞMAZ, elle çalıştırılan bir tarama aracıdır):
//   node scripts/time-travel.mjs 35                         → bütün kapı (npm test) 35 gün sonrasında
//   node scripts/time-travel.mjs 4 tests/integration/x.test.ts tests/unit/y.test.ts
//                                                           → yalnız bu dosyalar (npx vitest run …) 4 gün sonrasında
//   node scripts/time-travel.mjs -2 …                       → 2 gün öncesinde
// 🚨 Bu da bir vitest koşusudur: test veritabanını (5433) sıfırlar — tam kapı ya da başka bir vitest koşarken ÇALIŞTIRILMAZ.
// Kırmızı çıkan test = aday zaman bombası; ama saatle ilgisi olmayan bir sebep de olabilir → aynı test kaydırmasız yeniden koşulur.
// ---------------------------------------------------------------------------
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [daysArg, ...rest] = process.argv.slice(2);
const days = Number(daysArg);
if (!Number.isFinite(days) || daysArg === undefined) {
  console.error("kullanım: node scripts/time-travel.mjs <gün (eksi olabilir)> [test dosyaları…]");
  process.exit(2);
}
if (process.platform !== "linux") {
  console.error("zaman yolculuğu yalnız Linux'ta çalışır (LD_PRELOAD).");
  process.exit(2);
}
const others = spawnSync("sh", ["-c", "ps -eo args | grep '[n]ode (vitest'"], { encoding: "utf8" }).stdout.trim();
if (others) {
  console.error("başka bir vitest koşuyor — test veritabanı ortak, zaman yolculuğu başlatılmadı.");
  process.exit(2);
}

const dir = mkdtempSync(path.join(os.tmpdir(), "lixus-timeshift-"));
const lib = path.join(dir, "libtimeshift.so");
execFileSync("gcc", ["-O2", "-fPIC", "-shared", "-o", lib, path.join(ROOT, "scripts/time-travel/timeshift.c"), "-ldl"], { stdio: "inherit" });
// 🚨 Kitaplığı test veritabanının kullanıcısı da yükleyebilmeli: geçici klasör yalnız sahibine açık doğar; öyle kalırsa PostgreSQL kitaplığı
// SESSİZCE yüklemez ("cannot be preloaded … ignored") ve veritabanı gerçek saatte, uygulama kaymış saatte koşar — satırların oluşma zamanı
// ile uygulamanın "şimdi"si günlerce ayrışır, ilgisiz testler kırmızıya döner (ölçüldü 11-13: düzeltilmiş kodda 12 sahte kırmızı).
chmodSync(dir, 0o755);
chmodSync(lib, 0o755);

// 🚨 Veritabanı istemcisinin yerel motoru (Prisma) kendi kitaplık kapsamına bağlanarak yüklenir (RTLD_DEEPBIND) ve önyüklemeyi GÖRMEZ:
// motorun ürettiği `createdAt` / `updatedAt` gerçek saatte kalır, uygulama ve veritabanı kaymış saatte koşar (ölçüldü 11-13: düzeltilmiş
// kodda 12 sahte kırmızı). Çözüm: motorun bir KOPYASINA kaydırma kitaplığı ilk bağımlılık olarak eklenir (patchelf) ve istemciye o kopya
// gösterilir (`PRISMA_QUERY_ENGINE_LIBRARY`). `node_modules` içindeki asıl dosyaya dokunulmaz.
const engineDir = path.join(ROOT, "node_modules/.prisma/client");
const engineName = readdirSync(engineDir).find((f) => f.startsWith("libquery_engine") && f.endsWith(".node"));
if (!engineName) {
  console.error("Prisma motor kitaplığı bulunamadı (npx prisma generate?) — zaman yolculuğu başlatılmadı.");
  process.exit(2);
}
const engineCopy = path.join(dir, engineName);
copyFileSync(path.join(engineDir, engineName), engineCopy);
const patched = spawnSync("patchelf", ["--add-needed", lib, engineCopy], { encoding: "utf8" });
if (patched.status !== 0) {
  console.error(`patchelf çalışmadı (pip install patchelf) — motorun saati kaydırılamadığı için koşu başlatılmadı. ${patched.stderr ?? ""}`);
  process.exit(2);
}
chmodSync(engineCopy, 0o755);

const env = {
  ...process.env,
  LD_PRELOAD: [lib, process.env.LD_PRELOAD].filter(Boolean).join(":"),
  TIMESHIFT_SECONDS: String(Math.round(days * 86_400)),
  PRISMA_QUERY_ENGINE_LIBRARY: engineCopy,
};
const shown = spawnSync("node", ["-e", "console.log(new Date().toISOString())"], { env, encoding: "utf8" }).stdout.trim();
console.log(`[zaman yolculuğu] ${days} gün → testlerin gördüğü saat: ${shown} (gerçek: ${new Date().toISOString()})`);
// Veritabanı kullanıcısı da aynı saati görüyor mu (yukarıdaki sessiz ayrışmanın denetimi; `su` / postgres kullanıcısı yoksa atlanır).
const asDb = spawnSync("su", ["postgres", "-c", "date -u +%s"], { env, encoding: "utf8" });
if (asDb.status === 0) {
  const drift = Math.abs(Number(asDb.stdout.trim()) * 1000 - Date.parse(shown));
  if (!(drift < 60_000)) {
    console.error(`[zaman yolculuğu] veritabanı kullanıcısı kaymış saati GÖRMÜYOR (fark ${Math.round(drift / 1000)} sn) — koşu başlatılmadı.`);
    process.exit(2);
  }
}

const [cmd, args] = rest.length > 0 ? ["npx", ["vitest", "run", ...rest]] : ["npm", ["test"]];
const run = spawnSync(cmd, args, { cwd: ROOT, env, stdio: "inherit" });
process.exit(run.status ?? 1);
