/* ---------------------------------------------------------------------------
 * PARÇA OKUYUCUSUNUN ANLAMA / BAĞLAM GÜCÜ — ÜCRETLİ küçük ölçüm (kurucu 26 Kasım: "modelin anlama bağlam gücünü test et";
 * S-2 "önce kontrol et").
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx --tsconfig tests/workers/tsconfig.json tests/eval/part-reader-strength.ts [--dry] [--runs 2] [--budget 3.8]
 *       [--sets olumluluk,celiski,dil,maske,eksik]
 *
 * Soru: kodun emin olmadığı kararları okuyucuya bırakırsak okuyucu doğru karar veriyor mu? ÜRÜNÜN KENDİ okuyucusu çağrılır
 * (`runPartReader`, istem `PART_READER_SYSTEM_PROMPT`, model / çaba ürünün ortam değişkenlerinden — `partReaderModel()`); istem DEĞİŞMEZ.
 * Ek soru kolları (çelişki, dil) ürün dosyasına YAZILMAZ: yalnız bu betiğin `fetch` sarmalayıcısında isteğe tek bir alan + tek bir cümle
 * eklenir ve açıkça "ek soru kolu" diye raporlanır. Maske kolu: ürünün okuyucuya gönderdiği notlar (`redactForSemanticModel`) ile aynı
 * vakanın maskesiz notları — maskesiz hâl de yalnız sarmalayıcıda kurulur.
 *
 * Vakalar: `evals/olumluluk-tablosu.json` (Görev A, "olumluluk" kümesi) + `evals/okuyucu-gucu-vakalari.json` (çelişki · dil · maske ·
 * eksik). Her vaka `--runs` kez (varsayılan 2). Hüküm: okuyucu parçayı TUTTU mu (ürünün `partReaderHolds` kuralı; okuyucu düşerse tutar
 * — ayrı sayılır). Bütçe sayacı: sağlayıcının bildirdiği belirteçlerle liste fiyatı (`reply-scoring.ts` `PRICES`); tavana yaklaşınca yeni
 * çağrı başlatılmaz, rapor eksik koşuyu söyler.
 * Anahtar ortamdan (`OPENAI_API_KEY`); değeri hiçbir yere yazılmaz. Çıktı: `docs/olcum/okuyucu-gucu-2026-11-26.json`.
 * ------------------------------------------------------------------------- */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPartReaderUserContent, partReaderModel, partReaderReasoningEffort, runPartReader, type PartReaderInput } from "../../src/lib/ai/semantic/part-reader";
import { redactForSemanticModel } from "../../src/lib/ai/semantic/redact";
import { fenceSafe } from "../../src/lib/ai/semantic/fence";
import { groundEvidence } from "../../src/lib/ai/answer-parts";
import { sourceMentionsNeed } from "../../src/lib/ai/answer-binding";
import { ITEM_KIND_LABELS_TR, type ItemKind } from "../../src/lib/conversation-items/core";
import { priceFor } from "./reply-scoring";
import { REPO, loadTable, needOf, sourcesOf, type TableRow } from "./polarity-table-core";

const CASES_PATH = path.join(REPO, "evals", "okuyucu-gucu-vakalari.json");
const OUT = path.join(REPO, "docs", "olcum", "okuyucu-gucu-2026-11-26.json");

type Arm = "urun" | "celiski_soru" | "dil_soru" | "maskesiz";
interface Case {
  set: "olumluluk" | "celiski" | "dil" | "maske" | "eksik";
  id: string;
  guestMessage: string;
  request: string;
  topic: string;
  part: string;
  notes: string[];
  expect: "tut" | "gecir";
  reason: string;
  guestLang: string;
  partLang: string;
  control?: boolean;
  label?: string;
  form?: string;
}

// ─── ek soru kolları (YALNIZ bu betikte; ürün istemi değişmez) ─────────────────────────────────────────────────────────────────
export const CONFLICT_FIELD = "notes_conflict";
export const CONFLICT_EXTRA =
  "notes_conflict = true when two of the NOTES give different, incompatible values or rules for the thing this part talks about (two " +
  "different passwords, two different opening hours, free in one note and charged in another, collected on some days in one note and every " +
  "day in another). false when the notes agree, repeat the same value, or only add to each other (a general rule and its exception, a rule " +
  "and its fee).";
export const LANG_FIELD = "in_guest_language";
export const LANG_EXTRA =
  "in_guest_language = true when the part is written in the language the guest wrote this turn's message in (names, addresses, codes and " +
  "passwords do not count). false when the part, or any sentence of it, is in another language (a part in Turkish to a guest who wrote in " +
  "French).";

const ARGS = process.argv.slice(2);
const arg = (name: string) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 ? ARGS[i + 1] : undefined;
};
const DRY = ARGS.includes("--dry");
const RUNS = Number(arg("runs") ?? 2);
const BUDGET = Number(arg("budget") ?? 3.8);
const SETS = new Set((arg("sets") ?? "olumluluk,celiski,dil,maske,eksik").split(","));
const CONCURRENCY = 6;

