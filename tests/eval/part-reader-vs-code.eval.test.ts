import { describe, it, expect } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeVerifiedReply } from "@/lib/ai/answer-parts";
import { sourceMentionsNeed } from "@/lib/ai/answer-binding";
import { kbLine } from "@/lib/ai/retrieval/kb-line";
import { partReaderModel, partReaderReasoningEffort, runPartReader } from "@/lib/ai/semantic/part-reader";
import { ITEM_KIND_LABELS_TR, type ItemKind } from "@/lib/conversation-items/core";
import { requestTopics } from "@/lib/conversation-items/relation";
import { needTerms } from "@/lib/conversation-items/topic-absence";

// ---------------------------------------------------------------------------
// KOD ↔ OKUYUCU (Codex S3, 10-23 sabah-3): kodun anlam denetimleri ile parça okuyucusu AYNI vakada ne diyor? Set
// `evals/part-reader-vs-code.json` — hold = taslak yanlış (kodun yakalamak için yazıldığı sınıf), keep = taslak doğru (kör set incelemesinde
// kodun gereksiz tuttuğu sınıfların benzerleri). Kod kararı üretimdeki `composeVerifiedReply` ile, istekler üretimdeki gibi (`needTerms`,
// `requestTopics`, kaynak `kbLine`) kurulur. Okuyucu kolu üretimdeki girdiyle: misafirin kendi sözleri, ihtiyaç türü, dayandığı kalem + aynı
// konuyu anan öteki kalemler, önceki konuşma, bugün + konaklama günleri.
// Kod kolu her koşuda (çevrimdışı, ücretsiz). Okuyucu kolu: RUN_REAL_EVAL=1 + OPENAI_API_KEY + EVAL_PART_READER_OUT.
// ---------------------------------------------------------------------------

interface Case {
  id: string;
  kind: ItemKind;
  guest: string;
  earlier?: { from: "guest" | "host"; text: string }[];
  queries: string[];
  part: string;
  evidence: string;
  sources: { category: string; title: string; content: string }[];
  dateLine?: string;
  expect: "keep" | "hold";
  codeClass: string;
  why: string;
}
const SET = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/part-reader-vs-code.json"), "utf8")) as {
  defaultDateLine: string;
  cases: Case[];
};
const OUT = process.env.EVAL_PART_READER_OUT;
const REPEAT = Math.max(1, Math.min(5, Math.trunc(Number(process.env.EVAL_PART_READER_REPEAT) || 1)));
const run = process.env.RUN_REAL_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY) && Boolean(OUT);

function codeVerdict(c: Case, meaningJudge: "code" | "reader" = "code"): { verdict: "keep" | "hold"; issues: string[]; source: string | null; sources: { id: string; text: string }[]; need: { terms: string[]; topics: string[] } } {
  const sources = c.sources.map((s, i) => ({ id: `kb:${i + 1}`, text: kbLine(s) }));
  const need = { terms: needTerms(c.queries), topics: requestTopics(c.queries[0] ?? "", c.queries[1] ?? "", c.kind) };
  const composed = composeVerifiedReply({
    parts: [{ ref: "R1", status: "answered", text: c.part, evidence: c.evidence }],
    needs: [{ ref: "R1", terms: need.terms, topics: need.topics, queries: c.queries }],
    sources,
    meaningJudge,
  });
  const v = composed.verdicts[0];
  if (v?.status === "verified") return { verdict: "keep", issues: [], source: v.source, sources, need };
  return { verdict: "hold", issues: v && v.status === "rejected" ? v.issues : [v?.status ?? "missing"], source: null, sources, need };
}

