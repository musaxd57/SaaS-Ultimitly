// CI TEST RAPORU DENETİMİ — SAF karar fonksiyonu (kurucu 10-31, `docs/TASARIM-2026-10-31-ci-paralel-test.md` §3). Pin:
// `tests/unit/ci-verify-core.test.ts`. Kural: şüphede KIRMIZI — eksik / okunamayan rapor, başka commit'in raporu, başarısız ya da boş dosya,
// kaybolan / fazladan / iki kez koşan dosya, dosya başına atlanan test tavanının aşılması, vitest'in "başarısız" bayrağı (başarısız dosya / test),
// beklenen işlerden birinin sonucunun eksik ya da "success" dışında olması — hepsi kırmızı. Yakalanmamış istisna vitest JSON'unda `success`i
// DÜŞÜRMEZ (2.1.9) ama vitest adımı 1 ile çıkar → iş "failure" → `needs` denetimi yakalar. Yeşil yalnız HER ŞEY tam ve geçmişken.

const SKIPPED = new Set(["pending", "skipped", "todo", "disabled"]);

/** Vitest JSON raporundaki mutlak dosya yolunu depo-göreli yapar (`/__w/x/y/tests/a.test.ts` → `tests/a.test.ts`). */
export function relativeTestPath(name, root) {
  const n = String(name).replace(/\\/g, "/");
  const r = String(root).replace(/\\/g, "/").replace(/\/+$/, "");
  if (n.startsWith(`${r}/`)) return n.slice(r.length + 1);
  const i = n.lastIndexOf("/tests/");
  return i >= 0 ? n.slice(i + 1) : n;
}

/** Dosya başına atlanan / yapılacak test sayısı (taban üretimi ve denetim için ortak). */
export function skippedPerFile(json, root) {
  const out = {};
  for (const r of json?.testResults ?? []) {
    const n = (r.assertionResults ?? []).filter((a) => SKIPPED.has(a.status)).length;
    if (n > 0) out[relativeTestPath(r.name, root)] = n;
  }
  return out;
}

/**
 * @param {{ expectedFiles: string[], reports: { label: string, json: any, meta: any }[], skipBaseline: Record<string, number>,
 *           sha: string, root: string, needs?: Record<string, { result: string }> | null, requiredJobs?: string[],
 *           checkBaselineFiles?: boolean }} input
 * @returns {{ ok: boolean, errors: string[], files: number, tests: number, skipped: number }}
 */
export function verifyReports(input) {
  const errors = [];
  if (input.needs) {
    for (const [job, v] of Object.entries(input.needs)) {
      if (v?.result !== "success") errors.push(`iş "${job}" başarılı değil: ${v?.result ?? "bilinmiyor"}`);
    }
  }
  // Beklenen iş sonucu HİÇ gelmediyse de kırmızı (boş `NEEDS_JSON` "her şey başarılı" sayılmasın).
  for (const job of input.requiredJobs ?? []) {
    if (!input.needs || !(job in input.needs)) errors.push(`iş "${job}" sonucu yok`);
  }
  if (input.reports.length === 0) errors.push("hiç rapor yok");
  const seen = new Map();
  let tests = 0;
  let skipped = 0;
  for (const rep of input.reports) {
    if (!rep.json || typeof rep.json !== "object" || !Array.isArray(rep.json.testResults)) {
      errors.push(`${rep.label}: rapor eksik ya da okunamıyor`);
      continue;
    }
    if (!rep.meta || rep.meta.sha !== input.sha) {
      errors.push(`${rep.label}: rapor bu commit'in değil (beklenen ${input.sha}, gelen ${rep.meta?.sha ?? "yok"})`);
    }
    if (rep.json.success !== true) errors.push(`${rep.label}: vitest başarısız bildirdi (başarısız dosya ya da test)`);
    if ((rep.json.numFailedTests ?? 0) > 0) errors.push(`${rep.label}: ${rep.json.numFailedTests} test başarısız`);
    for (const r of rep.json.testResults) {
      const file = relativeTestPath(r.name, input.root);
      if (seen.has(file)) errors.push(`${file}: iki raporda birden (${seen.get(file)}, ${rep.label})`);
      seen.set(file, rep.label);
      const assertions = r.assertionResults ?? [];
      if (r.status === "failed" || assertions.some((a) => a.status === "failed")) {
        errors.push(`${file}: başarısız${r.message ? ` — ${String(r.message).split("\n")[0].slice(0, 200)}` : ""}`);
      }
      if (assertions.length === 0) errors.push(`${file}: hiç test koşmadı (yükleme hatası olabilir)`);
      const s = assertions.filter((a) => SKIPPED.has(a.status)).length;
      tests += assertions.length;
      skipped += s;
      const allowed = input.skipBaseline[file] ?? 0;
      if (s > allowed) errors.push(`${file}: atlanan test ${s} > taban ${allowed}`);
    }
  }
  // Taban yalnız var olan dosyaları anlatabilir (silinen dosyanın satırı bilinçli temizlenir; yoksa taban sessizce büyür).
  const known = new Set(input.expectedFiles);
  for (const f of Object.keys(input.skipBaseline)) if (input.checkBaselineFiles && !known.has(f)) errors.push(`atlanan test tabanında olmayan dosya: ${f}`);
  const expected = known;
  for (const f of expected) if (!seen.has(f)) errors.push(`${f}: hiçbir raporda yok (kayıp dosya)`);
  for (const f of seen.keys()) if (!expected.has(f)) errors.push(`${f}: beklenmeyen dosya`);
  return { ok: errors.length === 0, errors, files: seen.size, tests, skipped };
}
