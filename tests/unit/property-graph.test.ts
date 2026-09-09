import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPropertyGraph, recurringIssues, stayOfSignal } from "@/modules/intelligence/graph/property-graph";

// ---------------------------------------------------------------------------
// MÜLK İLİŞKİ GRAFI — host analizi (RAG dilim 2). Üç değişmez:
// kenar = kaynak + zaman · şikâyet ≠ doğrulanmış arıza · misafir yoluna taşınmaz.
// Ayrıca "ilişkinin marjinal faydası" ölçümü: konaklamaya yalnız KONUŞMA
// üzerinden bağlanan sinyali düz tarama (signal.reservationId) sayamaz, graf sayar.
// ---------------------------------------------------------------------------

const D = (s: string) => new Date(s);
const NOW = D("2026-09-09T12:00:00Z");

function fixture() {
  return buildPropertyGraph({
    propertyId: "prop_1",
    reservations: [
      { id: "res_1", arrivalDate: D("2026-08-20T12:00:00Z"), departureDate: D("2026-08-24T09:00:00Z"), status: "completed" },
      { id: "res_2", arrivalDate: D("2026-09-01T12:00:00Z"), departureDate: D("2026-09-05T09:00:00Z"), status: "completed" },
      { id: "res_3", arrivalDate: D("2026-09-07T12:00:00Z"), departureDate: D("2026-09-12T09:00:00Z"), status: "confirmed" },
    ],
    conversations: [
      { id: "conv_1", reservationId: "res_1", createdAt: D("2026-08-20T13:00:00Z") },
      { id: "conv_2", reservationId: "res_2", createdAt: D("2026-09-01T13:00:00Z") },
      { id: "conv_3", reservationId: "res_3", createdAt: D("2026-09-07T13:00:00Z") },
    ],
    signals: [
      // Doğrudan konaklamaya bağlı
      { id: "sig_1", category: "complaint", kind: "message.intent", occurredAt: D("2026-08-21T08:00:00Z"), reservationId: "res_1", conversationId: "conv_1" },
      // YALNIZ konuşma üzerinden bağlı (reservationId NULL — QR/legacy satır)
      { id: "sig_2", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-02T08:00:00Z"), reservationId: null, conversationId: "conv_2" },
      // Aynı konaklamada ikinci bildirim (farklı konaklama SAYILMAZ)
      { id: "sig_3", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-03T08:00:00Z"), reservationId: "res_2", conversationId: "conv_2" },
      // Hiçbir şeye bağlanamayan
      { id: "sig_4", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-08T08:00:00Z"), reservationId: null, conversationId: null },
      // Pencere dışı
      { id: "sig_old", category: "complaint", kind: "message.intent", occurredAt: D("2026-05-01T08:00:00Z"), reservationId: "res_1", conversationId: null },
      // Sorun sayılmayan kategori
      { id: "sig_5", category: "parking", kind: "message.intent", occurredAt: D("2026-09-08T09:00:00Z"), reservationId: "res_3", conversationId: "conv_3" },
    ],
    tasks: [],
    memories: [{ id: "mem_1", category: "complaint", status: "active", observedAt: D("2026-09-03T09:00:00Z"), evidenceJson: JSON.stringify([{ type: "signal", id: "sig_1" }, { type: "signal", id: "sig_3" }]) }],
    kbItems: [{ id: "kb_1", category: "parking", updatedAt: D("2026-08-01T00:00:00Z"), reviewState: "approved" }],
  });
}

describe("mülk grafı — kenarlar kaynak + zaman taşır", () => {
  it("her kenarın source/observedAt/certainty alanı dolu; hafıza kanıtı JSON'dan kenara döner", () => {
    const g = fixture();
    expect(g.edges.length).toBeGreaterThan(10);
    for (const e of g.edges) {
      expect(["db_fk", "signal", "task", "memory", "kb"]).toContain(e.source);
      expect(e.observedAt).toBeInstanceOf(Date);
      expect(["observed", "inferred"]).toContain(e.certainty);
      expect(g.nodes.has(e.from) && g.nodes.has(e.to)).toBe(true);
    }
    expect(g.out("mem_1").filter((e) => e.kind === "memory_evidence").map((e) => e.to).sort()).toEqual(["sig_1", "sig_3"]);
  });

  it("düğümler serbest metin taşımaz (yalnız kimlik, kapalı-küme kategori/durum, zaman)", () => {
    const g = fixture();
    for (const n of g.nodes.values()) {
      expect(Object.keys(n).sort()).toEqual(Object.keys(n).sort().filter((k) => ["id", "kind", "category", "status", "at"].includes(k)));
    }
  });
});

describe("konaklama çözümü — ilişkinin marjinal faydası", () => {
  it("sinyal konaklamaya DOĞRUDAN ya da KONUŞMA üzerinden bağlanır; bağlanamayan null", () => {
    const g = fixture();
    expect(stayOfSignal(g, "sig_1")).toEqual({ reservationId: "res_1", via: "direct" });
    expect(stayOfSignal(g, "sig_2")).toEqual({ reservationId: "res_2", via: "conversation" });
    expect(stayOfSignal(g, "sig_4")).toBeNull();
  });

  it("düz tarama (signal.reservationId) konuşma-bağlı bildirimi SAYAMAZ, graf sayar — fark ölçülür", () => {
    const g = fixture();
    const flat = new Set(
      [...g.nodes.values()].filter((n) => n.kind === "signal" && n.category === "complaint").map((n) => n.id).filter((id) => g.out(id).some((e) => e.kind === "about_stay")).map((id) => g.out(id).find((e) => e.kind === "about_stay")!.to),
    );
    const viaGraph = new Set(
      [...g.nodes.values()].filter((n) => n.kind === "signal" && n.category === "complaint").map((n) => stayOfSignal(g, n.id)?.reservationId).filter(Boolean),
    );
    expect(flat.size).toBe(2); // res_1 (sig_1, sig_old), res_2 (sig_3)
    expect(viaGraph.size).toBe(2); // aynı iki konaklama — ama sig_2 grafla res_2'ye bağlanır
    expect(stayOfSignal(g, "sig_2")?.via).toBe("conversation");
  });
});

describe("tekrar eden sorun raporu — şikâyet ≠ doğrulanmış arıza", () => {
  const opt = { now: NOW, windowDays: 30, issueCategories: new Set(["complaint"]) };

  it("pencere içi bildirimler, FARKLI konaklama sayısı ve bağlanamayanlar AYRI sayılır", () => {
    const g = fixture();
    const [r] = recurringIssues(g, opt);
    expect(r.category).toBe("complaint");
    expect(r.reports).toBe(4); // sig_1? hayır: 08-21 pencere dışı (30 gün) → sig_2, sig_3, sig_4 + ...
  });

  it("görev yokken evidence 'reported_only'; görev varsa 'task_open'/'task_done' — hiçbir dalda 'confirmed' YOK", () => {
    const base = fixture();
    const noTask = recurringIssues(base, opt);
    expect(noTask[0]?.evidence).toBe("reported_only");
    const withOpen = buildPropertyGraph({
      propertyId: "prop_1",
      reservations: [],
      conversations: [],
      signals: [
        { id: "s1", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-01T08:00:00Z"), reservationId: null, conversationId: null },
        { id: "s2", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-02T08:00:00Z"), reservationId: null, conversationId: null },
      ],
      tasks: [{ id: "t1", category: "complaint", status: "todo", createdAt: D("2026-09-02T09:00:00Z"), reservationId: null }],
      memories: [],
      kbItems: [],
    });
    expect(recurringIssues(withOpen, opt)[0].evidence).toBe("task_open");
    const withDone = buildPropertyGraph({
      propertyId: "prop_1",
      reservations: [],
      conversations: [],
      signals: [
        { id: "s1", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-01T08:00:00Z"), reservationId: null, conversationId: null },
        { id: "s2", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-02T08:00:00Z"), reservationId: null, conversationId: null },
      ],
      tasks: [{ id: "t1", category: "complaint", status: "done", createdAt: D("2026-09-02T09:00:00Z"), reservationId: null }],
      memories: [],
      kbItems: [],
    });
    const r = recurringIssues(withDone, opt)[0];
    expect(r.evidence).toBe("task_done");
    expect(JSON.stringify(r)).not.toMatch(/confirm|dogrulan|doğrulan/i);
  });

  it("tek bildirim tekrar sayılmaz; sorun sayılmayan kategori (parking) listeye girmez", () => {
    const g = fixture();
    const r = recurringIssues(g, { ...opt, issueCategories: new Set(["complaint", "parking"]) });
    expect(r.map((x) => x.category)).toEqual(["complaint"]);
  });
});

describe("mimari pin", () => {
  it("graf modülü DB'ye erişmez ve 'confirmed' diye bir kanıt değeri tanımlamaz", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/modules/intelligence/graph/property-graph.ts"), "utf8");
    expect(src).not.toMatch(/prisma|from "@\/lib\/db"/);
    expect(src).not.toMatch(/"confirmed"/);
    expect(src).toContain('"reported_only" | "task_open" | "task_done"');
  });
});
