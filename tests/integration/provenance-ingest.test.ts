import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// PROVENANCE — V0.4 (migration 50). Sözleşme (şema yorumu + channels/provenance.ts):
//   · `ingestedAt` = İLK ALINMA: satırı bir ingress YARATTIĞI an. Değişmez — update
//     yolları dokunmaz; tekrar senkron (içerik değişse de değişmese de) eski satırı
//     "yeni" gösteremez. Freshness bu değildir. Host'un elle girdiği satır ve bizim
//     ürettiğimiz çıktı (AI/bot cevabı, doğrudan gönderim) NULL.
//   · `connectionId` = KANITLANMIŞ bağlantı: ya ingest anında yazılır ya da NULL iken
//     bir senkron satırı O bağlantıdan gerçekten GÖZLEMLEYİNCE dolar (NULL→X). Asla
//     X→NULL, asla X→Y. ÇIKARIM YOK: bağlantı satırının doğması ("mevcut bağlantıyı
//     aktar") hiçbir geçmiş satırı damgalamaz; gözlemlenmeyen legacy satır NULL kalır.
//     iCal (`calendarSourceId`), QR (`qr-chat:`), dosya, env fallback → NULL.
//   · Sınıflar: ingest / observed / unbound / legacy (`describeProvenance`).
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
import { describeProvenance } from "@/lib/channels/provenance";
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
const TWO = [guestMsg(1001, "2026-05-30T09:00:00Z"), hostMsg(1002, "2026-05-30T10:00:00Z")];
const THREE = [...TWO, guestMsg(1003, "2026-05-30T11:00:00Z")];

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

