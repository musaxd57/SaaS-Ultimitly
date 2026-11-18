import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Konuşma sayfası "Açık işler" kartının sayfa bağlantısı (Codex 11-17 E4 + H8):
//  · öğe okuması düşerse sayfa ayakta kalır, hata `reportError`a gider ve kart "okunamadı" durumunu alır (boş liste gibi kaybolmaz);
//  · 21 açık iş → 21 satırın hepsi + rozet 21 (eski `.slice(0, 20)` en eski açık işi kesiyordu).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
const failItems = { on: false };
vi.mock("@/lib/conversation-items/store", async (orig) => {
  const actual = await orig<typeof import("@/lib/conversation-items/store")>();
  return {
    ...actual,
    listConversationItems: (...a: Parameters<typeof actual.listConversationItems>) =>
      failItems.on ? Promise.reject(new Error("items read down")) : actual.listConversationItems(...a),
  };
});
const failDecisions = { on: false };
vi.mock("@/lib/decisions/store", async (orig) => {
  const actual = await orig<typeof import("@/lib/decisions/store")>();
  return {
    ...actual,
    listConversationDecisions: (...a: Parameters<typeof actual.listConversationDecisions>) =>
      failDecisions.on ? Promise.reject(new Error("decisions read down")) : actual.listConversationDecisions(...a),
  };
});
const reportSpy = vi.fn(async (..._a: unknown[]) => ({ configured: false, notified: false }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: (...a: unknown[]) => reportSpy(...a),
}));

import { requireAuth } from "@/lib/auth";
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import { ConversationItemsCard } from "@/components/inbox/conversation-items-card";

const mockAuth = vi.mocked(requireAuth);

type CardProps = React.ComponentProps<typeof ConversationItemsCard>;

function findCard(node: unknown): CardProps | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findCard(n);
      if (hit) return hit;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    if (node.type === ConversationItemsCard) return node.props as CardProps;
    return findCard((node.props as { children?: unknown }).children);
  }
  return null;
}

async function renderPage(openItems: number, closedItems: number): Promise<CardProps | null> {
  const org = await prisma.organization.create({ data: { name: "Kart Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ada", status: "new", lastMessageAt: new Date() },
  });
  const base = Date.now() - 10 * 60 * 60_000;
  for (let i = 0; i < openItems + closedItems; i++) {
    const m = await prisma.message.create({
      data: { conversationId: conversation.id, direction: "inbound", authorType: "guest", senderName: "Ada", body: "?", createdAt: new Date(base + i * 60_000) },
    });
    await prisma.conversationItem.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        messageId: m.id,
        kind: "payment_invoice",
        sensitivity: "sensitive",
        sources: "lexical",
        status: i < openItems ? "pending_host" : "done",
        createdAt: new Date(base + i * 60_000 + 1000),
      },
    });
  }
  mockAuth.mockResolvedValue({ userId: "u1", organizationId: org.id, role: "owner", email: "o@x.com" } as never);
  const tree = await ConversationPage({ params: Promise.resolve({ id: conversation.id }), searchParams: Promise.resolve({}) } as never);
  return findCard(tree);
}

describe("konuşma sayfası — Açık işler kartı", () => {
  beforeEach(async () => {
    await resetDb();
    failItems.on = false;
    failDecisions.on = false;
    reportSpy.mockClear();
    vi.unstubAllEnvs();
  });

  it("🚨 öğe okuması düştü → sayfa ayakta, kart loadFailed alır, hata reportError'a gider", async () => {
    failItems.on = true;
    const card = await renderPage(2, 0);
    expect(card).not.toBeNull();
    expect(card!.loadFailed).toBe(true);
    expect(card!.items).toEqual([]);
    expect(reportSpy.mock.calls.map((c) => c[0])).toContain("inbox.conversation-items");
  });

  it("🚨 21 açık + 3 kapalı → 21 açık satırın hepsi (kapanmışlar tavan dışında), rozet 21; okuma sağlam (loadFailed yok, hata kaydı yok)", async () => {
    const card = await renderPage(21, 3);
    expect(card!.loadFailed).toBe(false);
    expect(card!.openTotal).toBe(21);
    expect(card!.items.filter((r) => r.open)).toHaveLength(21);
    expect(card!.items.filter((r) => !r.open)).toHaveLength(0);
    expect(reportSpy.mock.calls.map((c) => c[0])).not.toContain("inbox.conversation-items");
  });

  it("aşırı uygulama: 2 açık + 30 kapalı → 20 satır (2 açık + 18 kapalı), rozet 2", async () => {
    const card = await renderPage(2, 30);
    expect(card!.items).toHaveLength(20);
    expect(card!.items.slice(0, 2).every((r) => r.open)).toBe(true);
    expect(card!.openTotal).toBe(2);
  });

  it("karar kartı okuması düştü (bayrak açık) → sayfa ayakta, hata reportError'a gider; Açık işler kartı etkilenmez", async () => {
    vi.stubEnv("HOST_DECISIONS_ENABLED", "1");
    failDecisions.on = true;
    const card = await renderPage(1, 0);
    expect(reportSpy.mock.calls.map((c) => c[0])).toContain("inbox.conversation-decisions");
    expect(card!.loadFailed).toBe(false);
    expect(card!.openTotal).toBe(1);
  });
});
