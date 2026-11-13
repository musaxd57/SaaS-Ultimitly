// YEREL KAPININ RAPOR DENETİMİ (11-13, CI 1797) — `npm test` (`scripts/test-gate.mjs`) üç kol bitince çağırır.
//
// Neden: CI son kapısı yalnız "testler geçti mi"ye bakmaz; dosya başına atlanan test tabanını, kayıp / fazladan / hiç test koşmayan dosyayı da
// denetler (`ci-verify-core.mjs`). Yerel kapı bunu koşmuyordu → yeni bir atlanan test yerelde yeşil, CI'da kırmızı çıktı (push'tan SONRA
// öğrenildi). Karar fonksiyonu AYNI (`verifyReports`); burada yalnız yerel üç kolun raporları okunur.
//
// Kural aynı: şüphede KIRMIZI — rapor yok / okunamıyor, taban yok / bozuk → kırmızı. Commit kimliği yerelde anlamsızdır (rapor az önce bu
// süreçte yazıldı): sabit bir değer iki yana da verilir.
import { existsSync, readFileSync } from "node:fs";
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
