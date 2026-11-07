import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { findAttentionItems, CONVERSATION_CANDIDATE_CAP, DEPARTING_UNANSWERED_HOURS } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// Tur 5 (11-05, ölçüldü, çürütücüyle yeniden üretildi):
//  R1 — "Dikkat Gerektirenler" adayları tek "en eski önce" okumasıyla 200'de kesiliyordu: 30 günde 200'den fazla konuşması olan işletmede
//       CEVAPLANMIŞ eski konuşmalar tavanı dolduruyor, bekleyen misafirin satırı hiç çıkmıyordu (230 eski + 5 bekleyen → 0 satır).
//  R2 — "Çıkışı yaklaşan misafir cevap bekliyor" ham an kıyasıyla hesaplanıyordu: Hospitable çıkışı D 00:00Z (İstanbul 03:00) saklanır,
//       çıkış GÜNÜ sabahından itibaren "geçti" sayılıyor, satır çıkmıyordu (aynı durumda iCal saatli kayıtta çıkıyordu). Tek tarih kuralı.
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `n` konuşma + her birine TEK görünür mesaj (toplu yazım — hızlı). */
async function bulkConversations(
  propertyId: string,
  n: number,
  opts: { prefix: string; status: string; direction: "inbound" | "outbound"; at: (i: number) => Date },
) {
  const convs = Array.from({ length: n }, (_, i) => ({
    id: `${opts.prefix}-${String(i).padStart(4, "0")}`,
    propertyId,
    guestIdentifier: "Misafir",
    status: opts.status,
    channel: "airbnb",
    lastMessageAt: opts.at(i),
  }));
  await prisma.conversation.createMany({ data: convs });
  await prisma.message.createMany({
    data: convs.map((c) => ({
      conversationId: c.id,
      direction: opts.direction,
      senderName: opts.direction === "inbound" ? "Misafir" : "Ev sahibi",
      body: opts.direction === "inbound" ? "Klima çalışmıyor" : "Hemen bakıyoruz.",
      createdAt: c.lastMessageAt,
    })),
  });
  return convs.map((c) => c.id);
}

describe("R1 — aday tavanı bekleyen misafiri gizlemez", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 tavanı aşan sayıda ESKİ cevaplanmış konuşma varken (durumu açık kalmış olsalar da) son saatlerin cevapsız mesajı satır üretir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = new Date();
    // Durumu "new" kalmış ama son sözü bizde olan eski konuşmalar (ör. elle cevaplanıp durumu güncellenmemiş) — "en eski açık" okumasını doldurur.
    await bulkConversations(propertyId, CONVERSATION_CANDIDATE_CAP + 30, {
      prefix: "old",
      status: "new",
      direction: "outbound",
      at: (i) => new Date(now.getTime() - (20 * DAY + i * 60_000)),
    });
    const waiting = await bulkConversations(propertyId, 3, {
      prefix: "wait",
      status: "new",
      direction: "inbound",
      at: (i) => new Date(now.getTime() - (8 + i) * HOUR),
    });
    const items = await findAttentionItems(orgId, { now });
    const unansweredIds = items.filter((i) => i.kind === "unanswered_aging").map((i) => i.href);
    expect(unansweredIds.length).toBe(3);
    for (const id of waiting) expect(unansweredIds.some((h) => h.includes(id))).toBe(true);
  });

  it("🚨 en yeni tavan kadar konuşma CEVAPLANMIŞKEN daha eski, hâlâ açık ve cevapsız konuşma da satır üretir (en uzun bekleyen)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const now = new Date();
    // Daha ESKİ cevaplanmış konuşmalar (durum "answered") — açık durum süzgeci olmasa "en eski" okumasını bunlar doldururdu.
    await bulkConversations(propertyId, CONVERSATION_CANDIDATE_CAP + 10, {
      prefix: "older",
      status: "answered",
      direction: "outbound",
      at: (i) => new Date(now.getTime() - (27 * DAY + i * 60_000)),
    });
    const [stale] = await bulkConversations(propertyId, 1, {
      prefix: "stale",
      status: "new",
      direction: "inbound",
      at: () => new Date(now.getTime() - 20 * DAY),
    });
    // Daha YENİ cevaplanmış konuşmalar — "en yeni" okumasını doldurur.
    await bulkConversations(propertyId, CONVERSATION_CANDIDATE_CAP + 10, {
      prefix: "newer",
      status: "answered",
      direction: "outbound",
      at: (i) => new Date(now.getTime() - (DAY + i * 60_000)),
    });
    const items = await findAttentionItems(orgId, { now });
    const rows = items.filter((i) => i.kind === "unanswered_aging");
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toContain(stale);
  });
});

describe("R2 — çıkış günü tek tarih kuralıyla (Hospitable tarih-yalnız çıkış)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  /** İstanbul'da bugünün tarihi, saat 10:30 (UTC+3 → 07:30Z). */
  function istanbulTodayAt(h: number, m: number): { now: Date; dayStartUtc: Date } {
    const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const [y, mo, d] = key.split("-").map(Number);
    return { now: new Date(Date.UTC(y, mo - 1, d, h - 3, m)), dayStartUtc: new Date(Date.UTC(y, mo - 1, d)) };
  }

  async function departingConversation(propertyId: string, departureDate: Date, guestWroteAt: Date) {
    const res = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Çıkan Misafir",
        arrivalDate: new Date(departureDate.getTime() - 3 * DAY),
        departureDate,
        status: "confirmed",
        channel: "airbnb",
        currency: "EUR",
      },
    });
    const convo = await prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Çıkan Misafir", status: "new", channel: "airbnb", lastMessageAt: guestWroteAt, reservationId: res.id },
    });
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "inbound", senderName: "Çıkan Misafir", body: "Anahtarı nereye bırakalım?", createdAt: guestWroteAt },
    });
  }

  it("🚨 Hospitable çıkışı (D 00:00Z), çıkış günü 10:30'da, 08:30'dan beri cevapsız → 'çıkışı yaklaşan' satırı", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { now, dayStartUtc } = istanbulTodayAt(10, 30);
    await departingConversation(propertyId, dayStartUtc, new Date(now.getTime() - (DEPARTING_UNANSWERED_HOURS) * HOUR));
    const items = await findAttentionItems(orgId, { now });
    expect(items.map((i) => i.kind)).toEqual(["departing_unanswered"]);
  });

  it("KONTROL: çıkış günü GEÇMİŞ tarih-yalnız kayıt 'çıkışı yaklaşan' değildir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { now, dayStartUtc } = istanbulTodayAt(10, 30);
    await departingConversation(propertyId, new Date(dayStartUtc.getTime() - DAY), new Date(now.getTime() - 7 * HOUR));
    const items = await findAttentionItems(orgId, { now });
    expect(items.map((i) => i.kind)).not.toContain("departing_unanswered");
  });

  it("KONTROL: saatli (gerçek an) çıkış eski 24 saat penceresiyle — çıkış saati geçtiyse 'yaklaşan' değil", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const { now } = istanbulTodayAt(14, 30);
    // Bugün 11:07 İstanbul (gerçek an, tam saat değil) — geçti.
    await departingConversation(propertyId, new Date(now.getTime() - 3 * HOUR - 23 * 60_000), new Date(now.getTime() - 7 * HOUR));
    const items = await findAttentionItems(orgId, { now });
    expect(items.map((i) => i.kind)).not.toContain("departing_unanswered");
  });
});
