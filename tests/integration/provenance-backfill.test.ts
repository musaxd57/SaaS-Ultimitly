import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// PROVENANCE BACKFILL — V0.4 (migration 50). Migration öncesi Hospitable satırları
// org'un (org, provider) başına TEK bağlantısına damgalanır. Kurallar:
//   · Reservation: `calendarSourceId` NULL + `channel` notIn [ics, manual] +
//     `sourceReference` dolu → Hospitable-kaynaklı (mevcut yaşam-döngüsü işaretçisi
//     + sağlayıcı kimliği). iCal (calendarSourceId), elle dosya (ics/manual) ve
//     referanssız elle giriş DOKUNULMAZ.
//   · Conversation: `externalReservationId` dolu ve `qr-chat:` öneksiz.
//   · Message: yalnız Hospitable-kaynaklı konuşmalarda ve yalnız `externalId` dolu
//     satırlar (sağlayıcı kimliği = bağlantıdan geçti). Kimliksiz yerel gönderim
//     (legacy doğrudan yol) NULL kalır — dürüst.
//   · `ingestedAt` backfill'de UYDURULMAZ (geçmiş ingest anı bilinmiyor).
//   · Kiracı-kapsamlı; yalnız bağlantı satırı olan org; satır başına TEK SEFER
//     (`provenanceBackfilledAt` işareti) → idempotent, ikinci geçiş 0 yazar.
//   · Bağlantı durumu önemsiz (disconnected satır da tarihsel sahiptir).
// Kırmızı-önce: fonksiyon/kolon yokken kırmızı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { backfillProvenance, getConnection } from "@/lib/channels/connections";
import { setOrgHospitableToken, clearOrgHospitableToken } from "@/lib/hospitable-credentials";

interface Seeded {
  orgId: string;
  propertyId: string;
  resH: string;
  resIcs: string;
  resManual: string;
  resNoRef: string;
  resFeed: string;
  convH: string;
  convQr: string;
  convManual: string;
  mIn: string;
  mOutExt: string;
  mOutLocal: string;
  mQr: string;
  mManual: string;
}

async function seedLegacy(tag: string): Promise<Seeded> {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: `https://example.com/${tag}.ics` },
  });
  const res = (data: Record<string, unknown>) =>
    prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Misafir",
        arrivalDate: new Date("2026-06-01T00:00:00Z"),
        departureDate: new Date("2026-06-05T00:00:00Z"),
        ...data,
      } as never,
      select: { id: true },
    });
  const resH = (await res({ channel: "airbnb", sourceReference: `h-${tag}` })).id;
  const resIcs = (await res({ channel: "ics", sourceReference: `ics-${tag}` })).id;
  const resManual = (await res({ channel: "manual", sourceReference: `csv-${tag}` })).id;
  const resNoRef = (await res({ channel: "booking", sourceReference: null })).id;
  const resFeed = (await res({ channel: "airbnb", sourceReference: `feed-${tag}`, calendarSourceId: source.id })).id;

  const conv = (data: Record<string, unknown>) =>
    prisma.conversation.create({
      data: { propertyId, guestIdentifier: "Misafir", ...data } as never,
      select: { id: true },
    });
  const convH = (await conv({ channel: "airbnb", externalReservationId: `h-${tag}` })).id;
  const convQr = (await conv({ channel: "chat", externalReservationId: `qr-chat:${propertyId}:${tag}` })).id;
  const convManual = (await conv({ channel: "manual", externalReservationId: null })).id;

  const msg = (conversationId: string, data: Record<string, unknown>) =>
    prisma.message.create({
      data: { conversationId, senderName: "x", body: "y", ...data } as never,
      select: { id: true },
    });
  const mIn = (await msg(convH, { direction: "inbound", externalId: `e1-${tag}` })).id;
  const mOutExt = (await msg(convH, { direction: "outbound", externalId: `e2-${tag}` })).id;
  const mOutLocal = (await msg(convH, { direction: "outbound", externalId: null })).id;
  // Gerçekçi değil (QR mesajının sağlayıcı kimliği olmaz) — kapsam kuralını pinler:
  // externalId dolu olsa bile iç thread'in mesajı damgalanmaz.
  const mQr = (await msg(convQr, { direction: "inbound", externalId: `qr-${tag}` })).id;
  const mManual = (await msg(convManual, { direction: "inbound", externalId: null })).id;

  return { orgId, propertyId, resH, resIcs, resManual, resNoRef, resFeed, convH, convQr, convManual, mIn, mOutExt, mOutLocal, mQr, mManual };
}

async function snapshot(s: Seeded) {
  const pick = { id: true, connectionId: true, ingestedAt: true } as const;
  return {
    reservations: await prisma.reservation.findMany({ where: { propertyId: s.propertyId }, select: pick, orderBy: { id: "asc" } }),
    conversations: await prisma.conversation.findMany({ where: { propertyId: s.propertyId }, select: pick, orderBy: { id: "asc" } }),
    messages: await prisma.message.findMany({
      where: { conversation: { propertyId: s.propertyId } },
      select: pick,
      orderBy: { id: "asc" },
    }),
  };
}

