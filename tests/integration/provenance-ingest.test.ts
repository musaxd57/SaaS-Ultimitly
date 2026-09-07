import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// PROVENANCE — V0.4 (migration 50). Her DIŞ/MİSAFİR kaynaklı kayıt şunu taşır:
//   · `ingestedAt`  = kaydın bir INGRESS'ten SON geçtiği an (freshness). Create'te
//                    VE senkron update'inde yazılır; host'un elle girdiği satır ve
//                    bizim ürettiğimiz çıktı (AI cevabı, doğrudan gönderim) NULL.
//   · `connectionId` = ingest'in yapıldığı ChannelConnection (Hospitable) ya da
//                    outbox'ta kuyruklandığı bağlantı. iCal'in provenance'ı
//                    `calendarSourceId`, QR iç thread'in ise `qr-chat:` işaretçisi
//                    → ikisinde de NULL (bağlantı damgası UYDURULMAZ).
//   · Bağlantısız (env fallback) ingest damgayı NULL bırakır ve daha önce basılmış
//     bir damgayı NULL ile EZMEZ.
// Kırmızı-önce: kolonlar/damga yokken her senaryo kırmızı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn(),
  listReservations: vi.fn(),
  listMessages: vi.fn(),
}));
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));
vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return { ...actual, suggestReply: vi.fn() };
});
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { NextRequest } from "next/server";
import { listProperties, listReservations, listMessages } from "@/lib/hospitable";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { suggestReply } from "@/lib/ai";
import { syncHospitable } from "@/lib/hospitable-sync";
import { syncCalendarSource } from "@/lib/import/sync";
import { POST as importPost } from "@/app/api/reservations/import/route";
import { POST as chatPost } from "@/app/api/chat/[token]/route";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { getConnection } from "@/lib/channels/connections";
import {
  setOrgHospitableToken,
  clearOrgHospitableToken,
  resetPrimaryOrgCache,
} from "@/lib/hospitable-credentials";

const mockProperties = vi.mocked(listProperties);
const mockReservations = vi.mocked(listReservations);
const mockMessages = vi.mocked(listMessages);
const mockFeed = vi.mocked(fetchFeedText);
const mockSuggest = vi.mocked(suggestReply);

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ARRIVAL = ymd(daysFromNow(5));
const DEPARTURE = ymd(daysFromNow(9));

function hospReservation(over: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    code: "HMX1",
    platform: "airbnb",
    status: "accepted",
    conversation_id: "conv-1",
    conversation_language: "en",
    last_message_at: "2026-05-30T10:00:00Z",
    arrival_date: ARRIVAL,
    departure_date: DEPARTURE,
    guest: { id: "guest-1", first_name: "Alex", last_name: "Guest" },
    ...over,
  };
}
const guestMsg = (id: number, at: string) => ({
  id,
  body: `soru ${id}`,
  sender_type: "guest",
  sender_role: "guest",
  sender: { full_name: "Alex Guest" },
  created_at: at,
});
const hostMsg = (id: number, at: string) => ({
  id,
  body: `cevap ${id}`,
  sender_type: "host",
  sender_role: "host",
  sender: { full_name: "Ev Sahibi" },
  created_at: at,
});

const ORIGINAL_ENV = {
  PRIMARY_ORG_ID: process.env.PRIMARY_ORG_ID,
  HOSPITABLE_API_TOKEN: process.env.HOSPITABLE_API_TOKEN,
  GUEST_CHAT_ENABLED: process.env.GUEST_CHAT_ENABLED,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrimaryOrgCache();
}

