import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// GERÇEK MODEL EVAL'İ (kurucu şartı: mock testleri gerçek eval'den AYIR).
//
// 🚨 AYRI YAPILANDIRMA ŞART (Codex bulgusu, 09-08):
//     npm run eval        ← vitest.eval.config.ts
// Varsayılan `vitest.config.ts` `OPENAI_API_KEY`i ZORLA BOŞALTIR (normal suite
// asla OpenAI çağırmasın diye — o kapı KORUNUYOR) ve her koşuda Linux
// PostgreSQL ayağa kaldırır. O config'le eval koşmak senaryoları SESSİZCE
// atlar ve "8 skipped" ile başarılı görünür. Bu dosyadaki "kapı" testleri iki
// yapılandırmanın da doğru davrandığını PİNLER.
//
// 🚨 İKİ KAPI: RUN_REAL_EVAL=1 ve gerçek bir anahtar. Biri eksikse senaryolar
// atlanır — sahte "geçti" üretilmez.
//
// 🚨 LLM GRADER YOK. Her senaryo DETERMİNİSTİK kontrol taşır.
//
// 🚨 EKSİK KOŞU BAŞARILI GÖRÜNMEZ (Codex bulgusu): rapor BEKLENEN / TAMAMLANAN /
// DÜŞEN / GEÇERSİZ / KAYIT YOK sayılarını AYRI verir. Bir senaryo zaman aşımına
// uğrar ya da model çağrılamazsa "0 başarısız" YAZILMAZ; koşunun kendisi
// EKSİK damgalanır.
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

/** Bir senaryonun ne olduğunu SINIFLANDIRIR — "sessiz eksik" olmasın. */
type Outcome = "ok" | "failed_checks" | "invalid";

