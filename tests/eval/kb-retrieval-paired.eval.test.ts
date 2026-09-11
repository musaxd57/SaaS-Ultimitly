import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import type { KbRetrievalMode } from "@/lib/ai/retrieval/select";
import { assertsDefiniteValue, unverifiedActionClaims } from "../helpers/claim-detectors";
import { buildPairedKb, pairedInputs, type PairedInputs, type PairedScenario } from "../helpers/kb-retrieval-paired";
import { writeSidecar } from "./sidecar";

// ---------------------------------------------------------------------------
// EŞLEŞTİRİLMİŞ legacy / hibrit GERÇEK MODEL EVAL'İ (RAG dilim 3, Codex turu 3).
//
// AYNI soru + AYNI bilgi tabanı iki retrieval modunda (legacy: en yeni 30 kalem
// + 24k; hibrit: en yeni 200 + soruya göre parça) modele gider. Ölçülen:
//   · doğru kaynak İSTEMDE mi (KODDAN, modelden bağımsız)  · cevap doğru mu
//   · makbuzsuz eylem/söz var mı  · çelişkide kesin değer var mı
//   · kaynak yokken yokluk söyleniyor mu; "doğru görünen" cevap DESTEKSİZ mi
//
// 🚨 Sentetik retrieval ölçümü (`kb-retrieval-scale`: kaynak bloğa girdi mi)
// ile bu ölçüm (cevap doğru mu) AYRI raporlanır; biri ötekinin yerine geçmez.
// 🚨 Aynı kapılar: RUN_REAL_EVAL=1 + gerçek anahtar, `npm run eval` (ayrı config).
//    Anahtarsız senaryolar ATLANIR; çevrimdışı testler eşleştirmenin kendisini pinler
//    (hangi modda gold'un istemde OLMADIĞI kodla kanıtlanır).
// 🚨 LLM grader YOK. Eksik koşu "geçti" diye okunamaz (beş sayı ayrı).
// ---------------------------------------------------------------------------

const DATASET = path.resolve(__dirname, "../../evals/kb-retrieval-paired.json");
const suite = JSON.parse(readFileSync(DATASET, "utf8")) as { name: string; version: number; scenarios: PairedScenario[] };
export const MODES: readonly KbRetrievalMode[] = ["legacy", "hybrid"];

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

/** Bilgi yokluğunu söyleyen kalıplar (TR + EN; küçük harfe indirilmiş metinde). */
const ACK_ABSENCE = [
  "bilgim yok",
  "bilgi yok",
  "kayıtlı bilgi",
  "bilgim bulunmuyor",
  "kayıt yok",
  "bilgiye sahip değilim",
  "no information",
  "don't have information",
  "do not have information",
  "no record",
  "not have details",
];

type Outcome = "ok" | "failed_checks" | "invalid";
type ReplyResult = Awaited<ReturnType<typeof suggestReply>>;

export interface PairedRow {
  id: string;
  mode: KbRetrievalMode;
  question: string;
  outcome: Outcome;
  /** KODDAN: gold cümleleri istem bloğunda mı (gold yoksa null). */
  goldInPrompt: boolean | null;
  promptChars: number;
  fetched: number;
  selected: number;
  droppedTotal: number;
  fallback: string | null;
  reply: string;
  confidence: number | null;
  intent: string;
  riskLevel: string | null;
  declared: number | null;
  verified: number | null;
  claims: string[];
  definite: boolean | null;
  failures: string[];
  note: string;
  why: string;
}

function buildInput(s: PairedScenario, inp: PairedInputs): SuggestReplyInput {
  return {
    guestMessage: s.question,
    property: { name: "Test Dairesi", checkInTime: "15:00", checkOutTime: s.propertyCheckOutTime ?? "11:00" },
    reservation: null,
    // ÜRETİMLE AYNI: seçilen küme + düşen sayısı + seçim etiketi + notlar.
    knowledgeBase: inp.kbSel.items,
    knowledgeBaseDropped: inp.droppedTotal,
    knowledgeBaseSelection: inp.kbSel.selection,
    knowledgeBaseNotes: inp.kbSel.notes,
    history: s.history ?? [],
    tone: "warm",
    language: "tr",
  };
}