async function rows(propertyId: string) {
  const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { propertyId, externalReservationId: "res-1" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return { reservation, conversation, messages: conversation.messages };
}

describe("provenance — Hospitable senkronu (ingest damgası)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    mockProperties.mockResolvedValue([{ id: "hp-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([hospReservation()]);
    mockMessages.mockResolvedValue([guestMsg(1001, "2026-05-30T09:00:00Z"), hostMsg(1002, "2026-05-30T10:00:00Z")]);
  });
  afterEach(restoreEnv);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aktif bağlantıyla ingest: rezervasyon + konuşma + HER İKİ yöndeki sağlayıcı mesajı bağlantı id'sini ve ingestedAt'i taşır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    expect(conn?.status).toBe("active");
    const t0 = new Date(Date.now() - 1000);

    await syncHospitable(orgId);

    const { reservation, conversation, messages } = await rows(propertyId);
    expect(reservation.connectionId).toBe(conn!.id);
    expect(reservation.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(conversation.connectionId).toBe(conn!.id);
    expect(conversation.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(messages).toHaveLength(2);
    for (const m of messages) {
      // Sağlayıcıdan gelen host cevabı da ingest edilmiştir (yönü değil kaynağı sayar).
      expect(m.connectionId).toBe(conn!.id);
      expect(m.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    }
  });

  it("yeniden senkron: rezervasyon/konuşma ingestedAt İLERLER (freshness), bağlantı korunur; yeniden yazılmayan eski mesaj dokunulmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    await syncHospitable(orgId);
    const OLD = new Date("2020-01-01T00:00:00Z");
    const first = await rows(propertyId);
    await prisma.reservation.update({ where: { id: first.reservation.id }, data: { ingestedAt: OLD } });
    await prisma.conversation.update({ where: { id: first.conversation.id }, data: { ingestedAt: OLD } });
    await prisma.message.updateMany({ where: { conversationId: first.conversation.id }, data: { ingestedAt: OLD } });

    // Yeni bir misafir mesajı → thread atlanmaz, güncellenir.
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T11:00:00Z" })]);
    mockMessages.mockResolvedValue([
      guestMsg(1001, "2026-05-30T09:00:00Z"),
      hostMsg(1002, "2026-05-30T10:00:00Z"),
      guestMsg(1003, "2026-05-30T11:00:00Z"),
    ]);
    const t1 = new Date(Date.now() - 1000);
    await syncHospitable(orgId);

    const second = await rows(propertyId);
    expect(second.reservation.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    expect(second.reservation.connectionId).toBe(conn!.id);
    expect(second.conversation.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    expect(second.conversation.connectionId).toBe(conn!.id);
    const byExt = new Map(second.messages.map((m) => [m.externalId, m]));
    expect(byExt.get("1001")?.ingestedAt?.getTime()).toBe(OLD.getTime()); // yeniden yazılmadı
    expect(byExt.get("1003")?.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    expect(byExt.get("1003")?.connectionId).toBe(conn!.id);
  });

  it("env fallback (bağlantı satırı yok): ingestedAt yazılır, connectionId NULL; sonradan bağlanınca damgalanır; bağlantı kalkınca damga NULL ile EZİLMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    process.env.PRIMARY_ORG_ID = orgId;
    process.env.HOSPITABLE_API_TOKEN = "env-token";
    resetPrimaryOrgCache();
    expect(await getConnection(orgId, "hospitable")).toBeNull();

    // 1) env fallback ile ilk ingest
    await syncHospitable(orgId);
    const a = await rows(propertyId);
    expect(a.reservation.connectionId).toBeNull();
    expect(a.reservation.ingestedAt).toBeInstanceOf(Date);
    expect(a.conversation.connectionId).toBeNull();
    expect(a.conversation.ingestedAt).toBeInstanceOf(Date);
    expect(a.messages.map((m) => m.connectionId)).toEqual([null, null]);

    // 2) host bağlanır → sonraki senkron mevcut satırları damgalar, yeni mesaj damgalı doğar
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T11:00:00Z" })]);
    mockMessages.mockResolvedValue([
      guestMsg(1001, "2026-05-30T09:00:00Z"),
      hostMsg(1002, "2026-05-30T10:00:00Z"),
      guestMsg(1003, "2026-05-30T11:00:00Z"),
    ]);
    await syncHospitable(orgId);
    const b = await rows(propertyId);
    expect(b.reservation.connectionId).toBe(conn!.id);
    expect(b.conversation.connectionId).toBe(conn!.id);
    expect(b.messages.find((m) => m.externalId === "1003")?.connectionId).toBe(conn!.id);
    expect(b.messages.find((m) => m.externalId === "1001")?.connectionId).toBeNull(); // geçmiş dürüst kalır

    // 3) bağlantı kaldırılır, env fallback sürer → damga korunur, ingestedAt ilerler
    await clearOrgHospitableToken(orgId);
    expect((await getConnection(orgId, "hospitable"))?.status).toBe("disconnected");
    await prisma.reservation.update({ where: { id: b.reservation.id }, data: { ingestedAt: new Date("2020-01-01T00:00:00Z") } });
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T12:00:00Z" })]);
    mockMessages.mockResolvedValue([
      guestMsg(1001, "2026-05-30T09:00:00Z"),
      hostMsg(1002, "2026-05-30T10:00:00Z"),
      guestMsg(1003, "2026-05-30T11:00:00Z"),
      guestMsg(1004, "2026-05-30T12:00:00Z"),
    ]);
    const t2 = new Date(Date.now() - 1000);
    await syncHospitable(orgId);
    const c = await rows(propertyId);
    expect(c.reservation.connectionId).toBe(conn!.id);
    expect(c.reservation.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t2.getTime());
    expect(c.conversation.connectionId).toBe(conn!.id);
    const m1004 = c.messages.find((m) => m.externalId === "1004");
    expect(m1004?.connectionId).toBeNull(); // o an aktif bağlantı yoktu → uydurulmaz
    expect(m1004?.ingestedAt).toBeInstanceOf(Date);
  });
});

