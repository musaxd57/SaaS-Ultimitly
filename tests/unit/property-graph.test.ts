import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPropertyGraph, recurringIssues, stayOfSignal, type PropertyGraphInput } from "@/modules/intelligence/graph/property-graph";

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

describe("tekrar eden sorun raporu — şikâyet ≠ doğrulanmış arıza; görev kanıtı YALNIZ bildirime BAĞLI görevlerden", () => {
  const opt = { now: NOW, windowDays: 30, issueCategories: new Set(["complaint"]) };

  it("pencere içi bildirimler, FARKLI konaklama sayısı ve bağlanamayanlar AYRI sayılır", () => {
    const g = fixture();
    const [r] = recurringIssues(g, opt);
    expect(r.category).toBe("complaint");
    // Pencere 08-10 → 09-09: sig_1 (08-21), sig_2, sig_3, sig_4 içeride; sig_old (05-01) dışarıda.
    expect(r.reports).toBe(4);
    expect(r.stays).toBe(2); // res_1 (sig_1) + res_2 (sig_2 konuşma üzerinden, sig_3) — aynı konaklama iki kez SAYILMAZ
    expect(r.unlinkedReports).toBe(1); // sig_4
    expect(r.evidence).toBe("reported_only");
    expect(r.linkCertainty).toBeNull();
    expect(r.reportsWithoutTask).toBe(4);
  });

  /**
   * İki pencere-içi bildirim (ikisi de res_a'da; s2 konaklamayı YALNIZ konuşma üzerinden taşır;
   * mesaj kimlikleri msg_1/msg_2) + pencere DIŞI bildirimli ikinci konaklama res_b.
   */
  const withTasks = (tasks: PropertyGraphInput["tasks"]) =>
    buildPropertyGraph({
      propertyId: "prop_1",
      reservations: [
        { id: "res_a", arrivalDate: D("2026-09-01T12:00:00Z"), departureDate: D("2026-09-05T09:00:00Z"), status: "completed" },
        { id: "res_b", arrivalDate: D("2026-06-01T12:00:00Z"), departureDate: D("2026-06-05T09:00:00Z"), status: "completed" },
      ],
      conversations: [{ id: "conv_a", reservationId: "res_a", createdAt: D("2026-09-01T13:00:00Z") }],
      signals: [
        { id: "s1", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-02T08:00:00Z"), reservationId: "res_a", conversationId: "conv_a", sourceEntityId: "msg_1" },
        { id: "s2", category: "complaint", kind: "message.intent", occurredAt: D("2026-09-03T08:00:00Z"), reservationId: null, conversationId: "conv_a", sourceEntityId: "msg_2" },
        // Pencere DIŞI bildirim (res_b'de): görev bağı pencere içine SAYILMAZ.
        { id: "s_old", category: "complaint", kind: "message.intent", occurredAt: D("2026-06-02T08:00:00Z"), reservationId: "res_b", conversationId: null, sourceEntityId: "msg_old" },
      ],
      tasks,
      memories: [],
      kbItems: [],
    });
  const T = (over: Partial<PropertyGraphInput["tasks"][number]>): PropertyGraphInput["tasks"][number] => ({
    id: "t1",
    category: "complaint",
    status: "todo",
    createdAt: D("2026-09-03T09:00:00Z"),
    reservationId: null,
    ...over,
  });

  it("BAĞSIZ görev (konaklama da mesaj da yok) kanıt DEĞİL → reported_only; ayrı sayılır", () => {
    const r = recurringIssues(withTasks([T({})]), opt)[0];
    expect(r.evidence).toBe("reported_only");
    expect(r.unlinkedTasks).toBe(1);
    expect(r.linkedOpenTasks + r.linkedDoneTasks).toBe(0);
    expect(r.linkCertainty).toBeNull();
    expect(r.sources).toEqual(["signal"]);
  });

  it("MESAJ BAĞI (Task.sourceMessageId = Signal.sourceEntityId) → GÖZLEMLENMİŞ bağ; açık görev → task_open", () => {
    const r = recurringIssues(withTasks([T({ sourceMessageId: "msg_1" })]), opt)[0];
    expect(r.evidence).toBe("task_open");
    expect(r.linkCertainty).toBe("observed");
    expect(r.linkedOpenTasks).toBe(1);
    expect(r.unlinkedTasks).toBe(0);
    expect(r.reportsWithoutTask).toBe(1); // s2'nin görevi yok
    expect(r.sources).toEqual(["signal", "task"]);
  });

  it("KONAKLAMA BAĞI (aynı konaklama + aynı kategori) → ÇIKARIM; tamamlanmış görev → task_done", () => {
    const r = recurringIssues(withTasks([T({ status: "done", reservationId: "res_a" })]), opt)[0];
    expect(r.evidence).toBe("task_done");
    expect(r.linkCertainty).toBe("inferred");
    expect(r.linkedDoneTasks).toBe(1);
    // s2 reservationId taşımıyor ama konuşma üzerinden res_a'ya bağlı → o da bu görevle eşleşir.
    expect(r.reportsWithoutTask).toBe(0);
  });

  it("🚨 CODEX TUZAĞI (09-09): BAŞKA konaklamanın (pencere-içi bildirimi olmayan) tamamlanmış görevi kanıt DEĞİL → reported_only", () => {
    const r = recurringIssues(withTasks([T({ status: "done", reservationId: "res_b" })]), opt)[0];
    expect(r.evidence).toBe("reported_only");
    expect(r.unlinkedTasks).toBe(1);
    expect(r.linkedDoneTasks).toBe(0);
    expect(r.reportsWithoutTask).toBe(2);
  });

  it("PENCERE DIŞI bildirime mesajla bağlı görev pencere-içi bildirimlere bağlanamaz → reported_only", () => {
    const r = recurringIssues(withTasks([T({ status: "done", sourceMessageId: "msg_old" })]), opt)[0];
    expect(r.evidence).toBe("reported_only");
    expect(r.unlinkedTasks).toBe(1);
  });

  it("KARIŞIK: bağlı tamamlanmış + bağsız açık → task_done (bağsız açık görev sınıfı DEĞİŞTİRMEZ); açık/tamamlanan/bağsız AYRI", () => {
    const r = recurringIssues(withTasks([T({ id: "t1", status: "done", sourceMessageId: "msg_2" }), T({ id: "t2", status: "todo" })]), opt)[0];
    expect(r.evidence).toBe("task_done");
    expect(r.linkedDoneTasks).toBe(1);
    expect(r.linkedOpenTasks).toBe(0);
    expect(r.unlinkedTasks).toBe(1);
    // Bağlı AÇIK görev varsa sınıf task_open — tamamlanmış bir bağlı görevin yanında bile.
    const r2 = recurringIssues(
      withTasks([T({ id: "t1", status: "done", sourceMessageId: "msg_2" }), T({ id: "t2", status: "in_progress", reservationId: "res_a" })]),
      opt,
    )[0];
    expect(r2.evidence).toBe("task_open");
    expect(r2.linkedOpenTasks).toBe(1);
    expect(r2.linkedDoneTasks).toBe(1);
    expect(r2.linkCertainty).toBe("observed"); // en güçlü bağ
  });

  it("hiçbir dalda 'confirmed' / 'doğrulandı' YOK", () => {
    for (const tasks of [[], [T({})], [T({ status: "done", reservationId: "res_a" })], [T({ status: "done", sourceMessageId: "msg_1" })]]) {
      expect(JSON.stringify(recurringIssues(withTasks(tasks), opt))).not.toMatch(/confirm|dogrulan|doğrulan/i);
    }
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
