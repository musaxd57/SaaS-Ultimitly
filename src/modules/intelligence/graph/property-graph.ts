// ---------------------------------------------------------------------------
// MÜLK İLİŞKİ GRAFI — HOST ANALİZİ İÇİN, DB-GERÇEK KENARLARDAN (RAG dilim 2, 09-09).
//
// "GraphRAG" burada LLM ile metinden varlık çıkarmak DEĞİLDİR. Depoda zaten var
// olan ilişkiler (FK'lar + kapalı-küme sinyal/görev/hafıza kayıtları) tipli bir
// grafa dökülür; her kenar KAYNAĞINI ve ZAMANINI taşır. LightRAG/HippoRAG gibi
// LLM-tabanlı yaklaşımlarla kıyas protokolü tasarım belgesinde (§6); onlar
// ücretli model çağrısı ister → onay.
//
// 🚨 ÜÇ DEĞİŞMEZ (Codex/kurucu şartı):
//  1. Kenar = kaynak (`source`) + gözlem zamanı (`observedAt`) + kesinlik
//     (`observed` DB-gerçek / `inferred` kural çıkarımı). Kaynaksız kenar yok.
//  2. "Şikâyet var" bilgisinden "arıza DOĞRULANDI" sonucu ÇIKARILMAZ. Rapor
//     alanı `evidence` yalnız neyin KAYITLI olduğunu söyler:
//     reported_only | task_open | task_done. 'confirmed' diye bir değer YOKTUR.
//  3. Bu modül HOST'A ÖZEL analiz verisidir: misafir yolu (`ai/retrieval`,
//     QR rotası) bunu import ETMEZ (yapısal pin). Misafir metni taşınmaz —
//     yalnız kimlikler, kapalı-küme kategoriler ve zamanlar.
//
// Saf modül: DB erişimi yok; çağıran veriyi (org/mülk kapsamlı sorgulardan)
// yükler ve buraya verir. Yetki filtresi grafın ÖNÜNDEDİR.
// ---------------------------------------------------------------------------

export type NodeKind = "property" | "reservation" | "conversation" | "signal" | "task" | "memory" | "kb_item";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** Kapalı-küme etiket (sinyal/görev/hafıza/kb kategorisi). Serbest metin DEĞİL. */
  category?: string;
  /** Kapalı-küme durum (görev: todo/in_progress/awaiting_review/done; hafıza: active/…; rezervasyon). */
  status?: string;
  at?: Date;
}

export type EdgeKind =
  | "stay_at" // reservation → property
  | "thread_of" // conversation → reservation
  | "observed_in" // signal → conversation
  | "about_stay" // signal → reservation
  | "task_for" // task → property
  | "task_about_stay" // task → reservation
  | "memory_of" // memory → property
  | "memory_evidence" // memory → signal / kb_item (evidenceJson)
  | "documents"; // kb_item → property

export type EdgeSource = "db_fk" | "signal" | "task" | "memory" | "kb";

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  source: EdgeSource;
  observedAt: Date;
  certainty: "observed" | "inferred";
}

export interface PropertyGraphInput {
  propertyId: string;
  reservations: readonly { id: string; arrivalDate: Date; departureDate: Date; status: string }[];
  conversations: readonly { id: string; reservationId: string | null; createdAt: Date }[];
  signals: readonly {
    id: string;
    category: string;
    kind: string;
    occurredAt: Date;
    reservationId: string | null;
    conversationId: string | null;
  }[];
  tasks: readonly { id: string; category: string; status: string; createdAt: Date; reservationId: string | null }[];
  memories: readonly {
    id: string;
    category: string;
    status: string;
    observedAt: Date;
    /** `[{type,id}]` — yalnız kimlik. */
    evidenceJson: string;
  }[];
  kbItems: readonly { id: string; category: string; updatedAt: Date; reviewState: string }[];
}

export interface PropertyGraph {
  propertyId: string;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** Düğümden çıkan kenarlar. */
  out(id: string): GraphEdge[];
  /** Düğüme gelen kenarlar. */
  into(id: string): GraphEdge[];
}

