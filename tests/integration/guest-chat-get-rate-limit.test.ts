import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn() }));
import { GET } from "@/app/api/chat/[token]/route";

// ---------------------------------------------------------------------------
// 🚨 Codex 11-05 (43fb93e incelemesi P2): QR okuması IP başına 60/dk idi; her açık sohbet 12/dk sorgular → aynı bina internetindeki
// FARKLI dairelerin altı misafiri 72/dk ile sınıra takılıyor, altıncının sohbeti donuyordu. Beklenen: daire (QR anahtarı) başına IP
// bütçesi bugünkü gibi 60/dk; kaba IP tavanı yalnız toplam yükü sınırlar (240/dk); başka IP'nin seli bu misafiri etkilemez.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = process.env.GUEST_CHAT_ENABLED;

async function chatProperty(orgId: string, n: number) {
  const token = generateChatToken();
  const property = await prisma.property.create({ data: { organizationId: orgId, name: `Lale ${n}`, chatToken: token, chatEnabled: true } });
  await prisma.reservation.create({
    data: { propertyId: property.id, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return token;
}

function get(token: string, ip = "203.0.113.31") {
  const req = new Request(`http://localhost/api/chat/${token}`, { method: "GET", headers: { "x-forwarded-for": ip } });
  return GET(req as never, { params: Promise.resolve({ token }) });
}

describe("GET /api/chat/[token] — okuma sınırı iki katman", () => {
  let orgId: string;
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    process.env.GUEST_CHAT_ENABLED = "1";
    orgId = (await makeOrgWithProperty()).orgId;
  });
  afterAll(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.GUEST_CHAT_ENABLED;
    else process.env.GUEST_CHAT_ENABLED = ORIGINAL_ENV;
  });

  it("🚨 aynı internetteki YEDİ farklı dairenin sohbeti bir dakikada 12'şer sorgu yapar — hiçbiri sınıra takılmaz", async () => {
    const tokens = await Promise.all(Array.from({ length: 7 }, (_, i) => chatProperty(orgId, i)));
    const statuses: number[] = [];
    for (let round = 0; round < 12; round++) for (const t of tokens) statuses.push((await get(t)).status);
    expect(statuses).toHaveLength(84);
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
  }, 120_000);

  it("KONTROL — aynı daireye aynı IP'den 60/dk bütçe bugünkü gibi: 61. sorgu 429", async () => {
    const token = await chatProperty(orgId, 1);
    for (let i = 0; i < 60; i++) expect((await get(token)).status).not.toBe(429);
    expect((await get(token)).status).toBe(429);
  }, 120_000);

  it("kaba IP tavanı: tek IP'den bütün dairelere toplam 240/dk; 241. sorgu 429", async () => {
    const tokens = await Promise.all(Array.from({ length: 5 }, (_, i) => chatProperty(orgId, i)));
    for (let i = 0; i < 240; i++) expect((await get(tokens[i % 5])).status).not.toBe(429);
    expect((await get(tokens[0])).status).toBe(429);
  }, 180_000);

  it("başka bir IP'nin aynı daireye seli bu IP'deki misafirin kotasını tüketmez", async () => {
    const token = await chatProperty(orgId, 1);
    for (let i = 0; i < 61; i++) await get(token, "198.51.100.7");
    expect((await get(token, "198.51.100.7")).status).toBe(429);
    expect((await get(token, "203.0.113.31")).status).not.toBe(429);
  }, 120_000);
});
