/* ---------------------------------------------------------------------------
 * OLUMLULUK TABLOSU — ÜCRETSİZ ÖLÇÜM (model yok, veritabanı yok; kurucu S-2, 26 Kasım: "önce kontrol et").
 *
 *   npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/polarity-table-replay.ts
 *
 * `evals/olumluluk-tablosu.json` satırları ürünün BUGÜNKÜ kod denetiminden (`composeVerifiedReply`, okuyucu kipi) ve "yalnız emin olduğunda
 * tut" adaylarından (`polarity-table-core.ts` `CANDIDATES`) geçirilir. Sayılar: doğru tutma · haksız tutma (yanlış alarm) · kaçırma (ters
 * cevabı kodun geçirmesi; okuyucu ayrıca okuyabilir — ücretli ölçer `part-reader-strength.ts`). Kırılım: grup, dil, biçim.
 * Hangi olumluluk DALININ tetiklendiği ürün kodu değiştirilmeden görülemez; rapor (`docs/olcum/olumluluk-ve-model-gucu-2026-11-26.md` §2)
 * depo dışında, tek seferlik etiketli bir kopyayla yapılan tespiti yazar.
 * Çıktı: `docs/olcum/olumluluk-tablosu-2026-11-26.json` (satır başına hüküm + özet).
 * ------------------------------------------------------------------------- */

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  CANDIDATES,
  REPO,
  candidateVerdict,
  featuresOf,
  loadTable,
  outcomeOf,
  productVerdict,
  type CandidateName,
  type TableRow,
} from "./polarity-table-core";

const OUT = path.join(REPO, "docs", "olcum", "olumluluk-tablosu-2026-11-26.json");

type Outcome = ReturnType<typeof outcomeOf>;
const empty = (): Record<Outcome, number> => ({ dogru_tutma: 0, haksiz_tutma: 0, kacirma: 0, dogru_gecirme: 0 });

function main() {
  const table = loadTable();
  const names = Object.keys(CANDIDATES) as CandidateName[];
  const perRow: unknown[] = [];
  const totals = Object.fromEntries(names.map((n) => [n, empty()])) as Record<CandidateName, Record<Outcome, number>>;
  const byKey: Record<string, Record<CandidateName, Record<Outcome, number>>> = {};
  const bump = (key: string, n: CandidateName, o: Outcome) => {
    byKey[key] ??= Object.fromEntries(names.map((x) => [x, empty()])) as Record<CandidateName, Record<Outcome, number>>;
    byKey[key][n][o]++;
  };
  let reproduced = 0;
  let observed = 0;
  for (const row of table.rows) {
    const v = productVerdict(table, row);
    const f = featuresOf(table, row);
    if (row.observedIssues) {
      observed++;
      if (JSON.stringify(v.issues) === JSON.stringify(row.observedIssues) && JSON.stringify(v.advisory) === JSON.stringify(row.observedAdvisory ?? [])) reproduced++;
    }
    const decisions: Record<string, { held: boolean; issues: string[]; outcome: Outcome }> = {};
    for (const n of names) {
      const cv = candidateVerdict(row, v, CANDIDATES[n](f));
      const o = outcomeOf(row, cv);
      decisions[n] = { held: cv.held, issues: cv.issues, outcome: o };
      totals[n][o]++;
      for (const key of [`grup:${row.group}`, `dil:${row.partLang}`, `bicim:${row.form}`, `diller-arasi:${row.partLang !== row.kbLang}`]) bump(key, n, o);
    }
    perRow.push({
      id: row.id,
      group: row.group,
      expect: row.expect,
      label: row.label,
      partLang: row.partLang,
      kbLang: row.kbLang,
      form: row.form,
      part: row.part,
      evidence: row.evidence,
      product: v,
      features: { partSentencePol: f.partSentencePol, kbSentencePol: f.kbSentencePol, partClausePol: f.partClausePol, kbClausePol: f.kbClausePol, partLang: f.partLang, kbLang: f.kbLang },
      decisions,
    });
  }
  // Aday kıyası bugüne göre: geri kazanılan doğru cevap · hâlâ tutulan ters · kaçan ters (bugün tutulup adayla geçen) · yeni kaçan.
  const rowsById = new Map(table.rows.map((r) => [r.id, r] as const));
  const compare = Object.fromEntries(
    names.map((n) => {
      let recovered = 0;
      let stillHeldReverse = 0;
      let newlyMissed = 0;
      let missedTotal = 0;
      const recoveredIds: string[] = [];
      const missedIds: string[] = [];
      for (const pr of perRow as { id: string; decisions: Record<string, { held: boolean }> }[]) {
        const row = rowsById.get(pr.id) as TableRow;
        const today = pr.decisions.bugun.held;
        const cand = pr.decisions[n].held;
        if (row.expect === "gecir" && today && !cand) {
          recovered++;
          recoveredIds.push(row.id);
        }
        if (row.expect === "tut" && cand) stillHeldReverse++;
        if (row.expect === "tut" && !cand) {
          missedTotal++;
          if (today) {
            newlyMissed++;
            missedIds.push(row.id);
          }
        }
      }
      return [n, { recovered, stillHeldReverse, missedTotal, newlyMissed, recoveredIds, newlyMissedIds: missedIds }];
    }),
  );
  const summary = { rows: table.rows.length, reproducedObserved: `${reproduced}/${observed}`, totals, compare, byKey };
  writeFileSync(OUT, `${JSON.stringify({ summary, rows: perRow }, null, 1)}\n`);
  console.log(`satır ${table.rows.length} · gözlenen 27 reddin yeniden üretimi ${reproduced}/${observed}`);
  for (const n of names) {
    const t = totals[n];
    const c = compare[n];
    console.log(
      `${n.padEnd(28)} doğru tutma ${t.dogru_tutma} · haksız tutma ${t.haksiz_tutma} · kaçırma ${t.kacirma} · doğru geçirme ${t.dogru_gecirme}` +
        ` | geri kazanılan ${c.recovered} · hâlâ tutulan ters ${c.stillHeldReverse} · kaçan ters ${c.missedTotal} (bugüne göre yeni ${c.newlyMissed})`,
    );
  }
  console.log(`→ ${path.relative(REPO, OUT)}`);
}

main();
