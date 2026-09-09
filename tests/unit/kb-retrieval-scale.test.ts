import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { KB_ITEM_CAP } from "@/lib/ai/limits";
import { packKnowledgeBase } from "@/lib/ai/prompts";
import { selectKbForPrompt, type KbSelectSources } from "@/lib/ai/retrieval/select";
import { __resetKbIndexCache } from "@/lib/ai/retrieval/index-cache";
import { makeSyntheticKb, updatedItem, type SynQuestion, type SyntheticKb } from "../helpers/kb-retrieval-synthetic";

// ---------------------------------------------------------------------------
// ÖLÇEK HARNESS'I — 30 / 100 / 300 kalem, GERÇEK retrieval yolu (RAG dilim 2).
//
// Codex şartı: küçük-KB passthrough'u değil, seçim yapan yolu ölç; legacy
// (en yeni 30 + 24k) ile aynı soruları koş; doğru kaynağı bulma (hit@1/hit@3,
// kalem kimliğiyle), istem bloğunda doğru kaynak (inPrompt), gürültü, karakter
// (maliyet vekili), gecikme (soğuk/ılık), güncelleme ve silme sonrası doğruluk.
// Dört yapılandırma: legacy · hibrit bm25-yalnız · hibrit RRF · hibrit birleşik (CombSUM, varsayılan).
// Eşikler ÖLÇÜLEN değerlerin altına pay bırakılarak pinlendi (09-09: hit@1 .92–.94, hit@3 .95–.99, inPrompt .99–1.0).
// Model YOK: "cevabın kaynakla desteklenmesi" burada ölçülmez (gerçek eval işi).
// Rapor: KB_RETRIEVAL_REPORT=1 → docs/olcum/kb-retrieval-scale-<tarih>.md
// ---------------------------------------------------------------------------

const SIZES = [30, 100, 300] as const;

interface ConfigResult {
  name: string;
  hit1: number;
  hit3: number;
  inPrompt: number;
  noise: number;
  chars: number;
  coldMs: number;
  warmP50: number;
  warmP95: number;
  fallbacks: number;
  perKind: Record<string, { n: number; inPrompt: number }>;
}

