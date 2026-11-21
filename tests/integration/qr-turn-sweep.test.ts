// ---------------------------------------------------------------------------
// QR TEK CEVAP KİPİ — SAHİPSİZ AÇIK MESAJ SÜPÜRGESİ (ana oturum incelemesi 11-20: modelden sonra beklenmedik hata + misafir yeniden
// göndermezse satır açık kalıyor, ev sahibine uyarı gitmiyordu). Gerçek PostgreSQL; uyarı e-postası sahte.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { emailService } from "@/lib/email";
import { sweepAbandonedQrTurns, QR_TURN_SWEEP_WINDOW_MS } from "@/lib/guest-chat-turn-sweep";
import { QR_TURN_FRESH_MS, QR_TURN_OPEN_PREFIX } from "@/lib/guest-chat-turn-core";

const NOW = new Date("2030-06-01T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function seed(lastMessageAgoMs = 6 * 60_000) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Zeynep Kaya", arrivalDate: ago(86_400_000), departureDate: new Date(NOW.getTime() + 86_400_000), status: "confirmed", channel: "manual" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "chat",
      status: "answered",
      guestIdentifier: "Zeynep Kaya",
      externalReservationId: `qr-chat:${propertyId}:${reservation.id}`,
      lastMessageAt: ago(lastMessageAgoMs),
    },
  });
  return { orgId, propertyId, conversationId: conversation.id };
}
const openRow = (conversationId: string, key: string, agoMs: number) =>
  prisma.message.create({
    data: { conversationId, direction: "inbound", authorType: "guest", senderName: "Zeynep Kaya", body: "Wi-Fi şifresi ne?", externalId: `${QR_TURN_OPEN_PREFIX}${key}`, createdAt: ago(agoMs) },
  });

describe("QR — sahipsiz açık misafir mesajı süpürgesi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "1");
    vi.stubEnv("QR_ESCALATION_EMAIL_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 5 dakikadan eski açık satır ev sahibine bırakılır: kararı verildi + 'Yanıtınızı bekliyor' + karar kaydı + TEK uyarı", async () => {
    const s = await seed();
    const a = await openRow(s.conversationId, "r1", QR_TURN_FRESH_MS + 60_000);
    const b = await openRow(s.conversationId, "r2", QR_TURN_FRESH_MS + 30_000);
    expect(await sweepAbandonedQrTurns(NOW)).toEqual({ conversations: 1, rows: 2 });
    const rows = await prisma.message.findMany({ where: { conversationId: s.conversationId }, orderBy: { createdAt: "asc" }, select: { externalId: true } });
    expect(rows.map((r) => r.externalId)).toEqual(["qr:r1", "qr:r2"]);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: s.conversationId } })).priority).toBe("urgent");
    const events = await prisma.riskEvent.findMany({ where: { conversationId: s.conversationId }, select: { triggerId: true, reason: true, finalDecision: true } });
    expect(events.map((e) => e.triggerId).sort()).toEqual([a.id, b.id].sort());
    expect(events.every((e) => e.reason === "qr_turn_abandoned" && e.finalDecision === "human_review")).toBe(true);
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1);
    // İkinci tur: yapılacak iş yok, ikinci uyarı yok.
    expect(await sweepAbandonedQrTurns(NOW)).toEqual({ conversations: 0, rows: 0 });
    expect(vi.mocked(emailService.sendReporting)).toHaveBeenCalledTimes(1);
  });

  it("taze açık satıra (süren istek) DOKUNULMAZ; aynı konuşmadaki eski satır bırakılır", async () => {
    const s = await seed();
    await openRow(s.conversationId, "old", QR_TURN_FRESH_MS + 1_000);
    await openRow(s.conversationId, "fresh", QR_TURN_FRESH_MS - 1_000);
    expect(await sweepAbandonedQrTurns(NOW)).toEqual({ conversations: 1, rows: 1 });
    const rows = await prisma.message.findMany({ where: { conversationId: s.conversationId }, orderBy: { createdAt: "asc" }, select: { externalId: true } });
    expect(rows.map((r) => r.externalId)).toEqual(["qr:old", `${QR_TURN_OPEN_PREFIX}fresh`]);
  });

  it("kip kapalıyken hiçbir şey yapılmaz; kanal konuşması ve pencere dışındaki konuşma taranmaz", async () => {
    const s = await seed();
    await openRow(s.conversationId, "r1", QR_TURN_FRESH_MS + 60_000);
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "");
    expect(await sweepAbandonedQrTurns(NOW)).toEqual({ conversations: 0, rows: 0 });
    vi.stubEnv("GUEST_CHAT_TURN_MERGE_ENABLED", "1");
    const old = await seed(QR_TURN_SWEEP_WINDOW_MS + 60_000);
    await openRow(old.conversationId, "r9", QR_TURN_SWEEP_WINDOW_MS + 120_000);
    await prisma.conversation.update({ where: { id: old.conversationId }, data: { lastMessageAt: ago(QR_TURN_SWEEP_WINDOW_MS + 60_000) } });
    const channel = await seed();
    await prisma.conversation.update({ where: { id: channel.conversationId }, data: { channel: "airbnb" } });
    await openRow(channel.conversationId, "rc", QR_TURN_FRESH_MS + 60_000);
    expect(await sweepAbandonedQrTurns(NOW)).toEqual({ conversations: 1, rows: 1 });
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId: old.conversationId } })).externalId).toBe(`${QR_TURN_OPEN_PREFIX}r9`);
    expect((await prisma.message.findFirstOrThrow({ where: { conversationId: channel.conversationId } })).externalId).toBe(`${QR_TURN_OPEN_PREFIX}rc`);
  });
});
