import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// G2 TUR 8 — T8-B15: konuşma / daire silindikten sonra kuyruk satırlarında misafire yazılmış metin SÜRESİZ kalıyor.
// `MessageOutbox` konuşmaya / rezervasyona FK ile bağlı DEĞİL (kendi gövde snapshot'ını taşır). Silme rotaları (Codex F03) bekleyen satırı
// `canceled` yapıyor ama GÖVDEYİ bırakıyor; gönderilmiş satırların gövdesine hiç dokunmuyor. Saklama süpürgesi (`anonymizeOldGuestData`)
// kuyruk gövdesine YALNIZ var olan konuşma / rezervasyon kimlikleri üzerinden ulaşır → silinen konuşmanın satırları bir daha HİÇ
// anonimleşmez (hesap silinene kadar). Misafir silmesi (`erasure.ts`) aynı satırların gövdesini her durumda boşaltıyor — silme rotaları
// bu kuralla ayrışmış (CLAUDE.md "scrub kapsamı": misafir metni taşıyan her kolon süpürgede).
// Beklenen: silme anında bağlı satırların gövdesi `ANON_BODY` (durumu ne olursa olsun); başka konuşmanın / dairenin satırı dokunulmaz.
// ---------------------------------------------------------------------------
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), requireSession: vi.fn(async () => session) }));

import { DELETE as deleteConversation } from "@/app/api/conversations/[id]/route";
import { DELETE as deleteProperty } from "@/app/api/properties/[id]/route";
import { ANON_BODY } from "@/lib/data-retention";

const req = (url: string) => new NextRequest(`http://localhost${url}`, { method: "DELETE" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const GUEST_TEXT = "Merhaba Ayşe Yılmaz, kapı kodunuz 4821.";

async function seed(tag: string, orgId?: string) {
  const made = orgId
    ? { orgId, propertyId: (await prisma.property.create({ data: { organizationId: orgId, name: `Lale ${tag}` } })).id }
    : await makeOrgWithProperty();
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: made.propertyId, guestName: "Ayşe Yılmaz", arrivalDate: new Date(Date.now() + 86_400_000), departureDate: new Date(Date.now() + 3 * 86_400_000),
      status: "confirmed", sourceReference: `res-${tag}`, channel: "airbnb",
    },
  });
  const conversation = await prisma.conversation.create({
    data: { propertyId: made.propertyId, reservationId: reservation.id, channel: "airbnb", guestIdentifier: "Ayşe Yılmaz", externalReservationId: `res-${tag}` },
  });
  const row = (key: string, status: string, extra: Record<string, unknown> = {}) =>
    prisma.messageOutbox.create({
      data: { organizationId: made.orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: `${tag}-${key}`, status, externalReservationId: `res-${tag}`, ...extra },
    });
  await row("reply-pending", "pending", { conversationId: conversation.id });
  await row("reply-sent", "sent", { conversationId: conversation.id });
  await row("lifecycle-sent", "sent", { reservationId: reservation.id, messageType: "checkin" });
  return { ...made, conversationId: conversation.id, reservationId: reservation.id, tag };
}

const bodies = async (tag: string) =>
  (await prisma.messageOutbox.findMany({ where: { idempotencyKey: { startsWith: `${tag}-` } }, select: { idempotencyKey: true, body: true } }))
    .map((r) => `${r.idempotencyKey}=${r.body === ANON_BODY ? "ANON" : r.body === GUEST_TEXT ? "METIN" : r.body}`)
    .sort();

describe("T8-B15 — silme rotaları kuyruk gövdesini boşaltır", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 konuşma silinince o konuşmanın kuyruk satırlarının gövdesi boşalır (bekleyen + gönderilmiş); komşu konuşma dokunulmaz", async () => {
    const a = await seed("a");
    const b = await seed("b", a.orgId);
    session = { userId: "u", organizationId: a.orgId, role: "owner", email: "o@ornek.com", name: "O", sessionEpoch: 0 } as SessionPayload;
    const res = await deleteConversation(req(`/api/conversations/${a.conversationId}`), ctx(a.conversationId));
    expect(res.status).toBe(200);
    // Konuşmaya bağlı iki satır boşalır; rezervasyona bağlı yaşam döngüsü satırı rezervasyon durduğu için saklama süpürgesinde kalır.
    expect(await bodies("a")).toEqual(["a-lifecycle-sent=METIN", "a-reply-pending=ANON", "a-reply-sent=ANON"]);
    expect(await bodies("b")).toEqual(["b-lifecycle-sent=METIN", "b-reply-pending=METIN", "b-reply-sent=METIN"]);
  });

  it("KONTROL (aşırı uygulama yok): işçinin elindeki uçuştaki satır gövdesini korur — kanal uzlaştırması içerikle eşleştirir (KU-1); sahipsiz belirsiz satır bugünkü gibi iptal + boş", async () => {
    const a = await seed("a");
    for (const [key, status] of [["inflight-sending", "sending"], ["inflight-ambiguous", "ambiguous"], ["inflight-reconciling", "reconciling"], ["inflight-review", "review"]] as const) {
      await prisma.messageOutbox.create({
        data: {
          organizationId: a.orgId, conversationId: a.conversationId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: `a-${key}`, status,
          externalReservationId: "res-a", ...(status === "sending" || status === "reconciling" ? { claimedBy: "worker-1", claimExpiresAt: new Date(Date.now() + 60_000) } : {}),
        },
      });
    }
    session = { userId: "u", organizationId: a.orgId, role: "owner", email: "o@ornek.com", name: "O", sessionEpoch: 0 } as SessionPayload;
    expect((await deleteConversation(req(`/api/conversations/${a.conversationId}`), ctx(a.conversationId))).status).toBe(200);
    expect((await bodies("a")).filter((b) => b.startsWith("a-inflight"))).toEqual([
      "a-inflight-ambiguous=ANON",
      "a-inflight-reconciling=METIN",
      "a-inflight-review=ANON",
      "a-inflight-sending=METIN",
    ]);
    // Sahipsiz belirsiz / inceleme satırı silmede ZATEN iptal ediliyordu (F03, `ERASABLE_STATUSES`) — gövdesi artık kimseye gerekmez.
    const st = await prisma.messageOutbox.findMany({ where: { idempotencyKey: { in: ["a-inflight-ambiguous", "a-inflight-review"] } }, select: { status: true } });
    expect(st.map((r) => r.status)).toEqual(["canceled", "canceled"]);
  });

  it("🚨 daire silinince dairenin bütün kuyruk satırlarının gövdesi boşalır (yanıt + yaşam döngüsü); komşu daire dokunulmaz", async () => {
    const a = await seed("a");
    const b = await seed("b", a.orgId);
    session = { userId: "u", organizationId: a.orgId, role: "owner", email: "o@ornek.com", name: "O", sessionEpoch: 0 } as SessionPayload;
    const res = await deleteProperty(req(`/api/properties/${a.propertyId}`), ctx(a.propertyId));
    expect(res.status).toBe(200);
    expect(await bodies("a")).toEqual(["a-lifecycle-sent=ANON", "a-reply-pending=ANON", "a-reply-sent=ANON"]);
    expect(await bodies("b")).toEqual(["b-lifecycle-sent=METIN", "b-reply-pending=METIN", "b-reply-sent=METIN"]);
  });
});