interface SizeResult {
  n: number;
  items: number;
  questions: number;
  configs: ConfigResult[];
  updateOk: number;
  updateTotal: number;
  deleteOk: number;
  deleteTotal: number;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

function legacyPrompt(kb: SyntheticKb): { ids: string[]; text: string } {
  const sorted = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const sel = sorted.slice(0, KB_ITEM_CAP);
  // packKnowledgeBase karakter bütçesi de uygulanır: bloğa GİREN kalemler ölçülür.
  const text = packKnowledgeBase(sel, kb.items.length - sel.length).text;
  const ids = sel.filter((i) => text.includes(`] ${i.title}:`)).map((i) => i.id);
  return { ids, text };
}

function runConfig(kb: SyntheticKb, name: string, sources: KbSelectSources | null): ConfigResult {
  const sorted = [...kb.items].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  let hit1 = 0;
  let hit3 = 0;
  let inPrompt = 0;
  let noise = 0;
  let chars = 0;
  let fallbacks = 0;
  const warm: number[] = [];
  const perKind: Record<string, { n: number; inPrompt: number }> = {};
  let coldMs = 0;
  const legacy = sources === null ? legacyPrompt(kb) : null;
  kb.questions.forEach((q, qi) => {
    const gold = new Set(q.goldIds);
    let orderedIds: string[] = [];
    let text = "";
    if (legacy) {
      orderedIds = legacy.ids;
      text = legacy.text;
    } else {
      if (qi === 0) __resetKbIndexCache();
      const t0 = performance.now();
      const r = selectKbForPrompt({ items: sorted, guestMessage: q.text, mode: "hybrid", sources: sources ?? undefined });
      const ms = performance.now() - t0;
      if (qi === 0) coldMs = ms;
      else warm.push(ms);
      if (r.evidence?.fb && r.evidence.fb !== "none") fallbacks += 1;
      orderedIds = [];
      for (const it of r.items) if (!orderedIds.includes(it.id)) orderedIds.push(it.id);
      text = packKnowledgeBase(r.items, r.droppedItems, r.selection).text;
    }
    const goldPresent = q.mustContain ? text.includes(q.mustContain) : orderedIds.some((id) => gold.has(id));
    if (!legacy) {
      if (orderedIds[0] && gold.has(orderedIds[0])) hit1 += 1;
      if (orderedIds.slice(0, 3).some((id) => gold.has(id))) hit3 += 1;
    } else {
      // Legacy sıralama sorguya bakmaz: hit@k anlamsız; yalnız blokta var mı.
      if (goldPresent) {
        hit1 += 0;
        hit3 += 0;
      }
    }
    if (goldPresent) inPrompt += 1;
    noise += orderedIds.filter((id) => !gold.has(id)).length;
    chars += text.length;
    const pk = (perKind[q.kind] ??= { n: 0, inPrompt: 0 });
    pk.n += 1;
    if (goldPresent) pk.inPrompt += 1;
  });
  const Q = kb.questions.length;
  return {
    name,
    hit1: hit1 / Q,
    hit3: hit3 / Q,
    inPrompt: inPrompt / Q,
    noise: noise / Q,
    chars: Math.round(chars / Q),
    coldMs: Math.round(coldMs * 10) / 10,
    warmP50: Math.round(percentile(warm, 0.5) * 10) / 10,
    warmP95: Math.round(percentile(warm, 0.95) * 10) / 10,
    fallbacks,
    perKind,
  };
}

/** Güncelleme/silme sonrası doğruluk — hibrit birleşik yapılandırma. */
function updateDelete(kb: SyntheticKb): { updateOk: number; updateTotal: number; deleteOk: number; deleteTotal: number } {
  const topics = [...kb.goldByTopic.keys()].slice(0, 10);
  let updateOk = 0;
  let deleteOk = 0;
  for (const topic of topics) {
    const q = kb.questions.find((x) => x.topic === topic && x.kind === "tr") as SynQuestion;
    const goldId = kb.goldByTopic.get(topic)![0];
    // Güncelleme: içerik + updatedAt değişir → seçilen metin YENİ işareti taşımalı.
    const marker = `GNCL-${goldId}`;
    const updated = kb.items.map((i) => (i.id === goldId ? updatedItem(i, marker, Date.UTC(2026, 8, 9)) : i));
    const r1 = selectKbForPrompt({ items: updated, guestMessage: q.text, mode: "hybrid" });
    const sel1 = r1.items.find((i) => i.id === goldId);
    if (sel1 && sel1.content.includes(marker)) updateOk += 1;
    // Silme: konunun TÜM kalemleri gider → hiçbiri seçilemez; önbellek eski parçayı döndüremez.
    const goldSet = new Set(kb.goldByTopic.get(topic));
    const deleted = kb.items.filter((i) => !goldSet.has(i.id));
    const r2 = selectKbForPrompt({ items: deleted, guestMessage: q.text, mode: "hybrid" });
    if (!r2.items.some((i) => goldSet.has(i.id))) deleteOk += 1;
  }
  return { updateOk, updateTotal: topics.length, deleteOk, deleteTotal: topics.length };
}

const results: SizeResult[] = SIZES.map((n) => {
  const kb = makeSyntheticKb(n);
  const configs = [
    runConfig(kb, "legacy (en yeni 30 + 24k)", null),
    runConfig(kb, "hibrit bm25", { ngram: false }),
    runConfig(kb, "hibrit RRF (bm25+ngram)", { ngram: true, fusion: "rrf" }),
    runConfig(kb, "hibrit birleşik (bm25+ngram, CombSUM)", { ngram: true, fusion: "sum" }),
  ];
  return { n, items: kb.items.length, questions: kb.questions.length, configs, ...updateDelete(kb) };
});

const cfg = (n: number, name: string) => results.find((r) => r.n === n)!.configs.find((c) => c.name.startsWith(name))!;

describe("ölçek harness'ı — 30/100/300 kalem, gerçek retrieval yolu", () => {
  it("küçük-KB passthrough DEĞİL: her boyutta seçim yapılıyor (geri çekilme azınlıkta)", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit birleşik");
      expect(c.fallbacks / results.find((r) => r.n === n)!.questions, `n=${n}`).toBeLessThan(0.15);
    }
  });

