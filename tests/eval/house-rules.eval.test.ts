import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { understandGuestMessages, __resetUnderstandingCache } from "@/lib/ai/semantic/understand";
import { semanticModel, semanticReasoningEffort } from "@/lib/ai/semantic/config";
import { detectRiskTypes } from "@/lib/ai/fallback";
import { HOUSE_RULE_TOPICS, RULE_STANCES, type RuleUnderstanding } from "@/lib/house-rules/core";
import { writeSidecar } from "./sidecar";
import { summarizeHouseRules, houseRuleMetricsLines, type HouseRuleEvalRow } from "./house-rules-metrics";

// ---------------------------------------------------------------------------
// EV KURALLARI — ANLAMA KATMANI KONU + TUTUM EVAL'İ (#188, 09-26). Kural kararını koda bağlamadan ÖNCE (tasarım §6 sırası:
// gölge → ücretli kör ölçüm → kurucu onayı) katmanın misafirin mesajındaki kural konusunu ve TUTUMUNU ("izin istiyor /
// yapacağını söylüyor / kuralı soruyor / misafirin eylemi değil") ne kadar doğru okuduğunu ölçer.
// Katman CANLININ kipinde çağrılır: öğe kipi (`AI_CONVERSATION_ITEMS_ENABLED` canlıda açık) + kural kipi. Etiket ile çıktı
// AYNI karar tablosundan geçer (`house-rules-metrics.ts`): sınıflar SONUÇ farkıdır (misafire yanlış kural cümlesi, ev sahibine
// haber eksik, "misafir değil" diye atlanan gerçek istek…). Bugünkü kelime listesi (`rule_violation` ağı) aynı satırlarda
// kıyas tabanı.
// VERİ `evals/house-rules.json`: `dev` = kural istemi ekini yazan geliştiricinin yazdığı set (GÖRÜLDÜ, iyimser); açma kararı
// YALNIZ kör yazılmış `holdout` satırlarıyla. İKİ KAPI: `RUN_REAL_EVAL=1` + anahtar (bulutta `NODE_USE_ENV_PROXY=1`).
// Eksik koşu "GEÇTİ" diye okunamaz: satırların %5'inden fazlası düşerse rapor GEÇERSİZ. LLM hakem YOK.
// ---------------------------------------------------------------------------

const DATASET = path.resolve(__dirname, "../../evals/house-rules.json");
const key = process.env.OPENAI_API_KEY?.trim() ?? "";
const enabled = process.env.RUN_REAL_EVAL === "1" && key.length > 20 && !key.startsWith("test-");
const LIMIT = Number(process.env.EVAL_HR_LIMIT) > 0 ? Math.trunc(Number(process.env.EVAL_HR_LIMIT)) : Infinity;
const SPLITS = ["dev", "holdout"] as const;
const CONCURRENCY = 4;

interface Case {
  id: string;
  split: (typeof SPLITS)[number];
  lang: string;
  text: string;
  history?: { dir: "in" | "out"; body: string }[];
  expect: RuleUnderstanding[];
}
interface Dataset {
  version: number;
  suite: string;
  note: string;
  cases: Case[];
}

const data = JSON.parse(readFileSync(DATASET, "utf8")) as Dataset;

