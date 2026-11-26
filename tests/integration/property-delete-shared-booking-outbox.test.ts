import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import { stayDay } from "../helpers/stay-dates";

// Aynı sağlayıcı rezervasyonu iki dairede kayıtlıyken otomatik mesaj TUTULUR ("ev sahibi yanlış kaydı kaldırınca gider",
// `booking-property-conflict.ts`). Ev sahibi yanlış kaydı YANLIŞ DAİREYİ silerek kaldırırsa daire silme rotası, rezervasyon referansı
// üzerinden DOĞRU dairenin bekleyen mesaj satırını da "property_deleted" koduyla iptal ediyordu; bu kod diriltilebilir değil → misafire
// giriş bilgisi / karşılama HİÇ gitmiyordu, sessizce (hata ayıklama ajanı G4, 11-26 gece; kalıcı kuyruk açıkken).
// Kural: referansı işletmenin BAŞKA bir dairesinde yaşayan yaşam döngüsü satırı
//  - doğru dairenin rezervasyonuna aitse DOKUNULMAZ (işçi gönderim anında bütün kuralları yeniden uygular);
//  - silinen dairenin rezervasyonuna aitse (gövdesi o dairenin metninden kuruldu) DİRİLTİLEBİLİR kodla iptal edilir → gönderici doğru
//    dairenin metniyle yeniden kuyruğa verir.
// Referansı başka dairede yaşamayan satırlar ve yanıt satırları eskisi gibi "property_deleted".

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { enqueueProactive } from "@/lib/outbox/enqueue";
import { lifecycleUnusableIds } from "@/lib/automation";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";

