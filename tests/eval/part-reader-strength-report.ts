/* ---------------------------------------------------------------------------
 * PARÇA OKUYUCUSU GÜCÜ — sonuç özeti (model YOK; `part-reader-strength.ts` çıktısını ve olumluluk tablosunu okur).
 *
 *   npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/part-reader-strength-report.ts
 *
 * Küme × kol başına: doğru karar oranı (koşu başına ortalama), kararsız vaka (koşular arasında hüküm değişen), yanlış "geçir" (beklenen
 * "tut", okuyucu tutmadı — en tehlikeli sınıf; vaka ve koşu sayısı), haksız tutma, okuyucunun düştüğü çağrı. Dil kırılımı.
 * Birleşik hat (olumluluk kümesi): kodun hükmü (bugün ve her aday) TUTARSA tutulur, geçirirse okuyucunun hükmü — ürünün sırasıyla aynı
 * (okuyucu yalnız kodun geçirdiği parçayı okur). Çıktı: `docs/olcum/okuyucu-gucu-ozet-2026-11-26.json`.
 * 11-26 akşamüstü: `--in <dosya> --out <dosya>` (docs/olcum altında; varsayılan yeni koşu `…-b`). Birleşik hatta ürünün YENİ hükmü
 * (`urun_okuyucu_varken`: okuyucu okurken kodun tuttuğu) da sayılır; adaylar eski hükmü (`readerMissingVerdict`) sarar.
 * ------------------------------------------------------------------------- */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CANDIDATES, REPO, candidateVerdict, featuresOf, loadTable, productVerdict, readerMissingVerdict, type CandidateName } from "./polarity-table-core";
import { evalRuntimeMarkdown, type EvalRuntime } from "./run-meta";

const argOf = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const IN = path.join(REPO, "docs", "olcum", argOf("in") ?? "okuyucu-gucu-2026-11-26-b.json");
const OUT = path.join(REPO, "docs", "olcum", argOf("out") ?? "okuyucu-gucu-ozet-2026-11-26-b.json");

interface Result {
  set: string;
  id: string;
  arm: string;
  run: number;
  expect: "tut" | "gecir";
  held: boolean;
  failed: boolean;
  productHold: string | null;
  extraField: boolean | null;
}
interface CaseInfo {
  set: string;
  id: string;
  guestLang: string;
  partLang: string;
  part: string;
  expect: "tut" | "gecir";
  control?: boolean;
  label?: string;
}

