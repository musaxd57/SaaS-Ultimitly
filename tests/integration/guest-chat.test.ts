import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { resolveGuestChat, generateChatToken, QR_SECRET_CATEGORIES } from "@/lib/guest-chat";

async function enableChat(propertyId: string): Promise<string> {
  const token = generateChatToken();
  await prisma.property.update({
    where: { id: propertyId },
    data: { chatToken: token, chatEnabled: true },
  });
  return token;
}

// A reservation that is active right now (arrived yesterday, leaves in 2 days) —
// so the chat is OPEN regardless of the wall-clock time the test runs at.
async function activeStay(propertyId: string) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Misafir",
      arrivalDate: daysFromNow(-1),
      departureDate: daysFromNow(2),
      status: "confirmed",
      channel: "airbnb",
    },
  });
}

describe("resolveGuestChat (public QR concierge foundation)", () => {
  beforeEach(resetDb);

  it("resolves an enabled token to its apartment + secret-free, active KB", async () => {
    const { propertyId, orgId } = await makeOrgWithProperty();
    await prisma.knowledgeBaseItem.createMany({
      data: [
        { propertyId, category: "faq", title: "Çöp", content: "Çöp salı günü." },
        { propertyId, category: "wifi", title: "Wifi", content: "Şifre: SECRET123" },
        { propertyId, category: "checkin", title: "Giriş", content: "Kapı kodu 4821." },
        { propertyId, category: "rules", title: "Kural", content: "Sigara yok.", isActive: false },
      ],
    });
    await activeStay(propertyId);
    const token = await enableChat(propertyId);

    const ctx = await resolveGuestChat(token);
    expect(ctx).not.toBeNull();
    expect(ctx!.open).toBe(true);
    expect(ctx!.property.id).toBe(propertyId);
    expect(ctx!.property.organizationId).toBe(orgId);

    const cats = ctx!.knowledgeBase.map((k) => k.category);
    expect(cats).toContain("faq"); // general info surfaced
    expect(cats).not.toContain("wifi"); // secret excluded
    expect(cats).not.toContain("checkin"); // door code excluded
    expect(cats).not.toContain("rules"); // inactive excluded

    // The access secrets must not appear anywhere in the chat context.
    const blob = JSON.stringify(ctx!.knowledgeBase);
    expect(blob).not.toContain("SECRET123");
    expect(blob).not.toContain("4821");
  });

  it("drops access secrets MISFILED under a non-secret category (content scan, C1)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await prisma.knowledgeBaseItem.createMany({
      data: [
        // A door code a host naively put under "faq" / "general" / "rules".
        { propertyId, category: "faq", title: "Giriş", content: "Kapı kodu 7788'dir." },
        { propertyId, category: "general", title: "Bilgi", content: "Anahtar kutusu kodu 9090." },
        { propertyId, category: "rules", title: "Wifi", content: "Wi-Fi şifresi: HUNTER2" },
        { propertyId, category: "parking", title: "PIN", content: "PIN: 4455" },
        // A genuinely benign item must survive.
        { propertyId, category: "faq", title: "Çöp", content: "Çöp salı günü toplanır." },
      ],
    });
    await activeStay(propertyId);
    const token = await enableChat(propertyId);

    const ctx = await resolveGuestChat(token);
    const blob = JSON.stringify(ctx!.knowledgeBase);
    expect(blob).not.toContain("7788");
    expect(blob).not.toContain("9090");
    expect(blob).not.toContain("HUNTER2");
    expect(blob).not.toContain("4455");
    // ...but the benign item is still available.
    expect(blob).toContain("Çöp salı günü");
  });

  it("excludes exactly the secret-bearing categories", () => {
    expect([...QR_SECRET_CATEGORIES]).toEqual(["wifi", "checkin"]);
  });

  it("returns null when the apartment's chat is disabled (token set, chatEnabled false)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = generateChatToken();
    await prisma.property.update({
      where: { id: propertyId },
      data: { chatToken: token, chatEnabled: false },
    });
    expect(await resolveGuestChat(token)).toBeNull();
  });

  it("returns null for missing, too-short, and unknown tokens (404-equivalent)", async () => {
    expect(await resolveGuestChat("")).toBeNull();
    expect(await resolveGuestChat("short")).toBeNull();
    expect(await resolveGuestChat(generateChatToken())).toBeNull(); // valid shape, not in DB
  });

  it("is OPEN during an active stay, CLOSED when only past/future stays exist", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    // Only a past and a future stay → vacant now → closed.
    await prisma.reservation.create({
      data: { propertyId, guestName: "Geçmiş", arrivalDate: daysFromNow(-10), departureDate: daysFromNow(-7), status: "completed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Gelecek", arrivalDate: daysFromNow(5), departureDate: daysFromNow(8), status: "confirmed", channel: "airbnb" },
    });
    const closed = await resolveGuestChat(token);
    expect(closed!.open).toBe(false);
    expect(closed!.activeReservation).toBeNull();

    // Add a stay that is active right now → open, with that reservation attached.
    const current = await activeStay(propertyId);
    const ctx = await resolveGuestChat(token);
    expect(ctx!.open).toBe(true);
    expect(ctx!.activeReservation?.id).toBe(current.id);
  });

  it("CLOSES the chat at checkOutTime on the departure day (then nothing to answer)", async () => {
    const { propertyId } = await makeOrgWithProperty(); // checkOutTime defaults to "11:00"
    const token = await enableChat(propertyId);
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "faq", title: "Çöp", content: "Salı." },
    });
    // Stay departs Jun 15; checkout is 11:00 Istanbul.
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Çıkış",
        arrivalDate: new Date("2026-06-13T00:00:00Z"),
        departureDate: new Date("2026-06-15T00:00:00Z"),
        status: "confirmed",
        channel: "airbnb",
      },
    });

    // 10:00 Istanbul (07:00Z) on departure day → still open.
    const before = await resolveGuestChat(token, new Date("2026-06-15T07:00:00Z"));
    expect(before!.open).toBe(true);
    expect(before!.knowledgeBase.length).toBeGreaterThan(0);

    // 12:00 Istanbul (09:00Z), past the 11:00 checkout → closed, no KB.
    const after = await resolveGuestChat(token, new Date("2026-06-15T09:00:00Z"));
    expect(after!.open).toBe(false);
    expect(after!.knowledgeBase).toHaveLength(0);
  });

  it("OPENS only AT the check-in time on the arrival day (symmetric hard gate)", async () => {
    const { propertyId } = await makeOrgWithProperty(); // checkInTime "15:00"
    const token = await enableChat(propertyId);
    await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Varış",
        arrivalDate: new Date("2026-06-20T00:00:00Z"),
        departureDate: new Date("2026-06-23T00:00:00Z"),
        status: "confirmed",
        channel: "airbnb",
      },
    });
    // 12:00 Istanbul (09:00Z) on the arrival day, BEFORE the 15:00 check-in → closed.
    const early = await resolveGuestChat(token, new Date("2026-06-20T09:00:00Z"));
    expect(early!.open).toBe(false);
    // 16:00 Istanbul (13:00Z), past check-in → open.
    const live = await resolveGuestChat(token, new Date("2026-06-20T13:00:00Z"));
    expect(live!.open).toBe(true);
  });

  it("TURNOVER window (checkout 11:00 → next check-in 15:00) is CLOSED — no one can claim the incoming stay early", async () => {
    const { propertyId } = await makeOrgWithProperty(); // check-in 15:00, checkout 11:00
    const token = await enableChat(propertyId);
    // Guest A leaves today 11:00; Guest B arrives today 15:00 (back-to-back).
    await prisma.reservation.create({
      data: { propertyId, guestName: "A", arrivalDate: new Date("2026-06-18T00:00:00Z"), departureDate: new Date("2026-06-20T00:00:00Z"), status: "confirmed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "B", arrivalDate: new Date("2026-06-20T00:00:00Z"), departureDate: new Date("2026-06-22T00:00:00Z"), status: "confirmed", channel: "airbnb" },
    });
    // 12:00 Istanbul (09:00Z) — A checked out (11:00), B not checked in (15:00):
    // the whole turnover window is CLOSED, so a cleaner/past guest can't claim B's chat.
    const turnover = await resolveGuestChat(token, new Date("2026-06-20T09:00:00Z"));
    expect(turnover!.open).toBe(false);
    expect(turnover!.activeReservation).toBeNull();
    // 16:00 Istanbul (13:00Z) — past B's check-in → open, bound to B.
    const bLive = await resolveGuestChat(token, new Date("2026-06-20T13:00:00Z"));
    expect(bLive!.open).toBe(true);
    expect(bLive!.activeReservation?.guestName).toBe("B");
    // 10:00 Istanbul (07:00Z) — before A's checkout → still A (incumbent), unaffected.
    const aStill = await resolveGuestChat(token, new Date("2026-06-20T07:00:00Z"));
    expect(aStill!.activeReservation?.guestName).toBe("A");
  });
});