function tableCases(): Case[] {
  const table = loadTable();
  return table.rows.map((row: TableRow) => {
    const sources = sourcesOf(table, row.kbSet);
    const need = needOf(row);
    // Ürünün notları (`ai/index.ts` `notesOf`): dayanak kalem ilk, ardından alıntılanan ya da konuyu anan öteki kalemler.
    const g = groundEvidence(sources, row.evidence);
    const cited = new Set((g?.cited ?? []).map((c) => c.id));
    const primary = g?.source;
    const related = sources.filter((s) => s.id !== primary?.id && (cited.has(s.id) || sourceMentionsNeed(s.text, need.terms, need.topics))).map((s) => s.text);
    return {
      set: "olumluluk" as const,
      id: row.id,
      guestMessage: row.guestMessage,
      request: need.queries[need.queries.length - 1] ?? "",
      topic: ITEM_KIND_LABELS_TR[row.request.intent as ItemKind] ?? row.request.intent,
      part: row.part,
      notes: primary ? [primary.text, ...related] : related,
      expect: row.expect,
      reason: row.reason,
      guestLang: row.partLang,
      partLang: row.partLang,
      label: row.label,
      form: row.form,
    };
  });
}

function readerInput(c: Case): PartReaderInput {
  return { guestMessage: c.guestMessage, parts: [{ ref: "R1", request: c.request, topic: c.topic, text: c.part, notes: c.notes }] };
}

/** Ürünün okuyucuya gönderdiği NOTES bloğu ↔ maskesiz hâli (yalnız sarmalayıcıda). */
function notesBlocks(c: Case): { masked: string; plain: string } {
  const joined = c.notes.join("\n---\n");
  return { masked: `NOTES: <<<${fenceSafe(redactForSemanticModel(joined, [], "ours"))}`, plain: `NOTES: <<<${fenceSafe(joined)}` };
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}
let spent = 0;
let calls = 0;
let served = "";

function costOf(model: string, u: Usage | undefined): number {
  const p = priceFor(model);
  if (!p || !u) return 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return (((u.prompt_tokens ?? 0) - cached) * p.in + cached * p.cached + (u.completion_tokens ?? 0) * p.out) / 1e6;
}

