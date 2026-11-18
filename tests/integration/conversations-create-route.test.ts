import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ELLE KONUŞMA AÇMA KALDIRILDI (kurucu 11-18 akşam, tasarım `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` D2): "Lixus misafir
// konuşması uydurmaz. Konuşma ya kanaldan gelir ya QR'dan." `POST /api/conversations` eskiden ev sahibinin seçtiği kanal etiketiyle bir
// konuşma + misafirden gelmiş gibi bir mesaj yazıyordu. Artık istek AÇIKÇA reddedilir (405 + `Allow: GET`, genel hata biçimi) ve HİÇBİR şey
// yazılmaz — eski sekmeden gelen geçerli gövde de, eskiden kiracı sınırına takılan gövde de (S10-01 IDOR testleri bu yüzden "yazılmaz"
// iddiasıyla burada kalır: uç bir gün geri gelirse sınır yeniden sınanmalı). Rol kapısı (`withManage`) yerinde: personel 403.
// GET listesi DEĞİŞMEDİ: yalnız kendi işletmesi, QR sohbetleri ("chat") hariç, durum süzgeci aynı.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const { inboundRules } = vi.hoisted(() => ({ inboundRules: vi.fn(async () => undefined) }));
vi.mock("@/lib/automation", async (orig) => ({
  ...(await orig<typeof import("@/lib/automation")>()),
  applyInboundMessageRules: inboundRules,
}));

import { GET, POST } from "@/app/api/conversations/route";

const ctx = { params: Promise.resolve({}) };
const post = (body: unknown) =>
  POST(new NextRequest("http://localhost/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ctx as never);
const list = async (qs = "") =>
  (await (await GET(new NextRequest(`http://localhost/api/conversations${qs}`), ctx as never)).json()) as Array<{ id: string; propertyId: string; channel: string }>;

async function orgWithOwner(tag: string, role: "owner" | "manager" | "staff" = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: tag, email: `${tag}@x.com`, passwordHash: "x", role } });
  const reservation = await prisma.reservation.create({
    data: { propertyId, guestName: `Misafir ${tag}`, arrivalDate: new Date("2026-11-01T00:00:00Z"), departureDate: new Date("2026-11-04T00:00:00Z") },
  });
  return { orgId, propertyId, reservationId: reservation.id, session: { userId: user.id, organizationId: orgId, role, email: user.email, name: tag, sessionEpoch: 0 } as SessionPayload };
}

const base = { guestIdentifier: "Misafir", firstMessage: "Merhaba, Wi-Fi şifresi nedir?" };

async function expectNothingWritten() {
  expect(await prisma.conversation.count()).toBe(0);
  expect(await prisma.message.count()).toBe(0);
  expect(inboundRules).not.toHaveBeenCalled();
}

beforeEach(async () => {
  await resetDb();
  session = null;
  inboundRules.mockClear();
});

describe("POST /api/conversations — kaldırıldı (D2)", () => {
  it("🚨 eski formun GEÇERLİ gövdesi (kendi dairesi + kendi rezervasyonu + 'Airbnb' etiketi) → 405, hiçbir şey yazılmaz", async () => {
    const a = await orgWithOwner("a");
    session = a.session;
    const res = await post({ ...base, propertyId: a.propertyId, reservationId: a.reservationId, channel: "airbnb", priority: "standard" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
    expect(await res.json()).toEqual({ error: "Konuşma oluşturulamadı" });
    await expectNothingWritten();
  });

  it("🚨 yönetici de reddedilir (rol değil, uç kalktı)", async () => {
    const a = await orgWithOwner("m", "manager");
    session = a.session;
    expect((await post({ ...base, propertyId: a.propertyId })).status).toBe(405);
    await expectNothingWritten();
  });

  it("🚨 S10-01 kiracı sınırı gövdeleri (yabancı daire / yabancı rezervasyon) → yine 405, hiçbir şey yazılmaz", async () => {
    const a = await orgWithOwner("a");
    const b = await orgWithOwner("b");
    session = a.session;
    expect((await post({ ...base, propertyId: b.propertyId })).status).toBe(405);
    expect((await post({ ...base, propertyId: a.propertyId, reservationId: b.reservationId })).status).toBe(405);
    await expectNothingWritten();
  });

  it("KONTROL: rol kapısı yerinde — personel 403, oturumsuz 401 (405'e hiç varılmaz)", async () => {
    const s = await orgWithOwner("s", "staff");
    session = s.session;
    expect((await post({ ...base, propertyId: s.propertyId })).status).toBe(403);
    session = null;
    expect((await post({ ...base, propertyId: s.propertyId })).status).toBe(401);
    await expectNothingWritten();
  });
});

describe("GET /api/conversations — DEĞİŞMEDİ", () => {
  it("KONTROL: yalnız kendi işletmesinin kanal konuşmaları; QR sohbeti listede yok; durum süzgeci çalışır", async () => {
    const a = await orgWithOwner("a");
    const b = await orgWithOwner("b");
    const mine = await prisma.conversation.create({
      data: { propertyId: a.propertyId, channel: "airbnb", guestIdentifier: "Kanal misafiri", status: "new", priority: "standard", externalReservationId: "ext-a-1" },
    });
    const answered = await prisma.conversation.create({
      data: { propertyId: a.propertyId, channel: "booking", guestIdentifier: "Cevaplanmış", status: "answered", priority: "standard" },
    });
    await prisma.conversation.create({ data: { propertyId: a.propertyId, channel: "chat", guestIdentifier: "QR misafiri", status: "new", priority: "standard" } });
    await prisma.conversation.create({ data: { propertyId: b.propertyId, channel: "airbnb", guestIdentifier: "Başka işletme", status: "new", priority: "standard" } });

    session = a.session;
    const all = await list();
    expect(all.map((c) => c.id).sort()).toEqual([mine.id, answered.id].sort());
    expect(all.every((c) => c.propertyId === a.propertyId && c.channel !== "chat")).toBe(true);
    expect((await list("?status=new")).map((c) => c.id)).toEqual([mine.id]);
  });
});
