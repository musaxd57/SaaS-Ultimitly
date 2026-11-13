import { needMetrics, scoreNeeds, type NeedResult, type NeedSpec } from "./need-scoring";
import { armText, checkRequest, isRawResult, type RawArm, type RawCheckIssue, type RawNote } from "./raw-arm";

// ---------------------------------------------------------------------------
// HAM MODEL KOLU — PUANLAMA ÇEKİRDEĞİ (saf; dosya / ağ / saat okumaz).
//
// Ham çıktıları (`scripts/claude-work/run.ts` `raw_baseline`) GELİŞTİRME setlerinin insan yazımı ihtiyaç listesiyle, ürün ölçerinin AYNI
// cetveliyle (`need-scoring.ts`) puanlar; üç kol yan yana: ham (kapısız) · ham + yalnız mekanik denetim · ham + mekanik + modelin varlık /
// koşul beyanı. Dosyaları okuyan / raporu yazan ince kabuk: `tests/eval/raw-arm-report.ts` (komut satırı). Pinler: `raw-arm.eval.test.ts`.
//
// Neden test dosyasında değil (11-13, CI 1797): rapor üreticisi "ortam değişkeni yoksa atla" diye yazılmış bir testti; CI dosya başına atlanan
// test sayısını tabanla kıyaslar ve yeni atlamaya izin vermez (`scripts/ci-verify-core.mjs`). Ölçüm aracı test değildir: atlanan test olarak
// durmaz, çekirdeği burada HER koşuda sınanır.
//
// 🚨 Yalnız geliştirme setleri (aşağıdaki sabit liste). Mühürlü / kör setler bu ölçere hiç girmez.
// ---------------------------------------------------------------------------

export const RAW_DEV_SETS = ["grounding-dev", "turn-messages-dev"] as const;

export const RAW_ARMS: readonly { arm: RawArm; label: string }[] = [
  { arm: "raw", label: "ham model (kapısız)" },
  { arm: "mechanical", label: "ham + yalnız mekanik denetim (alıntı notta · sayı alıntıda)" },
  { arm: "declared", label: "ham + mekanik + modelin varlık / koşul beyanı" },
];

export interface RawDevSet {
  property: Record<string, unknown>;
  kbSets: Record<string, RawNote[]>;
  scenarios: { id: string; class?: string; lang?: string; kb: string; message: string; expect: { needs?: NeedSpec[] } }[];
}

export interface RawRow {
  id: string;
  result: unknown;
  model?: string | null;
}

export interface RawSetScore {
  scenarios: number;
  /** Ham çıktısı hiç olmayan senaryo (ölçüme girmez, ayrı sayılır). */
  missing: number;
  /** Ham çıktısı şema dışı olan senaryo (ölçüme girmez, ayrı sayılır). */
  malformed: number;
  /** Modelin çıkardığı istek sayısı (puanlanan senaryolarda). */
  requests: number;
  metrics: Record<RawArm, ReturnType<typeof needMetrics>>;
  /** Denetimin düşürdüğü cümleler: sebep → sayı ("cevap değil" kararı sayılmaz — o bir düşürme değildir). */
  issueCounts: Partial<Record<RawCheckIssue, number>>;
  detail: Record<string, unknown>[];
}

/** Bir geliştirme setini üç kolda puanlar. */
export function scoreRawSet(data: RawDevSet, rows: readonly RawRow[]): RawSetScore {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const propertyJson = JSON.stringify(data.property);
  const perArm = new Map<RawArm, NeedResult[]>(RAW_ARMS.map((a) => [a.arm, []]));
  const issueCounts: Partial<Record<RawCheckIssue, number>> = {};
  const detail: Record<string, unknown>[] = [];
  let missing = 0;
  let malformed = 0;
  let requests = 0;
  for (const s of data.scenarios) {
    const row = byId.get(s.id);
    if (!row) {
      missing += 1;
      continue;
    }
    if (!isRawResult(row.result)) {
      malformed += 1;
      continue;
    }
    const result = row.result;
    const notes = data.kbSets[s.kb] ?? [];
    const needs = s.expect.needs ?? [];
    const checks = result.requests.map((r) => ({ request: r.request_tr, decision: r.decision, issues: checkRequest(r, notes, propertyJson) }));
    requests += result.requests.length;
    for (const c of checks) for (const i of c.issues) if (i !== "not_answer") issueCounts[i] = (issueCounts[i] ?? 0) + 1;
    const armOut: Record<string, unknown> = {};
    for (const { arm } of RAW_ARMS) {
      const text = armText(result, arm, notes, propertyJson);
      const scored = scoreNeeds(needs, text, []);
      perArm.get(arm)!.push(...scored);
      armOut[arm] = { text, needs: scored.map((n) => `${n.kind}:${n.want}${n.wrongAnswered ? "✖YANLIŞ" : n.textOk ? "✔" : "✖"}`) };
    }
    detail.push({ id: s.id, class: s.class ?? null, message: s.message, checks, arms: armOut });
  }
  const metrics = Object.fromEntries(RAW_ARMS.map(({ arm }) => [arm, needMetrics(perArm.get(arm)!)])) as RawSetScore["metrics"];
  return { scenarios: data.scenarios.length, missing, malformed, requests, metrics, issueCounts, detail };
}