const connOf = async (id: string) => (await prisma.reservation.findUniqueOrThrow({ where: { id }, select: { connectionId: true } })).connectionId;
const convConnOf = async (id: string) => (await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { connectionId: true } })).connectionId;
const msgConnOf = async (id: string) => (await prisma.message.findUniqueOrThrow({ where: { id }, select: { connectionId: true } })).connectionId;

describe("backfillProvenance", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("yalnız Hospitable-kaynaklı satırlar damgalanır; iCal/elle/QR/kimliksiz dokunulmaz; ingestedAt uydurulmaz", async () => {
    const a = await seedLegacy("a");
    await setOrgHospitableToken(a.orgId, "pat-a", "A");
    const conn = await getConnection(a.orgId, "hospitable");

    const r = await backfillProvenance();
    expect(r).toEqual({ connections: 1, reservations: 1, conversations: 1, messages: 2 });

    expect(await connOf(a.resH)).toBe(conn!.id);
    expect(await connOf(a.resIcs)).toBeNull();
    expect(await connOf(a.resManual)).toBeNull();
    expect(await connOf(a.resNoRef)).toBeNull();
    expect(await connOf(a.resFeed)).toBeNull();

    expect(await convConnOf(a.convH)).toBe(conn!.id);
    expect(await convConnOf(a.convQr)).toBeNull();
    expect(await convConnOf(a.convManual)).toBeNull();

    expect(await msgConnOf(a.mIn)).toBe(conn!.id);
    expect(await msgConnOf(a.mOutExt)).toBe(conn!.id);
    expect(await msgConnOf(a.mOutLocal)).toBeNull();
    expect(await msgConnOf(a.mQr)).toBeNull();
    expect(await msgConnOf(a.mManual)).toBeNull();

    const snap = await snapshot(a);
    for (const row of [...snap.reservations, ...snap.conversations, ...snap.messages]) {
      expect(row.ingestedAt).toBeNull();
    }
    const after = await getConnection(a.orgId, "hospitable");
    expect(after).toBeTruthy();
    const marker = await prisma.channelConnection.findUniqueOrThrow({
      where: { id: conn!.id },
      select: { provenanceBackfilledAt: true },
    });
    expect(marker.provenanceBackfilledAt).toBeInstanceOf(Date);
  });

  it("kiracı sınırı: bağlantısız org'a ve başka org'un satırlarına dokunmaz; ikinci geçiş idempotent (0 yazma, satırlar aynı)", async () => {
    const a = await seedLegacy("a");
    const b = await seedLegacy("b"); // bağlantı satırı YOK
    await setOrgHospitableToken(a.orgId, "pat-a", "A");
    const connA = await getConnection(a.orgId, "hospitable");

    const r1 = await backfillProvenance();
    expect(r1).toEqual({ connections: 1, reservations: 1, conversations: 1, messages: 2 });
    const snapB = await snapshot(b);
    for (const row of [...snapB.reservations, ...snapB.conversations, ...snapB.messages]) {
      expect(row.connectionId).toBeNull();
    }
    expect(await connOf(a.resH)).toBe(connA!.id);

    // Geç gelen legacy satır (işaret basıldıktan sonra) → tekrar taranmaz; damga yoksa
    // ingest yolu sorumludur. İşaretin tek-seferliği pinlenir.
    await prisma.reservation.create({
      data: {
        propertyId: a.propertyId,
        guestName: "Geç",
        arrivalDate: new Date("2026-07-01T00:00:00Z"),
        departureDate: new Date("2026-07-03T00:00:00Z"),
        channel: "airbnb",
        sourceReference: "h-late",
      },
    });
    const before = await snapshot(a);
    const r2 = await backfillProvenance();
    expect(r2).toEqual({ connections: 0, reservations: 0, conversations: 0, messages: 0 });
    expect(await snapshot(a)).toEqual(before);
  });

  it("bağlantı durumu önemsiz: disconnected satır da tarihsel sahiptir ve damgalar; her org kendi bağlantısını alır", async () => {
    const a = await seedLegacy("a");
    const c = await seedLegacy("c");
    await setOrgHospitableToken(a.orgId, "pat-a", "A");
    await setOrgHospitableToken(c.orgId, "pat-c", "C");
    await clearOrgHospitableToken(c.orgId);
    const connA = await getConnection(a.orgId, "hospitable");
    const connC = await getConnection(c.orgId, "hospitable");
    expect(connC?.status).toBe("disconnected");

    const r = await backfillProvenance();
    expect(r).toEqual({ connections: 2, reservations: 2, conversations: 2, messages: 4 });
    expect(await connOf(a.resH)).toBe(connA!.id);
    expect(await connOf(c.resH)).toBe(connC!.id);
    expect(await convConnOf(c.convH)).toBe(connC!.id);
    expect(await msgConnOf(c.mIn)).toBe(connC!.id);
    expect(await msgConnOf(a.mIn)).toBe(connA!.id);
  });

  it("zaten damgalı satır (ingest yolu bastı) yeniden yazılmaz — yalnız NULL olanlar seçilir", async () => {
    const a = await seedLegacy("a");
    await setOrgHospitableToken(a.orgId, "pat-a", "A");
    await prisma.reservation.update({ where: { id: a.resH }, data: { connectionId: "conn-onceki" } });
    const r = await backfillProvenance();
    expect(r.reservations).toBe(0);
    expect(await connOf(a.resH)).toBe("conn-onceki");
  });
});
