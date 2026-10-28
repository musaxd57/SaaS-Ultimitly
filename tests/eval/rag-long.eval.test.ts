import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { planDocumentImport } from "@/lib/kb-import/document";
import { chunkItems } from "@/lib/ai/retrieval/chunker";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { runPipeline, type LabItem, type LabQuery } from "./rag-lab/core";
import { parseConfig } from "./rag-lab/config";

// ---------------------------------------------------------------------------
// UZUN BELGE RAG ÖLÇERİ (kurucu 10-28: "rag için ölçümlerimizi yapalım, orayı en iyi şekilde istiyorum"; Codex 10-28: "cümleyi bulmak
// yetmez — cevabı değiştiren bağlam (kural + istisna + koşul + tablo başlığı + açık gönderme) modele birlikte ulaşmalı"). Bugünkü RAG ölçüm
// setlerinde en uzun kalem 818 karakterdi: uzun belge, parça sınırı ve bağlam kopması hiç ölçülmemişti.
//
// Akış ÜRÜNÜN KENDİSİ: belge → `planDocumentImport` (ev sahibinin onaylayacağı konu kalemleri) → aynı getirme hattı (`rag-lab/core.ts`
// `runPipeline`: okuma tavanı · anlama · anlamsal · yeniden sıralayıcı · bütçe) → isteme giren blok. Her soru için ölçülen:
//   · içe aktarma kaybı: gereken her alıntı (requiredSpans) en az bir kalemde var mı (içe aktarma metni düşürmüş mü)
//   · birlikte durma: alıntıların hepsi AYNI kalemde / AYNI parçada mı (kural ile istisna bölünmüş mü)
//   · bağlam tamlığı: alıntıların HEPSİ modele giden blokta mı (asıl ölçü) · en az biri blokta mı
// Cevapsız sorularda (belgede yok) blok şişmesi raporlanır; cevap düzeyi (son gönderim doğru mu) `rag-answer` ölçeriyle ayrıca.
// Veri: `evals/rag-long/dev.json` (geliştirme, görülebilir) · `evals/rag-long/blind.json` (ayrı yazar, sistemi görmedi; YALNIZ son doğrulama).
// Kapılar: ölçer YALNIZ açıkça istenince koşar (`EVAL_RAG_LONG=1` ya da `RUN_REAL_EVAL=1`) — `npm test` bu dosyayı da toplar, kendiliğinden
// koşsa her kapıda rapor dosyası yazardı. `lex` ücretsizdir (model / gömme çağrısı yok); ücretli yapılandırmalar RUN_REAL_EVAL=1 + anahtar ister.
// Kullanım: EVAL_RAG_LONG=1 EVAL_RAG_LONG_SET=dev EVAL_RAG_LONG_CONFIGS=lex npx vitest run -c vitest.eval.config.ts tests/eval/rag-long.eval.test.ts
// ---------------------------------------------------------------------------

interface LongDoc {
  id: string;
  property: string;
  title: string;
  format: string;
  text: string;
}
interface LongQuestion {
  id: string;
  docId: string;
  lang: string;
  text: string;
  category: string;
  answerable: boolean;
  requiredSpans: string[];
  forbiddenAnswer?: string;
  goldAnswer?: string;
}
interface LongSet {
  split: string;
  author: string;
  documents: LongDoc[];
  questions: LongQuestion[];
}

const SET = process.env.EVAL_RAG_LONG_SET ?? "dev";
const FILE = process.env.EVAL_RAG_LONG_FILE ?? path.resolve(__dirname, `../../evals/rag-long/${SET}.json`);
const CONFIG_NAMES = (process.env.EVAL_RAG_LONG_CONFIGS ?? "lex").split(",").map((s) => s.trim()).filter(Boolean);
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const paidOk = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const NOW = Date.UTC(2026, 9, 28, 12);
const WORKERS = Math.max(1, Math.min(8, Math.trunc(Number(process.env.EVAL_RAG_WORKERS) || 4)));
/**
 * Arka plan bilgi tabanı (kalem sayısı; 0 = yok). Ürün 30 kalem / 24 bin karakterin altındaki bilgi tabanında SEÇİM YAPMAZ (hepsi gider) —
 * tek başına ~9 bin karakterlik belge aramayı hiç sınamaz. Gerçekçi zor durum: ev sahibinin elle yazdığı çok sayıda kısa kalem + bir uzun
 * belge. Arka plan, kısa kalem setinin GELİŞTİRME kümesinden (`evals/rag-scale/dev.json`) sabit sırayla alınır (başka daire adları taşır;
 * yakın konu dikkat dağıtıcısı olarak işe yarar).
 */