function main() {
  const data = JSON.parse(readFileSync(IN, "utf8")) as { meta: Record<string, unknown>; cases: Record<string, CaseInfo>; results: Result[] };
  const groups = new Map<string, Result[]>();
  for (const r of data.results) {
    const k = `${r.set}|${r.arm}|${r.id}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  type Agg = { cases: number; calls: number; correct: number; unstable: number; wrongPassCases: number; wrongPassCalls: number; falseHoldCases: number; failed: number; wrongPass: { id: string; passed: string; part: string }[]; unstableIds: string[] };
  const agg: Record<string, Agg> = {};
  const add = (key: string, rs: Result[], info: CaseInfo) => {
    const a = (agg[key] ??= { cases: 0, calls: 0, correct: 0, unstable: 0, wrongPassCases: 0, wrongPassCalls: 0, falseHoldCases: 0, failed: 0, wrongPass: [], unstableIds: [] });
    a.cases++;
    a.calls += rs.length;
    const ok = rs.filter((r) => (r.expect === "tut") === r.held).length;
    a.correct += ok / rs.length;
    if (new Set(rs.map((r) => r.held)).size > 1) {
      a.unstable++;
      a.unstableIds.push(info.id);
    }
    const passed = rs.filter((r) => !r.held).length;
    if (info.expect === "tut" && passed > 0) {
      a.wrongPassCases++;
      a.wrongPassCalls += passed;
      a.wrongPass.push({ id: info.id, passed: `${passed}/${rs.length}`, part: info.part });
    }
    if (info.expect === "gecir" && rs.some((r) => r.held)) a.falseHoldCases++;
    a.failed += rs.filter((r) => r.failed).length;
  };
  for (const [k, rs] of groups) {
    const [set, arm] = k.split("|");
    const info = data.cases[`${set}:${rs[0].id}`];
    add(`${set}|${arm}`, rs, info);
    add(`${set}|${arm}|dil:${info.guestLang}`, rs, info);
    add(`${set}|${arm}|beklenen:${info.expect}`, rs, info);
    if (info.label) add(`${set}|${arm}|etiket:${info.label}`, rs, info);
  }
  const rate = (a: Agg) => `${((100 * a.correct) / a.cases).toFixed(1)}%`;

  // Birleşik hat: olumluluk kümesi, "urun" kolu (notları maskelenen satırda ürünün gördüğü maskeli hâl — ürün gerçeği).
  const table = loadTable();
  const names = [...(Object.keys(CANDIDATES) as CandidateName[]), "urun_okuyucu_varken" as const];
  const combined: Record<string, { wrongPassCases: number; wrongPassCalls: number; falseHoldCases: number; meanCorrect: string; wrongPassIds: string[]; byCode: number; byReader: number }> = {};
  for (const arm of ["urun", "maskesiz_varsa"]) {
    for (const n of names) {
      let wrongPassCases = 0;
      let wrongPassCalls = 0;
      let falseHoldCases = 0;
      let correct = 0;
      let byCode = 0;
      let byReader = 0;
      const wrongPassIds: string[] = [];
      for (const row of table.rows) {
        const cv =
          n === "urun_okuyucu_varken" ? productVerdict(table, row) : candidateVerdict(row, readerMissingVerdict(table, row), CANDIDATES[n](featuresOf(table, row)));
        const plain = groups.get(`olumluluk|maskesiz|${row.id}`);
        const rs = (arm === "maskesiz_varsa" && plain ? plain : groups.get(`olumluluk|urun|${row.id}`)) ?? [];
        if (rs.length === 0) continue;
        const finals = rs.map((r) => cv.held || r.held);
        const passed = finals.filter((h) => !h).length;
        correct += finals.filter((h) => h === (row.expect === "tut")).length / finals.length;
        if (row.expect === "tut") {
          if (cv.held) byCode++;
          else if (passed < finals.length) byReader++;
          if (passed > 0) {
            wrongPassCases++;
            wrongPassCalls += passed;
            wrongPassIds.push(`${row.id} (${passed}/${finals.length})`);
          }
        } else if (finals.some((h) => h)) falseHoldCases++;
      }
      combined[`${arm}|${n}`] = { wrongPassCases, wrongPassCalls, falseHoldCases, meanCorrect: `${((100 * correct) / table.rows.length).toFixed(1)}%`, wrongPassIds, byCode, byReader };
    }
  }
  // Koşu kimliği ölçüm dosyasından AYNEN taşınır (bu betik model çağırmaz; kimlik ölçümün yapıldığı koşunundur).
  const runtime = (data as { runtime?: EvalRuntime }).runtime ?? null;
  writeFileSync(
    OUT,
    `${JSON.stringify({ runtime, runtimeMarkdown: runtime ? evalRuntimeMarkdown(runtime) : null, meta: data.meta, agg, combined }, null, 1)}\n`,
  );
  for (const [k, a] of Object.entries(agg)) {
    if (k.split("|").length !== 2) continue;
    console.log(
      `${k.padEnd(24)} vaka ${a.cases} · doğru ${rate(a)} · kararsız ${a.unstable} · yanlış geçir ${a.wrongPassCases} vaka / ${a.wrongPassCalls} çağrı · haksız tutma ${a.falseHoldCases} vaka · düşen ${a.failed}`,
    );
  }
  for (const [k, c] of Object.entries(combined))
    console.log(`birleşik ${k.padEnd(40)} doğru ${c.meanCorrect} · yanlış geçir ${c.wrongPassCases} vaka / ${c.wrongPassCalls} çağrı · haksız tutma ${c.falseHoldCases} · ters: kod tuttu ${c.byCode}, okuyucu tuttu ${c.byReader}`);
  console.log(`maliyet $${String(data.meta.costUsd)} · ${String(data.meta.calls)} çağrı → ${path.relative(REPO, OUT)}`);
}

main();