async function pool<T>(items: readonly T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const fmt = (list: readonly RuleUnderstanding[] | null) => (list === null ? "DÜŞTÜ" : list.map((u) => `${u.topic}/${u.stance}`).join(" ") || "—");

describe("ev kuralları — anlama katmanı konu + tutum eval'i", () => {
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of ["AI_UNDERSTANDING_ENABLED"]) saved[k] = process.env[k];
    if (enabled) process.env.AI_UNDERSTANDING_ENABLED = "1";
    __resetUnderstandingCache();
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("veri seti: kapalı kümeler, tekil kimlik, her konu × tutum dev bölümünde temsil ediliyor", () => {
    expect(data.suite).toBe("house-rules");
    const ids = new Set<string>();
    for (const c of data.cases) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(SPLITS as readonly string[]).toContain(c.split);
      expect(c.id.startsWith(c.split === "dev" ? "d-" : "h-"), c.id).toBe(true);
      expect(c.text.trim().length).toBeGreaterThan(0);
      const topics = new Set<string>();
      for (const e of c.expect) {
        expect(HOUSE_RULE_TOPICS as readonly string[]).toContain(e.topic);
        expect(RULE_STANCES as readonly string[]).toContain(e.stance);
        expect(topics.has(e.topic), `${c.id} aynı konu iki kez`).toBe(false);
        topics.add(e.topic);
      }
      for (const h of c.history ?? []) expect(["in", "out"]).toContain(h.dir);
    }
    const dev = data.cases.filter((c) => c.split === "dev");
    for (const t of HOUSE_RULE_TOPICS) {
      for (const s of RULE_STANCES) {
        // Sessiz saatlerde "yapacağız" tek başına zor yazılır (kutlama/ziyaretle birlikte gelir) — çoklu istek satırında var.
        expect(
          dev.some((c) => c.expect.some((e) => e.topic === t && e.stance === s)),
          `${t}/${s} dev bölümünde yok`,
        ).toBe(true);
      }
    }
    expect(dev.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(5);
  });

  it.skipIf(!enabled)(
    "anlama katmanı (gerçek model, canlı kip: öğe + kural)",
    async () => {
      const cases = SPLITS.flatMap((sp) => data.cases.filter((c) => c.split === sp).slice(0, LIMIT));
      const rows: (HouseRuleEvalRow & { split: string })[] = [];
      let failures = 0;
      await pool(cases, async (c) => {
        const thread = [
          ...(c.history ?? []).map((h) => ({ direction: h.dir === "in" ? ("inbound" as const) : ("outbound" as const), body: h.body })),
          { direction: "inbound" as const, body: c.text },
        ];
        const u = await understandGuestMessages({ guestMessage: c.text, history: thread, items: true, rules: true });
        const keyword = detectRiskTypes(c.text).includes("rule_violation");
        if (u.status !== "ok") {
          failures++;
          rows.push({ id: c.id, split: c.split, lang: c.lang, expect: c.expect, keyword, predicted: null });
          return;
        }
        const predicted = u.value.requests.flatMap((r) => (r.rule ? [r.rule] : []));
        rows.push({ id: c.id, split: c.split, lang: c.lang, expect: c.expect, keyword, predicted });
      });
      rows.sort((a, b) => a.id.localeCompare(b.id));

      const status = failures > cases.length * 0.05 ? `GEÇERSİZ — ${failures} satır düştü` : failures > 0 ? `GEÇERLİ (${failures} düşüş)` : "GEÇERLİ";
      let commit = "?";
      try {
        commit = execSync("git rev-parse --short HEAD", { cwd: path.resolve(__dirname, "../..") }).toString().trim();
      } catch {
        /* git yoksa "?" */
      }
      const date = new Date().toISOString().slice(0, 10);
      const lines = [
        `# Ev kuralları — anlama katmanı konu + tutum eval'i (${date})`,
        "",
        `Durum: **${status}** · commit \`${commit}\` · veri sürümü ${data.version} · ${cases.length} satır`,
        `Model: \`${semanticModel("understanding")}\` · reasoning_effort: ${semanticReasoningEffort("understanding") ?? "model varsayılanı"} · anlama kipi: öğe + kural (canlının kipi)`,
        "",
        "`dev` bölümü kural istemi ekini yazan geliştiricinin yazdığı settir (GÖRÜLDÜ, iyimser). Karara bağlama onayı YALNIZ kör",
        "yazılmış `holdout` bölümüyle. Sınıflar etiket ile modelin çıktısının AYNI karar tablosundan geçmesiyle bulunur",
        "(`tests/eval/house-rules-metrics.ts`): \"konu yok\" ile \"misafirin eylemi değil\" aynı sonuçtur.",
        "",
      ];
      for (const sp of SPLITS) {
        const part = rows.filter((r) => r.split === sp);
        if (part.length === 0) continue;
        const m = summarizeHouseRules(part);
        lines.push(`## ${sp}`, "", ...houseRuleMetricsLines(m), "", "| dil | konu bulundu | konu olmayanda olumlu konu |", "|---|---|---|");
        for (const [lang, l] of Object.entries(m.byLang).sort()) {
          lines.push(`| ${lang} | ${l.topicHit}/${l.positives} | ${l.negativeFalse}/${l.negatives} |`);
        }
        lines.push("");
      }
      lines.push("## Satır başına", "", "| kimlik | dil | etiket | model | kelime listesi |", "|---|---|---|---|---|");
      for (const r of rows) lines.push(`| ${r.id} | ${r.lang} | ${fmt(r.expect)} | ${fmt(r.predicted)} | ${r.keyword ? "tuttu" : "—"} |`);
      lines.push("");

      const dir = path.resolve(__dirname, "../../docs/olcum");
      mkdirSync(dir, { recursive: true });
      // Rapor adı / başlığı / yan dosya ANLAMA KATMANININ çözücüsüyle (10-10: katmansız `semanticModel()` okunuyordu —
      // `AI_UNDERSTANDING_MODEL` / `…_REASONING_EFFORT` ayarlıyken başlık ortak ayarı yazıyordu; ölçümün kendisi doğruydu).
      const stem = `ev-kurallari-eval-${date}-${semanticModel("understanding").replace(/[^a-z0-9.-]+/gi, "_")}`;
      let name = `${stem}.md`;
      for (let n = 2; existsSync(path.join(dir, name)); n++) name = `${stem}-${n}.md`;
      writeFileSync(path.join(dir, name), lines.join("\n"));
      writeSidecar(dir, name, {
        suite: "house-rules",
        version: data.version,
        meta: { status, failures, commit, model: semanticModel("understanding"), mode: "items+rules" },
        rows,
      });
      expect(failures).toBeLessThanOrEqual(Math.floor(cases.length * 0.05));
    },
    30 * 60_000,
  );
});