describe("provenance — diğer ingress'ler ve çıkış yolu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    __resetRateLimit();
  });
  afterEach(restoreEnv);

  it("iCal: ingestedAt yazılır, connectionId NULL kalır (provenance = calendarSourceId) — org bağlı olsa bile", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve"); // aşırı-uygulama tuzağı
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/feed.ics" },
    });
    const d = (n: number) => ymd(daysFromNow(n)).replace(/-/g, "");
    mockFeed.mockResolvedValue(
      `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\nBEGIN:VEVENT\nUID:abc-123@airbnb.com\nDTSTART;VALUE=DATE:${d(5)}\nDTEND;VALUE=DATE:${d(9)}\nSUMMARY:Ahmet Yilmaz\nEND:VEVENT\nEND:VCALENDAR`,
    );
    const t0 = new Date(Date.now() - 1000);
    await syncCalendarSource(source.id);
    const r = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "abc-123@airbnb.com" } });
    expect(r.calendarSourceId).toBe(source.id);
    expect(r.connectionId).toBeNull();
    expect(r.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());

    // Değişen feed → update yolu da freshness'ı ilerletir.
    await prisma.reservation.update({ where: { id: r.id }, data: { ingestedAt: new Date("2020-01-01T00:00:00Z") } });
    mockFeed.mockResolvedValue(
      `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\nBEGIN:VEVENT\nUID:abc-123@airbnb.com\nDTSTART;VALUE=DATE:${d(5)}\nDTEND;VALUE=DATE:${d(10)}\nSUMMARY:Ahmet Yilmaz\nEND:VEVENT\nEND:VCALENDAR`,
    );
    const t1 = new Date(Date.now() - 1000);
    await syncCalendarSource(source.id);
    const r2 = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(r2.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t1.getTime());
    expect(r2.connectionId).toBeNull();
  });

  it("elle .csv yükleme: ingestedAt yazılır (dosya bir ingress'tir), connectionId NULL", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
    const form = new FormData();
    form.set(
      "file",
      new File([`guest_name,arrival,departure\nAda,${ymd(daysFromNow(20))},${ymd(daysFromNow(24))}`], "rez.csv", {
        type: "text/csv",
      }),
    );
    form.set("propertyId", propertyId);
    const t0 = new Date(Date.now() - 1000);
    const res = await importPost(
      new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }),
      { params: Promise.resolve({}) } as never,
    );
    expect(res.status).toBe(200);
    const r = await prisma.reservation.findFirstOrThrow({ where: { propertyId, guestName: "Ada" } });
    expect(r.channel).toBe("manual");
    expect(r.connectionId).toBeNull();
    expect(r.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
  });

  it("QR misafir sohbeti: konuşma + misafirin mesajı ingestedAt taşır; botun cevabı taşımaz; connectionId hep NULL (iç thread)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    process.env.GUEST_CHAT_ENABLED = "1";
    const token = generateChatToken();
    await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
    await prisma.reservation.create({
      data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
    });
    const reply: SuggestReplyResult = {
      intent: "general",
      confidence: 0.9,
      reply: "Çöp salı günü toplanır.",
      risk: null,
      priority: "standard",
      source: "openai",
      actionSuggestion: null,
      riskLevel: "none",
      detectedLanguage: "tr",
      riskType: null,
      usedSources: [],
      missingInfo: [],
      statedCheckoutTime: null,
    };
    mockSuggest.mockResolvedValue(reply);
    const t0 = new Date(Date.now() - 1000);
    const res = await chatPost(
      new Request(`http://localhost/api/chat/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5" },
        body: JSON.stringify({ message: "Çöp ne zaman toplanıyor?" }),
      }) as never,
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
    const conv = await prisma.conversation.findFirstOrThrow({
      where: { propertyId, externalReservationId: { startsWith: "qr-chat:" } },
      include: { messages: true },
    });
    expect(conv.connectionId).toBeNull();
    expect(conv.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    const inbound = conv.messages.find((m) => m.direction === "inbound");
    const outbound = conv.messages.find((m) => m.direction === "outbound");
    expect(inbound?.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(inbound?.connectionId).toBeNull();
    expect(outbound).toBeTruthy();
    expect(outbound?.ingestedAt).toBeNull(); // bizim ürettiğimiz metin ingest değildir
    expect(outbound?.connectionId).toBeNull();
  });

  it("outbox enqueue: giden Message satırı kuyruklandığı bağlantıyı taşır, ingestedAt NULL (çıkış, ingest değil)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    const conv = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: "res-out-1" },
    });
    const { messageId } = await enqueueOutbound({
      organizationId: orgId,
      conversationId: conv.id,
      channel: "airbnb",
      externalReservationId: "res-out-1",
      body: "Merhaba",
      senderName: "Ev sahibi",
      authorType: "host",
      idempotencyKey: "k-1",
    });
    const m = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(m.connectionId).toBe(conn!.id);
    expect(m.ingestedAt).toBeNull();
  });
});