  it("🚨 LEGACY'nin ölçülen açığı: 100 ve 300 kalemde doğru kaynak çoğu soruda BLOĞA GİRMİYOR; hibrit giriyor", () => {
    for (const n of [100, 300] as const) {
      expect(cfg(n, "legacy").inPrompt, `legacy n=${n}`).toBeLessThan(0.6);
      expect(cfg(n, "hibrit birleşik").inPrompt, `hibrit n=${n}`).toBeGreaterThan(0.85);
    }
  });

  it("hibrit birleşik hiçbir boyutta bm25-yalnızdan az isabet etmez (n-gram kaynağı regresyon değil)", () => {
    for (const n of SIZES) {
      expect(cfg(n, "hibrit birleşik").inPrompt, `n=${n}`).toBeGreaterThanOrEqual(cfg(n, "hibrit bm25").inPrompt - 1e-9);
    }
  });

  it("doğru kaynak sıralamada önde: hit@1 ≥ 0.85, hit@3 ≥ 0.9, inPrompt ≥ 0.95 (birleşik, her boyut)", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit birleşik");
      expect(c.hit1, `hit@1 n=${n}`).toBeGreaterThanOrEqual(0.85);
      expect(c.hit3, `hit@3 n=${n}`).toBeGreaterThanOrEqual(0.9);
      expect(c.inPrompt, `inPrompt n=${n}`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("birleşim seçimi ÖLÇÜMLE: CombSUM hiçbir boyutta RRF'den az isabet etmez ve daha az gürültü taşır", () => {
    for (const n of SIZES) {
      expect(cfg(n, "hibrit birleşik").hit1, `n=${n}`).toBeGreaterThanOrEqual(cfg(n, "hibrit RRF").hit1 - 1e-9);
      expect(cfg(n, "hibrit birleşik").noise, `n=${n}`).toBeLessThanOrEqual(cfg(n, "hibrit RRF").noise);
    }
  });

  it("rehberde GÖMÜLÜ gerçekler bulunur (uzun metin ortası, her boyut)", () => {
    for (const n of SIZES) {
      const c = cfg(n, "hibrit birleşik");
      expect(c.perKind.guide.inPrompt / c.perKind.guide.n, `n=${n}`).toBeGreaterThanOrEqual(0.66);
    }
  });

  it("maliyet: hibrit blok legacy'nin yarısından küçük; gürültü daha az", () => {
    for (const n of SIZES) {
      expect(cfg(n, "hibrit birleşik").chars, `n=${n}`).toBeLessThan(cfg(n, "legacy").chars / 2);
      expect(cfg(n, "hibrit birleşik").noise, `n=${n}`).toBeLessThan(cfg(n, "legacy").noise);
    }
  });

  it("gecikme: 300 kalemde soğuk indeks < 400 ms, ılık p95 < 60 ms (bu makine; CI'da gevşek)", () => {
    const c = cfg(300, "hibrit birleşik");
    expect(c.coldMs).toBeLessThan(400);
    expect(c.warmP95).toBeLessThan(60);
  });

  it("GÜNCELLEME ve SİLME sonrası doğruluk: yeni metin gider, silinen kalem geri gelmez (10/10)", () => {
    for (const r of results) {
      expect(r.updateOk, `update n=${r.n}`).toBe(r.updateTotal);
      expect(r.deleteOk, `delete n=${r.n}`).toBe(r.deleteTotal);
    }
  });
});

function report(): string {
  let commit = "?";
  try {
    const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim().length > 0;
    commit = dirty ? `${head} + çalışma ağacı (rapor kodla aynı commit'e girer; hash ebeveyndir)` : head;
  } catch {
    /* rapor yine yazılır */
  }
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const L: string[] = [];
  L.push(`# Retrieval ölçek ölçümü — 30 / 100 / 300 kalem (${new Date().toISOString().slice(0, 10)}, commit ${commit})`);
  L.push("");
  L.push("> Sentetik mülk KB'leri (`tests/helpers/kb-retrieval-synthetic.ts`, tohum 42): 36 konu × 3 TR paraphrase + EN varyant,");
  L.push("> konu başına TR/EN/eşanlam/yazım-hatası soruları, n/10 çeldirici, her 50 kaleme 7k rehber (3 gömülü gerçek).");
  L.push("> `updatedAt` 400 güne tohumlu yayılır. Model YOK: 'cevabın kaynakla desteklenmesi' burada ÖLÇÜLMEZ (gerçek eval).");
  L.push("> hit@k = doğru kalem kimliği seçim sıralamasının ilk k'sında; inPrompt = doğru kaynak istem bloğunda; noise = seçilen ilgisiz kalem;");
  L.push("> chars = blok karakteri (maliyet vekili); ms = seçici süresi (soğuk: indeks kurulumu dahil; ılık: önbellek). Üretici: `tests/unit/kb-retrieval-scale.test.ts`.");
  L.push("");
  for (const r of results) {
    L.push(`## n=${r.n} konu kalemi (toplam ${r.items} kalem, ${r.questions} soru)`);
    L.push("");
    L.push("| Yapılandırma | hit@1 | hit@3 | inPrompt | gürültü | karakter | soğuk ms | ılık p50 | ılık p95 | geri çekilme |");
    L.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const c of r.configs) {
      const legacy = c.name.startsWith("legacy");
      L.push(`| ${c.name} | ${legacy ? "—" : pct(c.hit1)} | ${legacy ? "—" : pct(c.hit3)} | ${pct(c.inPrompt)} | ${c.noise.toFixed(1)} | ${c.chars} | ${legacy ? "—" : c.coldMs} | ${legacy ? "—" : c.warmP50} | ${legacy ? "—" : c.warmP95} | ${legacy ? "—" : c.fallbacks} |`);
    }
    L.push("");
    L.push("Soru türüne göre inPrompt (birleşik CombSUM): " + Object.entries(r.configs[3].perKind).map(([k, v]) => `${k} ${v.inPrompt}/${v.n}`).join(" · "));
    L.push(`Güncelleme sonrası yeni metin: ${r.updateOk}/${r.updateTotal} · Silme sonrası geri gelmeme: ${r.deleteOk}/${r.deleteTotal}`);
    L.push("");
  }
  L.push("## Okuma kılavuzu");
  L.push("- Legacy sıralama soruya bakmaz; hit@k anlamsızdır ('—'). inPrompt = en yeni 30 kalem + 24k bütçe içinde doğru kaynak var mı.");
  L.push("- 300 kalem ürün plan tavanının (60/mülk) üstündedir; ölçek davranışı için sentetiktir. Hibritte `kb-fetch` okuma tavanı 200'dür (canlıda en yeni 200).");
  L.push("- n-gram kaynağı ANLAMSAL değildir (yazım benzerliği); gömme tabanlı kaynak sözleşmesi hazır, ücretli servis onayı bekler.");
  return L.join("\n");
}

afterAll(() => {
  if (process.env.KB_RETRIEVAL_REPORT !== "1") return;
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `kb-retrieval-scale-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, `${report()}\n`, "utf8");
  console.log(`[kb-retrieval-scale] rapor yazıldı: ${file}`);
});
