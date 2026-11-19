import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// "İÇ KAYIT" — sayfa ve liste (dilim D3; kurucu 11-18 akşam: "'Gönder' yalnız gerçek bir alıcı varsa görünür … Eskiden açılan yerel
// kayıtlar silinmez veya rastgele bir kanala bağlanmaz; 'İç kayıt' olarak korunur"; kural `src/lib/internal-record.ts`).
//
// Alıcısı olmayan eski yerel kayıtta (kanal kimliği yok, QR değil):
//  · konuşma sayfası yazma kutusu / yapay zekâ önerisi / karar kartı VERMEZ (misafire mesaj gönderme yüzeyleri), eski mesajlar ve
//    "İç notlar" kartı durur; başlıkta kanal adı yerine "İç kayıt" yazar (eski formda seçilen "Airbnb" gerçek bir kanal bağı değildi);
//  · kartı gösterilmeyen kararın öğesi "Açık işler"den GİZLENMEZ;
//  · Gelen Kutusu satırı durum rozeti ("Yeni") yerine "İç kayıt" etiketi taşır ve vurgulanmaz.
// Kanal konuşması, iç QR sohbeti ve demo hesabı bugünkü gibi. Sunucudaki ret `reply-delivery-outcome.test.ts` ve karar testlerinde.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(async () => session),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async () => ({ configured: false, notified: false })),
}));

import { prisma, resetDb, PROPERTY_EXISTED_BEFORE } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { treeText } from "../helpers/tree-text";
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import InboxPage from "@/app/(app)/inbox/page";
import { ConversationThread } from "@/components/inbox/conversation-thread";
import { DecisionPanel } from "@/components/inbox/decision-panel";
import { InternalNotesCard } from "@/components/inbox/internal-notes";
import { ConversationItemsCard } from "@/components/inbox/conversation-items-card";
import { DEMO_ORG_ID } from "@/lib/demo-tenant/constants";

type ThreadProps = React.ComponentProps<typeof ConversationThread>;
type ItemsCardProps = React.ComponentProps<typeof ConversationItemsCard>;

function findProps<P>(node: unknown, type: unknown): P | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findProps<P>(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    if (node.type === type) return node.props as P;
    return findProps<P>((node.props as { children?: unknown }).children, type);
  }
  return null;
}

/** Bir işletme + üç konuşma: eski yerel kayıt ("Airbnb" etiketiyle elle açılmış), gerçek kanal konuşması, iç QR sohbeti. */
async function world(opts: { demo?: boolean } = {}) {
  const org = await prisma.organization.create({ data: { ...(opts.demo ? { id: DEMO_ORG_ID } : {}), name: "Org", timezone: "Europe/Istanbul" } });
  const user = await prisma.user.create({ data: { organizationId: org.id, name: "Ayşe Sahip", email: `o-${org.id}@x.com`, passwordHash: "x", role: "owner" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, createdAt: PROPERTY_EXISTED_BEFORE, name: "Lale", checkInTime: "15:00", checkOutTime: "11:00" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Ada Lale", arrivalDate: stayDay(1), departureDate: stayDay(3), status: "confirmed", channel: "airbnb" },
  });
  const now = Date.now();
  const mk = async (guest: string, externalReservationId: string | null, minutesAgo: number, channel = "airbnb") => {
    const at = new Date(now - minutesAgo * 60_000);
    const c = await prisma.conversation.create({
      data: { propertyId: property.id, reservationId: reservation.id, channel, guestIdentifier: guest, status: "new", lastMessageAt: at, externalReservationId },
    });
    await prisma.message.create({ data: { conversationId: c.id, direction: "inbound", authorType: "guest", senderName: guest, body: `Merhaba ${guest}`, createdAt: at } });
    return c.id;
  };
  const localId = await mk("Yerel", null, 30);
  const channelId = await mk("Kanal", "res-1", 20);
  session = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: user.name, sessionEpoch: 0 };
  return { orgId: org.id, propertyId: property.id, localId, channelId };
}
const page = (id: string) => ConversationPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) } as never);