/**
 * Deterministik kontrol — MODDAN BAĞIMSIZ beklenti, KODDAN ölçülen `goldInPrompt`e
 * göre dallanır: kaynak istemdeyse cevap ona DAYANMALI; istemde değilse "doğru"
 * görünen cevap DESTEKSİZDİR ve yokluk söylenmelidir.
 */
export function check(s: PairedScenario, goldInPrompt: boolean | null, r: ReplyResult): string[] {
  const fails: string[] = [];
  const raw = r.reply ?? "";
  const reply = raw.toLocaleLowerCase("tr");
  const e = s.expect;
  const has = (w: string) => reply.includes(w.toLocaleLowerCase("tr"));
  for (const w of e.forbidden ?? []) if (has(w)) fails.push(`YASAK ifade: "${w}"`);
  if (e.noUnverifiedCommitment) {
    const c = unverifiedActionClaims(raw);
    if (c.length > 0) fails.push(`makbuzsuz eylem/söz: ${c.join(", ")}`);
  }
  if (e.noDefiniteValue && assertsDefiniteValue(raw)) fails.push("ÇELİŞKİDE KESİN DEĞER (saat / kesinlik belirteci) var");
  if (goldInPrompt === true) {
    if (e.correctAny && !e.correctAny.some(has)) fails.push(`kaynak istemdeyken cevap ona dayanmıyor (hiçbiri yok: ${e.correctAny.join(" | ")})`);
    for (const w of e.correctAll ?? []) if (!has(w)) fails.push(`kaynak istemdeyken eksik: "${w}"`);
  } else {
    const looksCorrect = (e.correctAny?.some(has) ?? false) || (e.correctAll?.every(has) ?? false);
    if ((e.correctAny || e.correctAll) && looksCorrect) fails.push("DESTEKSİZ doğru cevap: kaynak istemde yokken cevap veriyor (şans/uydurma)");
    if (e.acknowledgeAbsenceWhenGoldMissing && !ACK_ABSENCE.some((w) => reply.includes(w))) fails.push("bilgi yokluğunu SÖYLEMİYOR");
    if (e.usedSourcesEmptyWhenGoldMissing && r.usedSources.length > 0) fails.push(`kaynak beyan etti ama etmemeliydi: ${r.usedSources.join(", ")}`);
  }
  return fails;
}

function baseRow(s: PairedScenario, inp: PairedInputs): PairedRow {
  return {
    id: s.id,
    mode: inp.mode,
    question: s.question,
    outcome: "invalid",
    goldInPrompt: inp.goldInPrompt,
    promptChars: inp.promptChars,
    fetched: inp.fetched.length,
    selected: inp.kbSel.items.length,
    droppedTotal: inp.droppedTotal,
    fallback: inp.kbSel.evidence?.fb ?? null,
    reply: "",
    confidence: null,
    intent: "",
    riskLevel: null,
    declared: null,
    verified: null,
    claims: [],
    definite: null,
    failures: [],
    note: "",
    why: s.expect.why,
  };
}

/** Senaryo × mod SONUCUNU sınıflandırır — SAF, gerçek çağrı gerektirmez. */
export function pairedRow(s: PairedScenario, inp: PairedInputs, r: ReplyResult): PairedRow {
  const base = baseRow(s, inp);
  if (r.source !== "openai") return { ...base, outcome: "invalid", note: "model çağrılamadı (fallback döndü)", reply: r.reply ?? "" };
  const failures = check(s, inp.goldInPrompt, r);
  return {
    ...base,
    outcome: failures.length === 0 ? "ok" : "failed_checks",
    reply: r.reply ?? "",
    confidence: r.confidence,
    intent: r.intent,
    riskLevel: r.riskLevel ?? null,
    declared: r.sourceAudit?.declared ?? null,
    verified: r.sourceAudit?.verified ?? null,
    claims: unverifiedActionClaims(r.reply ?? ""),
    definite: assertsDefiniteValue(r.reply ?? ""),
    failures,
  };
}

export function errorRow(s: PairedScenario, inp: PairedInputs, err: unknown): PairedRow {
  return { ...baseRow(s, inp), outcome: "invalid", note: `çağrı hatası: ${(err as Error)?.name ?? "bilinmiyor"}` };
}

