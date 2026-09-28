import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// K10-t — konuşma sayfasındaki "mesaj çok uzun, elle yanıtla" uyarısı (09-28 inceleme ajanı, çalıştırılarak doğrulandı):
//  · uyarı öncelikli gösterildiği için uyarı yolunun yazdığı risk sebebi ("Sebep: güvenlik / acil durum") kayboluyordu — uzun
//    acil mesajda ev sahibi acil sebebi görmüyordu (e-posta da yalnız ilk 600 karakteri taşıyor);
//  · ev sahibi konuşmayı elle "Cevaplandı" / "Tamamlandı" yapınca da uyarı duruyordu (eski uyarı "Cevaplandı"da gizleniyordu).
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

const LONG = "Merhaba, uzun bir mesaj. ".repeat(330) + "Dairede duman var!";
const WARNING = "Mesaj çok uzun (8.000 karakterden fazla)";

async function render(status: "new" | "problem" | "answered" | "closed", lastRiskType: string | null): Promise<string> {
  const org = await prisma.organization.create({ data: { name: "Uzun Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Ada",
      status,
      lastRiskType,
      skippedReason: lastRiskType ? "complaint" : null,
      lastMessageAt: new Date(),
      messages: { create: [{ direction: "inbound", authorType: "guest", senderName: "Ada", body: LONG }] },
    },
  });
  mockAuth.mockResolvedValue({ userId: "u1", organizationId: org.id, role: "owner", email: "o@x.com" } as never);
  const tree = await ConversationPage({ params: Promise.resolve({ id: conversation.id }), searchParams: Promise.resolve({}) } as never);
  return textOf(tree);
}

describe("uzun mesaj uyarısı — konuşma sayfası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 uyarı yolunun acil sebebi uyarıyla BİRLİKTE görünür", async () => {
    const text = await render("problem", "safety_emergency");
    expect(text).toContain(WARNING);
    expect(text).toContain("Sebep: güvenlik / acil durum");
  });

  it("🚨 ev sahibi 'Cevaplandı' / 'Tamamlandı' yaptıysa uyarı gizlenir", async () => {
    expect(await render("answered", null)).not.toContain(WARNING);
    await resetDb();
    expect(await render("closed", null)).not.toContain(WARNING);
  });

  it("KONTROL — yeni konuşmada uyarı görünür (risk sebebi yoksa sebep satırı yok)", async () => {
    const text = await render("new", null);
    expect(text).toContain(WARNING);
    expect(text).not.toContain("Sebep:");
  });
});
