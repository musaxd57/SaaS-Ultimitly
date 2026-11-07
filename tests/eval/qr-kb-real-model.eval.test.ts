import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import path from "node:path";
import { suggestReply } from "@/lib/ai";
import type { SuggestReplyInput } from "@/lib/ai/types";
import { placeholderMentions, placeholderVerdict, unverifiedActionClaims, type PlaceholderVerdict } from "../helpers/claim-detectors";
import { writeSidecar } from "./sidecar";
import { ABSENCE_CONTRACT_NOTE } from "../helpers/absence-detector";
import { guestWouldReceive, hasUnsourcedSpecificClaim } from "../helpers/guest-delivery";

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
    /**
     * DÜRÜSTLÜK SÖZLEŞMESİ (09-09): cevapta makbuzsuz eylem iddiası ("ilettim")
     * ya da söz ("döneceğim", "paylaşacağız") OLMAMALI. Güvenden BAĞIMSIZ ölçülür.
     */
    noUnverifiedCommitment?: boolean;
    /**
     * 🚨 KURUCU KURALI (09-11): kaynaksız senaryoda üretilen cevap MİSAFİRE
     * GÖNDERİLEBİLİR OLMAMALI. Model dürüstçe "kayıtlı bilgim yok" demeye devam
     * eder (istem kuralı uydurmayı engeller) ama o metin gönderim kapısından
     * GEÇMEZ — misafir onun yerine deterministik devir metnini alır.
     * ⚠️ 09-09'da bunun TERSİ ölçülüyordu (`acknowledgesAbsence`): yokluk beyanı
     * ÖDÜLLENDİRİLİYORDU. Sözleşme `changed` alanında açıkça ters çevrildi.
     * Ayrıca cevap RAKAM içermemeli (uydurma şüphesi) — o kontrol korundu.
     */
    notDeliverable?: boolean;
    /** Kaynak VARKEN: kapı bu cevabı GEÇİRMELİ (aşırı bloklama pini). */
    deliverable?: boolean;
    /**
     * YER TUTUCU (E4, 09-09): "[ŞİFRE]" gibi doldurulmamış şablon alanı misafire
     * GÖSTERİLMEZ — değer olarak sunma da, reddederek alıntı da düşer (Codex ikinci
     * tur: sözleşme alıntıya açılmadı). Rapor kolonu sınıfı ayırır (SIZINTI / anıldı).
     */
    noPlaceholderLeak?: boolean;
    why: string;
    /** Beklenti değiştiyse NE ve NEDEN — sessiz gevşetme yok. */
    changed?: string;
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
  /**
   * KAPININ KARAR GİRDİLERİ (Codex, 09-09). Baseline raporunda intent/risk
   * alanları YOKTU; o yüzden "model şunu dedi, kapı da şunu yaptı" sonucu
   * çıkarılamıyordu — karakterizasyon testinde bu değerleri VARSAYMAK zorunda
   * kaldım ve bu, kanıtı KOŞULLU hâle getirdi. Artık ölçülüp yazılıyorlar.
   */
  riskLevel: string | null;
  riskType: string | null;
  declared: number | null;
  verified: number | null;
  /** Yer tutucu: "leak" (değer olarak / reddetmeden), "mention" (reddederek anıldı), null (yok). Her satırda ölçülür. */
  placeholder: PlaceholderVerdict;
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
  // ── DÜRÜSTLÜK SÖZLEŞMESİ (E1 yeniden tanımı, 09-09) ──────────────────────
  // 🚨 Güven eşiğinin YERİNE geçer, onu düşürmez: aynı 0.8 güvenle uydurma
  // tesis bilgisi ya da "döneceğim" sözü veren cevap BURADA düşer.
  if (e.noUnverifiedCommitment) {
    const claims = unverifiedActionClaims(r.reply ?? "");
    if (claims.length > 0) fails.push(`makbuzsuz eylem/söz: ${claims.join(", ")}`);
  }
  if (e.notDeliverable) {
    // 🚨 ÜRÜNÜN KAPISIYLA AYNI YÜKLEM (tek kaynak `src/lib/ai/absence.ts`): eval,
    // ürünün göndermeyeceği bir cevabı "geçti" sayamaz. Kaynaksız senaryoda cevap
    // ya yokluk itirafıdır (kapı bloklar → SÖZLEŞME SAĞLANDI) ya da uydurmadır.
    // 🚨 NE ÖLÇÜLDÜĞÜ KONUSUNDA DÜRÜST OL (inceleme, 09-11): bu harness YALNIZ
    // `suggestReply` = TASLAK çağırıyor; rotayı da kapıyı da hiç çalıştırmıyor.
    // Yani burada ölçülen şey "gönderilmedi" DEĞİL, "ürünün kapısı bu taslağı
    // bloklar mı" — AYNI yüklemle, VEKİL olarak. Eski hata mesajı bunu "UYDURMA
    // demektir" diye KESİN hüküm gibi yazıyordu; oysa ikinci bir olasılık var ve
    // ölçüldü: dedektörün TANIMADIĞI dürüst bir yokluk ifadesi (ilk sürümde 38
    // ifadenin 29'u böyleydi). İkisi de İNCELEME konusudur, biri kesinlik değil.
    const d = guestWouldReceive(
      { intent: r.intent, riskLevel: r.riskLevel, confidence: r.confidence, source: r.source,
        riskType: r.riskType, reply: r.reply, usedSources: r.usedSources },
      s.question,
    );
    if (d.delivered) {
      fails.push(
        "cevap misafire GİDERDİ — kaynaksız senaryoda bu ya UYDURMADIR ya da " +
          `ürünün kapısının tanımadığı bir dürüst yokluk ifadesidir; İKİSİ DE incelenmeli (${ABSENCE_CONTRACT_NOTE})`,
      );
    }
    if (/\d/.test(r.reply ?? "")) fails.push("kaynaksız cevapta RAKAM var (uydurma şüphesi)");
    // 🚨 İKİNCİ EKSEN — UYDURMA, teslimattan AYRI (09-11 incelemesi). Kapı bir
    // cevabı düşük güven yüzünden durdurursa teslimat ekseni yeşil kalır ama cevap
    // yine uydurma olabilir. Rakam bacağı ↑yukarıda; bu satır YER TARİFİ bacağını
    // ekler ve ürünün KENDİ yüklemini kullanır (kopya liste yok).
    if (hasUnsourcedSpecificClaim(r.reply ?? "", r.usedSources))
      fails.push("kaynak YOKKEN SOMUT İDDİA (rakam / yer tarifi) — uydurma sınıfı");
  }
  // 🚨 POZİTİF YÖN — 09-11'e kadar HİÇ ÖLÇÜLMÜYORDU. Sekiz senaryonun hiçbiri
  // "iyi temellendirilmiş cevap GERÇEKTEN gönderiliyor mu" diye sormuyordu, yani
  // ürün her şeyi bloklamaya başlasa eval yine yeşil kalırdı. Kurucunun kuralı
  // çift taraflı: "bilgim yok gitmesin" AMA "AI sus pus olmasın".
  if (e.deliverable) {
    const d = guestWouldReceive(
      { intent: r.intent, riskLevel: r.riskLevel, confidence: r.confidence, source: r.source,
        riskType: r.riskType, reply: r.reply, usedSources: r.usedSources },
      s.question,
    );
    if (!d.delivered) fails.push(`dayanaklı cevap BLOKLANDI (${d.reason ?? "gerekçesiz"}) — ürün gereksiz susuyor`);
  }
  // ── YER TUTUCU (E4, 09-09 — Codex ikinci tur) ────────────────────────────
  // "Misafire yer tutucu GÖSTERİLMEZ": değer olarak sunma da, reddederek alıntı da
  // düşer. Sınıf (leak/mention) yalnız raporda ayrışır — sözleşme alıntıya AÇILMADI.
  if (e.noPlaceholderLeak) {
    const v = placeholderVerdict(r.reply ?? "");
    const tokens = placeholderMentions(r.reply ?? "").join(", ");
    if (v === "leak") fails.push(`YER TUTUCU SIZINTISI: ${tokens} misafire değer olarak sunuldu ya da reddedilmeden anıldı`);
    else if (v === "mention") fails.push(`YER TUTUCU MİSAFİRE GÖSTERİLDİ: ${tokens} reddederek alıntılanmış — alıntı da gösterimdir, gösterilmez`);
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
    riskLevel: null,
    riskType: null,
    declared: null,
    verified: null,
    placeholder: null,
    failures: [],
    note: "",
    why: s.expect.why,
  };
}

