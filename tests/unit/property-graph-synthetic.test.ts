import { describe, it, expect, afterAll } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildPropertyGraph, recurringIssues, stayOfSignal } from "@/modules/intelligence/graph/property-graph";
import { HOST_QUESTIONS, makeSyntheticProperty } from "../helpers/graph-synthetic";

// ---------------------------------------------------------------------------
// BASİT GRAF SORGULARI vs ALTIN — sentetik mülk–mesaj–görev verisi (RAG dilim 3).
//
// LightRAG/HippoRAG kıyasının BİZİM tarafı: aynı veri, aynı sorular, altın
// cevaplar üreticiden. H1–H3 grafla tam doğru cevaplanmalı; H4 (mesaj
// metninden cihaz/varlık) kapalı-küme kategorinin ÖTESİ → basit graf
// cevaplayamaz, bunu dürüstçe "cevaplanamaz" olarak raporlar. LLM tarafı
// onay sonrası aynı harness'a eklenir; rapor `KB_RETRIEVAL_REPORT=1` ile yazılır.
// ---------------------------------------------------------------------------

const ISSUE = new Set(["complaint", "refund", "early_departure", "human_request"]);

function run(seed: number) {
  const syn = makeSyntheticProperty(40, seed, 30);
  const graph = buildPropertyGraph(syn.input);
  const issues = recurringIssues(graph, { now: syn.now, windowDays: syn.windowDays, issueCategories: ISSUE, minReports: 1 });
  // H1: kategori → farklı konaklama sayısı
  const h1Ok = [...syn.truth.staysByCategory.entries()].every(([cat, stays]) => issues.find((i) => i.category === cat)?.stays === stays.size);
  const h1Extra = issues.some((i) => !syn.truth.staysByCategory.has(i.category));
  // H2: görev açılmayanlar
  const h2Ok = [...syn.truth.taskEvidence.entries()].every(([cat, ev]) => issues.find((i) => i.category === cat)?.evidence === ev);
  // H3: yalnız konuşma üzerinden bağlananlar
  const since = syn.now.getTime() - syn.windowDays * 86_400_000;
  const viaConv = syn.input.signals.filter((s) => s.occurredAt.getTime() >= since && stayOfSignal(graph, s.id)?.via === "conversation").length;
  const flatLinked = syn.input.signals.filter((s) => s.occurredAt.getTime() >= since && s.reservationId).length;
  const totalWindow = syn.input.signals.filter((s) => s.occurredAt.getTime() >= since).length;
  // H4: varlık (cihaz) — grafın düğümlerinde yok (kapalı-küme kategori dışı)
  const h4Answerable = [...graph.nodes.values()].some((n) => n.category && syn.truth.reportsByEntity.has(n.category));
  return { syn, graph, issues, h1Ok: h1Ok && !h1Extra, h2Ok, viaConv, flatLinked, totalWindow, h4Answerable };
}

const SEEDS = [7, 11, 23];
const results = SEEDS.map(run);

