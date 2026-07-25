import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Liste ekranlarının SAYFALAMA sözleşmesi (Codex, tur-3 kapanış şartı).
//
// Bu ekranlar server component; jsdom'da tam render etmek ağır client
// bileşenlerini (yanıt kutusu, QR) sürüklerdi. property-page-erasure.test.ts ile
// AYNI desen kullanılır: sayfa fonksiyonu GERÇEK test DB'siyle çağrılır ve dönen
// React ağacı yürünür. Pinlenen davranışlar:
//   • QR sohbet listesi sayfalanır (25/sayfa) ve toplam GERÇEKTİR;
//   • başka kiracının thread'i notFound() — IDOR yok;
//   • mesaj penceresi aşılınca ekran bunu SÖYLER ve kademeli yükleme sunar;
//   • pencere SERT TAVANLIDIR (tek tıkla 10.000 baloncuk yok);
//   • "İnsan desteğinde" rozeti tam pencereye değil OTORİTER duruma bağlıdır —
//     devir işareti çok eskide kalsa bile listede doğru görünür;
//   • İptaller sayfalanır ve grupların yalnız o sayfaya ait olduğu yazılır;
//   • İptallerde filtre değişince sayfa 1'e döner.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
// notFound()/redirect() gerçekte throw eder; testte ayırt edilebilir hataya çeviriyoruz.
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { requireAuth } from "@/lib/auth";
import GuestChatsPage from "@/app/(app)/guest-chats/page";
import GuestChatDetailPage from "@/app/(app)/guest-chats/[id]/page";
import CancellationsPage from "@/app/(app)/cancellations/page";

const mockAuth = vi.mocked(requireAuth);

function treeText(root: unknown): string {
  const parts: string[] = [];
  const collect = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (React.isValidElement(node)) collect((node.props as { children?: unknown }).children);
  };
  collect(root);
  return parts.join("");
}

/** Ağaçtaki tüm href değerleri (sayfalama bağlantılarını doğrulamak için). */
function hrefs(root: unknown): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as { href?: unknown; children?: unknown };
      if (typeof props.href === "string") found.push(props.href);
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

function sessionFor(orgId: string, role = "owner") {
  return {
    userId: "user-list-test",
    organizationId: orgId,
    role,
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

const sp = <T,>(v: T) => Promise.resolve(v);

describe("Misafir Sohbetleri — liste sayfalaması", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("25/sayfa böler, GERÇEK toplamı gösterir ve 2. sayfa kalanı verir", async () => {
    const org = await prisma.organization.create({ data: { name: "Chat Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire A" },
    });
    for (let i = 0; i < 30; i++) {
      await prisma.conversation.create({
        data: {
          propertyId: property.id,
          channel: "chat",
          guestIdentifier: `Misafir-${String(i).padStart(2, "0")}`,
          status: "answered",
          priority: "standard",
          lastMessageAt: new Date(Date.now() - i * 60_000),
        },
      });
    }
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const p1 = treeText(await GuestChatsPage({ searchParams: sp({}) }));
    expect(p1).toContain("1–25 / 30"); // sayfadaki aralık + GERÇEK toplam
    expect(p1).toContain("Misafir-00");
    expect(p1).not.toContain("Misafir-25"); // 26. kayıt 2. sayfada

    const p2 = treeText(await GuestChatsPage({ searchParams: sp({ sayfa: "2" }) }));
    expect(p2).toContain("26–30 / 30");
    expect(p2).toContain("Misafir-25");
    expect(p2).not.toContain("Misafir-00");
  });

  it("rozet OTORİTERdir: devir işareti pencere dışında kalsa da listede görünür", async () => {
    const org = await prisma.organization.create({ data: { name: "Badge Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire B" },
    });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "chat",
        guestIdentifier: "Devirli Misafir",
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
      },
    });
    const base = Date.now() - 400 * 60_000;
    // ÇOK ESKİDE bir host yanıtı…
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        authorType: "host",
        senderName: "Ev sahibi",
        body: "Ben ilgileniyorum.",
        createdAt: new Date(base),
      },
    });
    // …ve üstüne YALNIZ misafir mesajları (300 tane): pencere temelli türetim
    // devri ıskalardı, otoriter sorgu ıskalamaz.
    await prisma.message.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        conversationId: conv.id,
        direction: "inbound",
        authorType: "guest",
        senderName: "Devirli Misafir",
        body: `Soru ${i}`,
        createdAt: new Date(base + (i + 1) * 60_000),
      })),
    });
    mockAuth.mockResolvedValue(sessionFor(org.id));

    expect(treeText(await GuestChatsPage({ searchParams: sp({}) }))).toContain("İnsan desteğinde");
  });

  it("AI etkinken rozet ÇIKMAZ (yeniden-etkinleştirme işareti host yanıtını geçersizler)", async () => {
    const org = await prisma.organization.create({ data: { name: "Resume Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire C" },
    });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "chat",
        guestIdentifier: "Devri Biten",
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
      },
    });
    const base = Date.now() - 10 * 60_000;
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        authorType: "host",
        senderName: "Ev sahibi",
        body: "Ben bakıyorum.",
        createdAt: new Date(base),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        direction: "outbound",
        authorType: "system",
        systemEventType: "guest_chat_ai_resumed",
        senderName: "Lixus AI yeniden etkinleştirildi",
        body: "Lixus AI yeniden etkinleştirildi",
        createdAt: new Date(base + 60_000),
      },
    });
    mockAuth.mockResolvedValue(sessionFor(org.id));

    expect(treeText(await GuestChatsPage({ searchParams: sp({}) }))).not.toContain(
      "İnsan desteğinde",
    );
  });
});

