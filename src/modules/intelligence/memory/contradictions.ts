import "server-only";

import { prisma } from "@/lib/db";
import { aiReadableForConflicts, kbTimeConflicts } from "@/lib/kb-time-conflicts";
import { KB_CATEGORY } from "@/lib/constants";
import { topicsOf } from "@/lib/conversation-items/relation";

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

/**
 * Bilgi tabanı kategorisi → mesaj metnindeki konu kavramları (`conversation-items/relation.ts topicsOf`). Haiku 4. tur (10-11): karışık
 * mesajda ("Gürültüden uyuyamadık. Bu arada Wi-Fi ağı hangisi?" → şikâyet + wifi) Wi-Fi şikâyet sayılıyordu. Kural: mesajdaki somut
 * konuların TAMAMI bu kategoriye aitse sayılır; başka bir somut konu da varsa (gürültü, havlu…) şikâyetin hangisine ait olduğu belirsiz →
 * SAYILMAZ (temkinli: uyarı kaçabilir, yanlış uyarı üretmez). Ayrıca konunun geçtiği bölümlerden EN AZ BİRİ soru olmamalı: "Oda kirli,
 * Wi-Fi şifresi ne?" (sözlük "kirli"yi tanımaz, yalnız Wi-Fi görünür) Wi-Fi şikâyeti değildir; "Wi-Fi çalışmıyor, ne yapalım?" şikâyettir.
 * Konusu okunamayan metin (silinmiş / anonim) sayılmaz.
 */
export const KB_CATEGORY_CONCEPTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  wifi: ["wifi"],
  parking: ["parking"],
  cleaning: ["towels", "cleaning", "linen", "bedding"],
  trash: ["trash"],
  checkin: ["checkin", "keys"],
  checkout: ["checkout"],
  location: ["address", "location"],
});

/** Mesaj metni bu kategorinin şikâyeti olarak OKUNABİLİR mi (yalnız bu kategorinin konuları). */
export function messageIsAbout(body: string, kbCategory: string): boolean {
  const own = KB_CATEGORY_CONCEPTS[kbCategory];
  if (!own || typeof body !== "string" || body.length > 8_000) return false;
  const topics = topicsOf(body);
  if (topics.length === 0 || !topics.every((t) => own.includes(t))) return false;
  // Bölümler (cümle / virgül); soru = soru işaretiyle biten bölüm. Konu yalnız soru bölümlerinde geçiyorsa şikâyet konusu değildir.
  const clauses = body.match(/[^.!?;\n,]+[.!?;\n,]*/g) ?? [];
  return clauses.some((c) => !/\?\s*$/.test(c) && topicsOf(c).some((t) => own.includes(t)));
}

export interface ConversationItemLite {
  conversationId: string;
  messageId: string;
  kind: string;
  createdAt: Date;
}

/**
 * Aynı misafir mesajında şikâyet + konu → (konuşma, bilgi tabanı kategorisi) çiftleri. `bodies` verilirse (yükleyici HER ZAMAN verir) mesaj
 * metni o konuya ait olmalı (`messageIsAbout`); metni olmayan mesaj sayılmaz.
 */
export function complaintTopics(
  items: readonly ConversationItemLite[],
  bodies?: ReadonlyMap<string, string>,
): { conversationId: string; kbCategory: string; at: Date }[] {
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
      if (!kb) continue;
      if (bodies && !messageIsAbout(bodies.get(i.messageId) ?? "", kb)) continue;
      out.push({ conversationId: i.conversationId, kbCategory: kb, at: i.createdAt });
    }
  }
  return out;
}

export interface TimeRowLite {
  text: string;
  itemIds: readonly string[];
  /** Mülk ayarı ↔ bilgi tabanı satırı: işaret, mülk ayarı SONRADAN değişirse geçersiz (Haiku 4. tur). */
  againstPropertyUpdatedAt?: Date | null;
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

const acknowledged = (facts: readonly FactLite[], alsoAfter: Date | null = null) =>
  facts.length > 0 &&
  facts.every(
    (f) =>
      f.humanOverrideAt !== null &&
      f.humanOverrideAt.getTime() >= f.observedAt.getTime() &&
      (alsoAfter === null || f.humanOverrideAt.getTime() >= alsoAfter.getTime()),
  );

/** Saf karar: olası çelişkiler (ev sahibinin "bilerek" işaretlediği ve sonra değişmeyenler hariç). */
export function detectContradictions(input: {
  facts: readonly FactLite[];
  topics: readonly { conversationId: string; kbCategory: string; at: Date }[];
  timeRows: readonly TimeRowLite[];
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
    if (facts.length === 0 || acknowledged(facts, row.againstPropertyUpdatedAt ?? null)) continue;
    out.push({ kind: "kb_vs_kb", memoryIds: facts.map((f) => f.id), text: row.text });
  }
  return out;
}

/** Mülk sayfası için: kiracı + mülk kapsamlı olası çelişkiler. Okunamazsa çağıran boş liste gösterir. */
export async function getMemoryContradictions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<ContradictionWarning[]> {
  const since = new Date(now.getTime() - CONTRADICTION_WINDOW_DAYS * 86_400_000);
  const [property, facts, items, kbItems] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, organizationId }, select: { checkInTime: true, checkOutTime: true, updatedAt: true } }),
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
      // En yeniden (Haiku 4. tur: sırasız tavan, sayfa açılışları arasında farklı sonuç verebiliyordu); `id` eşitlik bozucu.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2_000,
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId, property: { organizationId } },
      select: { id: true, title: true, category: true, content: true, isActive: true, reviewState: true, updatedAt: true, supersededById: true },
    }),
  ]);
  if (!property) return [];
  const timeRows: TimeRowLite[] = kbTimeConflicts(property, aiReadableForConflicts(kbItems)).map((r) => ({
    text: r.text,
    itemIds: r.sides.map((s) => s.itemId),
    againstPropertyUpdatedAt: r.kind === "property" ? property.updatedAt : null,
  }));
  // Konu doğrulaması için yalnız ADAY mesajların metni (şikâyet + eşlenen konu aynı mesajda); kiracı + mülk kapsamlı.
  const kindsByMessage = new Map<string, Set<string>>();
  for (const i of items) {
    const set = kindsByMessage.get(i.messageId) ?? new Set<string>();
    set.add(i.kind);
    kindsByMessage.set(i.messageId, set);
  }
  const candidateMessageIds = [...kindsByMessage.entries()]
    .filter(([, kinds]) => kinds.has("complaint_issue") && [...kinds].some((k) => k in ITEM_TOPIC_TO_KB))
    .map(([id]) => id)
    .slice(0, 500);
  const messages = candidateMessageIds.length
    ? await prisma.message.findMany({
        where: { id: { in: candidateMessageIds }, conversation: { propertyId, property: { organizationId } } },
        select: { id: true, body: true },
      })
    : [];
  const bodies = new Map(messages.map((m) => [m.id, m.body ?? ""]));
  return detectContradictions({
    facts: facts.map((f) => ({ id: f.id, category: f.category, kbItemId: f.sourceRef, observedAt: f.observedAt, humanOverrideAt: f.humanOverrideAt })),
    topics: complaintTopics(items, bodies),
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