const BACKGROUND = Math.max(0, Math.trunc(Number(process.env.EVAL_RAG_LONG_BACKGROUND) || 0));
/** Kör küme ayar için okunmaz: rapora soru ayrıntısı yazılmaz (yalnız oranlar). */
const DETAILS = process.env.EVAL_RAG_LONG_DETAILS !== "0" && SET !== "blind";
/** Rapor adına ek (aynı gün aynı yapılandırmanın farklı koşuları üst üste yazılmasın). */
const TAG = (process.env.EVAL_RAG_LONG_TAG ?? "").replace(/[^a-z0-9_.-]/gi, "");

function backgroundItems(n: number): LabItem[] {
  if (n === 0) return [];
  const file = JSON.parse(readFileSync(path.resolve(__dirname, "../../evals/rag-scale/dev.json"), "utf8")) as {
    items: { id: string; category: string; title: string; content: string }[];
  };
  return file.items.slice(0, n).map((it) => ({
    id: `bg-${it.id}`,
    category: it.category,
    title: it.title,
    content: it.content,
    updatedAt: new Date(NOW - 30 * 86_400_000),
    supersededById: null,
    reviewState: "approved",
  }));
}

/** Boşluk farkı (satır sonu, çift boşluk) içe aktarmanın düzenidir, içerik farkı değil. */
export const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Belgeyi ürünün içe aktarıcısıyla onaylı kalemlere çevirir (ev sahibi taslakları olduğu gibi onaylamış sayılır). */
export function itemsFromDocument(doc: LongDoc): LabItem[] {
  const plan = planDocumentImport([{ page: 1, text: doc.text }]);
  return plan.drafts.map((d, i) => ({
    id: `${doc.id}-k${i}`,
    category: d.category,
    title: d.title,
    content: d.content,
    updatedAt: new Date(NOW - 86_400_000),
    supersededById: null,
    reviewState: "approved",
  }));
}

export interface LongRow {
  qid: string;
  docId: string;
  category: string;
  lang: string;
  answerable: boolean;
  config: string;
  spans: number;
  /** Alıntıların kaçı içe aktarılan kalemlerde var. */
  imported: number;
  /**
   * Yalnız "Giriş Talimatı" (checkin) kaleminde bulunan alıntı sayısı — o kategori QR sohbetinde ve rezervasyon öncesinde misafire
   * GİTMEZ (`QR_SECRET_CATEGORIES` / `PREBOOKING_SECRET_CATEGORIES`). İçe aktarma kapı / anahtar sözcüğü taşıyan paragrafı bütünüyle oraya
   * taşır (dev seti yazarı 10-28: yol tarifi, otopark, sigorta kutusu bu yüzden gizleniyor). Bu ölçer bütün kategorileri getirir; sayı
   * QR / rezervasyon öncesi yüzeyde kaybolacak bağlamın büyüklüğüdür.
   */
  accessOnly: number;
  sameItem: boolean;
  sameChunk: boolean;
  /** Bloğa giren alıntı sayısı. */
  inBlock: number;
  complete: boolean;
  any: boolean;
  selected: number;
  /** Anlama katmanı bu soruda koştu mu (`LabRun.undStatus`). */
  und: string;
  blockChars: number;
  missing: string[];
}

