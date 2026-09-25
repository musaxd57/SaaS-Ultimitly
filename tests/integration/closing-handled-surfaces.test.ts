import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import React from "react";
import { treeText } from "../helpers/tree-text";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// "CEVAP GEREKMEDİ" HÂLİ — EV SAHİBİ YÜZEYLERİ (kurucu kuralı 09-25, `lib/conversation-attention.ts`).
// Misafir yalnız teşekkür yazdı ve yapay zekâ BİLEREK sessiz kaldı → konuşma panonun "Bekleyen Mesajlar"ında, gelen
// kutusunun "Yeni" sekmesinde ve açık konuşma sayacında GÖRÜNMEZ; "Tümü"nde kendi etiketiyle görünür. Durum değişmez
// (`new` kalır) — hâl türetilir; misafir yeniden yazınca konuşma kendiliğinden geri gelir. "Sorunlu" asla gizlenmez.
// Desen: inbox-visual-and-a11y.test.ts — sayfa fonksiyonu GERÇEK test DB'siyle çağrılır, dönen ağaç yürünür.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
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

import { requireAuth } from "@/lib/auth";
import InboxPage from "@/app/(app)/inbox/page";
import DashboardPage from "@/app/(app)/dashboard/page";
import { getOpsStats } from "@/lib/reports";
import { CLOSING_HANDLED_LABEL } from "@/lib/conversation-attention";
import { Badge } from "@/components/ui/badge";

const mockAuth = vi.mocked(requireAuth);
const sp = <T,>(v: T) => Promise.resolve(v);

function sessionFor(orgId: string) {
  return {
    userId: "user-closing-test",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

async function seed() {
  const org = await prisma.organization.create({ data: { name: "Kapanış Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Daire A" } });
  const t = new Date(Date.now() - 10 * 60_000);
  const convo = (guestIdentifier: string, data: Record<string, unknown>) =>
    prisma.conversation.create({
      data: { propertyId: property.id, channel: "airbnb", guestIdentifier, lastMessageAt: t, ...data },
    });
  // Düz yeni konuşma (skippedReason NULL — NULL güvenliği: listeden DÜŞMEMELİ).
  await convo("Misafir-Acik", { status: "new" });
  // Kapanışa bilerek sessiz kalındı → gizlenir.
  await convo("Misafir-Kapanis", { status: "new", skippedReason: "closing_ack", autoReplyAttemptedAt: t });
  // Aynı damga ama BAŞKA gerekçe (ev sahibi taslağı bekliyor) → görünür.
  await convo("Misafir-Baska", { status: "new", skippedReason: "low_confidence_or_risky", autoReplyAttemptedAt: t });
  // Kapanıştan SONRA misafir yeniden yazdı (son mesaj damgayı geçti) → görünür.
  await convo("Misafir-Yeniden", {
    status: "new",
    skippedReason: "closing_ack",
    autoReplyAttemptedAt: new Date(t.getTime() - 60_000),
  });
  // "Sorunlu" asla gizlenmez.
  await convo("Misafir-Sorunlu", { status: "problem", skippedReason: "closing_ack", autoReplyAttemptedAt: t });
  return org;
}

describe("'cevap gerekmedi' — pano, gelen kutusu, sayaç", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("pano 'Bekleyen Mesajlar': sessiz kalınan kapanış YOK; düz yeni, başka gerekçe, yeniden yazan ve sorunlu VAR", async () => {
    const org = await seed();
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const text = treeText(await DashboardPage());
    expect(text).toContain("Misafir-Acik");
    expect(text).toContain("Misafir-Baska");
    expect(text).toContain("Misafir-Yeniden");
    expect(text).toContain("Misafir-Sorunlu");
    expect(text).not.toContain("Misafir-Kapanis");
  });

  it("gelen kutusu 'Yeni': sessiz kalınan kapanış YOK, sayaç aynı koşulla", async () => {
    const org = await seed();
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const text = treeText(await InboxPage({ searchParams: sp({ status: "new" }) }));
    expect(text).toContain("Misafir-Acik");
    expect(text).toContain("Misafir-Baska");
    expect(text).toContain("Misafir-Yeniden");
    expect(text).not.toContain("Misafir-Kapanis");
    expect(text).not.toContain(CLOSING_HANDLED_LABEL);
    expect(text).toContain("3 konuşma");
  });

  it("gelen kutusu 'Tümü': sessiz kalınan kapanış kendi etiketiyle görünür (kaybolmaz)", async () => {
    const org = await seed();
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const text = treeText(await InboxPage({ searchParams: sp({}) }));
    expect(text).toContain("Misafir-Kapanis");
    expect(text).toContain(CLOSING_HANDLED_LABEL);
    // Etiket yalnız o satırda: diğer dört konuşma kendi durum etiketini taşır. Ağaç yürütücüsü fonksiyon bileşenini hem
    // açar hem çocuklarını toplar (rozet metni çiftlenir) → beklenen sayı TEK bir rozetin yürütücüdeki çarpanıdır.
    const perBadge = treeText(React.createElement(Badge, { tone: "muted" }, "ZZQ")).split("ZZQ").length - 1;
    expect(perBadge).toBeGreaterThan(0);
    expect(text.split(CLOSING_HANDLED_LABEL).length - 1).toBe(perBadge);
  });

  it("açık konuşma sayacı sessiz kalınan kapanışı saymaz; sorunlu sayacı etkilenmez", async () => {
    const org = await seed();
    const stats = await getOpsStats(org.id);
    expect(stats.openConversations).toBe(3); // Acik + Baska + Yeniden
    expect(stats.problemConversations).toBe(1);
  });
});
