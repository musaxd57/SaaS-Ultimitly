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
 * Kapının çıkış kodu: bütün kollar 0 ile bitti VE rapor denetimi yeşil → 0; aksi 1. (Testler yeşilken denetim kırmızıysa kapı kırmızıdır;
 * denetim yeşilken bir kol kırmızıysa da — vitest'in çıkış kodu yakalanmamış istisnayı da taşır, rapor taşımaz.)
 * @param {{ code: number }[]} results
 * @param {{ ok: boolean }} verify
 */
export function gateExitCode(results, verify) {
  return results.length > 0 && results.every((r) => r.code === 0) && verify.ok === true ? 0 : 1;
}

/**
 * KAPININ AKIŞI. Süreç başlatma (`runArm`) ve çıktı (`log`) dışarıdan verilir → akış, gerçek vitest koşmadan davranışsal sınanır
 * (`tests/unit/test-gate-verify.test.ts`); `scripts/test-gate.mjs` yalnız gerçek başlatıcıyı ve dizinleri verir.
 *  1) Bu dizindeki ESKİ raporlar silinir (bir kol rapor yazmadan 0 ile çıkarsa önceki koşunun raporu "bu koşu" diye okunmasın).
 *  2) Veritabanlı + veritabanısız kol AYNI ANDA; ikisi bitince süre ölçen kol tek başına (makine boşken).
 *  3) Özet + rapor denetimi; çıkış kodu `gateExitCode`.
 * Bir kol kırmızı olsa da kalan kollar koşar (bütün kırmızılar tek seferde görünür).
 * @param {{ runArm: (label: string) => Promise<{ label: string, code: number, signal?: string | null, seconds: number }>, reportDir: string,
 *           root: string, expectedFiles: string[], baselinePath: string, log: (line: string) => void, workers?: string }} input
 */
export async function runGate(input) {
  for (const arm of LOCAL_ARMS) rmSync(join(input.reportDir, `${arm}.json`), { force: true });
  const t0 = Date.now();
  const parallel = await Promise.all([input.runArm("db"), input.runArm("nodb")]);
  const timing = await input.runArm("timing");
  const results = [...parallel, timing];
  const total = Math.round((Date.now() - t0) / 1000);

  input.log("\n── Test kapısı özeti ──");
  for (const r of results) input.log(`${r.label.padEnd(7)} ${r.code === 0 ? "yeşil" : `KIRMIZI (çıkış ${r.code}${r.signal ? `, ${r.signal}` : ""})`}  ${r.seconds} sn`);
  input.log(`toplam  ${total} sn  (işçi: ${input.workers || "varsayılan"})`);

  const verify = verifyLocalGate({ reportDir: input.reportDir, root: input.root, expectedFiles: input.expectedFiles, baselinePath: input.baselinePath });
  input.log(`rapor   ${verify.ok ? "yeşil" : "KIRMIZI"}  dosya ${verify.files} · test ${verify.tests} · atlanan ${verify.skipped}  (${input.reportDir})`);
  for (const e of verify.errors) input.log(`  ✗ ${e}`);
  return { code: gateExitCode(results, verify), results, verify };
}
