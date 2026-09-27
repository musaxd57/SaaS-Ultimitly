import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { embeddingModel } from "@/lib/ai/embeddings/provider";
import { semanticModel } from "@/lib/ai/semantic/config";
import { makeSyntheticKb } from "../helpers/kb-retrieval-synthetic";
import { e4Queries } from "./e4-shared";
import { writeSidecar } from "./sidecar";
import { cacheStats, OfflineMiss, RAG_LAB_CACHE } from "./rag-lab/cache";
import { labRow, latencyLines, reportLines, type LabConfig, type LabItem, type LabQuery, type LabRow } from "./rag-lab/core";
import { parseConfig, CAP, RR, T_PROD } from "./rag-lab/config";
import { buildScaleLab, kbForQuery, loadScaleFile } from "./rag-lab/scale-set";

// ---------------------------------------------------------------------------
// RAG LAB — AŞAMA BAZLI KAYIP ÖLÇÜMÜ (#189, kurucu 09-26 gece modu: "300 kalemde bile ≥%95; önce ölçüyü düzeltin").
// Üretimin boru hattını (okuma tavanı · onay süzgeci · anlama katmanı · anlamsal eşik · yeniden sıralayıcı · bütçe) AYNEN
// koşar ve her kaçan cevabın hangi aşamada kaybolduğunu yazar (`rag-lab/core.ts`). Model çıktıları + gömmeler disk önbellekli.
// İKİ KAPI: RUN_REAL_EVAL=1 + anahtar. Yapılandırmalar `EVAL_RAG_CONFIGS` (virgüllü ad listesi), boyutlar `EVAL_RAG_SIZES`,
// ücretli katmanın (anlama + yeniden sıralayıcı) grupları `EVAL_RAG_PAID_GROUPS`.
// Veri: E4 SENTETİK kümesi (konu başına tekrarlanan varyantlar — bilinen yapay zorluk; ayrı gerçekçi set ↓ dosyalar).
// ---------------------------------------------------------------------------

const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const NOW = Date.UTC(2026, 8, 23, 12);

const CONFIGS = (process.env.EVAL_RAG_CONFIGS?.split(",").map((s) => s.trim()).filter(Boolean) ?? ["lex", `s${T_PROD}`, "s0.3", `s${T_PROD}+und`, "prod", "s0.3+und+rr20/600"]).map(parseConfig);
/** Tek soru gruplarından her N'inci soru (ücretli koşu bütçesi; 1 = hepsi). */
const SAMPLE = Math.max(1, Math.trunc(Number(process.env.EVAL_RAG_SAMPLE) || 1));
const SIZES = (process.env.EVAL_RAG_SIZES?.split(",").map((s) => Number(s.trim())).filter((n) => n > 0) ?? [100, 300]) as number[];
const PAID_GROUPS = new Set(process.env.EVAL_RAG_PAID_GROUPS?.split(",").map((s) => s.trim()) ?? ["para", "multi", "neg"]);
const GROUPS = new Set(
  process.env.EVAL_RAG_GROUPS?.split(",").map((s) => s.trim()) ?? ["scale", "para", "multi", "neg", "single_tr", "single_xx", "draft", "version", "conflict"],
);
/** Hangi küme: e4 (sentetik tekrar) · scale (gerçekçi ayrı olgu, dev) · holdout (yalnız son doğrulama) — virgüllü. */
const KBS = new Set(process.env.EVAL_RAG_KB?.split(",").map((s) => s.trim()) ?? ["e4"]);
/** Gerçekçi set boyutları (0 = tamamı, ~300). */
const SCALE_SIZES = (process.env.EVAL_RAG_SCALE_SIZES?.split(",").map((s) => Number(s.trim())) ?? [60, 0]).filter((n) => Number.isFinite(n) && n >= 0);
/** `EVAL_RAG_KB=perq`: soru başına gerçekçi boyutlu bilgi tabanı (↓`kbForQuery`); ürünün plan tavanı mülk başına 60 kayıt. */
const PERQ_SIZES = (process.env.EVAL_RAG_PERQ_SIZES?.split(",").map((s) => Number(s.trim())).filter((n) => n > 0) ?? [60]) as number[];