export function buildPropertyGraph(input: PropertyGraphInput): PropertyGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const outIdx = new Map<string, GraphEdge[]>();
  const inIdx = new Map<string, GraphEdge[]>();
  const add = (e: GraphEdge) => {
    edges.push(e);
    outIdx.set(e.from, [...(outIdx.get(e.from) ?? []), e]);
    inIdx.set(e.to, [...(inIdx.get(e.to) ?? []), e]);
  };
  nodes.set(input.propertyId, { id: input.propertyId, kind: "property" });
  for (const r of input.reservations) {
    nodes.set(r.id, { id: r.id, kind: "reservation", status: r.status, at: r.arrivalDate });
    add({ from: r.id, to: input.propertyId, kind: "stay_at", source: "db_fk", observedAt: r.arrivalDate, certainty: "observed" });
  }
  for (const c of input.conversations) {
    nodes.set(c.id, { id: c.id, kind: "conversation", at: c.createdAt });
    if (c.reservationId && nodes.has(c.reservationId)) {
      add({ from: c.id, to: c.reservationId, kind: "thread_of", source: "db_fk", observedAt: c.createdAt, certainty: "observed" });
    }
  }
  for (const s of input.signals) {
    nodes.set(s.id, { id: s.id, kind: "signal", category: s.category, at: s.occurredAt });
    if (s.conversationId && nodes.has(s.conversationId)) {
      add({ from: s.id, to: s.conversationId, kind: "observed_in", source: "signal", observedAt: s.occurredAt, certainty: "observed" });
    }
    if (s.reservationId && nodes.has(s.reservationId)) {
      add({ from: s.id, to: s.reservationId, kind: "about_stay", source: "signal", observedAt: s.occurredAt, certainty: "observed" });
    }
  }
  for (const t of input.tasks) {
    nodes.set(t.id, { id: t.id, kind: "task", category: t.category, status: t.status, at: t.createdAt });
    add({ from: t.id, to: input.propertyId, kind: "task_for", source: "task", observedAt: t.createdAt, certainty: "observed" });
    if (t.reservationId && nodes.has(t.reservationId)) {
      add({ from: t.id, to: t.reservationId, kind: "task_about_stay", source: "task", observedAt: t.createdAt, certainty: "observed" });
    }
  }
  for (const k of input.kbItems) {
    nodes.set(k.id, { id: k.id, kind: "kb_item", category: k.category, at: k.updatedAt });
    add({ from: k.id, to: input.propertyId, kind: "documents", source: "kb", observedAt: k.updatedAt, certainty: "observed" });
  }
  for (const m of input.memories) {
    nodes.set(m.id, { id: m.id, kind: "memory", category: m.category, status: m.status, at: m.observedAt });
    add({ from: m.id, to: input.propertyId, kind: "memory_of", source: "memory", observedAt: m.observedAt, certainty: "observed" });
    for (const ev of parseEvidence(m.evidenceJson)) {
      if (nodes.has(ev.id)) {
        // Hafıza → kanıt bağı DB'de düz FK değil, JSON referansı: "inferred" DEĞİL
        // ama kaynağı memory kaydıdır (kanıt JSON'u o satırın kendisi).
        add({ from: m.id, to: ev.id, kind: "memory_evidence", source: "memory", observedAt: m.observedAt, certainty: "observed" });
      }
    }
  }
  return {
    propertyId: input.propertyId,
    nodes,
    edges,
    out: (id) => outIdx.get(id) ?? [],
    into: (id) => inIdx.get(id) ?? [],
  };
}