export interface PairedRunMeta {
  requestedModel: string | null;
  servedModel: string | null;
  commit: string | null;
  promptFingerprint: string | null;
  /** Tüm senaryo bilgi tabanlarının birleşik parmak izi — iki koşu aynı veriyi mi gördü. */
  kbFingerprint: string;
  runId: string;
  stamp: string;
}

export function kbFingerprint(scenarios: PairedScenario[]): string {
  const h = createHash("sha256");
  for (const s of scenarios) {
    for (const i of buildPairedKb(s.kb)) h.update(`${s.id}|${i.id}|${i.updatedAt.getTime()}|${i.category}|${i.title}|${i.content}\n`);
  }
  return h.digest("hex").slice(0, 12);
}

/** Aynı GÜN ikinci koşu ÖNCEKİNİ EZMEZ. */
export function pickPairedReportFileName(stamp: string, runId: string, exists: (name: string) => boolean): string {
  const plain = `eval-retrieval-${stamp}.md`;
  return exists(plain) ? `eval-retrieval-${stamp}-${runId}.md` : plain;
}

const mark = (r: PairedRow | undefined): string => (!r ? "⛔ KAYIT YOK" : r.outcome === "ok" ? "✅" : r.outcome === "failed_checks" ? "❌" : "⛔ GEÇERSİZ");
const gold = (r: PairedRow | undefined): string => (!r ? "—" : r.goldInPrompt === null ? "gold yok" : r.goldInPrompt ? "istemde" : "İSTEMDE DEĞİL");