describe("iç kayıt — konuşma sayfası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.unstubAllEnvs();
  });

  it("🚨 alıcısı olmayan kayıt: yazma kutusu / öneri YOK (canReply kapalı), karar kartı YOK, başlıkta 'İç kayıt' (kanal adı değil); mesajlar ve iç not kartı durur", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const w = await world();
    const tree = await page(w.localId);
    const thread = findProps<ThreadProps>(tree, ConversationThread)!;
    expect(thread.canReply).toBe(false); // ⬅️ ESKİDE: yazma kutusu açıktı, "Gönder" cevabı yalnız kaydediyordu
    expect(thread.propertyLabel).toContain("İç kayıt");
    expect(thread.propertyLabel).not.toContain("Airbnb");
    expect(thread.messages.map((m) => m.body)).toEqual(["Merhaba Yerel"]); // eski mesajlar okunur
    expect(findProps(tree, DecisionPanel)).toBeNull();
    expect(findProps(tree, InternalNotesCard)).not.toBeNull(); // ekip kaydı buraya yazılır
  });

  it("KONTROL: gerçek kanal konuşması bugünkü gibi — yazma kutusu açık, başlıkta kanal adı, karar kartı alanı yerinde", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    const w = await world();
    const tree = await page(w.channelId);
    const thread = findProps<ThreadProps>(tree, ConversationThread)!;
    expect(thread.canReply).toBe(true);
    expect(thread.localOnly).toBe(false);
    expect(thread.propertyLabel).toContain("Airbnb");
    expect(thread.propertyLabel).not.toContain("İç kayıt");
    expect(findProps(tree, DecisionPanel)).not.toBeNull();
  });

  it("KONTROL: DEMO hesabı muaf — kanala bağlı olmayan konuşmada yazma kutusu açık kalır ('yalnız kaydedilir' notuyla)", async () => {
    const w = await world({ demo: true });
    const thread = findProps<ThreadProps>(await page(w.localId), ConversationThread)!;
    expect(thread.canReply).toBe(true);
    expect(thread.localOnly).toBe(true);
    expect(thread.propertyLabel).not.toContain("İç kayıt");
  });

  it("🚨 iç kayıtta kartı gösterilmeyen kararın öğesi 'Açık işler'den GİZLENMEZ (gizlenseydi açık iş sayfada hiçbir yerde görünmezdi)", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
    vi.stubEnv("AI_UNDERSTANDING_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const w = await world();
    const seedDecision = async (conversationId: string) => {
      const message = await prisma.message.findFirstOrThrow({ where: { conversationId } });
      const item = await prisma.conversationItem.create({
        data: { organizationId: w.orgId, conversationId, messageId: message.id, kind: "early_checkin", sources: "understanding", status: "pending_host" },
      });
      await prisma.decisionRequest.create({
        data: { organizationId: w.orgId, conversationId, messageId: message.id, itemId: item.id, kind: "early_checkin", requestedTime: "13:00", dayKey: stayDay(1).toISOString().slice(0, 10), lang: "tr" },
      });
      return item.id;
    };
    const localItem = await seedDecision(w.localId);
    const channelItem = await seedDecision(w.channelId);
    const itemIds = async (id: string) => (findProps<ItemsCardProps>(await page(id), ConversationItemsCard)?.items ?? []).map((r) => r.id);
    // Kanal konuşmasında öğeyi KART temsil eder → "Açık işler"de ikinci kez görünmez (bugünkü davranış).
    expect(await itemIds(w.channelId)).not.toContain(channelItem);
    // İç kayıtta kart yok → öğe "Açık işler"de kendi satırıyla durur.
    expect(await itemIds(w.localId)).toContain(localItem);
  });
});

describe("iç kayıt — Gelen Kutusu satırı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.unstubAllEnvs();
  });

  it("🚨 satır 'İç kayıt' etiketi taşır (durum rozeti yerine) ve kayıt listeden SİLİNMEZ; kanal konuşması bugünkü gibi 'Yeni'", async () => {
    await world();
    const tree = await InboxPage({ searchParams: Promise.resolve({}) } as never);
    const text = treeText(tree);
    expect(text).toContain("Yerel"); // kayıt korunur
    expect(text).toContain("Kanal");
    // Durum rozeti ("Yeni") yalnız kanal konuşmasında: iki satırın ikisi de 'new' durumunda. (Satır metni üzerinden sayılır: açılmayan
    // bileşenin metni `treeText`te hem prop hem çocuk olarak iki kez toplanır.)
    const rows = collectRows(tree);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.includes("İç kayıt"))).toHaveLength(1); // yalnız yerel kayıt
    expect(rows.find((r) => r.includes("Yerel"))).toContain("İç kayıt");
    expect(rows.find((r) => r.includes("Yerel"))).not.toContain("Yeni");
    expect(rows.find((r) => r.includes("Kanal"))).toContain("Yeni");
    expect(rows.find((r) => r.includes("Kanal"))).not.toContain("İç kayıt");
  });

  it("KONTROL: DEMO hesabında kanala bağlı olmayan konuşma 'İç kayıt' sayılmaz (bugünkü rozetler)", async () => {
    await world({ demo: true });
    expect(treeText(await InboxPage({ searchParams: Promise.resolve({}) } as never))).not.toContain("İç kayıt");
  });
});

/** Liste satırlarının (konuşma bağlantıları) metinleri. */
function collectRows(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const n of node) collectRows(n, out);
    return out;
  }
  if (React.isValidElement(node)) {
    const props = node.props as { href?: unknown; children?: unknown };
    if (typeof props.href === "string" && /^\/inbox\/[^/?]+\?from=/.test(props.href)) {
      out.push(treeText(node));
      return out;
    }
    collectRows(props.children, out);
  }
  return out;
}
