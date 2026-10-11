import "server-only";

import { prisma } from "@/lib/db";
import { aiReadableForConflicts, kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { KB_CATEGORY } from "@/lib/constants";

// ---------------------------------------------------------------------------
// MÜLK HAFIZASI — OLASI ÇELİŞKİ UYARISI (değişmez 13; karar 26, kurucu 10-11: "1 ile 2 beraber; bilgi tabanı ve şikâyet iki kaynak
// birbiriyle çelişiyorsa uyarı gibi göster; bilerek olduğu işaretlenirse sorun yok").
//  (1) BİLGİ TABANI ↔ ŞİKÂYET: bilgi tabanında bir konuda kalem varken son 30 günde en az 3 AYRI misafir (konuşma) aynı konuda sorun
//      bildirdi. Konu, anlama katmanının konuşma öğelerinden: aynı misafir mesajında "şikâyet" öğesi + konu öğesi (wifi, otopark…).
//      Metin taşınmaz, yalnız sayılır.
//  (2) BİLGİ TABANI ↔ BİLGİ TABANI / MÜLK AYARI: uyuşmayan giriş / çıkış saatleri (`kb-time-conflicts.ts`, bilgi tabanı sayfasıyla aynı).
// Yalnız EV SAHİBİNE gösterilir; yapay zekâya GİTMEZ, cevapları değiştirmez. Ev sahibi "Bilerek böyle" derse ilgili hafıza kalemlerine
// `humanOverrideAt` yazılır ve uyarı kalkar; kalem sonradan değişirse (`observedAt` > işaret) uyarı yeniden değerlendirilir.
// LLM yok, deterministik; şema değişikliği yok (alanlar V1'de vardı).
// ---------------------------------------------------------------------------

export const CONTRADICTION_WINDOW_DAYS = 30;
export const CONTRADICTION_MIN_GUESTS = 3;

/** Konuşma öğesi konusu (anlama niyeti) → bilgi tabanı kategorisi. Yalnız AÇIK eşleşmeler (belirsiz konu uyarı üretmez). */
export const ITEM_TOPIC_TO_KB: Readonly<Record<string, string>> = Object.freeze({
  wifi: "wifi",
  parking: "parking",
  cleaning_linen: "cleaning",
  trash: "trash",
  access_keys: "checkin",
  checkin_time: "checkin",
  checkout_time: "checkout",
  house_rules: "rules",
  directions_transport: "location",
});

export interface ConversationItemLite {
  conversationId: string;
  messageId: string;
  kind: string;
  createdAt: Date;
}

/** Aynı misafir mesajında şikâyet + konu → (konuşma, bilgi tabanı kategorisi) çiftleri. */
export function complaintTopics(items: readonly ConversationItemLite[]): { conversationId: string; kbCategory: string; at: Date }[] {
  const byMessage = new Map<string, ConversationItemLite[]>();
  for (const it of items) {
    const list = byMessage.get(it.messageId);
    if (list) list.push(it);
    else byMessage.set(it.messageId, [it]);
  }
  const out: { conversationId: string; kbCategory: string; at: Date }[] = [];
  for (const list of byMessage.values()) {
    if (!list.some((i) => i.kind === "complaint_issue")) continue;
    for (const i of list) {
      const kb = ITEM_TOPIC_TO_KB[i.kind];
      if (kb) out.push({ conversationId: i.conversationId, kbCategory: kb, at: i.createdAt });
    }
  }
  return out;
}

export interface FactLite {
  id: string;
  category: string;
  /** Kaynak bilgi tabanı kaleminin kimliği (`sourceRef`). */
  kbItemId: string;
  observedAt: Date;
  humanOverrideAt: Date | null;
}

export interface ContradictionWarning {
  kind: "kb_vs_complaints" | "kb_vs_kb";
  /** İlgili bilgi tabanı hafıza kalemleri ("Bilerek böyle" bunlara yazılır). */
  memoryIds: string[];
  text: string;
}

const acknowledged = (facts: readonly FactLite[]) =>
  facts.length > 0 && facts.every((f) => f.humanOverrideAt !== null && f.humanOverrideAt.getTime() >= f.observedAt.getTime());

/** Saf karar: olası çelişkiler (ev sahibinin "bilerek" işaretlediği ve sonra değişmeyenler hariç). */
export function detectContradictions(input: {
  facts: readonly FactLite[];
  topics: readonly { conversationId: string; kbCategory: string; at: Date }[];
  timeRows: readonly { text: string; itemIds: readonly string[] }[];
  now: Date;
}): ContradictionWarning[] {
  const out: ContradictionWarning[] = [];
  const since = input.now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000;
  const guestsByCategory = new Map<string, Set<string>>();
  for (const t of input.topics) {
    if (t.at.getTime() < since || t.at.getTime() > input.now.getTime()) continue;
    const set = guestsByCategory.get(t.kbCategory) ?? new Set<string>();
    set.add(t.conversationId);
    guestsByCategory.set(t.kbCategory, set);
  }
  for (const [category, guests] of [...guestsByCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (guests.size < CONTRADICTION_MIN_GUESTS) continue;
    const facts = input.facts.filter((f) => f.category === category);
    if (facts.length === 0 || acknowledged(facts)) continue;
    out.push({
      kind: "kb_vs_complaints",
      memoryIds: facts.map((f) => f.id),
      text: `Bilgi tabanında "${KB_CATEGORY.label(category)}" bilgisi var, ama son ${CONTRADICTION_WINDOW_DAYS} günde ${guests.size} misafir bu konuda sorun bildirdi. Bilgi güncel mi?`,
    });
  }
  for (const row of input.timeRows) {
    const facts = input.facts.filter((f) => row.itemIds.includes(f.kbItemId));
    if (facts.length === 0 || acknowledged(facts)) continue;
    out.push({ kind: "kb_vs_kb", memoryIds: facts.map((f) => f.id), text: row.text });
  }
  return out;
}

/** Mülk sayfası için: kiracı + mülk kapsamlı olası çelişkiler. Okunamazsa çağıran boş liste gösterir. */
export async function getMemoryContradictions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<ContradictionWarning[]> {
  const since = new Date(now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000);
  const [property, facts, items, kbItems] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { checkInTime: true, checkOutTime: true } }),
    prisma.propertyMemory.findMany({
      where: { organizationId, propertyId, status: "active", kind: "fact", source: "kb_item" },
      select: { id: true, category: true, sourceRef: true, observedAt: true, humanOverrideAt: true },
    }),
    prisma.conversationItem.findMany({
      where: {
        organizationId,
        createdAt: { gte: since, lte: now },
        kind: { in: ["complaint_issue", ...Object.keys(ITEM_TOPIC_TO_KB)] },
        conversation: { propertyId },
      },
      select: { conversationId: true, messageId: true, kind: true, createdAt: true },
      take: 2_000,
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId, property: { organizationId } },
      select: { id: true, title: true, category: true, content: true, isActive: true, reviewState: true, updatedAt: true, supersededById: true },
    }),
  ]);
  if (!property) return [];
  const timeRows = kbTimeConflicts(property, aiReadableForConflicts(kbItems)).map((r) => ({ text: r.text, itemIds: r.sides.map((s) => s.itemId) }));
  return detectContradictions({
    facts: facts.map((f) => ({ id: f.id, category: f.category, kbItemId: f.sourceRef, observedAt: f.observedAt, humanOverrideAt: f.humanOverrideAt })),
    topics: complaintTopics(items),
    timeRows,
    now,
  });
}

/** "Bilerek böyle": yalnız bu mülkün bilgi tabanı hafıza kalemlerine işaret (başka kiracı / mülk / kaynak sessizce atlanır). */
export async function acknowledgeContradiction(
  organizationId: string,
  propertyId: string,
  memoryIds: readonly string[],
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const res = await prisma.propertyMemory.updateMany({
    where: { id: { in: [...memoryIds] }, organizationId, propertyId, source: "kb_item", kind: "fact" },
    data: { humanOverrideAt: now, humanOverrideUserId: userId },
  });
  return res.count;
}