/** Puanlanan senaryo sayısı (rapor boş çıkmasın denetimi için). */
export function scoredScenarios(score: RawSetScore): number {
  return score.scenarios - score.missing - score.malformed;
}

export interface RawReport {
  /** Markdown satırları. */
  lines: string[];
  /** Yan dosya (ayrıntı). */
  sidecar: { label: string; sets: Record<string, RawSetScore> };
  /** Ham çıktısı bulunan ve puanlanan set sayısı. */
  scoredSets: number;
  /** Ham çıktısı var ama tek senaryosu bile puanlanamayan setler (koşu yeşil sayılmaz). */
  emptySets: string[];
}

/** Rapor adına giren etiket (ör. model adı): dosya adına uygun karakterlere iner. */
export function reportLabel(raw: string | undefined): string {
  return (raw?.trim() || "model").replace(/[^a-z0-9.-]+/gi, "-");
}

/** Setlerin puanından raporu kurar. `scores[set] === null` → o setin ham çıktısı yok (atlandı). */
export function renderRawReport(label: string, scores: Readonly<Record<string, RawSetScore | null>>): RawReport {
  const lines: string[] = [
    `# Ham model kolu — ${label}`,
    "",
    "Aynı misafir mesajı + aynı notlarla, ürünün kapıları olmadan modelin kendi kararı; ürün ölçerinin ihtiyaç cetveliyle (`tests/eval/need-scoring.ts`) puanlandı.",
    "Kollar: ham (hiçbir denetim) · yalnız kodun sınayabildiği denetim · ek olarak modelin varlık / koşul beyanı. Sözcük / kök sözlüğü yok.",
    "Ürün kolundan farkı: ham kolda öğe defteri yoktur — yalnız GİDEN METİN puanlanır; ürün kolunda ek olarak \"öğe cevaplandı sayıldı ama değer gitmedi\" yanlışı da sayılır.",
    "",
  ];
  const sidecar: RawReport["sidecar"] = { label, sets: {} };
  const emptySets: string[] = [];
  let scoredSets = 0;
  for (const set of RAW_DEV_SETS) {
    const score = scores[set] ?? null;
    if (score === null) {
      lines.push(`## ${set}`, "", "ham çıktı yok — atlandı", "");
      continue;
    }
    lines.push(`## ${set}`, "", `Senaryo ${score.scenarios} · ham çıktısı olmayan ${score.missing} · biçimi bozuk ${score.malformed} · modelin çıkardığı istek ${score.requests}`, "");
    lines.push("| Kol | Doğru cevap | Gereksiz tutma | Açık kaldı | 🚨 Yanlış gönderim |", "|---|---|---|---|---|");
    for (const { arm, label: armLabel } of RAW_ARMS) {
      const m = score.metrics[arm];
      lines.push(`| ${armLabel} | ${m.answeredOk} / ${m.answered} | ${m.needlessHold} | ${m.openOk} / ${m.open} | **${m.wrong}** |`);
    }
    lines.push("", `Denetimin düşürdüğü cümleler (sebep → sayı): ${Object.entries(score.issueCounts).map(([k, v]) => `${k} ${v}`).join(" · ") || "yok"}`, "");
    sidecar.sets[set] = score;
    if (scoredScenarios(score) > 0) scoredSets += 1;
    else emptySets.push(set);
  }
  return { lines, sidecar, scoredSets, emptySets };
}