export function e4LabSet(size: number): { items: LabItem[]; queries: LabQuery[] } {
  const kb = makeSyntheticKb(size);
  const items: LabItem[] = kb.items.map((i) => ({ ...i, reviewState: "legacy" }));
  const queries: LabQuery[] = e4Queries(kb).map((q) => ({
    id: q.id,
    group: q.group,
    cls: q.cls,
    lang: q.cls.endsWith("_en") || q.cls === "en" ? "en" : "tr",
    text: q.text,
    answers:
      q.group === "neg"
        ? []
        : q.needleGroups
          ? q.needleGroups.map((g, gi) => ({ needles: g, goldIds: q.goldGroups?.[gi] ?? q.goldIds }))
          : [{ needles: q.needles, goldIds: q.goldIds }],
  }));
  return { items, queries };
}

/**
 * Soru başına zaman bekçisi (09-26: bir koşu ağ beklemeden askıda kaldı, hangi soruda olduğu görülemedi). Aşılırsa koşu
 * düşer ve rapor GEÇERSİZ yazılır — takılan yapılandırma/soru hata iletisinde.
 */
const WATCHDOG_MS = Math.max(10_000, Number(process.env.EVAL_RAG_WATCHDOG_MS) || 180_000);
function withWatchdog<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`rag-lab bekçisi: ${label} ${WATCHDOG_MS} ms içinde bitmedi`)), WATCHDOG_MS);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

const isPaid = (c: LabConfig) => c.understanding || (c.rerank !== null && c.rerank.dry !== true);
/**
 * EŞLEŞTİRİLMİŞ ÖNBELLEK ALT KÜMESİ (`RAG_LAB_OFFLINE=1` + `RAG_LAB_OFFLINE_SKIP=1`; 09-26 gece, kredi bitti): önbellekte
 * çıktısı olmayan soru HİÇBİR yapılandırmada sayılmaz (paired) — ücretsiz ön tahmin. Alt küme rastgele değildir (yarım kalan
 * koşunun başarılı çağrıları); rapor alt küme boyunu ve çıkarılan soru sayısını yazar, tam ölçümün yerini TUTMAZ.
 */
const OFFLINE_SKIP = process.env.RAG_LAB_OFFLINE === "1" && process.env.RAG_LAB_OFFLINE_SKIP === "1";
const skippedQs = new Set<string>();