interface Row {
  id: string;
  question: string;
  outcome: Outcome;
  reply: string;
  confidence: number | null;
  intent: string;
  declared: number | null;
  verified: number | null;
  failures: string[];
  /** `invalid` satırlarda NEDEN geçersiz olduğu (PII yok, anahtar yok). */
  note: string;
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

function baseRow(s: Scenario): Row {
  return {
    id: s.id,
    question: s.question,
    outcome: "invalid",
    reply: "",
    confidence: null,
    intent: "",
    declared: null,
    verified: null,
    failures: [],
    note: "",
    why: s.expect.why,
  };
}

/**
 * Senaryo SONUCUNU sınıflandırır — SAF fonksiyon, gerçek çağrı GEREKTİRMEZ.
 *
 * 🚨 Neden ayrı: bu mantık bir dönem doğrudan `it()` gövdesindeydi ve orası
 * ancak GERÇEK bir model çağrısıyla çalışıyordu — yani "model çağrılamadı"
 * dalını hiçbir test koruyamıyordu (mutasyon testinde HAYATTA KALDI). Saf
 * fonksiyona çıkınca fallback sonucu sentetik olarak verilip ölçülebiliyor.
 */
export function rowFor(s: Scenario, r: Awaited<ReturnType<typeof suggestReply>>): Row {
  const base = baseRow(s);
  // Model çağrılamadıysa `suggestReply` fallback'e düşer. Bu bir EVAL SONUCU
  // DEĞİLDİR; senaryo GEÇERSİZDİR ve raporda öyle görünür.
  if (r.source !== "openai") {
    return { ...base, outcome: "invalid", note: "model çağrılamadı (fallback döndü)", reply: r.reply ?? "" };
  }
  const failures = check(s, r);
  return {
    ...base,
    outcome: failures.length === 0 ? "ok" : "failed_checks",
    reply: r.reply ?? "",
    confidence: r.confidence,
    intent: r.intent,
    declared: r.sourceAudit?.declared ?? null,
    verified: r.sourceAudit?.verified ?? null,
    failures,
  };
}

/** Çağrı FIRLATTIĞINDA (ağ/kota/iptal) satır — sessiz kayıp yok. */
export function errorRow(s: Scenario, err: unknown): Row {
  return { ...baseRow(s), outcome: "invalid", note: `çağrı hatası: ${(err as Error)?.name ?? "bilinmiyor"}` };
}

/**
 * Rapor gövdesi — SAF fonksiyon, test edilebilir.
 *
 * 🚨 EKSİK KOŞU BAŞARILI GÖRÜNEMEZ: beş sayı ayrı verilir ve biri bile
 * "eksik" tarafındaysa başlıkta koşu GEÇERSİZ damgalanır. Eskiden yalnız
 * `düşen` yazıyordu; hiç tamamlanmamış bir koşu "düşen: 0" ile temiz görünürdü.
 */
export function buildEvalReport(expected: number, list: Row[], model: string, stamp: string): string {
  const completed = list.length;
  const failed = list.filter((r) => r.outcome === "failed_checks").length;
  const invalid = list.filter((r) => r.outcome === "invalid").length;
  const noRecord = Math.max(0, expected - completed); // zaman aşımı / çökme
  const ok = list.filter((r) => r.outcome === "ok").length;
  const incomplete = invalid > 0 || noRecord > 0;

  const header = incomplete
    ? `> 🚨 **BU KOŞU EKSİK — SONUÇ "GEÇTİ" DİYE OKUNAMAZ.** ${invalid} senaryo geçersiz (model çağrılamadı), ${noRecord} senaryo hiç kayıt bırakmadı (zaman aşımı/çökme).`
    : `> Koşu tam: beklenen ${expected} senaryonun hepsi tamamlandı.`;

  return `# GERÇEK MODEL EVAL — ${suite.name} v${suite.version} (${stamp})

> Bu dosya \`tests/eval/qr-kb-real-model.eval.test.ts\` tarafından ÜRETİLİR; elle yazılmaz.
> Model: \`${model}\` · LLM grader YOK; her satır deterministik kontrolle ölçüldü.
${header}

| Beklenen | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK (timeout/çökme) |
|---|---|---|---|---|---|
| ${expected} | ${completed} | ${ok} | ${failed} | ${invalid} | ${noRecord} |

| # | Sonuç | Soru | Modelin cevabı | Güven | Beyan/Doğrulanan | Not |
|---|---|---|---|---|---|---|
${list
  .map((r) => {
    const mark = r.outcome === "ok" ? "✅" : r.outcome === "failed_checks" ? "❌" : "⛔ GEÇERSİZ";
    const detail = r.outcome === "failed_checks" ? r.failures.join("; ") : r.note;
    return `| ${r.id} | ${mark} | ${r.question} | ${JSON.stringify(r.reply.slice(0, 120))} | ${r.confidence ?? "—"} | ${r.declared ?? "—"}/${r.verified ?? "—"} | ${detail} |`;
  })
  .join("\n")}

## Kayıt bırakmayan senaryolar
${
  noRecord === 0
    ? "Yok."
    : suite.scenarios
        .filter((s) => !list.some((r) => r.id === s.id))
        .map((s) => `- **${s.id}** — tamamlanmadı (zaman aşımı ya da çökme). Ölçülmedi; "geçti" SAYILMAZ.`)
        .join("\n")
}

## Düşen doğrulamaların gerekçeleri
${
  failed === 0
    ? "Yok."
    : list
        .filter((r) => r.outcome === "failed_checks")
        .map((r) => `- **${r.id}** — ${r.why}\n  - ${r.failures.join("\n  - ")}`)
        .join("\n")
}
`;
}

describe.skipIf(!enabled)(`GERÇEK MODEL EVAL — ${suite.name} v${suite.version}`, () => {
  beforeAll(() => {
    console.log(`[eval] ${suite.scenarios.length} senaryo, GERÇEK model çağrısı yapılacak.`);
  });

  afterAll(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `eval-${stamp}.md`),
      buildEvalReport(suite.scenarios.length, rows, process.env.OPENAI_MODEL ?? "(varsayılan)", stamp),
      "utf8",
    );
  });

  for (const s of suite.scenarios) {
    it(`${s.id} — ${s.expect.why}`, async () => {
      let r: Awaited<ReturnType<typeof suggestReply>>;
      try {
        r = await suggestReply(buildInput(s));
      } catch (err) {
        // Çağrı FIRLATTI (ağ/kota/iptal). Satır yine YAZILIR — sessiz kayıp yok.
        rows.push(errorRow(s, err));
        throw err;
      }
      const row = rowFor(s, r);
      rows.push(row);
      if (row.outcome === "invalid") expect.fail(`${row.note} — bu senaryo GEÇERSİZ (rapora öyle yazıldı)`);
      expect(row.failures, row.failures.join("; ")).toEqual([]);
    });
  }
});