describe("Misafir Sohbeti detayı — IDOR + kademeli mesaj penceresi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  async function seedLongThread(messageCount: number) {
    const org = await prisma.organization.create({ data: { name: "Detail Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire D" },
    });
    const conv = await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "chat",
        guestIdentifier: "Uzun Sohbet",
        status: "answered",
        priority: "standard",
        lastMessageAt: new Date(),
      },
    });
    const base = Date.now() - messageCount * 60_000;
    await prisma.message.createMany({
      data: Array.from({ length: messageCount }, (_, i) => ({
        conversationId: conv.id,
        direction: i % 2 === 0 ? "inbound" : "outbound",
        authorType: i % 2 === 0 ? "guest" : "ai",
        senderName: i % 2 === 0 ? "Uzun Sohbet" : "GuestOps AI",
        body: `msg-${String(i).padStart(5, "0")}`,
        createdAt: new Date(base + i * 60_000),
      })),
    });
    return { org, conv };
  }

  it("BAŞKA kiracının thread'i notFound() — IDOR yok", async () => {
    const { conv } = await seedLongThread(3);
    const otherOrg = await prisma.organization.create({ data: { name: "Yabancı Org" } });
    mockAuth.mockResolvedValue(sessionFor(otherOrg.id));

    await expect(
      GuestChatDetailPage({ params: sp({ id: conv.id }), searchParams: sp({}) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("pencere aşılınca SÖYLER ve kademeli yükleme sunar (sessiz kesme yok)", async () => {
    const { org, conv } = await seedLongThread(260);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const first = await GuestChatDetailPage({ params: sp({ id: conv.id }), searchParams: sp({}) });
    const text = treeText(first);
    expect(text).toContain("En yeni 200 mesaj gösteriliyor");
    expect(text).toContain("60 eski mesaj gizli");
    expect(text).toContain("mesajı yükle"); // kademeli yükleme bağlantısı
    expect(hrefs(first)).toContain(`/guest-chats/${conv.id}?mesaj=400`);
    // En eski 60 mesaj gerçekten DIŞARIDA (pencere uygulanıyor).
    expect(text).not.toContain("msg-00000");
    expect(text).toContain("msg-00259");

    // İkinci adım pencereyi büyütür ve artık gizli kalan yoktur.
    const second = treeText(
      await GuestChatDetailPage({ params: sp({ id: conv.id }), searchParams: sp({ mesaj: "400" }) }),
    );
    expect(second).toContain("msg-00000");
    expect(second).not.toContain("eski mesaj gizli");
  });

  it("pencere SERT TAVANLI: uydurma ?mesaj= değeri sınırsız DOM üretemez", async () => {
    const { org, conv } = await seedLongThread(1400);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(
      await GuestChatDetailPage({
        params: sp({ id: conv.id }),
        searchParams: sp({ mesaj: "999999" }),
      }),
    );
    // Tavan 1000: 1400'ün 400'ü hâlâ gizli ve ekran bunu tavan olarak açıklıyor.
    expect(text).toContain("En yeni 1000 mesaj gösteriliyor");
    expect(text).toContain("400 eski mesaj gizli");
    expect(text).toContain("en fazla 1000 mesaj gösterilir");
    expect(text).not.toContain("mesajı yükle"); // tavanda "daha yükle" YOK
  });
});

describe("İptaller — sayfalama + grup dürüstlüğü", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("50/sayfa böler, gerçek toplamı ve grupların sayfaya ait olduğunu yazar", async () => {
    const org = await prisma.organization.create({ data: { name: "Cancel Org" } });
    const property = await prisma.property.create({
      data: { organizationId: org.id, name: "Daire E" },
    });
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 60; i++) {
      await prisma.reservation.create({
        data: {
          propertyId: property.id,
          guestName: `Iptal-${String(i).padStart(2, "0")}`,
          arrivalDate: new Date(Date.now() - i * day),
          departureDate: new Date(Date.now() - i * day + 2 * day),
          status: "cancelled",
          channel: "airbnb",
          sourceReference: `c-${i}`,
        },
      });
    }
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const p1 = treeText(await CancellationsPage({ searchParams: sp({}) }));
    expect(p1).toContain("1–50 / 60");
    expect(p1).toContain("Toplam 60 iptalden"); // gruplar sayfaya ait — dürüst not
    expect(p1).toContain("Iptal-00");
    expect(p1).not.toContain("Iptal-55");

    const p2 = treeText(await CancellationsPage({ searchParams: sp({ sayfa: "2" }) }));
    expect(p2).toContain("51–60 / 60");
    expect(p2).toContain("Iptal-55");
  });

  it("filtre değişince sayfa 1'e döner (7. sayfada boş ekran 'kayıt yok' sanılır)", async () => {
    const org = await prisma.organization.create({ data: { name: "Filter Org" } });
    const a = await prisma.property.create({ data: { organizationId: org.id, name: "Daire F1" } });
    await prisma.property.create({ data: { organizationId: org.id, name: "Daire F2" } });
    const day = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 130; i++) {
      await prisma.reservation.create({
        data: {
          propertyId: a.id,
          guestName: `F-${i}`,
          arrivalDate: new Date(Date.now() - i * day),
          departureDate: new Date(Date.now() - i * day + 2 * day),
          status: "cancelled",
          channel: "airbnb",
          sourceReference: `f-${i}`,
        },
      });
    }
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const links = hrefs(await CancellationsPage({ searchParams: sp({ sayfa: "2" }) }));
    // Daire/dönem çipleri sayfa numarasını TAŞIMAZ — asıl iddia bu: filtreye
    // basınca 2. sayfada değil 1. sayfada devam edilir.
    const filterLinks = links.filter((h) => h.includes("propertyId=") || h.includes("period="));
    expect(filterLinks.length).toBeGreaterThan(0);
    for (const h of filterLinks) expect(h).not.toContain("sayfa=");
    // …ama sayfa gezinme bağlantısı sayfayı taşır (130 kayıt → 3. sayfa var).
    expect(links).toContain("/cancellations?sayfa=3");
  });
});
