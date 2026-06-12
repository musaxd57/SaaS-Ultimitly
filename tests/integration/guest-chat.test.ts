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
    const token = await enableChat(propertyId);

    const ctx = await resolveGuestChat(token);
    expect(ctx).not.toBeNull();
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

  it("attaches the currently-staying reservation, never a past or future one", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const token = await enableChat(propertyId);

    await prisma.reservation.create({
      data: { propertyId, guestName: "Geçmiş", arrivalDate: daysFromNow(-10), departureDate: daysFromNow(-7), status: "completed", channel: "airbnb" },
    });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Gelecek", arrivalDate: daysFromNow(5), departureDate: daysFromNow(8), status: "confirmed", channel: "airbnb" },
    });
    expect((await resolveGuestChat(token))!.activeReservation).toBeNull();

    const current = await prisma.reservation.create({
      data: { propertyId, guestName: "Şimdi", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });
    const ctx = await resolveGuestChat(token);
    expect(ctx!.activeReservation?.id).toBe(current.id);
    expect(ctx!.activeReservation?.guestName).toBe("Şimdi");
  });
});