describe.skipIf(!enabled)("RAG LAB — aşama bazlı kayıp (gerçek gömme + önbellekli model)", () => {
  const rows: LabRow[] = [];
  const saved = process.env.AI_UNDERSTANDING_ENABLED;
  /** Koşan her `it` sonunda artar; afterAll beklenenle kıyaslar. */
  let finished = 0;
  let started = 0;
  let complete = true;
  beforeAll(() => {
    process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetKbIndexCache();
    __resetUnderstandingCache();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.AI_UNDERSTANDING_ENABLED;
    else process.env.AI_UNDERSTANDING_ENABLED = saved;
    if (skippedQs.size > 0) {
      const keep = rows.filter((r) => !skippedQs.has(`${r.kb}|${r.size}|${r.qid}`));
      rows.length = 0;
      rows.push(...keep);
    }
    if (rows.length === 0) return;
    complete = finished === started;
    let commit = "?";
    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    } catch {
      /* uydurma yazılmaz */
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const meta = {
      commit,
      gömme: embeddingModel(),
      model: semanticModel(),
      "canlı eşik": T_PROD,
      "okuma tavanı": CAP,
      "yeniden sıralayıcı": `ilk ${RR.k} · kırpma ${RR.crop}`,
      "ücretli gruplar": [...PAID_GROUPS].join(","),
      önbellek: RAG_LAB_CACHE,
      çağrılar: cacheStats(),
      ...(OFFLINE_SKIP ? { "EŞLEŞTİRİLMİŞ ÖNBELLEK ALT KÜMESİ": `önbellekte olmayan ${skippedQs.size} soru TÜM yapılandırmalardan çıkarıldı (ön tahmin, tam ölçüm DEĞİL)` } : {}),
    };
    // EKSİK KOŞU "GEÇTİ" DİYE OKUNAMAZ: bir `it` yarıda kaldıysa rapor başlığı GEÇERSİZ der (satırlar teşhis için yine yazılır).
    const title = complete ? `RAG lab — aşama bazlı kayıp (${stamp})` : `GEÇERSİZ — koşu yarıda kaldı — RAG lab (${stamp})`;
    const lines = reportLines(rows, title, { ...meta, durum: complete ? "tamam" : "YARIDA KALDI (sonuç sayılmaz)" });
    lines.push("", ...latencyLines(rows));
    const dir = path.resolve(__dirname, "../../docs/olcum");
    mkdirSync(dir, { recursive: true });
    let name = `rag-lab-${stamp}.md`;
    for (let n = 2; existsSync(path.join(dir, name)); n++) name = `rag-lab-${stamp}-${n}.md`;
    writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
    writeSidecar(dir, name, { suite: "rag-lab", version: 1, meta, rows });
  });

  async function runSet(kbName: string, size: number, items: LabItem[] | ((q: LabQuery) => LabItem[]), queries: LabQuery[]) {
    for (const cfg of CONFIGS) {
      // Örnekleme GRUP İÇİ sırayla (09-26 hatası: genel sıra tr/xx dönüşümlü olduğu için "her 4." yalnız Türkçe soruları alıyordu).
      const seen = new Map<string, number>();
      const qs = queries.filter((q) => {
        if (!GROUPS.has(q.group) || (isPaid(cfg) && !PAID_GROUPS.has(q.group))) return false;
        if (!q.group.startsWith("single")) return true;
        const n = seen.get(q.group) ?? 0;
        seen.set(q.group, n + 1);
        return n % SAMPLE === 0;
      });
      let i = 0;
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (i < qs.length) {
            const q = qs[i++];
            try {
              const kb = typeof items === "function" ? items(q) : items;
              rows.push(await withWatchdog(labRow(kbName, size, kb, q, cfg, NOW), `${cfg.name} · ${q.id}`));
            } catch (err) {
              if (!(OFFLINE_SKIP && err instanceof OfflineMiss)) throw err;
              skippedQs.add(`${kbName}|${size}|${q.id}`);
            }
            if (rows.length % 200 === 0) console.error(`[rag-lab] ${rows.length} satır · ${kbName}/${size} · ${cfg.name}`);
          }
        }),
      );
    }
  }

  it.skipIf(!KBS.has("scale") && !KBS.has("holdout"))("gerçekçi ayrı olgu seti (dev / holdout)", async () => {
    started += 1;
    for (const split of ["dev", "holdout"] as const) {
      if (!KBS.has(split === "dev" ? "scale" : "holdout")) continue;
      const file = loadScaleFile(split);
      if (!file) throw new Error(`evals/rag-scale/${split}.json yok — önce üretici (RAG_GEN=1)`);
      for (const size of SCALE_SIZES) {
        const { items, queries } = buildScaleLab(file, size || undefined);
        await runSet(split === "dev" ? "scale-dev" : "scale-holdout", size || items.length, items, queries);
      }
    }
    finished += 1;
    expect(rows.length).toBeGreaterThan(0);
  }, 120 * 60_000);

  it.skipIf(!KBS.has("perq"))("gerçek müşteri boyutu: soru başına N kalemlik bilgi tabanı (dev)", async () => {
    started += 1;
    const file = loadScaleFile("dev");
    if (!file) throw new Error("evals/rag-scale/dev.json yok");
    const { items, queries } = buildScaleLab(file);
    for (const size of PERQ_SIZES) await runSet("perq-dev", size, (q) => kbForQuery(items, q, size), queries);
    finished += 1;
    expect(rows.length).toBeGreaterThan(0);
  }, 120 * 60_000);

  it.skipIf(!KBS.has("e4"))("E4 kümesi: boyut × yapılandırma × grup", async () => {
    started += 1;
    for (const size of SIZES) {
      const { items, queries } = e4LabSet(size);
      await runSet("e4", size, items, queries);
    }
    finished += 1;
    expect(rows.length).toBeGreaterThan(0);
  }, 60 * 60_000);
});
