import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// GERÇEK MODEL EVAL'İ (kurucu şartı: mock testleri gerçek eval'den AYIR).
//
// 🚨 VARSAYILAN OLARAK ATLANIR. İki kapı birden gerekir:
//     RUN_REAL_EVAL=1  ve  gerçek bir OPENAI_API_KEY
// Yani CI'da, normal `npm test`te ve anahtarsız ortamlarda KOŞMAZ — bu bilinçli:
// gerçek model çağrısı para harcar, ağ ister ve deterministik değildir.
//
// 🚨 LLM GRADER YOK. Her senaryo DETERMİNİSTİK bir kontrol taşır (metin içerir/
// içermez, güven eşiği, beyan edilen kaynaklar, rakam sızıntısı). Bir modelin
// başka bir modeli puanlaması güvenlik kanıtı DEĞİLDİR.
//
// ÇALIŞTIRMA:
//   RUN_REAL_EVAL=1 OPENAI_API_KEY=sk-... npx vitest run tests/eval
// Sonuç raporu: docs/olcum/eval-<tarih>.md
// ---------------------------------------------------------------------------

interface Scenario {
  id: string;
  question: string;
  kb: { category: string; title: string; content: string }[];
  propertyCheckOutTime?: string;
  expect: {
    mustContainAny?: string[];
    mustContainAll?: string[];
    mustNotContainAny?: string[];
    mustNotMatch?: string;
    minConfidence?: number;
    maxConfidence?: number;
    usedSourcesEmpty?: boolean;
    usedSourcesInclude?: string[];
    intentIn?: string[];
    why: string;
  };
}

const DATASET = path.resolve(__dirname, "../../evals/qr-kb-coverage.json");
const suite = JSON.parse(readFileSync(DATASET, "utf8")) as { name: string; version: number; scenarios: Scenario[] };

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");

interface Row {
  id: string;
  question: string;
  reply: string;
  confidence: number;
  intent: string;
  usedSources: string[];
  declared: number;
  verified: number;
  failures: string[];
  why: string;
}
const rows: Row[] = [];

function buildInput(s: Scenario): SuggestReplyInput {
  return {
    guestMessage: s.question,
    property: {
      name: "Test Dairesi",
      checkInTime: "15:00",
      checkOutTime: s.propertyCheckOutTime ?? "11:00",
    },
    knowledgeBase: s.kb,
    reservation: null,
    history: [],
    // Ürünün varsayılanları — eval bir üslup/dil denemesi değil, KAPSAM denemesi.
    tone: "warm",
    language: "tr",
  };
}

function check(s: Scenario, r: Awaited<ReturnType<typeof suggestReply>>): string[] {
  const fails: string[] = [];
  const reply = (r.reply ?? "").toLocaleLowerCase("tr");
  const e = s.expect;
  if (e.mustContainAny && !e.mustContainAny.some((w) => reply.includes(w.toLocaleLowerCase("tr")))) {
    fails.push(`hiçbiri geçmiyor: ${e.mustContainAny.join(" | ")}`);
  }
  for (const w of e.mustContainAll ?? []) {
    if (!reply.includes(w.toLocaleLowerCase("tr"))) fails.push(`eksik: "${w}"`);
  }
  for (const w of e.mustNotContainAny ?? []) {
    if (reply.includes(w.toLocaleLowerCase("tr"))) fails.push(`OLMAMALIYDI: "${w}"`);
  }
  if (e.mustNotMatch && new RegExp(e.mustNotMatch).test(r.reply ?? "")) {
    fails.push(`kalıp EŞLEŞTİ (olmamalıydı): /${e.mustNotMatch}/`);
  }
  if (typeof e.minConfidence === "number" && r.confidence < e.minConfidence) {
    fails.push(`güven düşük: ${r.confidence} < ${e.minConfidence}`);
  }
  if (typeof e.maxConfidence === "number" && r.confidence >= e.maxConfidence) {
    fails.push(`güven YÜKSEK (kesin konuşmamalıydı): ${r.confidence} ≥ ${e.maxConfidence}`);
  }
  if (e.usedSourcesEmpty && r.usedSources.length > 0) {
    fails.push(`kaynak beyan etti ama etmemeliydi: ${r.usedSources.join(", ")}`);
  }
  for (const src of e.usedSourcesInclude ?? []) {
    if (!r.usedSources.includes(src)) fails.push(`kaynak beyan edilmedi: ${src}`);
  }
  if (e.intentIn && !e.intentIn.includes(r.intent)) {
    fails.push(`intent "${r.intent}", beklenen: ${e.intentIn.join("|")}`);
  }
  return fails;
}