/** Rapor gövdesi — SAF. EKSİK KOŞU BAŞARILI GÖRÜNEMEZ; eşleştirme farkı ayrı tablo. */
export function buildPairedReport(expected: number, rows: PairedRow[], meta: PairedRunMeta): string {
  const completed = rows.length;
  const ok = rows.filter((r) => r.outcome === "ok").length;
  const failed = rows.filter((r) => r.outcome === "failed_checks").length;
  const invalid = rows.filter((r) => r.outcome === "invalid").length;
  const noRecord = Math.max(0, expected - completed);
  const incomplete = invalid > 0 || noRecord > 0;
  const perMode = (m: KbRetrievalMode) => {
    const list = rows.filter((r) => r.mode === m);
    return { n: list.length, ok: list.filter((r) => r.outcome === "ok").length, failed: list.filter((r) => r.outcome === "failed_checks").length, invalid: list.filter((r) => r.outcome === "invalid").length, chars: list.length ? Math.round(list.reduce((a, r) => a + r.promptChars, 0) / list.length) : 0 };
  };
  const L = perMode("legacy");
  const H = perMode("hybrid");
  let hybridOnly = 0;
  let legacyOnly = 0;
  let bothOk = 0;
  let bothFail = 0;
  for (const s of suite.scenarios) {
    const l = rows.find((r) => r.id === s.id && r.mode === "legacy");
    const h = rows.find((r) => r.id === s.id && r.mode === "hybrid");
    if (!l || !h || l.outcome === "invalid" || h.outcome === "invalid") continue;
    if (l.outcome === "ok" && h.outcome === "ok") bothOk += 1;
    else if (l.outcome !== "ok" && h.outcome !== "ok") bothFail += 1;
    else if (h.outcome === "ok") hybridOnly += 1;
    else legacyOnly += 1;
  }
  const header = incomplete
    ? `> 🚨 **BU KOŞU EKSİK — SONUÇ "GEÇTİ" DİYE OKUNAMAZ.** ${invalid} satır geçersiz (model çağrılamadı), ${noRecord} satır hiç kayıt bırakmadı (zaman aşımı/çökme).`
    : `> Koşu tam: beklenen ${expected} satırın (senaryo × mod) hepsi tamamlandı.`;
  return `# EŞLEŞTİRİLMİŞ RETRIEVAL EVAL — ${suite.name} v${suite.version} (${meta.stamp})

> Bu dosya \`tests/eval/kb-retrieval-paired.eval.test.ts\` tarafından ÜRETİLİR; elle yazılmaz. LLM grader YOK.
> Aynı soru + aynı bilgi tabanı, iki mod: **legacy** (en yeni 30 + 24k) · **hybrid** (en yeni 200 + soruya göre parça).
> "gold" = cevabı taşıyan cümle(ler); istemde olup olmadığı KODDAN ölçülür. Kaynak istemde DEĞİLKEN "doğru" cevap DESTEKSİZ sayılır.
> 🚨 Sentetik retrieval ölçümü (kaynak bloğa girdi mi) ile bu ölçüm (cevap doğru mu) AYRIDIR; biri ötekinin yerine geçmez.
${header}

## Kanıt zinciri

| Alan | Değer |
|---|---|
| İstenen model (\`OPENAI_MODEL\`) | ${meta.requestedModel ?? "**env verilmedi** → kod içi varsayılan"} |
| Sağlayıcının bildirdiği model | ${meta.servedModel ?? "**KAYDEDİLMEDİ** — \`suggestReply\` yanıtın model kimliğini çağırana döndürmüyor"} |
| Commit | ${meta.commit ?? "(alınamadı)"} |
| İstem parmak izi (\`prompts.ts\` sha256/12) | ${meta.promptFingerprint ?? "(alınamadı)"} |
| Bilgi tabanı parmak izi (tüm senaryolar) | ${meta.kbFingerprint} |
| Koşu kimliği | ${meta.runId} |

| Beklenen (senaryo×mod) | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK |
|---|---|---|---|---|---|
| ${expected} | ${completed} | ${ok} | ${failed} | ${invalid} | ${noRecord} |

## Mod özeti

| Mod | satır | geçti | düştü | geçersiz | ort. bilgi bloğu (karakter) |
|---|---|---|---|---|---|
| legacy | ${L.n} | ${L.ok} | ${L.failed} | ${L.invalid} | ${L.chars} |
| hybrid | ${H.n} | ${H.ok} | ${H.failed} | ${H.invalid} | ${H.chars} |

Eşleştirme farkı (iki modu da geçerli senaryolar): **yalnız hibrit geçti ${hybridOnly}** · yalnız legacy geçti ${legacyOnly} · ikisi geçti ${bothOk} · ikisi düştü ${bothFail}

## Senaryo × mod

| # | Mod | gold istemde? | blok kr. | seçilen/çekilen | geri çekilme | Sonuç | intent | risk | Güven | Beyan/Doğr. | makbuzsuz | kesin değer |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${suite.scenarios
  .flatMap((s) =>
    MODES.map((m) => {
      const r = rows.find((x) => x.id === s.id && x.mode === m);
      if (!r) return `| ${s.id} | ${m} | — | — | — | — | ⛔ KAYIT YOK | — | — | — | — | — | — |`;
      return `| ${s.id} | ${m} | ${gold(r)} | ${r.promptChars} | ${r.selected}/${r.fetched} | ${r.fallback ?? "—"} | ${mark(r)} | ${r.intent || "—"} | ${r.riskLevel ?? "—"} | ${r.confidence ?? "—"} | ${r.declared ?? "—"}/${r.verified ?? "—"} | ${r.claims.length ? r.claims.join(",") : "—"} | ${r.definite === null ? "—" : r.definite ? "VAR" : "yok"} |`;
    }),
  )
  .join("\n")}

## Tam cevaplar (KIRPILMAZ)
${suite.scenarios
  .flatMap((s) =>
    MODES.map((m) => {
      const r = rows.find((x) => x.id === s.id && x.mode === m);
      if (!r) return `### ${s.id} · ${m}\n**Soru:** ${s.question}\n\n(kayıt yok — tamamlanmadı; "geçti" SAYILMAZ)\n`;
      const detail = r.outcome === "failed_checks" ? r.failures.join("; ") : r.note;
      return `### ${s.id} · ${m} (gold ${gold(r)})\n**Soru:** ${s.question}\n\n\`\`\`\n${r.reply === "" ? "(cevap yok)" : r.reply}\n\`\`\`\n${detail ? `**Not:** ${detail}\n` : ""}`;
    }),
  )
  .join("\n")}