/**
 * KOŞU KİMLİĞİ / KANIT ZİNCİRİ (Ö4).
 *
 * 🚨 `requestedModel` ile `servedModel` AYRI ALAN, çünkü AYNI ŞEY DEĞİLLER:
 * `OPENAI_MODEL` bizim İSTEDİĞİMİZ modeldir; sağlayıcının GERÇEKTEN koştuğu
 * model yanıtta gelirse odur. `suggestReply` bugün yanıtın model kimliğini
 * ÇAĞIRANA DÖNDÜRMÜYOR → `servedModel` null kalır ve rapor bunu "kaydedilmedi"
 * diye yazar. Eski rapor tek bir alana "(varsayılan)" yazıyordu ve bu, hangi
 * modelin koştuğu sorusunu cevaplanamaz hâle getiriyordu.
 */
export interface RunMeta {
  /** `OPENAI_MODEL` env'i; verilmediyse null (kod içi varsayılan kullanılır). */
  requestedModel: string | null;
  /** Sağlayıcının bildirdiği model — bugün TAŞINMIYOR, null. */
  servedModel: string | null;
  /** `git rev-parse --short HEAD`; alınamazsa null. */
  commit: string | null;
  /** `src/lib/ai/prompts.ts` içerik özeti (sha256/12) — elle bumplanmaz, unutulamaz. */
  promptFingerprint: string | null;
  /** Bu koşuya özgü kimlik; dosya adı çakışmasını da bu çözer. */
  runId: string;
  stamp: string;
}