describe.skipIf(!enabled)(`GERÇEK MODEL EVAL — ${suite.name} v${suite.version}`, () => {
  beforeAll(() => {
    // Anahtar varlığı yukarıda ölçüldü; burada yalnız niyeti bir kez daha yazıyoruz.
    console.log(`[eval] ${suite.scenarios.length} senaryo, GERÇEK model çağrısı yapılacak.`);
  });

  afterAll(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const failed = rows.filter((r) => r.failures.length > 0);
    const body = `# GERÇEK MODEL EVAL — ${suite.name} v${suite.version} (${stamp})

> Bu dosya \`tests/eval/qr-kb-real-model.eval.test.ts\` tarafından ÜRETİLİR.
> Model: \`${process.env.OPENAI_MODEL ?? "(varsayılan)"}\` · senaryo: ${rows.length} · **düşen: ${failed.length}**
> LLM grader YOK; her satır deterministik kontrolle ölçüldü.

| # | Soru | Modelin cevabı | Güven | Beyan/Doğrulanan | Sonuç |
|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| ${r.id} | ${r.question} | ${JSON.stringify(r.reply.slice(0, 120))} | ${r.confidence} | ${r.declared}/${r.verified} | ${r.failures.length === 0 ? "✅" : `❌ ${r.failures.join("; ")}`} |`,
  )
  .join("\n")}

## Düşen senaryoların gerekçeleri
${failed.length === 0 ? "Yok." : failed.map((r) => `- **${r.id}** — ${r.why}\n  - ${r.failures.join("\n  - ")}`).join("\n")}
`;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `eval-${stamp}.md`), body, "utf8");
  });

  for (const s of suite.scenarios) {
    it(`${s.id} — ${s.expect.why}`, async () => {
      const r = await suggestReply(buildInput(s));
      // Model çağrılamadıysa (ağ/kota) fallback döner — bu bir EVAL SONUCU
      // değildir, koşunun kendisi geçersizdir. Sessizce "geçti" demeyiz.
      expect(r.source, "model çağrılamadı; eval sonucu geçersiz").toBe("openai");
      const failures = check(s, r);
      rows.push({
        id: s.id,
        question: s.question,
        reply: r.reply ?? "",
        confidence: r.confidence,
        intent: r.intent,
        usedSources: r.usedSources,
        declared: r.sourceAudit?.declared ?? -1,
        verified: r.sourceAudit?.verified ?? -1,
        failures,
        why: s.expect.why,
      });
      expect(failures, failures.join("; ")).toEqual([]);
    }, 60_000);
  }
});

describe("eval kapısı", () => {
  it("gerçek eval ANAHTARSIZ koşmaz (sahte 'geçti' üretilmez)", () => {
    if (!enabled) {
      // Anahtar yoksa/bayrak kapalıysa yukarıdaki blok ATLANIR. Bu testin kendisi
      // o kapının VAR olduğunu pinler: birisi kapıyı kaldırırsa CI gerçek model
      // çağırmaya kalkar ve sessizce fallback'e düşüp "eval geçti" der.
      expect(enabled).toBe(false);
      return;
    }
    expect(key.length).toBeGreaterThan(20);
  });

  it("veri seti sürümlü ve her senaryoda gerekçe var", () => {
    expect(suite.version).toBeGreaterThanOrEqual(1);
    expect(suite.scenarios.length).toBeGreaterThan(0);
    for (const s of suite.scenarios) {
      expect(s.expect.why, s.id).toBeTruthy();
      expect(s.id, "senaryo kimliği gerekli").toBeTruthy();
    }
    // Kimlikler EŞSİZ olmalı — rapor satırları karışmasın.
    expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(suite.scenarios.length);
  });
});