function evaluate(q: LongQuestion, items: LabItem[], blockText: string, config: string, selected: number, und: string): LongRow {
  const spans = q.requiredSpans.map(norm);
  const itemTexts = items.map((it) => norm(it.content));
  const chunkTexts = chunkItems(items).map((c) => norm(c.text));
  const block = norm(blockText);
  const inItems = spans.filter((s) => itemTexts.some((t) => t.includes(s)));
  const accessOnly = spans.filter((s) => {
    const holders = items.filter((it) => norm(it.content).includes(s));
    return holders.length > 0 && holders.every((it) => it.category === "checkin");
  }).length;
  const inBlock = spans.filter((s) => block.includes(s));
  return {
    qid: q.id,
    docId: q.docId,
    category: q.category,
    lang: q.lang,
    answerable: q.answerable,
    config,
    spans: spans.length,
    imported: inItems.length,
    accessOnly,
    sameItem: spans.length > 0 && itemTexts.some((t) => spans.every((s) => t.includes(s))),
    sameChunk: spans.length > 0 && chunkTexts.some((t) => spans.every((s) => t.includes(s))),
    inBlock: inBlock.length,
    complete: spans.length > 0 && inBlock.length === spans.length,
    any: inBlock.length > 0,
    selected,
    und,
    blockChars: blockText.length,
    missing: q.requiredSpans.filter((s) => !block.includes(norm(s))),
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "—" : `${n}/${d} (%${Math.round((100 * n) / d)})`;
}

export function report(rows: readonly LongRow[], set: LongSet, docs: Map<string, { items: number; chars: number }>, details = true, background = 0): string {
  const lines: string[] = [];
  lines.push(`# Uzun belge RAG ölçümü — ${set.split} (${set.author})`, "");
  lines.push(`Belgeler: ${[...docs].map(([id, d]) => `${id} ${d.chars} kr → ${d.items} kalem`).join(" · ")}`, "");
  lines.push(`Arka plan bilgi tabanı: ${background} kalem${background === 0 ? " (tek belge — ürün bu boyutta seçim yapmaz, bilgi tabanının tamamı gider)" : ""}`, "");
  const configs = [...new Set(rows.map((r) => r.config))];
  for (const cfg of configs) {
    const rs = rows.filter((r) => r.config === cfg);
    const ans = rs.filter((r) => r.answerable && r.spans > 0);
    const multi = ans.filter((r) => r.spans >= 2);
    lines.push(`## Yapılandırma \`${cfg}\``, "");
    lines.push(`| ölçü | sonuç |`, `|---|---|`);
    const und = (k: string) => rs.filter((r) => r.und === k).length;
    lines.push(`| anlama katmanı (koştu · boş döndü · gerek yok · kapalı) | ${und("ok")} · ${und("null")} · ${und("not_needed")} · ${und("off")} |`);
    lines.push(`| yalnız "Giriş Talimatı"nda kalan alıntı (QR ve rezervasyon öncesi görmez) | ${ans.reduce((a, r) => a + r.accessOnly, 0)} alıntı · ${ans.filter((r) => r.accessOnly > 0).length} soru |`);
    lines.push(`| içe aktarmada kaybolmayan alıntı | ${pct(ans.reduce((a, r) => a + r.imported, 0), ans.reduce((a, r) => a + r.spans, 0))} |`);
    lines.push(`| çok alıntılı soruda hepsi aynı kalemde | ${pct(multi.filter((r) => r.sameItem).length, multi.length)} |`);
    lines.push(`| çok alıntılı soruda hepsi aynı parçada | ${pct(multi.filter((r) => r.sameChunk).length, multi.length)} |`);
    lines.push(`| **bağlam tam (bütün alıntılar modelde)** | **${pct(ans.filter((r) => r.complete).length, ans.length)}** |`);
    lines.push(`| en az bir alıntı modelde | ${pct(ans.filter((r) => r.any).length, ans.length)} |`);
    const neg = rs.filter((r) => !r.answerable);
    if (neg.length > 0) lines.push(`| cevapsız soruda ortalama seçilen parça | ${(neg.reduce((a, r) => a + r.selected, 0) / neg.length).toFixed(1)} (${neg.length} soru) |`);
    lines.push("", `| kategori | soru | bağlam tam | en az biri | aynı parçada |`, `|---|---|---|---|---|`);
    for (const cat of [...new Set(ans.map((r) => r.category))].sort()) {
      const c = ans.filter((r) => r.category === cat);
      lines.push(`| ${cat} | ${c.length} | ${pct(c.filter((r) => r.complete).length, c.length)} | ${pct(c.filter((r) => r.any).length, c.length)} | ${pct(c.filter((r) => r.sameChunk).length, c.length)} |`);
    }
    const fails = ans.filter((r) => !r.complete).slice(0, 25);
    if (fails.length > 0 && !details) lines.push("", `(Kör küme: ${ans.filter((r) => !r.complete).length} eksik bağlamlı sorunun ayrıntısı yazılmaz — ayar için okunmaz.)`);
    if (fails.length > 0 && details) {
      lines.push("", `Eksik bağlamlı ilk ${fails.length} soru (eksik alıntı):`, "");
      for (const f of fails) lines.push(`- ${f.qid} [${f.category}] ${f.inBlock}/${f.spans} — eksik: ${f.missing.map((m) => `«${m.slice(0, 90)}»`).join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const hasFile = existsSync(FILE);
const requested = process.env.EVAL_RAG_LONG === "1" || process.env.RUN_REAL_EVAL === "1";

describe(`uzun belge RAG — ${SET}`, () => {
  // Anlama katmanı üretimde AÇIK (`AI_UNDERSTANDING_ENABLED=1`, canlı); ölçer de açar — 10-28 ilk koşular bunu vermediği için katman
  // sessizce kapalı koşmuştu (aşağıdaki anti-vakum artık bunu koşuyu düşürerek yakalar). `rag-lab.eval.test.ts` ile aynı kurulum.
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetKbIndexCache();
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
  });
  it.runIf(hasFile && requested)("içe aktarma + getirme: bağlam tamlığı ölçülür, rapor yazılır", { timeout: 3_600_000 }, async () => {
    const set = JSON.parse(readFileSync(FILE, "utf8")) as LongSet;
    const configs = CONFIG_NAMES.map(parseConfig);
    for (const c of configs) {
      const paid = c.semantic !== null || c.understanding || c.rerank !== null;
      if (paid && !paidOk) throw new Error(`"${c.name}" ücretli yapılandırma: RUN_REAL_EVAL=1 + OPENAI_API_KEY gerekir`);
    }
    // Anti-vakum: her soru bir belgeye bağlı, her alıntı belgesinde birebir var (yazım hatası ölçümü sessizce bozmasın).
    const docById = new Map(set.documents.map((d) => [d.id, d]));
    for (const q of set.questions) {
      const doc = docById.get(q.docId);
      expect(doc, q.id).toBeDefined();
      for (const s of q.requiredSpans) expect(norm(doc!.text).includes(norm(s)), `${q.id}: «${s}»`).toBe(true);
    }
    const bg = backgroundItems(BACKGROUND);
    const itemsByDoc = new Map(set.documents.map((d) => [d.id, [...itemsFromDocument(d), ...bg]]));
    const docs = new Map(set.documents.map((d) => [d.id, { items: itemsByDoc.get(d.id)!.length - bg.length, chars: d.text.length }]));

    const rows: LongRow[] = [];
    for (const cfg of configs) {
      const queue = [...set.questions];
      const work = async () => {
        for (let q = queue.shift(); q; q = queue.shift()) {
          const items = itemsByDoc.get(q.docId)!;
          const lq: LabQuery = {
            id: q.id,
            group: q.category,
            cls: q.category,
            lang: q.lang,
            text: q.text,
            answers: q.requiredSpans.map((s) => ({ needles: [s], goldIds: [] })),
          };
          const run = await runPipeline(items, lq, cfg, NOW);
          rows.push(evaluate(q, items, run.text, cfg.name, run.result.items.length, run.undStatus));
        }
      };
      await Promise.all(Array.from({ length: WORKERS }, work));
    }
    rows.sort((a, b) => a.config.localeCompare(b.config) || a.qid.localeCompare(b.qid));
    const outDir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(outDir, { recursive: true });
    const stamp = `rag-uzun-belge-${set.split}-bg${BACKGROUND}-${CONFIG_NAMES.join("_").replace(/[^a-z0-9_.-]/gi, "")}${TAG ? `-${TAG}` : ""}-2026-10-28`;
    const outRows = DETAILS ? rows : rows.map(({ missing: _missing, ...r }) => r);
    writeFileSync(path.join(outDir, `${stamp}.json`), JSON.stringify({ set: set.split, author: set.author, configs: CONFIG_NAMES, background: BACKGROUND, rows: outRows }, null, 1));
    writeFileSync(path.join(outDir, `${stamp}.md`), report(rows, set, docs, DETAILS, BACKGROUND));
    expect(rows.length).toBe(set.questions.length * configs.length);
    // Anti-vakum: anlamalı yapılandırma seçim yapılan boyutta (arka planlı) koştuysa katmanın gerçekten sonuç vermiş olması gerekir.
    for (const c of configs.filter((x) => x.understanding)) {
      const cr = rows.filter((r) => r.config === c.name && r.und !== "not_needed");
      if (cr.length > 0) expect(cr.filter((r) => r.und === "ok").length, `${c.name}: anlama katmanı sonuç vermedi`).toBeGreaterThanOrEqual(Math.ceil(cr.length * 0.9));
    }
  });
});
