import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// İÇ NOT — sayfa bağlantısı (dilim D1):
//  · konuşma sayfası notları SUNUCUDA yükler ve "İç notlar" kartına verir (konaklamanın notları, yeniden eskiye, sahip silebilir);
//  · not, mesaj akışına (ConversationThread) GİRMEZ;
//  · not eklemek Gelen Kutusu listesini (sıra, son mesaj önizlemesi, rozetler) DEĞİŞTİRMEZ — liste ağacının metni not öncesi / sonrası aynı.
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

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { treeText } from "../helpers/tree-text";
import { __resetRateLimit } from "@/lib/rate-limit";
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import InboxPage from "@/app/(app)/inbox/page";
import { InternalNotesCard } from "@/components/inbox/internal-notes";
import { ConversationThread } from "@/components/inbox/conversation-thread";
import { POST as createPost } from "@/app/api/internal-notes/route";

type CardProps = React.ComponentProps<typeof InternalNotesCard>;

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

const post = (body: unknown) =>
  createPost(
    new NextRequest("http://localhost/api/internal-notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({}) },
  );

async function world() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Istanbul" } });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "Ayşe Sahip", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Ada Lale", arrivalDate: stayDay(1), departureDate: stayDay(3), status: "confirmed", channel: "airbnb" },
  });
  const now = Date.now();
  const older = await prisma.conversation.create({
    data: { propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ada", status: "waiting", lastMessageAt: new Date(now - 2 * 3_600_000) },
  });
  const newer = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Can", status: "new", lastMessageAt: new Date(now - 3_600_000) },
  });
  for (const c of [older, newer]) {
    await prisma.message.create({
      data: { conversationId: c.id, direction: "inbound", authorType: "guest", senderName: c.guestIdentifier, body: `Merhaba ${c.guestIdentifier}`, createdAt: c.lastMessageAt },
    });
  }
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: user.name, sessionEpoch: 0 };
  return { olderId: older.id, newerId: newer.id };
}

describe("iç not — sayfa", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
  });

  it("🚨 konuşma sayfası notları karta verir (yeniden eskiye, zaman ev sahibinin saatiyle); not mesaj akışına GİRMEZ", async () => {
    const w = await world();
    expect((await post({ conversationId: w.olderId, body: "Telefonla aradı" })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 5));
    expect((await post({ conversationId: w.olderId, body: "Kapıda söylendi" })).status).toBe(201);
    const tree = await ConversationPage({ params: Promise.resolve({ id: w.olderId }), searchParams: Promise.resolve({}) } as never);
    const card = findProps<CardProps>(tree, InternalNotesCard);
    expect(card).not.toBeNull();
    expect(card!.conversationId).toBe(w.olderId);
    expect(card!.readOnly).toBe(false);
    expect(card!.notes.map((n) => [n.body, n.authorName, n.canDelete])).toEqual([
      ["Kapıda söylendi", "Ayşe Sahip", true],
      ["Telefonla aradı", "Ayşe Sahip", true],
    ]);
    expect(card!.notes[0]!.createdLabel).toMatch(/\d{2}:\d{2}/);
    const thread = findProps<{ messages: Array<{ body: string }> }>(tree, ConversationThread);
    expect(thread!.messages.map((m) => m.body)).toEqual(["Merhaba Ada"]);
    // Konaklamasız öteki konuşmanın kartı boş.
    const other = await ConversationPage({ params: Promise.resolve({ id: w.newerId }), searchParams: Promise.resolve({}) } as never);
    expect(findProps<CardProps>(other, InternalNotesCard)!.notes).toEqual([]);
  });

  it("🚨 not eklemek Gelen Kutusu listesini DEĞİŞTİRMEZ: sıra, son mesaj önizlemesi, rozetler aynı; not metni listede görünmez", async () => {
    const w = await world();
    const before = treeText(await InboxPage({ searchParams: Promise.resolve({}) } as never));
    expect(before.indexOf("Merhaba Can")).toBeGreaterThanOrEqual(0);
    expect(before.indexOf("Merhaba Can")).toBeLessThan(before.indexOf("Merhaba Ada")); // yeni konuşma üstte
    // Eski konuşmaya not: konuşma "yeni etkinlik" gibi üste çıkmamalı.
    expect((await post({ conversationId: w.olderId, body: "GİZLİ-NOT-METNİ telefonla aradı" })).status).toBe(201);
    const after = treeText(await InboxPage({ searchParams: Promise.resolve({}) } as never));
    expect(after).toBe(before);
    expect(after).not.toContain("GİZLİ-NOT-METNİ");
  });
});
