// YEREL KAPININ RAPOR DENETİMİ (11-13, CI 1797) — `npm test` (`scripts/test-gate.mjs`) üç kol bitince çağırır.
//
// Neden: CI son kapısı yalnız "testler geçti mi"ye bakmaz; dosya başına atlanan test tabanını, kayıp / fazladan / hiç test koşmayan dosyayı da
// denetler (`ci-verify-core.mjs`). Yerel kapı bunu koşmuyordu → yeni bir atlanan test yerelde yeşil, CI'da kırmızı çıktı (push'tan SONRA
// öğrenildi). Karar fonksiyonu AYNI (`verifyReports`); burada yalnız yerel üç kolun raporları okunur.
//
// Kural aynı: şüphede KIRMIZI — rapor yok / okunamıyor, taban yok / bozuk → kırmızı. Commit kimliği yerelde anlamsızdır (rapor az önce bu
// süreçte yazıldı): sabit bir değer iki yana da verilir.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { validSkipBaseline, verifyReports } from "./ci-verify-core.mjs";

/** Yerel kapının kolları = rapor adları (`<dizin>/<ad>.json`). */
export const LOCAL_ARMS = ["db", "nodb", "timing"];

const LOCAL_SHA = "local";

function readJson(p) {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ reportDir: string, root: string, expectedFiles: string[], baselinePath: string }} input
 * @returns {{ ok: boolean, errors: string[], files: number, tests: number, skipped: number }}
 */
export function verifyLocalGate(input) {
  const baseline = readJson(input.baselinePath);
  if (!validSkipBaseline(baseline)) {
    return { ok: false, errors: [`${input.baselinePath} yok ya da bozuk (dosya → atlanan test sayısı)`], files: 0, tests: 0, skipped: 0 };
  }
  const reports = LOCAL_ARMS.map((label) => ({ label, json: readJson(join(input.reportDir, `${label}.json`)), meta: { sha: LOCAL_SHA } }));
  return verifyReports({ expectedFiles: input.expectedFiles, reports, skipBaseline: baseline, sha: LOCAL_SHA, root: input.root, checkBaselineFiles: true });
}

/**
 * SIR TARAMASI (11-13, CI 1801): CI'ın `secret-scan` işi (gitleaks) yerelde yoktu — bütün testler yeşilken push CI'da yalnız bu yüzden
 * kırmızıya döndü. Kapı aynı aracı `scripts/secret-scan.mjs` ile koşar (sürüm + sha256 ci.yml'den). Ne zaman ATLANIR (saf karar; testli):
 *  · CI'da — orada ayrı iş var (aynı ikiliyi iki kez indirmeyelim);
 *  · linux x64 dışında — gitleaks ikilisi o platform için indirilir; başka platformda çalışmaz.
 * Atlama sessiz değildir: özet satırı sebebi yazar. `null` = koş.
 * @param {{ ci?: string, platform: string, arch: string }} env
 * @returns {string | null}
 */
export function secretScanSkipReason(env) {
  if (env.ci && env.ci.trim() !== "" && env.ci !== "0" && env.ci.toLowerCase() !== "false") return "CI'da ayrı iş (secret-scan)";
  if (env.platform !== "linux" || env.arch !== "x64") return `${env.platform}/${env.arch}: yerel gitleaks yalnız linux x64 — push'tan sonra CI'ın secret-scan işine bakın`;
  return null;
}

/**
 * Kapının çıkış kodu: bütün kollar 0 ile bitti VE rapor denetimi yeşil VE sır taraması (koştuysa) temiz → 0; aksi 1. (Testler yeşilken
 * denetim kırmızıysa kapı kırmızıdır; denetim yeşilken bir kol kırmızıysa da — vitest'in çıkış kodu yakalanmamış istisnayı da taşır, rapor
 * taşımaz.) Sır taramasının 2 çıkışı (araç indirilemedi / doğrulanamadı) da kırmızıdır: tarama yapılmadıysa "temiz" sayılmaz.
 * @param {{ code: number }[]} results
 * @param {{ ok: boolean }} verify
 * @param {{ code: number, skipped?: string } | null} [scan]
 */
