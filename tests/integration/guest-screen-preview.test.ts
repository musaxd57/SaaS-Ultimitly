import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// K14 (kurucu kararı 09-30): "Misafirin gördüğü ekran" — QR sohbetinin misafir tarafının SALT OKUNUR önizlemesi.
//  · Gönderim YOK (form / yazma kutusu / düğme çizilmez), cihaz bağlama YOK, okundu durumu değişmez: sayfa hiçbir satır yazmaz.
//  · Misafirin gördüğüyle AYNI: yön (misafir sağda), etiketler ("🤖 Lixus AI", "👥 İşletme ekibi"), devir ayraçları, pencere (200).
//  · Erişim konuşma sayfasıyla aynı (sahip / yönetici; başka işletme 404).
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
import GuestScreenPreviewPage from "@/app/(app)/guest-chats/[id]/misafir-ekrani/page";
import { GUEST_CHAT_CLOSED } from "@/components/guest-chat/guest-chat-thread";

const mockAuth = vi.mocked(requireAuth);
const DAY = 24 * 60 * 60 * 1000;

/** Ağacın metni + (fonksiyon bileşenleri açılarak) element türleri. */
function walk(node: unknown, out: { text: string[]; types: string[] }): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    out.text.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const n of node) walk(n, out);
    return;
  }
  if (React.isValidElement(node)) {
    if (typeof node.type === "string") out.types.push(node.type);
    if (typeof node.type === "function") {
      try {
        walk((node.type as (p: unknown) => unknown)(node.props), out);
        return;
      } catch {
        /* hook'lu bileşen: çocuklara düş */
      }
    }
    walk((node.props as { children?: unknown }).children, out);
  }
}

async function seed(opts: { departsInDays?: number; extraMessages?: number } = {}) {
  const org = await prisma.organization.create({ data: { name: "Önizleme Org", timezone: "Europe/Istanbul" } });
  const property = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "Lale 9",
      chatEnabled: true,
      chatToken: "tok-preview-0123456789abcdef",
      checkInTime: "00:00",
      checkOutTime: "23:59",
    },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Ada",
      arrivalDate: new Date(Date.now() - 2 * DAY),
      departureDate: new Date(Date.now() + (opts.departsInDays ?? 2) * DAY),
      status: "confirmed",
      channel: "airbnb",
    },
  });
  const base = Date.now() - 60 * 60_000;
  const rows: { direction: string; authorType: string; senderName: string; body: string; systemEventType?: string }[] = [];
  for (let i = 0; i < (opts.extraMessages ?? 0); i++) {
    rows.push({ direction: "inbound", authorType: "guest", senderName: "Ada", body: `eski-${String(i).padStart(3, "0")}` });
  }
  rows.push(
    { direction: "inbound", authorType: "guest", senderName: "Ada", body: "Havlu var mı?" },
    { direction: "outbound", authorType: "ai", senderName: "Lixus AI", body: "Havlular dolapta." },
    { direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Ben de buradayım." },
  );
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      channel: "chat",
      guestIdentifier: "Ada",
      status: "new",
      externalReservationId: `qr-chat:${property.id}:${reservation.id}`,
      lastMessageAt: new Date(),
      messages: { create: rows.map((r, i) => ({ ...r, createdAt: new Date(base + i * 1000) })) },
    },
  });
  mockAuth.mockResolvedValue({ userId: "u1", organizationId: org.id, role: "owner", email: "o@x.com" } as never);
  return { org, property, reservation, conversation };
}

async function render(id: string) {
  const tree = await GuestScreenPreviewPage({ params: Promise.resolve({ id }) } as never);
  const out = { text: [] as string[], types: [] as string[] };
  walk(tree, out);
  return { text: out.text.join(" "), types: out.types };
}