## Düşen doğrulamaların gerekçeleri
${
  failed === 0
    ? "Yok."
    : rows
        .filter((r) => r.outcome === "failed_checks")
        .map((r) => `- **${r.id} · ${r.mode}** — ${r.why}\n  - ${r.failures.join("\n  - ")}`)
        .join("\n")
}
`;
}

const rows: PairedRow[] = [];

describe.skipIf(!enabled)(`EŞLEŞTİRİLMİŞ RETRIEVAL EVAL — ${suite.name} v${suite.version}`, () => {
  beforeAll(() => {
    console.log(`[eval-retrieval] ${suite.scenarios.length} senaryo × ${MODES.length} mod, GERÇEK model çağrısı yapılacak.`);
  });

  afterAll(() => {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const runId = `${now.toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let promptFingerprint: string | null = null;
    try {
      promptFingerprint = createHash("sha256").update(readFileSync(path.resolve(__dirname, "../../src/lib/ai/prompts.ts"))).digest("hex").slice(0, 12);
    } catch {
      /* uydurma değer YAZILMAZ */
    }
    let commit: string | null = null;
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || null;
    } catch {
      /* aynı kural */
    }
    const meta: PairedRunMeta = {
      requestedModel: process.env.OPENAI_MODEL?.trim() || null,
      servedModel: null,
      commit,
      promptFingerprint,
      kbFingerprint: kbFingerprint(suite.scenarios),
      runId,
      stamp,
    };
    const name = pickPairedReportFileName(stamp, runId, (f) => existsSync(path.join(dir, f)));
    writeFileSync(path.join(dir, name), buildPairedReport(suite.scenarios.length * MODES.length, rows, meta), "utf8");
    // Makine-okunur kopya + yol işaretleri (model kıyası markdown PARSE ETMEZ).
    writeSidecar(dir, name, { suite: suite.name, version: suite.version, meta: { ...meta }, rows });
  });

  for (const s of suite.scenarios) {
    for (const mode of MODES) {
      it(`${s.id} · ${mode} — ${s.expect.why}`, async () => {
        const inp = pairedInputs(s, mode);
        let r: ReplyResult;
        try {
          r = await suggestReply(buildInput(s, inp));
        } catch (err) {
          rows.push(errorRow(s, inp, err));
          throw err;
        }
        const row = pairedRow(s, inp, r);
        rows.push(row);
        if (row.outcome === "invalid") expect.fail(`${row.note} — bu satır GEÇERSİZ (rapora öyle yazıldı)`);
        expect(row.failures, row.failures.join("; ")).toEqual([]);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// ÇEVRİMDIŞI (gerçek çağrı YOK): eşleştirmenin kendisi + sınıflandırma + rapor.
// ---------------------------------------------------------------------------

const OPENAI_BASE = {
  intent: "parking",
  confidence: 0.85,
  source: "openai" as const,
  usedSources: ["kb:parking"] as string[],
  riskLevel: "none" as const,
  riskType: null,
  risk: null,
  priority: "standard" as const,
  actionSuggestion: null,
  detectedLanguage: "tr",
  missingInfo: [],
  statedCheckoutTime: null,
};

const META: PairedRunMeta = {
  requestedModel: "gpt-test",
  servedModel: null,
  commit: "abc1234",
  promptFingerprint: "deadbeef1234",
  kbFingerprint: "cafe00000000",
  runId: "120000-ab12",
  stamp: "2026-01-01",
};

describe("eşleştirilmiş eval — çevrimdışı pinler (gerçek çağrı YAPMAZ)", () => {
  it("ANAHTARSIZ ya da bayraksız koşmaz — sahte 'geçti' üretilmez", () => {
    if (!enabled) {
      expect(enabled).toBe(false);
      return;
    }
    expect(key.length).toBeGreaterThan(20);
  });

  it("veri seti sürümlü, kimlikler eşsiz, her senaryoda gerekçe; gold cümleleri gerçekten o senaryonun bilgi tabanında geçiyor", () => {
    expect(suite.version).toBeGreaterThanOrEqual(1);
    expect(suite.scenarios.length).toBeGreaterThanOrEqual(8);
    expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(suite.scenarios.length);
    for (const s of suite.scenarios) {
      expect(s.expect.why, s.id).toBeTruthy();
      const items = buildPairedKb(s.kb);
      for (const n of s.gold.needles) expect(items.some((i) => i.content.includes(n)), `${s.id}: "${n}"`).toBe(true);
    }
  });

  it("🚨 EŞLEŞTİRME KODLA KANITLI: eski kalemli senaryolarda gold LEGACY isteminde YOK, HİBRİT isteminde VAR; en-yeni kalemlerde ikisinde de var; bilgi-yok senaryosunda iki blok BİREBİR", () => {
    const expectPattern: Record<string, [boolean | null, boolean | null]> = {
      "R1-uzun-rehber-ortasi": [false, true],
      "R2-yazim-hatasi": [false, true],
      "R3-ingilizce-soru": [false, true],
      "R4-cok-soru": [true, true],
      "R5-celiskili-kaynak": [true, true],
      "R6-bilgi-yok": [null, null],
      "R7-turkce-esanlam": [false, true],
      "R8-konusma-baglami": [false, true],
    };
    for (const s of suite.scenarios) {
      const [legacyGold, hybridGold] = expectPattern[s.id];
      const l = pairedInputs(s, "legacy");
      const h = pairedInputs(s, "hybrid");
      expect(l.goldInPrompt, `${s.id} legacy`).toBe(legacyGold);
      expect(h.goldInPrompt, `${s.id} hybrid`).toBe(hybridGold);
      expect(l.kbSel.selection).toBe("all");
      if (s.id === "R6-bilgi-yok") {
        // Geri çekilme: hibrit tam kümeyi verir = legacy bloğu (aynı 20 kalem).
        expect(h.kbSel.evidence?.fb).toBe("no_lexical_hits");
        expect(h.promptText).toBe(l.promptText);
      } else {
        expect(h.kbSel.selection, s.id).toBe("retrieved");
        expect(h.promptChars, `${s.id} blok`).toBeLessThan(l.promptChars);
      }
    }
    // Legacy'nin kaybı bir ÖLÇÜM sonucudur, varsayım değil: 34 dolgu > 30 tavan → en eski kalem düşer.
    const r1 = pairedInputs(suite.scenarios[0], "legacy");
    expect(r1.fetched.length).toBe(30);
    expect(r1.fetched.some((i) => i.id === "kb_guide")).toBe(false);
  });

  it("R5 çelişki: hibrit iki çıkış saatini de taşır ve seçici çelişkiyi kanıta yazar (conf 1, sığmayan 0)", () => {
    const s = suite.scenarios.find((x) => x.id === "R5-celiskili-kaynak")!;
    const h = pairedInputs(s, "hybrid");
    expect(h.kbSel.evidence?.conf).toBe(1);
    expect(h.kbSel.evidence?.confDropped).toBe(0);
    expect(h.promptText).toContain("11:00");
    expect(h.promptText).toContain("12:00");
  });

  it("SINIFLANDIRMA (saf): kaynak istemdeyken dayanmayan cevap DÜŞER; kaynak istemde yokken 'doğru' cevap DESTEKSİZ sayılır, dürüst yokluk GEÇER; fallback GEÇERSİZ", () => {
    const s = suite.scenarios.find((x) => x.id === "R1-uzun-rehber-ortasi")!;
    const hyb = pairedInputs(s, "hybrid");
    const leg = pairedInputs(s, "legacy");
    // Hibrit (gold istemde) + doğru cevap → ok
    const okRow = pairedRow(s, hyb, { ...OPENAI_BASE, reply: "Aracınızı binanın arkasındaki açık otoparka ücretsiz bırakabilirsiniz." });
    expect(okRow.outcome, okRow.failures.join("; ")).toBe("ok");
    // Hibrit (gold istemde) + yokluk cevabı → dayanmadı
    const missed = pairedRow(s, hyb, { ...OPENAI_BASE, usedSources: [], reply: "Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir." });
    expect(missed.outcome).toBe("failed_checks");
    expect(missed.failures.join(" ")).toMatch(/dayanmıyor/);
    // Legacy (gold istemde DEĞİL) + dürüst yokluk → ok
    const honest = pairedRow(s, leg, { ...OPENAI_BASE, usedSources: [], reply: "Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir." });
    expect(honest.outcome, honest.failures.join("; ")).toBe("ok");
    // Legacy (gold istemde DEĞİL) + "doğru" cevap → DESTEKSİZ
    const lucky = pairedRow(s, leg, { ...OPENAI_BASE, reply: "Evet, binanın arkasındaki açık otopark ücretsiz." });
    expect(lucky.outcome).toBe("failed_checks");
    expect(lucky.failures.join(" ")).toMatch(/DESTEKSİZ/);
    // Yasak ifade her iki dalda düşer; makbuzsuz söz de.
    const fabricated = pairedRow(s, hyb, { ...OPENAI_BASE, reply: "Bina altı garajı ücretsiz kullanabilirsiniz; detayları kontrol edip size dönüş yapacağım." });
    expect(fabricated.failures.join(" ")).toMatch(/YASAK ifade/);
    expect(fabricated.failures.join(" ")).toMatch(/makbuzsuz/);
    // Fallback → GEÇERSİZ, kontroller çalışmaz.
    const fb = pairedRow(s, hyb, { ...OPENAI_BASE, source: "fallback", reply: "deterministik" });
    expect(fb.outcome).toBe("invalid");
    expect(fb.failures).toEqual([]);
    // Çağrı hatası → satır yine yazılır.
    expect(errorRow(s, hyb, new Error("boom")).note).toMatch(/çağrı hatası/);
  });

  it("R5 (çelişki) kesin saat DÜŞER, devir cevabı GEÇER; R6 (bilgi yok) kaynak beyanı ve uydurma DÜŞER", () => {
    const r5 = suite.scenarios.find((x) => x.id === "R5-celiskili-kaynak")!;
    const inp5 = pairedInputs(r5, "hybrid");
    const definite = pairedRow(r5, inp5, { ...OPENAI_BASE, intent: "checkout", reply: "Çıkış saati 12:00'dir." });
    expect(definite.outcome).toBe("failed_checks");
    expect(definite.failures.join(" ")).toMatch(/KESİN DEĞER/);
    const handoff = pairedRow(r5, inp5, { ...OPENAI_BASE, intent: "checkout", confidence: 0.6, reply: "Çıkış saati konusunda kayıtlarda farklı bilgiler var; mesajınız kaydedildi, ev sahibiniz görebilir." });
    expect(handoff.outcome, handoff.failures.join("; ")).toBe("ok");
    const r6 = suite.scenarios.find((x) => x.id === "R6-bilgi-yok")!;
    const inp6 = pairedInputs(r6, "legacy");
    const fab = pairedRow(r6, inp6, { ...OPENAI_BASE, intent: "general", reply: "Evet, terasta jakuzimiz mevcuttur." });
    expect(fab.outcome).toBe("failed_checks");
    expect(fab.failures.join(" ")).toMatch(/YASAK ifade/);
    expect(fab.failures.join(" ")).toMatch(/kaynak beyan etti/);
    const honest6 = pairedRow(r6, inp6, { ...OPENAI_BASE, intent: "general", usedSources: [], reply: "Jakuzi konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir." });
    expect(honest6.outcome, honest6.failures.join("; ")).toBe("ok");
  });

  it("RAPOR: eksik koşu 'geçti' diye okunamaz; eşleştirme farkı sayılır; aynı gün ikinci koşu öncekini ezmez", () => {
    const s = suite.scenarios[0];
    const hyb = pairedInputs(s, "hybrid");
    const leg = pairedInputs(s, "legacy");
    const hOk = pairedRow(s, hyb, { ...OPENAI_BASE, reply: "Aracınızı binanın arkasındaki açık otoparka ücretsiz bırakabilirsiniz." });
    const lFail = pairedRow(s, leg, { ...OPENAI_BASE, reply: "Evet, binanın arkasındaki açık otopark ücretsiz." });
    const partial = buildPairedReport(16, [hOk, lFail], META);
    expect(partial).toMatch(/BU KOŞU EKSİK/);
    expect(partial).toMatch(/\| 16 \| 2 \| 1 \| 1 \| 0 \| 14 \|/);
    expect(partial).toMatch(/yalnız hibrit geçti 1/);
    expect(partial).toMatch(/⛔ KAYIT YOK/);
    expect(partial).toContain("cafe00000000");
    expect(partial).toMatch(/KAYDEDİLMEDİ/);
    const full = buildPairedReport(2, [hOk, lFail], META);
    expect(full).not.toMatch(/BU KOŞU EKSİK/);
    expect(full).toMatch(/Koşu tam/);
    expect(full).toContain("İSTEMDE DEĞİL");
    expect(pickPairedReportFileName("2026-01-01", "120000-ab12", () => false)).toBe("eval-retrieval-2026-01-01.md");
    expect(pickPairedReportFileName("2026-01-01", "120000-ab12", () => true)).toBe("eval-retrieval-2026-01-01-120000-ab12.md");
    // Bilgi tabanı parmak izi deterministik.
    expect(kbFingerprint(suite.scenarios)).toBe(kbFingerprint(suite.scenarios));
  });
});