describe("KOD ↔ OKUYUCU — anlam denetimi karşılaştırması", () => {
  it("set biçimi + kod kolu (çevrimdışı): her vaka kod kararı üretir", () => {
    expect(SET.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(SET.cases.map((c) => c.id)).size).toBe(SET.cases.length);
    const rows = SET.cases.map((c) => ({ id: c.id, expect: c.expect, ...codeVerdict(c) }));
    const wrongPass = rows.filter((r) => r.expect === "hold" && r.verdict === "keep");
    const needless = rows.filter((r) => r.expect === "keep" && r.verdict === "hold");
    console.log(
      `[kod] ${rows.length} vaka · YANLIŞ GEÇİŞ ${wrongPass.length} (${wrongPass.map((r) => r.id).join(",") || "-"}) · GEREKSİZ TUTMA ${needless.length} (${needless.map((r) => `${r.id}:${r.issues.join("+")}`).join(",") || "-"})`,
    );
    for (const r of rows) expect(["keep", "hold"]).toContain(r.verdict);
    // Okuyucu kipinde kodda kalan denetimler (Codex S3): doğru cevabı tutmamalı; kötü taslağın yalnız sayı / kaynak hatalısını tutar.
    const kept = SET.cases.map((c) => ({ id: c.id, expect: c.expect, ...codeVerdict(c, "reader") }));
    const keptNeedless = kept.filter((r) => r.expect === "keep" && r.verdict === "hold");
    console.log(
      `[kod, okuyucu kipi] doğru cevabı tutan ${keptNeedless.length} (${keptNeedless.map((r) => `${r.id}:${r.issues.join("+")}`).join(",") || "-"}) · kötü taslağı tek başına tutan ${kept.filter((r) => r.expect === "hold" && r.verdict === "hold").length} / ${kept.filter((r) => r.expect === "hold").length}`,
    );
    expect(keptNeedless).toEqual([]);
  });

  it.skipIf(!run)(
    "okuyucu kolu (gerçek model): aynı vakalar, kodun kararıyla yan yana",
    async () => {
      const rows: { id: string; expect: string; codeClass: string; code: string; codeIssues: string[]; reader: string[]; ms: number[] }[] = [];
      for (const c of SET.cases) {
        const code = codeVerdict(c);
        // Okuyucu üretimde YALNIZ kodun geçirdiği parçayı okur; burada her parçayı okur (kod tutsaydı okuyucu ne derdi — taşıma kararının sorusu).
        // Dayanak kalem: kodun bulduğu ya da (kod tuttuysa) alıntıyı içeren ilk kalem.
        const primary =
          code.sources.find((s) => s.id === code.source) ?? code.sources.find((s) => s.text.includes(c.evidence)) ?? code.sources[0]!;
        const related = code.sources.filter((s) => s !== primary && sourceMentionsNeed(s.text, code.need.terms, code.need.topics));
        const reader: string[] = [];
        const ms: number[] = [];
        for (let i = 0; i < REPEAT; i++) {
          const started = Date.now();
          const out = await runPartReader({
            dateLine: c.dateLine ?? SET.defaultDateLine,
            guestMessage: c.guest,
            earlierConversation: c.earlier ?? [],
            parts: [
              {
                ref: "R1",
                request: c.queries[c.queries.length - 1] ?? "",
                topic: ITEM_KIND_LABELS_TR[c.kind],
                text: c.part,
                notes: [primary.text, ...related.map((s) => s.text)],
              },
            ],
          });
          ms.push(Date.now() - started);
          reader.push(out.status !== "ok" ? "failed" : (out.holds.get("R1") ?? "keep"));
        }
        rows.push({ id: c.id, expect: c.expect, codeClass: c.codeClass, code: code.verdict, codeIssues: code.issues, reader, ms });
      }
      const v = (g: string) => (g === "keep" ? "keep" : g === "failed" ? "failed" : "hold");
      const flat = rows.flatMap((r) => r.reader.map((g) => ({ ...r, got: v(g), reason: g })));
      const readerWrongPass = flat.filter((x) => x.expect === "hold" && x.got === "keep");
      const readerNeedless = flat.filter((x) => x.expect === "keep" && x.got === "hold");
      const codeWrongPass = rows.filter((r) => r.expect === "hold" && r.code === "keep");
      const codeNeedless = rows.filter((r) => r.expect === "keep" && r.code === "hold");
      // Kod tutup okuyucunun da tuttuğu doğru tutmalar (taşınırsa yine yakalanır) — S3 kararının asıl sayısı.
      const codeCatchesReaderAlsoHolds = rows.filter((r) => r.expect === "hold" && r.code === "hold" && r.reader.every((g) => v(g) === "hold"));
      const codeCatchesReaderMisses = rows.filter((r) => r.expect === "hold" && r.code === "hold" && r.reader.some((g) => v(g) === "keep"));
      const arm = `${partReaderModel()}/${partReaderReasoningEffort() ?? "(varsayılan)"}`;
      mkdirSync(path.dirname(OUT!), { recursive: true });
      writeFileSync(OUT!, JSON.stringify({ arm, repeat: REPEAT, rows }, null, 1));
      console.log(
        `[kod↔okuyucu] kol ${arm} · ${rows.length} vaka × ${REPEAT}\n` +
          `  KOD: yanlış geçiş ${codeWrongPass.length} (${codeWrongPass.map((r) => r.id).join(",") || "-"}) · gereksiz tutma ${codeNeedless.length} (${codeNeedless.map((r) => `${r.id}:${r.codeIssues.join("+")}`).join(",") || "-"})\n` +
          `  OKUYUCU: yanlış geçiş ${readerWrongPass.length} (${[...new Set(readerWrongPass.map((x) => x.id))].join(",") || "-"}) · gereksiz tutma ${readerNeedless.length} (${readerNeedless.map((x) => `${x.id}:${x.reason}`).join(",") || "-"}) · düşen ${flat.filter((x) => x.got === "failed").length}\n` +
          `  kodun doğru tuttuğu ${rows.filter((r) => r.expect === "hold" && r.code === "hold").length} vakanın okuyucu da hep tuttuğu ${codeCatchesReaderAlsoHolds.length}; kaçırdığı ${codeCatchesReaderMisses.length} (${codeCatchesReaderMisses.map((r) => `${r.id}[${r.codeClass}]`).join(",") || "-"})`,
      );
      expect(rows.length).toBe(SET.cases.length);
    },
    1_800_000,
  );
});