export function gateExitCode(results, verify, scan = null) {
  const scanOk = !scan || Boolean(scan.skipped) || scan.code === 0;
  return results.length > 0 && results.every((r) => r.code === 0) && verify.ok === true && scanOk ? 0 : 1;
}

/** Özetteki sır taraması satırı. */
export function secretScanLine(scan) {
  if (scan.skipped) return `sır     atlandı (${scan.skipped})`;
  // "HEAD": tarama CI gibi COMMIT EDİLMİŞ ağaca bakar (Opus 11-13 K3) — commit edilmemiş değişiklik bu satırın kapsamında değildir.
  if (scan.code === 0) return `sır     yeşil (HEAD)  ${scan.seconds} sn`;
  return `sır     KIRMIZI (${scan.code === 1 ? "sızıntı bulundu" : "tarama YAPILAMADI — temiz sayılmaz"}; çıkış ${scan.code})  ${scan.seconds} sn`;
}

/**
 * KAPININ AKIŞI. Süreç başlatma (`runArm`) ve çıktı (`log`) dışarıdan verilir → akış, gerçek vitest koşmadan davranışsal sınanır
 * (`tests/unit/test-gate-verify.test.ts`); `scripts/test-gate.mjs` yalnız gerçek başlatıcıyı ve dizinleri verir.
 *  1) Bu dizindeki ESKİ raporlar silinir (bir kol rapor yazmadan 0 ile çıkarsa önceki koşunun raporu "bu koşu" diye okunmasın).
 *  2) Veritabanlı + veritabanısız kol (ve verildiyse sır taraması) AYNI ANDA; ikisi bitince süre ölçen kol tek başına (makine boşken —
 *     sır taraması da o zamana kadar bitmiş olur; bitmediyse süre ölçen koldan ÖNCE beklenir).
 *  3) Özet + rapor denetimi; çıkış kodu `gateExitCode`.
 * Bir kol kırmızı olsa da kalan kollar koşar (bütün kırmızılar tek seferde görünür).
 * @param {{ runArm: (label: string) => Promise<{ label: string, code: number, signal?: string | null, seconds: number }>, reportDir: string,
 *           root: string, expectedFiles: string[], baselinePath: string, log: (line: string) => void, workers?: string,
 *           secretScan?: () => Promise<{ code: number, seconds: number, skipped?: string }> }} input
 */
export async function runGate(input) {
  for (const arm of LOCAL_ARMS) rmSync(join(input.reportDir, `${arm}.json`), { force: true });
  const t0 = Date.now();
  const scanning = input.secretScan ? input.secretScan() : Promise.resolve(null);
  const parallel = await Promise.all([input.runArm("db"), input.runArm("nodb")]);
  const scan = await scanning;
  const timing = await input.runArm("timing");
  const results = [...parallel, timing];
  const total = Math.round((Date.now() - t0) / 1000);

  input.log("\n── Test kapısı özeti ──");
  for (const r of results) input.log(`${r.label.padEnd(7)} ${r.code === 0 ? "yeşil" : `KIRMIZI (çıkış ${r.code}${r.signal ? `, ${r.signal}` : ""})`}  ${r.seconds} sn`);
  if (scan) input.log(secretScanLine(scan));
  input.log(`toplam  ${total} sn  (işçi: ${input.workers || "varsayılan"})`);

  const verify = verifyLocalGate({ reportDir: input.reportDir, root: input.root, expectedFiles: input.expectedFiles, baselinePath: input.baselinePath });
  input.log(`rapor   ${verify.ok ? "yeşil" : "KIRMIZI"}  dosya ${verify.files} · test ${verify.tests} · atlanan ${verify.skipped}  (${input.reportDir})`);
  for (const e of verify.errors) input.log(`  ✗ ${e}`);
  return { code: gateExitCode(results, verify, scan), results, verify, scan };
}