describe("basit graf sorguları — sentetik altın ile", () => {
  it("H1: kategori başına FARKLI konaklama sayısı üreticiyle birebir (3 tohum)", () => {
    for (const r of results) expect(r.h1Ok, `seed`).toBe(true);
  });

  it("H2: görev kanıt sınıfı (reported_only/task_open/task_done) üreticiyle birebir; 'confirmed' hiçbir yerde yok", () => {
    for (const r of results) {
      expect(r.h2Ok).toBe(true);
      expect(JSON.stringify(r.issues)).not.toMatch(/confirm/i);
    }
  });

  it("H2 🚨 CODEX TUZAĞI: çeldirici görevler (bildirimsiz konaklamanın tamamlanmış işi) kanıt sınıfını DEĞİŞTİRMEZ; bağlı/bağsız ve bağ türü ayrı", () => {
    for (const r of results) {
      expect(r.syn.truth.decoyTasks).toBeGreaterThan(0);
      const unlinked = r.issues.reduce((n, i) => n + i.unlinkedTasks, 0);
      expect(unlinked).toBe(r.syn.truth.decoyTasks);
      const linked = r.issues.reduce((n, i) => n + i.linkedOpenTasks + i.linkedDoneTasks, 0);
      expect(linked).toBe(r.syn.truth.linkedTasks);
      for (const [cat, mode] of r.syn.truth.linkMode) expect(r.issues.find((i) => i.category === cat)?.linkCertainty, cat).toBe(mode);
      for (const [cat, ev] of r.syn.truth.taskEvidence) {
        if (ev === "reported_only") expect(r.issues.find((i) => i.category === cat)?.linkCertainty, cat).toBeNull();
      }
    }
  });

  it("H3: yalnız konuşma üzerinden bağlanan bildirimler = üretici sayısı; düz tarama bunları KAÇIRIR", () => {
    for (const r of results) {
      expect(r.viaConv).toBe(r.syn.truth.conversationLinkedOnly);
      expect(r.flatLinked + r.viaConv).toBe(r.totalWindow);
    }
    // Tohumların en az birinde böyle bildirim var (yoksa ölçüm boş kalırdı) — tohum seçilmez, toplam pinlenir.
    expect(results.reduce((n, r) => n + r.viaConv, 0)).toBeGreaterThan(0);
  });

  it("H4: cihaz/varlık sorusu basit grafla CEVAPLANAMAZ (dürüst sınır — LightRAG deneyinin hedefi)", () => {
    for (const r of results) expect(r.h4Answerable).toBe(false);
  });

  it("graf yalnız GİRDİDEKİ düğümleri bağlar: yabancı kimlikli kenar üretilmez (kapsam korunur)", () => {
    const syn = makeSyntheticProperty(10, 3, 30);
    const foreign = {
      ...syn.input,
      signals: [...syn.input.signals, { id: "sig_foreign", category: "complaint", kind: "message.intent", occurredAt: syn.now, reservationId: "res_OTHER_PROPERTY", conversationId: "conv_OTHER" }],
      conversations: [...syn.input.conversations, { id: "conv_x", reservationId: "res_OTHER_PROPERTY", createdAt: syn.now }],
    };
    const g = buildPropertyGraph(foreign);
    expect(g.edges.some((e) => e.to === "res_OTHER_PROPERTY" || e.to === "conv_OTHER")).toBe(false);
    expect(g.nodes.has("res_OTHER_PROPERTY")).toBe(false);
    expect(stayOfSignal(g, "sig_foreign")).toBeNull();
  });
});

function report(): string {
  const L: string[] = [];
  L.push(`# Host analizi baseline — basit graf sorguları, sentetik veri (${new Date().toISOString().slice(0, 10)})`);
  L.push("");
  L.push("> Veri: `tests/helpers/graph-synthetic.ts` (40 konaklama, şablon mesajlar, sinyal/görev kural tabanlı; GERÇEK misafir metni YOK).");
  L.push("> Altın cevaplar üreticiden. LightRAG/HippoRAG tarafı ONAY sonrası aynı `messages[]` + `HOST_QUESTIONS` ile eklenir (tasarım §6.2).");
  L.push("");
  L.push("| Tohum | Sinyal (30g) | H1 kategori→konaklama | H2 kanıt sınıfı | H2 çeldirici (bağsız sayılan / üretilen) | H3 konuşma-bağlı (graf / altın) | H4 cihaz/varlık |");
  L.push("|---|---|---|---|---|---|---|");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const unlinked = r.issues.reduce((n, x) => n + x.unlinkedTasks, 0);
    L.push(
      `| ${SEEDS[i]} | ${r.totalWindow} | ${r.h1Ok ? "✅ birebir" : "❌"} | ${r.h2Ok ? "✅ birebir" : "❌"} | ${unlinked} / ${r.syn.truth.decoyTasks} | ${r.viaConv} / ${r.syn.truth.conversationLinkedOnly} | ${r.h4Answerable ? "cevaplandı" : "CEVAPLANAMAZ (beklenen)"} |`,
    );
  }
  L.push("");
  L.push("## Sorular");
  for (const q of HOST_QUESTIONS) L.push(`- **${q.id}** ${q.text} — gerek: ${q.needs}`);
  L.push("");
  L.push("## Okuma");
  L.push("- H1–H3 DB-gerçek ilişkilerle tam; LLM'e ihtiyaç yok. H4 (mesaj metninden cihaz) LightRAG/HippoRAG'ın tek aday katkısı; ölçüm onay sonrası, sentetik metinle.");
  L.push("- H2 görev kanıtı YALNIZ bildirime bağlı görevlerden (mesaj bağı = observed, konaklama+kategori = inferred); başka konaklamanın tamamlanmış işi (çeldirici) `unlinkedTasks` olarak AYRI görünür, sınıfı değiştirmez (Codex 09-09).");
  L.push("- Basit grafın maliyeti sıfır model çağrısı; kenarlar kaynak+zaman taşır; 'doğrulanmış arıza' hiçbir dalda üretilmez.");
  return L.join("\n");
}

afterAll(() => {
  if (process.env.KB_RETRIEVAL_REPORT !== "1") return;
  const dir = path.resolve(__dirname, "../../docs/olcum");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `graph-baseline-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, `${report()}\n`, "utf8");
  console.log(`[graph-baseline] rapor yazıldı: ${file}`);
});