function wrappedFetch(c: Case, arm: Arm, sink: { raw?: Record<string, unknown> }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages: { role: string; content: string }[];
      response_format: { json_schema: { schema: { properties: { parts: { items: { required: string[]; properties: Record<string, unknown> } } } } } };
    };
    const items = body.response_format.json_schema.schema.properties.parts.items;
    if (arm === "celiski_soru" || arm === "dil_soru") {
      const [field, extra] = arm === "celiski_soru" ? [CONFLICT_FIELD, CONFLICT_EXTRA] : [LANG_FIELD, LANG_EXTRA];
      body.messages[0].content = body.messages[0].content.replace(/\nquote: /, `\n${extra}\n\nquote: `);
      items.properties[field] = { type: "boolean" };
      items.required = [...items.required, field];
    }
    if (arm === "maskesiz") {
      const { masked, plain } = notesBlocks(c);
      if (!body.messages[1].content.includes(masked)) throw new Error(`maske bloğu bulunamadı: ${c.id}`);
      body.messages[1].content = body.messages[1].content.replace(masked, plain);
    }
    const res = await fetch(url, { ...init, body: JSON.stringify(body) });
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { model?: string; usage?: Usage; choices?: { message?: { content?: string } }[] };
      calls++;
      served = data.model ?? served;
      spent += costOf(data.model ?? "", data.usage);
      const content = data.choices?.[0]?.message?.content;
      const parsed = content ? (JSON.parse(content) as { parts?: Record<string, unknown>[] }) : undefined;
      sink.raw = parsed?.parts?.[0];
    } catch {
      /* gövde okunamadı → ürün kuralıyla "okuyucu düştü" sayılır */
    }
    return new Response(text, { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
}

interface Result {
  set: string;
  id: string;
  arm: Arm;
  run: number;
  expect: string;
  held: boolean;
  failed: boolean;
  productHold: string | null;
  extraField: boolean | null;
  raw: Record<string, unknown> | null;
}

async function runOne(c: Case, arm: Arm, run: number): Promise<Result> {
  const sink: { raw?: Record<string, unknown> } = {};
  const outcome = await runPartReader({ ...readerInput(c), fetchImpl: wrappedFetch(c, arm, sink) });
  const failed = outcome.status !== "ok";
  const productHold = outcome.status === "ok" ? (outcome.holds.get("R1") ?? null) : "unread";
  const field = arm === "celiski_soru" ? CONFLICT_FIELD : arm === "dil_soru" ? LANG_FIELD : null;
  const extraField = field && sink.raw && typeof sink.raw[field] === "boolean" ? (sink.raw[field] as boolean) : null;
  const extraHold = arm === "celiski_soru" ? extraField === true : arm === "dil_soru" ? extraField === false : false;
  return { set: c.set, id: c.id, arm, run, expect: c.expect, held: productHold !== null || extraHold, failed, productHold, extraField, raw: sink.raw ?? null };
}

/** Kollar: her vaka ürünün okuyucusuyla; çelişki / dil kümesinde ek soru kolu; maske kümesinde ve notları maskelenen her vakada maskesiz kol. */
function armsFor(c: Case): Arm[] {
  if (c.set === "celiski") return ["urun", "celiski_soru"];
  if (c.set === "dil") return ["urun", "dil_soru"];
  if (c.set === "maske" || buildPartReaderUserContent(readerInput(c)).includes("[REDACTED")) return ["urun", "maskesiz"];
  return ["urun"];
}

async function main() {
  const extra = (JSON.parse(readFileSync(CASES_PATH, "utf8")) as { cases: Case[] }).cases;
  const all = [...tableCases(), ...extra].filter((c) => SETS.has(c.set));
  // Maske denetimi (ücretsiz): ürünün okuyucuya göndereceği içerikte notlar / parça maskeli mi ("[REDACTED…]" — alan maskesi de, notun
  // geri kalanını silen "[REDACTED_UNPARSEABLE_JSON]" de). Maske kümesi dışında maskelenen vaka da listelenir (ölçümü etkiler).
  const maskCheck = all
    .filter((c) => c.set === "maske" || buildPartReaderUserContent(readerInput(c)).includes("[REDACTED"))
    .map((c) => {
      const content = buildPartReaderUserContent(readerInput(c));
      const notesLine = content.split("\n").find((l) => l.startsWith("NOTES: ")) ?? "";
      const partLine = content.split("\n").find((l) => l.startsWith("PART: ")) ?? "";
      return { id: c.id, notesRedacted: notesLine.includes("[REDACTED"), partRedacted: partLine.includes("[REDACTED"), notesLine, partLine };
    });
  const jobs: { c: Case; arm: Arm; run: number }[] = [];
  for (let run = 1; run <= RUNS; run++) for (const c of all) for (const arm of armsFor(c)) jobs.push({ c, arm, run });
  console.log(`model ${partReaderModel()} · çaba ${partReaderReasoningEffort() ?? "(gönderilmez)"} · vaka ${all.length} · çağrı ${jobs.length} · bütçe $${BUDGET}`);
  for (const m of maskCheck) console.log(`maske ${m.id} [${all.find((c) => c.id === m.id)?.set}]: notlar ${m.notesRedacted ? "MASKELİ" : "açık"} · parça ${m.partRedacted ? "MASKELİ" : "açık"}`);
  if (ARGS.includes("--show")) for (const m of maskCheck) console.log(m.id, m.notesLine);
  if (DRY) return;
  const results: Result[] = [];
  let next = 0;
  let stopped = false;
  const worker = async () => {
    for (;;) {
      const j = jobs[next++];
      if (!j) return;
      if (spent >= BUDGET) {
        stopped = true;
        return;
      }
      results.push(await runOne(j.c, j.arm, j.run));
      if (results.length % 25 === 0) console.log(`${results.length}/${jobs.length} · $${spent.toFixed(3)}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // --merge: önceki çıktının BU koşuda koşulmayan kümeleri (sonuç, vaka, maliyet) korunur; koşulan kümeler baştan yazılır (vaka düzeltmesi
  // sonrası yalnız o kümeyi yeniden koşmak için). Maliyet iki koşunun toplamıdır.
  const prev = ARGS.includes("--merge") ? (JSON.parse(readFileSync(OUT, "utf8")) as { meta: { costUsd: number; calls: number }; cases: Record<string, Case>; results: Result[]; maskCheck: unknown[] }) : null;
  const keptResults = prev ? prev.results.filter((r) => !SETS.has(r.set)) : [];
  const keptCases = prev ? Object.fromEntries(Object.entries(prev.cases).filter(([, c]) => !SETS.has(c.set))) : {};
  if (prev) {
    spent += prev.meta.costUsd;
    calls += prev.meta.calls;
    results.unshift(...keptResults);
  }
  const cases = { ...keptCases, ...Object.fromEntries(all.map((c) => [`${c.set}:${c.id}`, c])) };
  writeFileSync(
    OUT,
    `${JSON.stringify({ meta: { model: partReaderModel(), served, reasoningEffort: partReaderReasoningEffort() ?? null, runs: RUNS, calls, costUsd: Number(spent.toFixed(4)), budgetUsd: BUDGET, stoppedByBudget: stopped, jobs: jobs.length, done: results.length - keptResults.length, merged: prev !== null, conflictExtra: CONFLICT_EXTRA, langExtra: LANG_EXTRA }, maskCheck, cases, results }, null, 1)}\n`,
  );
  console.log(`bitti: ${results.length - keptResults.length}/${jobs.length} çağrı · $${spent.toFixed(3)}${stopped ? " · BÜTÇE TAVANI" : ""} → ${path.relative(REPO, OUT)}`);
}

void main();