async function rows(propertyId: string, ref = "res-1") {
  const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: ref } });
  const conversation = await prisma.conversation.findFirstOrThrow({
    where: { propertyId, externalReservationId: ref },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return { reservation, conversation, messages: conversation.messages };
}
const stamp = (r: { connectionId: string | null; ingestedAt: Date | null }) => ({
  connectionId: r.connectionId,
  ingestedAt: r.ingestedAt?.getTime() ?? null,
});

describe("provenance — Hospitable senkronu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    mockProperties.mockResolvedValue([{ id: "hp-1", name: "Test Property" }]);
    mockReservations.mockResolvedValue([hospReservation()]);
    mockMessages.mockResolvedValue(TWO);
  });
  afterEach(restoreEnv);
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("aktif bağlantıyla ingest: rezervasyon + konuşma + HER İKİ yöndeki sağlayıcı mesajı 'ingest' sınıfı (bağlantı + ilk alınma)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    expect(conn?.status).toBe("active");
    const t0 = new Date(Date.now() - 1000);

    await syncHospitable(orgId);

    const { reservation, conversation, messages } = await rows(propertyId);
    for (const r of [reservation, conversation, ...messages]) {
      expect(r.connectionId).toBe(conn!.id);
      expect(r.ingestedAt?.getTime()).toBeGreaterThanOrEqual(t0.getTime());
      expect(describeProvenance(r)).toBe("ingest");
    }
    expect(messages).toHaveLength(2); // sağlayıcıdan gelen host cevabı da ingest'tir
  });

  it("ingestedAt = İLK ALINMA, değişmez: içerik değişmeyen VE değişen tekrar senkron eski satırların damgasını korur (eski veri 'yeni' görünmez)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    await syncHospitable(orgId);
    const first = await rows(propertyId);
    const firstStamps = {
      reservation: stamp(first.reservation),
      conversation: stamp(first.conversation),
      messages: first.messages.map(stamp),
    };
    expect(firstStamps.reservation.ingestedAt).not.toBeNull();

    // (a) hiçbir şey değişmedi — rezervasyon update yolu yine de koşar
    await new Promise((r) => setTimeout(r, 15));
    await syncHospitable(orgId);
    const same = await rows(propertyId);
    expect(stamp(same.reservation)).toEqual(firstStamps.reservation);
    expect(stamp(same.conversation)).toEqual(firstStamps.conversation);
    expect(same.messages.map(stamp)).toEqual(firstStamps.messages);

    // (b) içerik değişti: tarih kaydı + yeni misafir mesajı → thread güncellenir
    mockReservations.mockResolvedValue([
      hospReservation({ departure_date: ymd(daysFromNow(10)), last_message_at: "2026-05-30T11:00:00Z" }),
    ]);
    mockMessages.mockResolvedValue(THREE);
    await new Promise((r) => setTimeout(r, 15));
    const t1 = Date.now() - 1000;
    await syncHospitable(orgId);
    const changed = await rows(propertyId);
    expect(changed.reservation.departureDate.getTime()).not.toBe(first.reservation.departureDate.getTime()); // güncelleme gerçekten oldu
    expect(stamp(changed.reservation)).toEqual(firstStamps.reservation); // ama ilk alınma sabit
    expect(stamp(changed.conversation)).toEqual(firstStamps.conversation);
    const byExt = new Map(changed.messages.map((m) => [m.externalId, m]));
    expect(stamp(byExt.get("1001")!)).toEqual(firstStamps.messages[0]);
    expect(stamp(byExt.get("1002")!)).toEqual(firstStamps.messages[1]);
    expect(byExt.get("1003")!.ingestedAt!.getTime()).toBeGreaterThanOrEqual(t1); // yeni satırın KENDİ ilk alınması
    expect(describeProvenance(byExt.get("1003")!)).toBe("ingest");
  });

  it("env fallback → bağlan → kaldır: 'unbound' doğar; gözlemlenen satır NULL→X dolar (ilk alınma sabit); dolu damga NULL ile EZİLMEZ; mesaj satırı yeniden yazılmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    process.env.PRIMARY_ORG_ID = orgId;
    process.env.HOSPITABLE_API_TOKEN = "env-token";
    resetPrimaryOrgCache();
    expect(await getConnection(orgId, "hospitable")).toBeNull();

    // 1) env fallback ile ilk ingest → unbound
    await syncHospitable(orgId);
    const a = await rows(propertyId);
    for (const r of [a.reservation, a.conversation, ...a.messages]) expect(describeProvenance(r)).toBe("unbound");
    const firstIngest = a.reservation.ingestedAt!.getTime();

    // 2) host bağlanır → sonraki senkron mevcut satırları O bağlantıdan GÖZLEMLER: NULL→X, ilk alınma sabit
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T11:00:00Z" })]);
    mockMessages.mockResolvedValue(THREE);
    await syncHospitable(orgId);
    const b = await rows(propertyId);
    expect(b.reservation.connectionId).toBe(conn!.id);
    expect(b.reservation.ingestedAt!.getTime()).toBe(firstIngest);
    expect(describeProvenance(b.reservation)).toBe("ingest"); // ilk alınma zaten kayıtlıydı (unbound → ingest)
    expect(b.conversation.connectionId).toBe(conn!.id);
    expect(b.messages.find((m) => m.externalId === "1001")?.connectionId).toBeNull(); // mesaj satırı yeniden yazılmaz
    expect(describeProvenance(b.messages.find((m) => m.externalId === "1003")!)).toBe("ingest");

    // 3) bağlantı kaldırılır, env fallback sürer → damga korunur, yeni mesaj unbound
    await clearOrgHospitableToken(orgId);
    expect((await getConnection(orgId, "hospitable"))?.status).toBe("disconnected");
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T12:00:00Z" })]);
    mockMessages.mockResolvedValue([...THREE, guestMsg(1004, "2026-05-30T12:00:00Z")]);
    await syncHospitable(orgId);
    const c = await rows(propertyId);
    expect(c.reservation.connectionId).toBe(conn!.id);
    expect(c.reservation.ingestedAt!.getTime()).toBe(firstIngest);
    expect(c.conversation.connectionId).toBe(conn!.id);
    expect(describeProvenance(c.messages.find((m) => m.externalId === "1004")!)).toBe("unbound");
  });

  it("'mevcut bağlantıyı aktar' tarihsel kanıt DEĞİL: bağlantı doğunca hiçbir legacy satır damgalanmaz; yalnız senkronun gerçekten gözlemlediği legacy satır 'observed' olur, pencere dışı legacy NULL kalır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Legacy satırlar (migration öncesi): damgasız. `res-1` sağlayıcı cevabında VAR, `res-old` YOK.
    const mkLegacy = async (ref: string) => {
      const reservation = await prisma.reservation.create({
        data: { propertyId, guestName: "Legacy", arrivalDate: daysFromNow(5), departureDate: daysFromNow(9), channel: "airbnb", sourceReference: ref },
      });
      const conversation = await prisma.conversation.create({
        data: {
          propertyId,
          channel: "airbnb",
          guestIdentifier: "Legacy",
          externalReservationId: ref,
          reservationId: reservation.id,
          messages: { create: { direction: "inbound", authorType: "guest", senderName: "Legacy", body: "eski", externalId: `old-${ref}` } },
        },
      });
      return { reservation, conversation };
    };
    await mkLegacy("res-1");
    await mkLegacy("res-old");

    // Bağlantı satırı DOĞAR (aktarım / bağlanma) — hiçbir satır damgalanmamalı.
    await setOrgHospitableToken(orgId, "pat-1", "Nuve");
    const conn = await getConnection(orgId, "hospitable");
    for (const ref of ["res-1", "res-old"]) {
      const r = await rows(propertyId, ref);
      for (const x of [r.reservation, r.conversation, ...r.messages]) expect(describeProvenance(x)).toBe("legacy");
    }

    // Senkron yalnız res-1'i gözlemler (yeni mesajla thread güncellenir).
    mockReservations.mockResolvedValue([hospReservation({ last_message_at: "2026-05-30T11:00:00Z" })]);
    mockMessages.mockResolvedValue(THREE);
    await syncHospitable(orgId);

    const seen = await rows(propertyId, "res-1");
    expect(seen.reservation.connectionId).toBe(conn!.id);
    expect(seen.reservation.ingestedAt).toBeNull(); // ilk alınma bilinmiyor → uydurulmaz
    expect(describeProvenance(seen.reservation)).toBe("observed");
    expect(describeProvenance(seen.conversation)).toBe("observed");
    expect(describeProvenance(seen.messages.find((m) => m.externalId === "old-res-1")!)).toBe("legacy"); // eski mesaj satırı yeniden yazılmaz
    expect(describeProvenance(seen.messages.find((m) => m.externalId === "1003")!)).toBe("ingest");

    const unseen = await rows(propertyId, "res-old");
    for (const x of [unseen.reservation, unseen.conversation, ...unseen.messages]) expect(describeProvenance(x)).toBe("legacy");
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

  it("iCal: 'unbound' (provenance = calendarSourceId) — org bağlı olsa bile; değişen feed ilk alınmayı DEĞİŞTİRMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, "pat-1", "Nuve"); // aşırı-uygulama tuzağı
    const source = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/feed.ics" },
    });
    const d = (n: number) => ymd(daysFromNow(n)).replace(/-/g, "");
    const feed = (end: number) =>
      `BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Airbnb//Hosting Calendar//EN\nBEGIN:VEVENT\nUID:abc-123@airbnb.com\nDTSTART;VALUE=DATE:${d(5)}\nDTEND;VALUE=DATE:${d(end)}\nSUMMARY:Ahmet Yilmaz\nEND:VEVENT\nEND:VCALENDAR`;
    mockFeed.mockResolvedValue(feed(9));
    const t0 = new Date(Date.now() - 1000);
    await syncCalendarSource(source.id);
    const r = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "abc-123@airbnb.com" } });
    expect(r.calendarSourceId).toBe(source.id);
    expect(describeProvenance(r)).toBe("unbound");
    expect(r.ingestedAt!.getTime()).toBeGreaterThanOrEqual(t0.getTime());

    mockFeed.mockResolvedValue(feed(10));
    await new Promise((res) => setTimeout(res, 15));
    await syncCalendarSource(source.id);
    const r2 = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    expect(r2.departureDate.getTime()).not.toBe(r.departureDate.getTime()); // update gerçekten oldu
    expect(stamp(r2)).toEqual(stamp(r)); // ilk alınma sabit, bağlantı yok
  });

  it("elle .csv yükleme: ilk alınma yazılır (dosya bir ingress'tir), connectionId NULL → 'unbound'", async () => {
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
    expect(describeProvenance(r)).toBe("unbound");
    expect(r.ingestedAt!.getTime()).toBeGreaterThanOrEqual(t0.getTime());
  });

  it("QR misafir sohbeti: konuşma + misafirin mesajı 'unbound'; botun cevabı damgasız (bizim çıktımız)", async () => {
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
    expect(describeProvenance(conv)).toBe("unbound");
    const inbound = conv.messages.find((m) => m.direction === "inbound")!;
    const outbound = conv.messages.find((m) => m.direction === "outbound")!;
    expect(describeProvenance(inbound)).toBe("unbound");
    expect(outbound).toBeTruthy();
    expect(outbound.ingestedAt).toBeNull();
    expect(outbound.connectionId).toBeNull();
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