function parseEvidence(json: string): { type: string; id: string }[] {
  try {
    const v = JSON.parse(json) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is { type: string; id: string } => typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string");
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// SORGULAR — host analizi (salt-okuma, deterministik)
// ---------------------------------------------------------------------------

/** Sinyalin bağlı olduğu konaklama: doğrudan `about_stay` ya da konuşma üzerinden (`observed_in` → `thread_of`). */
export function stayOfSignal(graph: PropertyGraph, signalId: string): { reservationId: string; via: "direct" | "conversation" } | null {
  const out = graph.out(signalId);
  const direct = out.find((e) => e.kind === "about_stay");
  if (direct) return { reservationId: direct.to, via: "direct" };
  const conv = out.find((e) => e.kind === "observed_in");
  if (conv) {
    const thread = graph.out(conv.to).find((e) => e.kind === "thread_of");
    if (thread) return { reservationId: thread.to, via: "conversation" };
  }
  return null;
}

/** Kayıtlı kanıt sınıfı — "doğrulandı" diye bir değer YOKTUR (kural 2). */
export type IssueEvidence = "reported_only" | "task_open" | "task_done";

export interface RecurringIssue {
  category: string;
  /** Sinyal (bildirim) sayısı. */
  reports: number;
  /** Farklı konaklama sayısı (graf üzerinden çözülen). */
  stays: number;
  /** Konaklamaya bağlanamayan bildirim sayısı (dürüstçe ayrı sayılır). */
  unlinkedReports: number;
  firstAt: Date;
  lastAt: Date;
  evidence: IssueEvidence;
  /** Kenar kaynakları (kapalı küme) — raporun neye dayandığı. */
  sources: EdgeSource[];
}

export interface RecurringIssueOptions {
  now: Date;
  windowDays: number;
  /** Hangi sinyal kategorileri "sorun" sayılır (kapalı küme; çağıran verir). */
  issueCategories: ReadonlySet<string>;
  minReports?: number;
}

/**
 * Pencere içinde tekrar eden sorun bildirimleri, kategori başına. Bir görev
 * kaydı varsa `evidence` bunu söyler; hiçbir dal "arıza doğrulandı" demez.
 */
export function recurringIssues(graph: PropertyGraph, opt: RecurringIssueOptions): RecurringIssue[] {
  const since = opt.now.getTime() - opt.windowDays * 86_400_000;
  const byCat = new Map<string, { ids: string[]; stays: Set<string>; unlinked: number; first: number; last: number }>();
  for (const node of graph.nodes.values()) {
    if (node.kind !== "signal" || !node.category || !node.at) continue;
    if (!opt.issueCategories.has(node.category)) continue;
    const t = node.at.getTime();
    if (t < since || t > opt.now.getTime()) continue;
    const acc = byCat.get(node.category) ?? { ids: [], stays: new Set<string>(), unlinked: 0, first: t, last: t };
    acc.ids.push(node.id);
    const stay = stayOfSignal(graph, node.id);
    if (stay) acc.stays.add(stay.reservationId);
    else acc.unlinked += 1;
    acc.first = Math.min(acc.first, t);
    acc.last = Math.max(acc.last, t);
    byCat.set(node.category, acc);
  }
  const out: RecurringIssue[] = [];
  for (const [category, acc] of byCat) {
    if (acc.ids.length < (opt.minReports ?? 2)) continue;
    const tasks = [...graph.nodes.values()].filter(
      (n) => n.kind === "task" && n.category === category && n.at && n.at.getTime() >= since,
    );
    // Görev kaydı = host'un bir İŞ AÇTIĞININ kanıtı; "arıza doğrulandı" DEĞİL.
    let evidence: IssueEvidence = "reported_only";
    if (tasks.length > 0) evidence = tasks.some((t) => t.status === "done") ? "task_done" : "task_open";
    const sources = new Set<EdgeSource>(["signal"]);
    if (tasks.length > 0) sources.add("task");
    out.push({
      category,
      reports: acc.ids.length,
      stays: acc.stays.size,
      unlinkedReports: acc.unlinked,
      firstAt: new Date(acc.first),
      lastAt: new Date(acc.last),
      evidence,
      sources: [...sources],
    });
  }
  return out.sort((a, b) => b.reports - a.reports || a.category.localeCompare(b.category));
}