const req = (url: string) => new NextRequest(`http://localhost${url}`, { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("daire silme — referansı başka dairede yaşayan otomatik mesaj satırı", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function world() {
    const { orgId, propertyId: propA } = await makeOrgWithProperty();
    const propB = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale 2", checkInTime: "15:00", checkOutTime: "11:00" } })).id;
    const user = await prisma.user.create({ data: { organizationId: orgId, email: `o-${orgId}@t.com`, name: "O", passwordHash: "x", role: "owner" } });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 } as SessionPayload;
    const stay = { guestName: "Lale", arrivalDate: stayDay(2), departureDate: stayDay(5), status: "confirmed", channel: "airbnb" };
    const resA = await prisma.reservation.create({ data: { ...stay, propertyId: propA, sourceReference: "R-SHARED" } });
    const resB = await prisma.reservation.create({ data: { ...stay, propertyId: propB, sourceReference: "R-SHARED" } });
    const soloA = await prisma.reservation.create({ data: { ...stay, propertyId: propA, sourceReference: "R-ONLY-A" } });
    return { orgId, propA, propB, resA, resB, soloA };
  }
  const enqueue = (orgId: string, ref: string, reservationId: string, body: string) =>
    enqueueProactive({ organizationId: orgId, externalReservationId: ref, reservationId, channel: "airbnb", messageType: "checkin", body, idempotencyKey: `checkin:${orgId}:${ref}` });
  const rowOf = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
  const noErasure = async () => ({ blocksSourceReference: () => false });

  it("🚨 satır DOĞRU dairenin rezervasyonuna aitse yanlış daire silinince dokunulmaz (bekleyen kalır, gövde aynı)", async () => {
    const w = await world();
    const row = await enqueue(w.orgId, "R-SHARED", w.resB.id, "Lale 2 giriş bilgisi");
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    const after = await rowOf(row.outboxId);
    expect(after).toMatchObject({ status: "pending", lastErrorCode: null, cancelRequestedAt: null, body: "Lale 2 giriş bilgisi", reservationId: w.resB.id });
  });

  it("🚨 satır SİLİNEN dairenin rezervasyonuna aitse diriltilebilir kodla iptal edilir; gönderici doğru dairenin metniyle yeniden kuyruğa verir", async () => {
    const w = await world();
    const row = await enqueue(w.orgId, "R-SHARED", w.resA.id, "Lale giriş bilgisi (silinecek daire)");
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    expect(await rowOf(row.outboxId)).toMatchObject({ status: "canceled", lastErrorCode: "reservation_gone" });
    // Gönderici ön elemesi doğru dairenin rezervasyonunu "kuyruk sahiplendi" saymaz…
    const unusable = await lifecycleUnusableIds(w.orgId, "checkin", [{ id: w.resB.id, sourceReference: "R-SHARED" }], noErasure);
    expect(unusable.has(w.resB.id)).toBe(false);
    // …ve yeniden kuyruğa verme aynı satırı doğru dairenin gövdesi + rezervasyonuyla bekleyen yapar (ikinci satır yok).
    const again = await enqueue(w.orgId, "R-SHARED", w.resB.id, "Lale 2 giriş bilgisi");
    expect(again).toEqual({ outboxId: row.outboxId, deduped: false });
    expect(await rowOf(row.outboxId)).toMatchObject({ status: "pending", body: "Lale 2 giriş bilgisi", reservationId: w.resB.id, lastErrorCode: null });
    expect(await prisma.messageOutbox.count({ where: { organizationId: w.orgId } })).toBe(1);
  });

  it("işçinin elindeki (isteği atılmamış) silinen-daire satırına iptal İSTEĞİ diriltilebilir kodla yazılır", async () => {
    const w = await world();
    const row = await enqueue(w.orgId, "R-SHARED", w.resA.id, "Lale giriş bilgisi");
    await prisma.messageOutbox.update({ where: { id: row.outboxId }, data: { status: "sending", claimedBy: "isci-1", claimedAt: new Date(), claimExpiresAt: new Date(Date.now() + 60_000) } });
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    const after = await rowOf(row.outboxId);
    expect(after.status).toBe("sending");
    expect(after.cancelRequestedAt).not.toBeNull();
    expect(after.cancelReason).toBe("reservation_gone");
  });

  it("anti-aşırı-uygulama: referansı başka dairede YAŞAMAYAN satır eskisi gibi 'property_deleted' (dirilmez)", async () => {
    const w = await world();
    const row = await enqueue(w.orgId, "R-ONLY-A", w.soloA.id, "Lale giriş bilgisi");
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    expect(await rowOf(row.outboxId)).toMatchObject({ status: "canceled", lastErrorCode: "property_deleted" });
  });

  it("anti-aşırı-uygulama: başka İŞLETMENİN aynı referanslı rezervasyonu 'başka dairede yaşıyor' sayılmaz", async () => {
    const w = await world();
    const other = await makeOrgWithProperty();
    await prisma.reservation.create({
      data: { propertyId: other.propertyId, guestName: "Lale", arrivalDate: stayDay(2), departureDate: stayDay(5), status: "confirmed", channel: "airbnb", sourceReference: "R-ONLY-A" },
    });
    const row = await enqueue(w.orgId, "R-ONLY-A", w.soloA.id, "Lale giriş bilgisi");
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    expect(await rowOf(row.outboxId)).toMatchObject({ status: "canceled", lastErrorCode: "property_deleted" });
  });

  it("yanıt satırı (konuşmalı) referansı paylaşılsa da 'property_deleted' ile iptal edilir", async () => {
    const w = await world();
    const conv = await prisma.conversation.create({ data: { propertyId: w.propA, guestIdentifier: "Lale", channel: "airbnb", status: "new", externalReservationId: "R-SHARED" } });
    const reply = await prisma.messageOutbox.create({
      data: { organizationId: w.orgId, conversationId: conv.id, externalReservationId: "R-SHARED", channel: "airbnb", messageType: "reply", body: "Merhaba", idempotencyKey: `reply:${conv.id}:1`, status: "pending", availableAt: new Date() },
    });
    expect((await deleteProperty(req(`/api/properties/${w.propA}`), ctx(w.propA))).status).toBe(200);
    expect(await rowOf(reply.id)).toMatchObject({ status: "canceled", lastErrorCode: "property_deleted" });
  });
});