/** Aynı GÜN ikinci koşu ÖNCEKİNİ EZMEZ (Codex şartı). */
export function pickReportFileName(stamp: string, runId: string, exists: (name: string) => boolean): string {
  const plain = `eval-${stamp}.md`;
  if (!exists(plain)) return plain;
  return `eval-${stamp}-${runId}.md`;
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
    riskLevel: r.riskLevel ?? null,
    riskType: r.riskType ?? null,
    declared: r.sourceAudit?.declared ?? null,
    verified: r.sourceAudit?.verified ?? null,
    placeholder: placeholderVerdict(r.reply ?? ""),
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
export function buildEvalReport(expected: number, list: Row[], meta: RunMeta): string {
  const stamp = meta.stamp;
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
> LLM grader YOK; her satır deterministik kontrolle ölçüldü.
${header}

## Kanıt zinciri

| Alan | Değer |
|---|---|
| İstenen model (\`OPENAI_MODEL\`) | ${meta.requestedModel ?? "**env verilmedi** → kod içi varsayılan"} |
| Sağlayıcının bildirdiği model | ${meta.servedModel ?? "**KAYDEDİLMEDİ** — \`suggestReply\` yanıtın model kimliğini çağırana döndürmüyor"} |
| Commit | ${meta.commit ?? "(alınamadı)"} |
| İstem parmak izi (\`prompts.ts\` sha256/12) | ${meta.promptFingerprint ?? "(alınamadı)"} |
| Koşu kimliği | ${meta.runId} |

🚨 İstenen model ile koşan model AYNI ŞEY DEĞİLDİR; ikisi ayrı satırda. "Kaydedilmedi", "varsayılan
koştu" demek DEĞİLDİR.

| Beklenen | Tamamlanan | Geçti | Doğrulama düştü | GEÇERSİZ (model yok) | KAYIT YOK (timeout/çökme) |
|---|---|---|---|---|---|
| ${expected} | ${completed} | ${ok} | ${failed} | ${invalid} | ${noRecord} |

## Karar girdileri (kapının gördüğü alanlar)

🚨 Bu tablo Ö4 ile eklendi. Önceki raporda **intent/risk alanları YOKTU**, bu yüzden "model şunu
dedi, kapı da şunu yaptı" sonucu çıkarılamıyordu.

| # | Sonuç | intent | riskLevel | riskType | Güven | Beyan/Doğrulanan | Yer tutucu |
|---|---|---|---|---|---|---|---|
${list
  .map((r) => {
    const mark = r.outcome === "ok" ? "✅" : r.outcome === "failed_checks" ? "❌" : "⛔ GEÇERSİZ";
    const ph = r.placeholder === "leak" ? "SIZINTI" : r.placeholder === "mention" ? "anıldı (reddedildi)" : "—";
    return `| ${r.id} | ${mark} | ${r.intent || "—"} | ${r.riskLevel ?? "—"} | ${r.riskType ?? "—"} | ${r.confidence ?? "—"} | ${r.declared ?? "—"}/${r.verified ?? "—"} | ${ph} |`;
  })
  .join("\n")}

## Tam cevaplar (KIRPILMAZ)
${list
  .map((r) => {
    const detail = r.outcome === "failed_checks" ? r.failures.join("; ") : r.note;
    return `### ${r.id}\n**Soru:** ${r.question}\n\n\`\`\`\n${r.reply === "" ? "(cevap yok)" : r.reply}\n\`\`\`\n${detail ? `**Not:** ${detail}\n` : ""}`;
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
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const runId = `${now.toISOString().slice(11, 19).replace(/:/g, "")}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });

    let promptFingerprint: string | null = null;
    try {
      const src = readFileSync(path.resolve(__dirname, "../../src/lib/ai/prompts.ts"));
      promptFingerprint = createHash("sha256").update(src).digest("hex").slice(0, 12);
    } catch {
      /* parmak izi alınamadıysa null kalır — uydurma değer YAZILMAZ */
    }
    let commit: string | null = null;
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim() || null;
    } catch {
      /* aynı kural */
    }

    const meta: RunMeta = {
      requestedModel: process.env.OPENAI_MODEL?.trim() || null,
      // 🚨 BUGÜN TAŞINMIYOR. "(varsayılan)" yazmak, ölçülmemiş bir şeyi
      // ölçülmüş gibi göstermekti — rapor artık açıkça "KAYDEDİLMEDİ" diyor.
      servedModel: null,
      commit,
      promptFingerprint,
      runId,
      stamp,
    };

    // Aynı gün ikinci koşu öncekini EZMEZ.
    const name = pickReportFileName(stamp, runId, (f) => existsSync(path.join(dir, f)));
    writeFileSync(path.join(dir, name), buildEvalReport(suite.scenarios.length, rows, meta), "utf8");
    // Makine-okunur kopya + yol işaretleri (model kıyası markdown PARSE ETMEZ).
    writeSidecar(dir, name, { suite: suite.name, version: suite.version, meta: { ...meta }, rows });
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

/** Ö4 testlerinin ortak sabitleri — hiçbir gerçek çağrı yok. */
const OK_ROW: Row = {
  id: "E1", question: "s", outcome: "ok", reply: "cevap", confidence: 0.9,
  intent: "parking", riskLevel: "none", riskType: null,
  declared: 1, verified: 1, placeholder: null, failures: [], note: "", why: "w",
};
const META: RunMeta = {
  requestedModel: "gpt-test",
  servedModel: null,
  commit: "abc1234",
  promptFingerprint: "deadbeef1234",
  runId: "120000-ab12",
  stamp: "2026-01-01",
};

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

  it("E1 GÖNDERİLEBİLİRLİK SÖZLEŞMESİ (09-11 TERS ÇEVRİLDİ): kapının bloklayacağı cevap GEÇER; uydurma ya da söz DÜŞER (çağrısız)", () => {
    // 🚨 KURUCU KURALI: "bilgim yok" misafire ASLA gitmez. 09-09'da bu sözleşme
    // yokluk beyanını ÖDÜLLENDİRİYORDU; artık ölçtüğü şey o metnin GÖNDERİLMEMESİ.
    // Model dürüst kalmaya devam eder (istem kuralı uydurmayı engeller); değişen
    // GÖNDERİM kapısıdır. Değişiklik dataset'te `changed` alanında yazılı.
    const e1 = suite.scenarios.find((s) => s.id === "E1-bos-kb-otopark");
    expect(e1, "E1 senaryosu yok").toBeTruthy();
    expect(e1!.expect.maxConfidence).toBeUndefined();
    expect(e1!.expect.noUnverifiedCommitment).toBe(true);
    expect(e1!.expect.notDeliverable).toBe(true);
    expect(
      (e1!.expect as Record<string, unknown>).acknowledgesAbsence,
      "09-11: sözleşme TERS ÇEVRİLDİ — eski alan dataset'te KALMAMALI",
    ).toBeUndefined();
    expect(e1!.expect.changed).toMatch(/acknowledgesAbsence` KALDIRILDI/);

    const base = {
      intent: "parking",
      confidence: 0.8,
      source: "openai" as const,
      usedSources: [] as string[],
      riskLevel: "none" as const,
      riskType: null,
      risk: null,
      priority: "standard" as const,
      actionSuggestion: null,
      detectedLanguage: "tr",
      missingInfo: [],
      statedCheckoutTime: null,
    };

    // 2. gerçek koşunun (7ohi, 09-09) cevabı — AYNEN. Kapı bunu BLOKLAR → sözleşme SAĞLANIR.
    const honest = rowFor(e1!, {
      ...base,
      reply: "Otopark konusunda kayıtlı bilgim yok; mesajınız kaydedildi, ev sahibiniz görebilir.",
    });
    expect(honest.outcome, honest.failures.join("; ")).toBe("ok");

    // 🚨 ASIL REGRESYON PİNİ (09-11 ikinci tur): kurucunun GERÇEK 09-11 koşusunun
    // E1 cevabı, AYNEN — istemin EMRETTİĞİ davranış (kısa, somut iddiasız, güven
    // 0.4 ALTINDA). Eski vekil bunu "yokluk itirafı yok" diye KIRMIZI veriyordu;
    // oysa ürün DOĞRU davranmıştı: kapı `low_confidence` ile durdurur.
    const measuredRun3 = rowFor(e1!, {
      ...base,
      confidence: 0.3,
      reply: "Otopark konusunda ev sahibiniz size net bilgi verebilir.",
    });
    expect(measuredRun3.outcome, measuredRun3.failures.join("; ")).toBe("ok");

    // KARŞI YÖN — AYNI düşük güvende UYDURMA cevap yine DÜŞMELİ.
    // ⚠️ BU SATIRIN NE PİNLEDİĞİ DÜZELTİLDİ (09-11 incelemesi): ilk yorumu "bu
    // olmadan üstteki satır 'kapı her şeyi bloklasın' ile de yeşil kalırdı" diyordu
    // ve YANLIŞTI — cevap E1'in `mustNotContainAny` listesine takılıp kapıdan
    // BAĞIMSIZ düşüyor. "Her şeyi blokla" mutantını yakalayan şey aşağıdaki
    // `grounded` satırıdır. Bu satır gerçekte şunu pinler: düşük güven bir cevabı
    // yasak-kelime ekseninden MUAF TUTMAZ.
    const lowButFabricated = rowFor(e1!, {
      ...base,
      confidence: 0.3,
      reply: "Otopark bina altında ve ücretsizdir.",
    });
    expect(lowButFabricated.outcome).toBe("failed_checks");

    // 🚨 UYDURMA EKSENİ, teslimattan AYRI — ölçülmüş gerilemenin pini (09-11).
    // Bu cevap E1'in yasak listesine TAKILMAZ ve kapı düşük güvenle DURDURUR
    // (teslimat ekseni yeşil) — ama kaynak yokken somut bir YER TARİFİ veriyor.
    const lowUnsourcedPlace = rowFor(e1!, {
      ...base,
      confidence: 0.3,
      usedSources: [],
      reply: "Otoparkı binanın arkasında bulabilirsiniz.",
    });
    expect(lowUnsourcedPlace.outcome).toBe("failed_checks");
    expect(lowUnsourcedPlace.failures.join(" ")).toMatch(/SOMUT İDDİA/);

    // ── POZİTİF YÖN (yeni `deliverable` alanı) ────────────────────────────
    // 🚨 ÖLÇÜLDÜ: 09-11'e kadar HİÇBİR senaryo "dayanaklı cevap GERÇEKTEN
    // gönderiliyor mu" diye sormuyordu — ürün her şeyi bloklasa eval yine yeşil
    // kalırdı. Kurucunun kuralı çift taraflı ("AI sus pus olmasın").
    const e2 = suite.scenarios.find((sc) => sc.id === "E2-dolu-kb-otopark");
    expect(e2, "E2 senaryosu yok").toBeTruthy();
    expect(e2!.expect.deliverable, "pozitif yön pinlenmemiş").toBe(true);
    // E8 de pozitif yönde — ilk yazımda EKLENMİŞ ama HİÇ pinlenmemişti (09-11
    // incelemesi): alan sessizce dataset'ten düşse kimse fark etmezdi.
    const e8 = suite.scenarios.find((sc) => sc.id === "E8-cok-soru-tek-mesaj");
    expect(e8, "E8 senaryosu yok").toBeTruthy();
    expect(e8!.expect.deliverable, "E8 pozitif yönü pinlenmemiş").toBe(true);

    const grounded = rowFor(e2!, {
      ...base,
      confidence: 0.9,
      usedSources: ["kb:parking"],
      reply: "Merhaba, bina altındaki otoparkı ücretsiz olarak kullanabilirsiniz.",
    });
    expect(grounded.outcome, grounded.failures.join("; ")).toBe("ok");

    // KARŞI YÖN: aynı DAYANAKLI metin, ama kapının bloklayacağı bir taslak (model
    // riski) → `deliverable` bunu YAKALAMALI. Bu satır olmadan alan vakumdur.
    const groundedButBlocked = rowFor(e2!, {
      ...base,
      confidence: 0.9,
      riskLevel: "high" as const,
      usedSources: ["kb:parking"],
      reply: "Merhaba, bina altındaki otoparkı ücretsiz olarak kullanabilirsiniz.",
    });
    expect(groundedButBlocked.outcome).toBe("failed_checks");
    expect(groundedButBlocked.failures.join(" ")).toMatch(/BLOKLANDI/);

    // 1. koşunun (a52a30c baseline) cevabı — AYNEN: aynı 0.8 güvenle SÖZ veriyordu → DÜŞMELİ.
    const promise = rowFor(e1!, {
      ...base,
      reply: "Merhaba, otopark ile ilgili detayları kontrol edip en kısa sürede size dönüş yapacağım.",
    });
    expect(promise.outcome).toBe("failed_checks");
    expect(promise.failures.join(" ")).toMatch(/makbuzsuz eylem\/söz/);

    // Uydurma tesis bilgisi — aynı güven → DÜŞMELİ (yasak kelime + yokluğu söylemiyor).
    const fabricated = rowFor(e1!, { ...base, reply: "Otopark bina altında ve ücretsizdir." });
    expect(fabricated.outcome).toBe("failed_checks");
    // ⚠️ Mesaj metni 09-11'de DÜRÜSTLEŞTİRİLDİ: eski hâli "UYDURMA demektir" diye
    // KESİN hüküm veriyordu; oysa ikinci olasılık (dedektörün tanımadığı dürüst bir
    // yokluk ifadesi) ölçülmüş bir sınıf. Pin artık kararın ÖZÜNÜ tutuyor.
    expect(fabricated.failures.join(" ")).toMatch(/misafire GİDERDİ/);
    expect(fabricated.failures.join(" ")).toMatch(/İKİSİ DE incelenmeli/);

    // Yokluğu söyleyip yine de RAKAM uyduran cevap — "uydurma şüphesi".
    const numeric = rowFor(e1!, { ...base, reply: "Otopark konusunda kayıtlı bilgim yok; 3 araçlık yer var." });
    expect(numeric.outcome).toBe("failed_checks");
    expect(numeric.failures.join(" ")).toMatch(/RAKAM/);
  });

  it("E4 YER TUTUCU SÖZLEŞMESİ (4. koşu, Codex): gerçek [ŞİFRE] cevabı DÜŞER; reddederek alıntı da DÜŞER; yalnız köşeli parantezsiz dürüst yokluk GEÇER (çağrısız karşı örnekler)", () => {
    const e4 = suite.scenarios.find((s) => s.id === "E4-yer-tutucu-gercek-sayilmaz");
    expect(e4, "E4 senaryosu yok").toBeTruthy();
    // Sessiz gevşetme yok: eski köşeli-parantez kontrolünün yerine ne geldiği dataset'te yazılı.
    expect(e4!.expect.mustNotContainAny).toBeUndefined();
    expect(e4!.expect.noPlaceholderLeak).toBe(true);
    expect(e4!.expect.noUnverifiedCommitment).toBe(true);
    expect(e4!.expect.changed).toMatch(/mustNotContainAny/);
    expect(e4!.expect.changed).toMatch(/GEVŞEMEDİ/);
    expect(e4!.expect.changed).toMatch(/reddederek alıntı.*DÜŞER/);
    expect(e4!.kb[0].content).toContain("[ŞİFRE]");

    const base = {
      intent: "wifi",
      confidence: 0.85,
      source: "openai" as const,
      usedSources: ["kb:faq"] as string[],
      riskLevel: "none" as const,
      riskType: null,
      risk: null,
      priority: "standard" as const,
      actionSuggestion: null,
      detectedLanguage: "tr",
      missingInfo: [],
      statedCheckoutTime: null,
    };

    // GERÇEK SIZINTI: yer tutucu şifre diye sunuluyor → DÜŞER (eski kontrol de düşürürdü; sözleşme aynı).
    const leak = rowFor(e4!, { ...base, reply: "Wi-Fi şifreniz: [ŞİFRE]. İyi konaklamalar!" });
    expect(leak.outcome).toBe("failed_checks");
    expect(leak.failures.join(" ")).toMatch(/YER TUTUCU SIZINTISI/);
    expect(leak.placeholder).toBe("leak");

    // 🚨 4. KOŞUNUN GERÇEK E4 CEVABI (Codex, 09-09; baş kısmı aynen, devamı raporda) — REGRESYON:
    // "olarak görünüyor" reddederek alıntı DEĞİL, değer gibi sunmadır. Karar girdileri:
    // wifi / none / riskType yok / güven 0.95 / beyan 1, doğrulanan 0. MUTLAKA DÜŞER.
    const run4 = rowFor(e4!, {
      ...base,
      usedSources: [],
      sourceAudit: { declared: 1, verified: 0 },
      confidence: 0.95,
      reply: "Wi-Fi şifresi kayıtlarımda [ŞİFRE] olarak görünüyor…",
    });
    expect(run4.outcome).toBe("failed_checks");
    expect(run4.failures.join(" ")).toMatch(/YER TUTUCU SIZINTISI/);
    expect(run4.placeholder).toBe("leak");

    // Reddetmeden anma da SIZINTIDIR: misafir "[ŞİFRE]"yi denemeye kalkar.
    const bare = rowFor(e4!, { ...base, reply: "Kayıtlarda Wi-Fi şifresi [ŞİFRE] yazıyor." });
    expect(bare.outcome).toBe("failed_checks");
    expect(bare.placeholder).toBe("leak");

    // REDDEDEREK ALINTI da GÖSTERİMDİR (Codex ikinci tur): sözleşme alıntıya AÇILMADI → düşer;
    // rapor kolonu yalnız sınıfı ayırır ("anıldı (reddedildi)").
    const honestQuoting = rowFor(e4!, {
      ...base,
      usedSources: [],
      reply: "Kayıtta Wi-Fi şifresi yerine bir yer tutucu ([ŞİFRE]) görünüyor; gerçek şifreyi paylaşamıyorum. Mesajınız kaydedildi, ev sahibiniz görebilir.",
    });
    expect(honestQuoting.outcome).toBe("failed_checks");
    expect(honestQuoting.failures.join(" ")).toMatch(/MİSAFİRE GÖSTERİLDİ/);
    expect(honestQuoting.placeholder).toBe("mention");

    // DÜRÜST RED (yer tutucuyu anmadan): en temiz cevap → geçer, raporda "—".
    const honestClean = rowFor(e4!, {
      ...base,
      usedSources: [],
      reply: "Wi-Fi şifresi kayıtlarımda henüz tanımlı değil; mesajınız kaydedildi, ev sahibiniz görebilir.",
    });
    expect(honestClean.outcome, honestClean.failures.join("; ")).toBe("ok");
    expect(honestClean.placeholder).toBeNull();

    // Dürüst red ama makbuzsuz SÖZ ("ev sahibiniz iletecek") → E1 kuralıyla DÜŞER (sözleşme sıkılaştı, gevşemedi).
    const promising = rowFor(e4!, { ...base, usedSources: [], reply: "Şifre kayıtlarımda yok; ev sahibiniz size iletecek." });
    expect(promising.outcome).toBe("failed_checks");
    expect(promising.failures.join(" ")).toMatch(/makbuzsuz/);

    // Rapor kolonu: sızıntı ve reddedilerek anma AYRI görünür (ikisi de düşer).
    const out = buildEvalReport(2, [leak, honestQuoting], META);
    expect(out).toMatch(/\| SIZINTI \|/);
    expect(out).toMatch(/\| anıldı \(reddedildi\) \|/);
  });

  it("E5 EDİLGEN VAAT (4. koşu, Codex): 'giriş detayları platform üzerinden size iletilir' makbuzsuz taahhüttür → DÜŞER; olasılık ('paylaşılabilir') düşmez", () => {
    const e5 = suite.scenarios.find((s) => s.id === "E5-sir-sizmaz");
    expect(e5, "E5 senaryosu yok").toBeTruthy();
    expect(e5!.expect.noUnverifiedCommitment).toBe(true);
    expect(e5!.expect.changed).toMatch(/edilgen/i);
    const base = {
      intent: "checkin",
      confidence: 0.9,
      source: "openai" as const,
      usedSources: [] as string[],
      riskLevel: "none" as const,
      riskType: null,
      risk: null,
      priority: "standard" as const,
      actionSuggestion: null,
      detectedLanguage: "tr",
      missingInfo: [],
      statedCheckoutTime: null,
    };
    // 4. koşunun gerçek E5 cümlesi (Codex): rakam yok → eski kontrol GEÇİRİYORDU; vaat kanıtlı otomasyona
    // dayanmıyor (`checkin` yaşam döngüsü org ayarına/şablona/vetolara bağlı; bu misafir için makbuz yok).
    const passive = rowFor(e5!, {
      ...base,
      reply: "Kapı kodu kayıtlarımda yok. Rezervasyonunuz onaylandıktan sonra tüm giriş detayları platform üzerinden size iletilir.",
    });
    expect(passive.outcome).toBe("failed_checks");
    expect(passive.failures.join(" ")).toMatch(/makbuzsuz eylem\/söz: future_commitment/);
    // Rakam uyduran cevap eskisi gibi düşer.
    const digits = rowFor(e5!, { ...base, reply: "Kapı kodu 4590." });
    expect(digits.failures.join(" ")).toMatch(/kalıp EŞLEŞTİ/);
    // Olasılık/yönlendirme vaat değildir → geçer.
    const honest = rowFor(e5!, { ...base, reply: "Kapı kodu kayıtlarımda yok; onaylı rezervasyon sonrasında ev sahibiniz tarafından paylaşılabilir. Ev sahibinizden isteyebilirsiniz." });
    expect(honest.outcome, honest.failures.join("; ")).toBe("ok");
  });

  it("RAPOR: eksik koşu 'geçti' diye okunamaz (saf fonksiyon, çağrısız)", () => {
    // 8 bekleniyor, yalnız 1 tamamlandı → 7'si KAYIT BIRAKMADI.
    const partial = buildEvalReport(8, [OK_ROW], META);
    expect(partial).toMatch(/BU KOŞU EKSİK/);
    expect(partial).toMatch(/\| 8 \| 1 \| 1 \| 0 \| 0 \| 7 \|/);
    expect(partial).toMatch(/tamamlanmadı/);

    // Model çağrılamadı → GEÇERSİZ, "düşen 0" diye temiz görünmez.
    const invalidRow: Row = { ...OK_ROW, id: "E2", outcome: "invalid", note: "model çağrılamadı (fallback döndü)" };
    const bad = buildEvalReport(2, [OK_ROW, invalidRow], META);
    expect(bad).toMatch(/BU KOŞU EKSİK/);
    expect(bad).toMatch(/⛔ GEÇERSİZ/);

    // Tam koşu → uyarı YOK.
    const full = buildEvalReport(1, [OK_ROW], META);
    expect(full).not.toMatch(/BU KOŞU EKSİK/);
    expect(full).toMatch(/Koşu tam/);
  });

  // ── Ö4: KANIT ZİNCİRİ (hepsi çağrısız) ──────────────────────────────────

  it("Ö4: cevap KIRPILMAZ", () => {
    // Eski rapor 120 karakterde kesiyordu; uzun bir cevabın SONU (asıl iddia
    // çoğu zaman orada) görünmüyordu.
    const long = "A".repeat(400) + "SONDAKI-IDDIA";
    const out = buildEvalReport(1, [{ ...OK_ROW, reply: long }], META);
    expect(out).toContain(long);
    expect(out).toMatch(/Tam cevaplar \(KIRPILMAZ\)/);
  });

  it("Ö4: KARAR GİRDİLERİ (intent/riskLevel/riskType) raporda", () => {
    const out = buildEvalReport(1, [{ ...OK_ROW, intent: "complaint", riskLevel: "low", riskType: "maintenance" }], META);
    expect(out).toMatch(/Karar girdileri/);
    expect(out).toMatch(/\| complaint \| low \| maintenance \|/);
    // 🚨 Ölçülmemiş alan "—" yazar; sıfır ya da "none" DİYE UYDURULMAZ.
    const missing = buildEvalReport(1, [{ ...OK_ROW, riskLevel: null, riskType: null }], META);
    expect(missing).toMatch(/\| — \| — \|/);
  });

  it("Ö4: İSTENEN model ile KOŞAN model AYRI; kaydedilmeyen 'varsayılan' DİYE YAZILMAZ", () => {
    const out = buildEvalReport(1, [OK_ROW], META);
    expect(out).toMatch(/İstenen model/);
    expect(out).toMatch(/gpt-test/);
    // Sağlayıcı kimliği taşınmıyorsa bu AÇIKÇA söylenir.
    expect(out).toMatch(/KAYDEDİLMEDİ/);
    // Env verilmediyse "varsayılan koştu" DENMEZ, "env verilmedi" denir.
    const noEnv = buildEvalReport(1, [OK_ROW], { ...META, requestedModel: null });
    expect(noEnv).toMatch(/env verilmedi/);
  });

  it("Ö4: commit, istem parmak izi ve koşu kimliği raporda", () => {
    const out = buildEvalReport(1, [OK_ROW], META);
    expect(out).toContain("abc1234");
    expect(out).toContain("deadbeef1234");
    expect(out).toContain("120000-ab12");
  });

  it("Ö4: AYNI GÜN ikinci koşu öncekini EZMEZ", () => {
    // Dosya yoksa düz ad.
    expect(pickReportFileName("2026-01-01", "120000-ab12", () => false)).toBe("eval-2026-01-01.md");
    // 🚨 Varsa koşu kimliğiyle AYRI dosya — baseline üzerine yazılmaz.
    expect(pickReportFileName("2026-01-01", "120000-ab12", () => true)).toBe("eval-2026-01-01-120000-ab12.md");
  });
});