describe("eval kapıları (gerçek çağrı YAPMAZ)", () => {
  it("ANAHTARSIZ ya da bayraksız koşmaz — sahte 'geçti' üretilmez", () => {
    if (!enabled) {
      expect(enabled).toBe(false);
      return;
    }
    expect(key.length).toBeGreaterThan(20);
  });

  it("🚨 YAPILANDIRMA: normal suite anahtarı BOŞALTIR, eval config BOŞALTMAZ", async () => {
    // ⚠️ Bu bir dönem METİN TARAMASIYDI ve kendi AÇIKLAMA YORUMUMA takıldı
    // (config dosyasının başındaki "env.OPENAI_API_KEY: ..." cümlesi regex'i
    // eşleştiriyordu). Kaynak taraması tek yönlüdür — artık config NESNELERİ
    // okunuyor, yani yorum metni sonucu etkilemiyor.
    const evalCfg = (await import("../../vitest.eval.config")).default as {
      test?: { env?: Record<string, string>; globalSetup?: unknown };
    };
    const mainCfg = (await import("../../vitest.config")).default as {
      test?: { env?: Record<string, string>; globalSetup?: unknown };
    };
    // Normal suite ASLA gerçek model çağırmasın — bu kapı KORUNUR.
    expect(mainCfg.test?.env?.OPENAI_API_KEY).toBe("");
    expect(mainCfg.test?.globalSetup).toBeDefined();
    // Eval config anahtarı SET ETMEZ (kullanıcının ortamından geçsin) ve
    // veritabanı hazırlığı YAPMAZ (Windows'ta da koşabilsin).
    expect(evalCfg.test?.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(evalCfg.test?.globalSetup).toBeUndefined();
  });

  it("ORTAM GEÇİŞİ (davranışsal): hangi config koşuyorsa anahtar ona göre görünür", () => {
    // Anahtarın KENDİSİ hiçbir yere yazılmaz — yalnız "zorla boşaltıldı mı"
    // ölçülür. Üç ayırt edici durum:
    //   · normal suite  → tam olarak ""      (config boşalttı)
    //   · eval config, kullanıcıda anahtar yok → undefined (config dokunmadı)
    //   · eval config, kullanıcıda anahtar var → dolu değer
    const raw = process.env.OPENAI_API_KEY;
    if (process.env.EVAL_CONFIG === "1") {
      expect(
        raw,
        "eval config OPENAI_API_KEY'i boşaltmamalı — boşaltırsa kullanıcının anahtarı hiç görünmez ve eval sessizce atlanır",
      ).not.toBe("");
    } else {
      expect(raw, "normal suite gerçek model çağırmamalı — anahtar boşaltılmış olmalı").toBe("");
    }
  });

  it("veri seti sürümlü, kimlikler eşsiz ve her senaryoda gerekçe var", () => {
    expect(suite.version).toBeGreaterThanOrEqual(1);
    expect(suite.scenarios.length).toBeGreaterThan(0);
    for (const s of suite.scenarios) {
      expect(s.expect.why, s.id).toBeTruthy();
      expect(s.id, "senaryo kimliği gerekli").toBeTruthy();
    }
    expect(new Set(suite.scenarios.map((s) => s.id)).size).toBe(suite.scenarios.length);
  });

  it("SINIFLANDIRMA: fallback sonucu GEÇERSİZ sayılır (çağrısız, sentetik)", () => {
    const scenario = suite.scenarios[0];
    const fallback = {
      reply: "deterministik cevap",
      intent: "general",
      confidence: 0.55,
      source: "fallback" as const,
      usedSources: [],
      riskLevel: "none" as const,
      riskType: null,
      risk: null,
      priority: "standard" as const,
      actionSuggestion: null,
      detectedLanguage: "tr",
      missingInfo: [],
      statedCheckoutTime: null,
    };
    const row = rowFor(scenario, fallback);
    // 🚨 "geçti" DEĞİL: model hiç çağrılamadıysa ölçüm YOKTUR.
    expect(row.outcome).toBe("invalid");
    expect(row.note).toMatch(/model çağrılamadı/);
    expect(row.failures).toEqual([]); // kontroller HİÇ çalıştırılmadı

    // Çağrı fırlatırsa da satır üretilir (sessiz kayıp yok).
    const errored = errorRow(scenario, new Error("boom"));
    expect(errored.outcome).toBe("invalid");
    expect(errored.note).toMatch(/çağrı hatası/);
  });

  it("RAPOR: eksik koşu 'geçti' diye okunamaz (saf fonksiyon, çağrısız)", () => {
    const okRow: Row = {
      id: "E1", question: "s", outcome: "ok", reply: "cevap", confidence: 0.9,
      intent: "parking", declared: 1, verified: 1, failures: [], note: "", why: "w",
    };
    // 8 bekleniyor, yalnız 1 tamamlandı → 7'si KAYIT BIRAKMADI.
    const partial = buildEvalReport(8, [okRow], "m", "2026-01-01");
    expect(partial).toMatch(/BU KOŞU EKSİK/);
    expect(partial).toMatch(/\| 8 \| 1 \| 1 \| 0 \| 0 \| 7 \|/);
    expect(partial).toMatch(/tamamlanmadı/);

    // Model çağrılamadı → GEÇERSİZ, "düşen 0" diye temiz görünmez.
    const invalidRow: Row = { ...okRow, id: "E2", outcome: "invalid", note: "model çağrılamadı (fallback döndü)" };
    const bad = buildEvalReport(2, [okRow, invalidRow], "m", "2026-01-01");
    expect(bad).toMatch(/BU KOŞU EKSİK/);
    expect(bad).toMatch(/⛔ GEÇERSİZ/);

    // Tam koşu → uyarı YOK.
    const full = buildEvalReport(1, [okRow], "m", "2026-01-01");
    expect(full).not.toMatch(/BU KOŞU EKSİK/);
    expect(full).toMatch(/Koşu tam/);
  });
});
