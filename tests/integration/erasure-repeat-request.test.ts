import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// K8 (Codex 11-25): misafir silme isteğinin TEKRARI (istemci 500 aldı ve yeniden denedi / çift tıklama) ikinci `kvkk.guest_erasure` denetim
// kaydı yazıyordu. Tekrar artık güvenli: silme kilidi altında "bu konaklamanın silmesi zaten tamamlandı mı" okunur (maskeli satır + bu
// konaklamanın denetim kaydı) — tamamlandıysa maskeleme yeniden koşar (arada yazılanı temizler) ama denetim kaydı / iz yazılmaz.
// Aşırı uygulama kontrolleri: saklama süresiyle maskelenmiş (denetim kaydı olmayan) konaklamanın ilk açık silmesi kayıt yazar; silmeden
// sonra kimlik alanı yeniden girilmiş konaklamanın silmesi YENİ bir silmedir ve kayıt yazar.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { eraseReservationData } from "@/lib/erasure";
import { ANON_NAME } from "@/lib/data-retention";

const audits = (orgId: string) => prisma.auditLog.count({ where: { organizationId: orgId, action: "kvkk.guest_erasure" } });

async function world(over: Record<string, unknown> = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const stay = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      guestEmail: "ada@example.com",
      sourceReference: "res-k8",
      arrivalDate: stayDay(-3),
      departureDate: stayDay(-1),
      status: "completed",
      channel: "airbnb",
      ...over,
    },
  });
  const conv = await prisma.conversation.create({ data: { propertyId, reservationId: stay.id, channel: "airbnb", guestIdentifier: "Ada Lale", status: "answered" } });
  await prisma.message.create({ data: { conversationId: conv.id, direction: "inbound", senderName: "Ada Lale", body: "Merhaba, ben Ada" } });
  return { orgId, propertyId, stay, conv };
}

describe("K8 — silme isteğinin tekrarı ikinci denetim kaydı yazmaz", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("🚨 aynı konaklamanın silmesi iki kez istenir → TEK denetim kaydı; ikinci sonuç 'zaten silinmişti' der", async () => {
    const w = await world();
    const first = await eraseReservationData(w.orgId, w.stay.id);
    expect(first).toMatchObject({ alreadyErased: false, verified: true });
    const tombstonesAfterFirst = await prisma.erasureTombstone.findMany({ select: { keyHash: true, erasedAt: true }, orderBy: { keyHash: "asc" } });
    const second = await eraseReservationData(w.orgId, w.stay.id);
    expect(second).toMatchObject({ alreadyErased: true, verified: true });
    expect(await audits(w.orgId)).toBe(1);
    // İz satırları tekrarda değişmez (yeni iz yok, kesim anı ilerlemez).
    expect(await prisma.erasureTombstone.findMany({ select: { keyHash: true, erasedAt: true }, orderBy: { keyHash: "asc" } })).toEqual(tombstonesAfterFirst);
  });

  it("🚨 ÇİFT TIKLAMA: iki eşzamanlı istek → silme kilidi sıraya sokar, TEK denetim kaydı", async () => {
    const w = await world();
    const results = await Promise.all([eraseReservationData(w.orgId, w.stay.id), eraseReservationData(w.orgId, w.stay.id)]);
    expect(results.map((r) => r?.alreadyErased).sort()).toEqual([false, true]);
    expect(await audits(w.orgId)).toBe(1);
  });

  it("🚨 tekrar maskelemeyi YENİDEN koşar: ilk silmeden sonra konuşmaya düşen misafir satırı tekrarda temizlenir", async () => {
    const w = await world();
    await eraseReservationData(w.orgId, w.stay.id);
    await prisma.message.create({ data: { conversationId: w.conv.id, direction: "inbound", senderName: "Ada Lale", body: "Geç gelen satır — Ada" } });
    await eraseReservationData(w.orgId, w.stay.id);
    const bodies = (await prisma.message.findMany({ where: { conversationId: w.conv.id } })).map((m) => m.body).join("\n");
    expect(bodies).not.toContain("Ada");
    expect(await audits(w.orgId)).toBe(1);
  });

  it("KONTROL (aşırı uygulama yok): saklama süresiyle maskelenmiş, denetim kaydı olmayan konaklamanın ilk açık silmesi kayıt YAZAR", async () => {
    const w = await world({ guestName: ANON_NAME, guestEmail: null });
    const r = await eraseReservationData(w.orgId, w.stay.id);
    expect(r?.alreadyErased).toBe(false);
    expect(await audits(w.orgId)).toBe(1);
  });

  it("KONTROL: silmeden sonra kimlik alanı yeniden girilmiş konaklamanın silmesi YENİ silmedir — ikinci kayıt yazılır", async () => {
    const w = await world();
    await eraseReservationData(w.orgId, w.stay.id);
    await prisma.reservation.update({ where: { id: w.stay.id }, data: { guestPhone: "+905320000000" } });
    const r = await eraseReservationData(w.orgId, w.stay.id);
    expect(r?.alreadyErased).toBe(false);
    expect(await audits(w.orgId)).toBe(2);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: w.stay.id } })).guestPhone).toBeNull();
  });

  it("KONTROL: başka bir konaklamanın denetim kaydı bu konaklamayı 'silinmiş' saydırmaz", async () => {
    const a = await world();
    const b = await prisma.reservation.create({
      data: { propertyId: a.propertyId, guestName: ANON_NAME, sourceReference: "res-k8-b", arrivalDate: stayDay(-6), departureDate: stayDay(-4), status: "completed", channel: "airbnb" },
    });
    await eraseReservationData(a.orgId, a.stay.id);
    const r = await eraseReservationData(a.orgId, b.id);
    expect(r?.alreadyErased).toBe(false);
    expect(await audits(a.orgId)).toBe(2);
  });
});
