import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type React from "react";
import { NextRequest } from "next/server";
import { prisma, resetDb, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// U4 (kurucu 10-22, migration 83): "misafire görünen ad" — QR sohbet başlığı. Mülk ayarlarından kaydedilir / temizlenir, uzun ad
// reddedilir, görünmez karakter temizlenir; QR sayfası YALNIZ bu alanı başlığa verir (iç mülk adı `name` ASLA), "aktif konaklama yok"
// ekranı yalnız marka; KVKK dışa aktarımında yer alır.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["accept-language", "tr-TR"], ["host", "localhost:3000"]]),
}));

import { PATCH } from "@/app/api/properties/[id]/route";
import { POST as CREATE } from "@/app/api/properties/route";
import { resolveGuestChat, generateChatToken } from "@/lib/guest-chat";
import { buildOrganizationDataExport } from "@/lib/data-export";
import GuestChatPage from "@/app/c/[token]/page";

const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;
afterAll(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
  else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
});

function patch(id: string, body: unknown) {
  return PATCH(
    new NextRequest(`http://localhost/api/properties/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("U4 — misafire görünen ad", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    process.env.GUEST_CHAT_ENABLED = "1";
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const p = await prisma.property.create({ data: { organizationId: orgId, name: "Daire 5 / arka cephe" } });
    propertyId = p.id;
    // Denetim kaydı gerçek kullanıcıya bağlanır (FK) — oturum gerçek sahibin kimliğini taşır.
    const owner = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });

  it("kaydedilir (görünmez karakter / boşluk temizlenmiş), boş gönderilince temizlenir, gönderilmezse dokunulmaz", async () => {
    let res = await patch(propertyId, { guestDisplayName: "  Deniz​ Manzaralı   Daire " });
    expect(res.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBe("Deniz Manzaralı Daire");

    res = await patch(propertyId, { notes: "iç not" });
    expect(res.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBe("Deniz Manzaralı Daire");

    res = await patch(propertyId, { guestDisplayName: "" });
    expect(res.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBeNull();
  });

  it("60 karakterden uzun ad reddedilir (sade hata), hiçbir şey yazılmaz; denetim kaydı alan adını taşır", async () => {
    const res = await patch(propertyId, { guestDisplayName: "a".repeat(61) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: Record<string, string> };
    expect(body.fields?.guestDisplayName).toBe("En fazla 60 karakter olabilir.");
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBeNull();

    // Uzunluk temizlenmiş karaktere göre: 40 emoji (80 UTF-16 birimi) kabul edilir (Haiku 10-22).
    const emoji = await patch(propertyId, { guestDisplayName: "🏖".repeat(40) });
    expect(emoji.status).toBe(200);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBe("🏖".repeat(40));

    await patch(propertyId, { guestDisplayName: "Bahçeli Daire" });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId: orgId, action: "property.updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadataJson).toContain("guestDisplayName");
    expect(audit.metadataJson).not.toContain("Bahçeli");
  });

  it("personel değiştiremez (403)", async () => {
    session = { ...session, role: "staff" };
    const res = await patch(propertyId, { guestDisplayName: "X Daire" });
    expect(res.status).toBe(403);
    expect((await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).guestDisplayName).toBeNull();
  });

  it("mülk oluştururken de kaydedilir; verilmezse boş", async () => {
    const mk = (body: unknown) =>
      CREATE(
        new NextRequest("http://localhost/api/properties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({}) },
      );
    let res = await mk({ name: "Yeni Daire", guestDisplayName: " Lale Evi " });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    expect((await prisma.property.findUniqueOrThrow({ where: { id: created.id } })).guestDisplayName).toBe("Lale Evi");
    res = await mk({ name: "Başka Daire" });
    const other = (await res.json()) as { id: string };
    expect((await prisma.property.findUniqueOrThrow({ where: { id: other.id } })).guestDisplayName).toBeNull();
  });

  it("🚨 QR sayfası başlığa YALNIZ misafire görünen adı verir — iç mülk adı ASLA; ad yoksa yalnız marka", async () => {
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });

    let el = (await GuestChatPage({ params: Promise.resolve({ token }) })) as React.ReactElement<{ placeName?: string | null }>;
    expect(el.props.placeName).toBeNull();

    // Elle yazılmış görünmez karakter okurken de temizlenir.
    await prisma.property.update({ where: { id: propertyId }, data: { guestDisplayName: "Deniz​ Manzaralı" } });
    el = (await GuestChatPage({ params: Promise.resolve({ token }) })) as React.ReactElement<{ placeName?: string | null }>;
    expect(el.props.placeName).toBe("Deniz Manzaralı");
    expect(JSON.stringify(el.props)).not.toContain("arka cephe");

    const ctx = await resolveGuestChat(token, undefined, { knowledgeBase: false });
    expect(ctx?.property.guestDisplayName).toBe("Deniz Manzaralı");
  });

  it("aktif konaklama yokken ekran yalnız marka (ad bu ekrana çıkmaz)", async () => {
    const token = generateChatToken();
    await prisma.property.update({
      where: { id: propertyId },
      data: { chatToken: token, chatEnabled: true, guestDisplayName: "Deniz Manzaralı" },
    });
    const el = (await GuestChatPage({ params: Promise.resolve({ token }) })) as React.ReactElement<{ brand?: string }>;
    expect(el.props.brand).toBe("Lixus AI Misafir Asistanı");
    expect(JSON.stringify(el.props)).not.toContain("Deniz");
  });

  it("KVKK dışa aktarımında yer alır", async () => {
    await prisma.property.update({ where: { id: propertyId }, data: { guestDisplayName: "Deniz Manzaralı" } });
    const out = await buildOrganizationDataExport(orgId);
    expect(JSON.stringify(out)).toContain('"guestDisplayName":"Deniz Manzaralı"');
  });
});
