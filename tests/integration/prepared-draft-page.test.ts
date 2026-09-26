import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// HAZIR TASLAK — konuşma sayfasının BAĞLANTISI (kurucu 09-26, "Otomatik hazır dursun"; "yüklem var, argüman yok" sınıfı).
// Sayfa sunucu bileşeni gerçek test DB'siyle çağrılır, dönen ağaçtaki `ConversationThread`in `initialDraft` alanı okunur
// (istemci bileşeni çalışmaz). Pinlenen: bayrak kapısı · yalnız sahip/yönetici · sonra cevap gittiyse bayat · İPTAL edilmiş
// giden satır cevap sayılmaz · müsaitlik uyarısı sayfada yeniden hesaplanır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
// Öğe kipi bayrağı anlama katmanını da ister (anahtar); test paketi anahtarı boşaltır → katman "açık" sayılır.
vi.mock("@/lib/ai/semantic/understand", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/semantic/understand")>()),
  understandingEnabled: () => true,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import ConversationPage from "@/app/(app)/inbox/[id]/page";
import { ConversationThread } from "@/components/inbox/conversation-thread";

const mockAuth = vi.mocked(requireAuth);

function walk(node: unknown, visit: (el: React.ReactElement) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (React.isValidElement(node)) {
    visit(node);
    walk((node.props as { children?: unknown }).children, visit);
  }
}

type ThreadProps = React.ComponentProps<typeof ConversationThread>;
function initialDraftOf(tree: unknown): ThreadProps["initialDraft"] | "no-thread" {
  let found: ThreadProps | null = null;
  walk(tree, (el) => {
    if (el.type === ConversationThread) found = el.props as ThreadProps;
  });
  return found ? ((found as ThreadProps).initialDraft ?? null) : "no-thread";
}

const DRAFT = "Ödeme bilgisini kontrol edip size dönüş yapacağım.";

async function seed(messages: { direction: "inbound" | "outbound"; body: string; draft?: string; intent?: string; outbox?: string }[]) {
  const org = await prisma.organization.create({ data: { name: "Draft Org" } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: property.id, channel: "airbnb", guestIdentifier: "Ada", status: "new", lastMessageAt: new Date() },
  });
  const ids: string[] = [];
  let t = Date.now() - 60 * 60_000;
  for (const m of messages) {
    t += 60_000;
    const row = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: m.direction,
        senderName: m.direction === "inbound" ? "Ada" : "Ev sahibi",
        authorType: m.direction === "inbound" ? "guest" : "host",
        body: m.body,
        createdAt: new Date(t),
        ...(m.draft ? { aiSuggestedReply: m.draft, aiIntent: m.intent ?? "general", aiConfidence: 0.9 } : {}),
      },
    });
    ids.push(row.id);
    if (m.outbox) {
      await prisma.messageOutbox.create({
        data: {
          organizationId: org.id,
          conversationId: conversation.id,
          messageId: row.id,
          channel: "airbnb",
          body: m.body,
          idempotencyKey: `k-${row.id}`,
          status: m.outbox,
        },
      });
    }
  }
  return { orgId: org.id, conversationId: conversation.id, ids };
}

function session(orgId: string, role: string) {
  return { userId: "u-draft", organizationId: orgId, role, email: "draft@example.com" } as never;
}

async function render(conversationId: string) {
  return ConversationPage({ params: Promise.resolve({ id: conversationId }), searchParams: Promise.resolve({}) });
}

describe("konuşma sayfası — hazır taslak bağlantısı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("bayrak açık + sahip: son misafir mesajının taslağı panele gider (uyarısız)", async () => {
    const { orgId, conversationId, ids } = await seed([{ direction: "inbound", body: "IBAN'ınızı atar mısınız?", draft: DRAFT, intent: "payment" }]);
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    expect(initialDraftOf(await render(conversationId))).toEqual({
      messageId: ids[0],
      reply: DRAFT,
      intent: "payment",
      confidence: 0.9,
      availabilityCheck: null,
    });
  });

  it("KONTROL (bayrak kapalı): bugünkü davranış — taslak gösterilmez", async () => {
    vi.stubEnv("AI_CONVERSATION_ITEMS_ENABLED", "");
    const { orgId, conversationId } = await seed([{ direction: "inbound", body: "IBAN?", draft: DRAFT }]);
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    expect(initialDraftOf(await render(conversationId))).toBeNull();
  });

  it("personel: taslak gösterilmez (cevap yetkisi yok)", async () => {
    const { orgId, conversationId } = await seed([{ direction: "inbound", body: "IBAN?", draft: DRAFT }]);
    mockAuth.mockResolvedValue(session(orgId, "staff"));
    expect(initialDraftOf(await render(conversationId))).toBeNull();
  });

  it("taslaktan sonra cevap gitti → bayat, gösterilmez", async () => {
    const { orgId, conversationId } = await seed([
      { direction: "inbound", body: "IBAN?", draft: DRAFT },
      { direction: "outbound", body: "Ödemeler platformdan." },
    ]);
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    expect(initialDraftOf(await render(conversationId))).toBeNull();
  });

  it("İPTAL edilmiş giden satır (misafire gitmedi) cevap sayılmaz → taslak gösterilir", async () => {
    const { orgId, conversationId, ids } = await seed([
      { direction: "inbound", body: "IBAN?", draft: DRAFT },
      { direction: "outbound", body: "Eski AI taslağı", outbox: "canceled" },
    ]);
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    expect(initialDraftOf(await render(conversationId))).toMatchObject({ messageId: ids[0], reply: DRAFT });
  });

  it("konaklama isteği varken müsaitlik uyarısı sayfada yeniden hesaplanır", async () => {
    const { orgId, conversationId } = await seed([
      { direction: "inbound", body: "Erken giriş yapabilir miyiz?", draft: "Tabii, 12:00'de gelebilirsiniz.", intent: "early_checkin" },
    ]);
    mockAuth.mockResolvedValue(session(orgId, "owner"));
    const d = initialDraftOf(await render(conversationId));
    expect(d && d !== "no-thread" ? d.availabilityCheck : "x").not.toBeNull();
  });
});
