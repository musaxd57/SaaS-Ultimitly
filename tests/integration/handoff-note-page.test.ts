import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// K10 (kurucu kararı 09-30, "Hiçbir şey gitmesin"): tutulan kanal cevabı konuyu ev sahibine bırakıyorduysa ("mesajınız
// kaydedildi; ev sahibiniz görebilir") misafire hiçbir şey gitmez. Ev sahibi konuşma sayfasında bunu "Misafir cevabınızı
// bekliyor" notuyla görür. `skippedReason` bilerek aynı kalır (on tüketicisi var) — not, SON misafir mesajının karar
// kaydından türetilir. Raporlarda kendi satırı vardır.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import ConversationPage from "@/app/(app)/inbox/[id]/page";

const mockAuth = vi.mocked(requireAuth);

function textOf(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement(node)) return textOf((node.props as { children?: unknown }).children);
  return "";
}

const WAITING = "Misafir cevabınızı bekliyor";
const LOW_CONF = "AI emin olamadı";

async function render(opts: { reason: string | null; trigger?: "last" | "earlier"; orgOfEvent?: "same" | "other" }): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Not Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 5" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Ada",
      status: "new",
      skippedReason: "low_confidence_or_risky",
      lastMessageAt: new Date(),
      messages: {
        create: [
          { direction: "inbound", authorType: "guest", senderName: "Ada", body: "Otopark var mı?", createdAt: new Date(Date.now() - 120_000) },
          { direction: "inbound", authorType: "guest", senderName: "Ada", body: "Yakında fırın var mı?", createdAt: new Date(Date.now() - 60_000) },
        ],
      },
    },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (opts.reason) {
    const other = opts.orgOfEvent === "other" ? await prisma.organization.create({ data: { name: "Başka" } }) : null;
    const trigger = opts.trigger === "earlier" ? conversation.messages[0]! : conversation.messages[1]!;
    await prisma.riskEvent.create({
      data: {
        organizationId: other?.id ?? org.id,
        conversationId: conversation.id,
        surface: "auto_reply",
        triggerId: trigger.id,
        finalDecision: "human_review",
        reason: opts.reason,
      },
    });
  }
  mockAuth.mockResolvedValue({ userId: "u1", organizationId: org.id, role: "owner", email: "o@x.com" } as never);
  const tree = await ConversationPage({ params: Promise.resolve({ id: conversation.id }), searchParams: Promise.resolve({}) } as never);
  return textOf(tree);
}

describe("K10 — konuşma sayfası 'Misafir cevabınızı bekliyor' notu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 son misafir mesajının karar kaydı handoff_notice → not 'Misafir cevabınızı bekliyor'", async () => {
    const text = await render({ reason: "handoff_notice" });
    expect(text).toContain(WAITING);
    expect(text).not.toContain(LOW_CONF);
  });

  it("KONTROL — karar kaydı düşük güven ya da hiç yok → bugünkü not", async () => {
    expect(await render({ reason: "low_confidence_or_risky" })).toContain(LOW_CONF);
    await resetDb();
    const none = await render({ reason: null });
    expect(none).toContain(LOW_CONF);
    expect(none).not.toContain(WAITING);
  });

  it("karar ESKİ bir mesaja aitse (son mesaj henüz değerlendirilmedi) not bugünkü gibi", async () => {
    const text = await render({ reason: "handoff_notice", trigger: "earlier" });
    expect(text).toContain(LOW_CONF);
    expect(text).not.toContain(WAITING);
  });

  it("🚨 kiracı izolasyonu: BAŞKA org'un aynı tetikleyicili kaydı notu değiştirmez", async () => {
    const text = await render({ reason: "handoff_notice", orgOfEvent: "other" });
    expect(text).not.toContain(WAITING);
  });
});

describe("K10 — raporlar: 'Misafir cevabınızı bekledi' satırı", () => {
  it("gerekçe risk-events REASONS'ta ve raporun 'size bırakılanlar' sorgusunda; satır kendi sayısını gösterir", async () => {
    const { ESCALATION_REASON_CODES } = await import("@/lib/risk-events");
    expect(ESCALATION_REASON_CODES.has("handoff_notice")).toBe(true);
    const src = readFileSync(join(process.cwd(), "src/app/(app)/reports/page.tsx"), "utf8");
    const start = src.indexOf("const HELD_REASONS = [");
    expect(start).toBeGreaterThan(-1);
    expect(src.slice(start, src.indexOf("];", start))).toContain('"handoff_notice"');
    expect(src).toMatch(/heldCount\("handoff_notice"\) > 0 \?/);
    expect(src).toContain("Misafir cevabınızı bekledi — size bırakıldı");
  });
});