/** Önizlemenin dokunabileceği her tablo — satırların TAMAMI (sayfa hiçbir şey yazmamalı). */
async function dbSnapshot() {
  const [conversations, reservations, messages, locks, counters, risk, audit, properties] = await Promise.all([
    prisma.conversation.findMany({ orderBy: { id: "asc" } }),
    prisma.reservation.findMany({ orderBy: { id: "asc" } }),
    prisma.message.findMany({ orderBy: { id: "asc" } }),
    prisma.systemLock.findMany({ orderBy: { name: "asc" } }),
    prisma.rateLimitCounter.findMany({ orderBy: { key: "asc" } }),
    prisma.riskEvent.count(),
    prisma.auditLog.count(),
    prisma.property.findMany({ orderBy: { id: "asc" } }),
  ]);
  return JSON.stringify({ conversations, reservations, messages, locks, counters, risk, audit, properties });
}

describe("K14 — misafirin gördüğü ekran (salt okunur önizleme)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 misafirin ekranıyla aynı etiketler ve devir ayracı; yazma kutusu / form / düğme YOK", async () => {
    const { conversation } = await seed();
    const { text, types } = await render(conversation.id);
    expect(text).toContain("Havlu var mı?");
    expect(text).toContain("🤖 Lixus AI");
    expect(text).toContain("👥 İşletme ekibi");
    expect(text).toContain("İşletme ekibi görüşmeye katıldı");
    expect(text).toContain("Konaklama sürüyor");
    // Ev sahibi paneli etiketleri ("Siz", "Misafir") misafir ekranında YOK.
    expect(text).not.toMatch(/\bSiz\b/);
    for (const t of ["form", "textarea", "input", "button"]) expect(types, t).not.toContain(t);
  });

  it("🚨 sayfa HİÇBİR satır yazmaz (cihaz bağlama / okundu / sayaç / kayıt yok)", async () => {
    const { conversation } = await seed();
    const before = await dbSnapshot();
    await render(conversation.id);
    await render(conversation.id);
    expect(await dbSnapshot()).toBe(before);
  });

  it("pencere misafirin GET ucuyla aynı: en yeni 200 mesaj, kronolojik", async () => {
    const { conversation } = await seed({ extraMessages: 205 });
    const { text } = await render(conversation.id);
    // 208 mesajın en eski 8'i dışarıda: eski-000 … eski-007 yok, eski-008 var.
    expect(text).not.toContain("eski-000");
    expect(text).not.toContain("eski-007");
    expect(text).toContain("eski-008");
    expect(text.indexOf("eski-008")).toBeLessThan(text.indexOf("Havlu var mı?"));
  });

  it("konaklama bittiyse misafirin gördüğü kapanış kartı; yazma alanı notu yok", async () => {
    const { conversation } = await seed({ departsInDays: -1 });
    const { text } = await render(conversation.id);
    expect(text).toContain(GUEST_CHAT_CLOSED);
    expect(text).toContain("Konaklama sürmüyor");
    expect(text).not.toContain("Misafir bu alana yazar");
  });

  it("karekod sohbeti kapalıysa (genel anahtar) misafirin 'kullanılamıyor' ekranını söyler", async () => {
    vi.stubEnv("GUEST_CHAT_ENABLED", "");
    const { conversation } = await seed();
    const { text } = await render(conversation.id);
    expect(text).toContain("Bu sohbet şu anda kullanılamıyor");
  });

  it("KONTROL — açık konaklamada yazma alanının yeri not olarak görünür (önizleme gönderemez)", async () => {
    const { conversation } = await seed();
    expect((await render(conversation.id)).text).toContain("Önizlemeden mesaj gönderilmez");
  });

  it("🚨 erişim: personel yönlendirilir, başka işletmenin konuşması 404", async () => {
    const { conversation } = await seed();
    mockAuth.mockResolvedValueOnce({ userId: "s1", organizationId: (await prisma.organization.findFirstOrThrow()).id, role: "staff", email: "s@x.com" } as never);
    await expect(render(conversation.id)).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    const other = await prisma.organization.create({ data: { name: "Başka" } });
    mockAuth.mockResolvedValueOnce({ userId: "u2", organizationId: other.id, role: "owner", email: "b@x.com" } as never);
    await expect(render(conversation.id)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
