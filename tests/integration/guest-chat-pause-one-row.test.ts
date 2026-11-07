import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  guestChatAiPausedForStay,
  guestChatAiPausedFromMessages,
  QR_CONVERSATION_MARKER_PREFIX,
  type GuestChatDb,
} from "@/lib/guest-chat";

// ---------------------------------------------------------------------------
// QR "yapay zekâ devredildi mi" kontrolü TEK SATIR okur (gece denetimi 09-28, kodda doğrulandı). Misafir rotası her mesajda
// bu kontrolü iki kez yapıyor — biri ev sahibi cevabının da beklediği konuşma kilidinin altında — ve eskiden konuşmanın
// BÜTÜN mesajlarını okuyordu; konuşmayı büyüten, cihazı bağlı misafirdir (dakikada 20 istek; yapay zekâ kotası dolunca da
// mesajlar kaydediliyor). Hüküm AYNI kalmalı: tarayıcı (`guestChatAiPausedFromMessages`, tüm konuşma) kâhin alınır,
// rastgele dizilerle (eski yazarsız satırlar, bilinmeyen / boş yazar türü, nötr sistem olayı dahil) birebir kıyaslanır.
// ---------------------------------------------------------------------------

type Row = { direction: string; senderName: string; authorType: string | null; systemEventType: string | null };

const KINDS: Row[] = [
  { direction: "inbound", senderName: "Ada", authorType: "guest", systemEventType: null },
  { direction: "inbound", senderName: "Ada", authorType: null, systemEventType: null },
  { direction: "outbound", senderName: "Lixus AI", authorType: "ai", systemEventType: null },
  { direction: "outbound", senderName: "Lixus AI", authorType: null, systemEventType: null },
  { direction: "outbound", senderName: "GuestOps AI", authorType: null, systemEventType: null },
  { direction: "outbound", senderName: "Ev sahibi", authorType: "host", systemEventType: null },
  { direction: "outbound", senderName: "Ev sahibi", authorType: null, systemEventType: null },
  { direction: "outbound", senderName: "__lixus_ai_resumed__", authorType: null, systemEventType: null },
  { direction: "outbound", senderName: "Sistem", authorType: "system", systemEventType: "guest_chat_ai_resumed" },
  { direction: "outbound", senderName: "Sistem", authorType: "system", systemEventType: "other_event" },
  { direction: "outbound", senderName: "Ev sahibi", authorType: "host", systemEventType: "guest_chat_ai_resumed" },
  { direction: "outbound", senderName: "Operatör", authorType: "operator", systemEventType: null },
  { direction: "outbound", senderName: "Ev sahibi", authorType: "", systemEventType: null },
  { direction: "inbound", senderName: "Ada", authorType: "", systemEventType: null },
  { direction: "outbound", senderName: "Lixus AI", authorType: "", systemEventType: null },
];

let seed = 20260928;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

let propertyId: string;
let seq = 0;

async function stayWith(rows: Row[]) {
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.UTC(2026, 8, 20)), departureDate: new Date(Date.UTC(2026, 8, 30)), status: "confirmed", channel: "manual" },
    select: { id: true },
  });
  const t0 = Date.UTC(2026, 8, 21) + ++seq * 100_000;
  await prisma.conversation.create({
    data: {
      propertyId,
      reservationId: reservation.id,
      channel: "qr",
      guestIdentifier: "Ada",
      status: "new",
      externalReservationId: `${QR_CONVERSATION_MARKER_PREFIX}${propertyId}:${reservation.id}`,
      messages: { create: rows.map((r, i) => ({ ...r, body: `m${i}`, createdAt: new Date(t0 + i * 1000) })) },
    },
  });
  return reservation.id;
}

beforeEach(async () => {
  await resetDb();
  propertyId = (await makeOrgWithProperty()).propertyId;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("QR devir kontrolü — tek satır, aynı hüküm", () => {
  it("🚨 rastgele 60 dizi: tek satırlık hüküm tüm konuşmayı tarayanla BİREBİR aynı", async () => {
    let paused = 0;
    for (let n = 0; n < 60; n++) {
      const len = 1 + Math.floor(rnd() * 10);
      const rows = Array.from({ length: len }, () => KINDS[Math.floor(rnd() * KINDS.length)]);
      const reservationId = await stayWith(rows);
      const expected = guestChatAiPausedFromMessages(rows);
      expect(await guestChatAiPausedForStay(propertyId, reservationId), JSON.stringify(rows)).toBe(expected);
      if (expected) paused += 1;
    }
    // Anti-vakum: iki hüküm de örneklemde gerçekten var.
    expect(paused).toBeGreaterThan(5);
    expect(paused).toBeLessThan(55);
  });

  it("elle seçilmiş sınırlar: nötr sistem olayı atlanır; bilinmeyen / boş yazar türü tarayıcıyla aynı", async () => {
    const H = KINDS[5];
    const RESUME = KINDS[8];
    const NEUTRAL = KINDS[9];
    const cases: Row[][] = [
      [H, NEUTRAL], // nötr olay ev sahibinin devrini SİLMEZ → duraklatılmış
      [H, RESUME, NEUTRAL], // yeniden açıldı → etkin
      [RESUME, H], // son geçiş kazanır → duraklatılmış
      [KINDS[11]], // bilinmeyen yazar türü → tarayıcı "ev sahibi" sayar
      [H, KINDS[14]], // boş yazar türü + yapay zekâ adı → atlanır, ev sahibi kalır
      [KINDS[12]], // boş yazar türü + ev sahibi adı → duraklatılmış
      [KINDS[7]], // eski "yeniden açıldı" adı → etkin
      [],
    ];
    for (const rows of cases) {
      const reservationId = await stayWith(rows);
      expect(await guestChatAiPausedForStay(propertyId, reservationId), JSON.stringify(rows)).toBe(guestChatAiPausedFromMessages(rows));
    }
  });

  it("konuşma yoksa etkin (false)", async () => {
    expect(await guestChatAiPausedForStay(propertyId, "yok")).toBe(false);
  });

  it("🚨 uzun konuşmada da en fazla TEK mesaj satırı okunur", async () => {
    const rows: Row[] = [KINDS[5], ...Array.from({ length: 80 }, (_, i) => KINDS[i % 2 === 0 ? 0 : 2])];
    const reservationId = await stayWith(rows);
    let messageRows = 0;
    const count = (r: unknown) => {
      if (Array.isArray(r)) messageRows += r.length;
      else if (r && typeof r === "object" && Array.isArray((r as { messages?: unknown[] }).messages)) messageRows += (r as { messages: unknown[] }).messages.length;
      else if (r && typeof r === "object" && "direction" in (r as object)) messageRows += 1;
      return r;
    };
    const db = {
      conversation: { findFirst: async (a: never) => count(await prisma.conversation.findFirst(a)) },
      message: {
        findFirst: async (a: never) => count(await prisma.message.findFirst(a)),
        findMany: async (a: never) => count(await prisma.message.findMany(a)),
      },
    } as unknown as GuestChatDb;
    expect(await guestChatAiPausedForStay(propertyId, reservationId, db)).toBe(true);
    expect(messageRows).toBeLessThanOrEqual(1);
  });
});
