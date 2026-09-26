import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";
import type { SuggestReplyResult } from "@/lib/ai/types";

// ---------------------------------------------------------------------------
// V1 ÜRÜN AKIŞI — HOSPITABLE'SIZ KİRACI, UÇTAN UCA (Codex turu 2026-09-08).
//
// Kanıtlanan şey: Hospitable token'ı/bağlantısı OLMAYAN bir org'da Lixus'un KENDİ
// giriş yolları (iCal takvim beslemesi · elle .ics yükleme · QR misafir sohbeti ·
// Bilgi Tabanı) sağlayıcıdan bağımsız IngestEvent sözleşmesine bağlanır, zamanlanmış
// geçiş onları tüketir ve mülk hafızası/sinyaller `getPropertyMemory` (mülk sayfası)
// üzerinden okunur. Yapay olay YOK: her event gerçek bir yazma anında, aynı TX'te.
//
// ⚠️ Feed HTTP katmanı ve model çağrısı mock; bu dosya ürün akışının kablolamasını
// pinler, canlı doğrulama değildir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-sync", () => ({ syncHospitable: vi.fn() }));
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => false,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
  HospitableError: class HospitableError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn().mockResolvedValue({ notified: false, throttled: false, configured: false }),
  redactSensitive: (s: string) => s,
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

import { syncHospitable } from "@/lib/hospitable-sync";
import { fetchFeedText } from "@/lib/net/pinned-fetch";
import { suggestReply } from "@/lib/ai";
import { runScheduledSync } from "@/lib/scheduled-sync";
import { generateChatToken } from "@/lib/guest-chat";
import { __resetRateLimit } from "@/lib/rate-limit";
import { resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { POST as CHAT_POST } from "@/app/api/chat/[token]/route";
import { POST as IMPORT_POST } from "@/app/api/reservations/import/route";
import { POST as KB_CREATE } from "@/app/api/kb/route";
import { PATCH as KB_PATCH, DELETE as KB_DELETE } from "@/app/api/kb/[id]/route";
import { processIngestEvents } from "@/modules/intelligence/consumer";
import { runIntelligencePass } from "@/modules/intelligence";
import { getPropertyMemory } from "@/modules/intelligence/memory/read";
import { purgeExpiredSignals } from "@/modules/intelligence/retention";
import { INGEST_SOURCES } from "@/lib/ingest/events";

const mockHospitable = vi.mocked(syncHospitable);
const mockFeed = vi.mocked(fetchFeedText);
const mockSuggest = vi.mocked(suggestReply);

const ZERO = {
  properties: 0,
  reservations: 0,
  conversations: 0,
  messages: 0,
  threads: 0,
  skipped: 0,
  propertiesCapped: 0,
  reservationsUnwritable: 0,
  messagesUnimportable: 0,
};

const DAY = 86_400_000;
const icsDate = (d: number) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10).replace(/-/g, "");
function vevent(uid: string, name: string, from: number, to: number, cancelled = false): string {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${icsDate(from)}`,
    `DTEND;VALUE=DATE:${icsDate(to)}`,
    `SUMMARY:${name}`,
    ...(cancelled ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
  ].join("\n");
}
const ics = (...ev: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Airbnb//Hosting Calendar//EN", ...ev, "END:VCALENDAR"].join("\n");
const UID1 = "uid-1@airbnb.com";
const UID2 = "uid-2@airbnb.com";
const FEED_V1 = ics(vevent(UID1, "Ahmet Yilmaz", 5, 9), vevent(UID2, "Jane Doe", 11, 13));
const FEED_V2 = ics(vevent(UID1, "Ahmet Yilmaz", 6, 10), vevent(UID2, "Jane Doe", 11, 13, true)); // uid-1 tarih kaydı, uid-2 iptal

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

function aiResult(over: Partial<SuggestReplyResult> = {}): SuggestReplyResult {
  return {
    intent: "general",
    confidence: 0.9,
    reply: "Hemen ilgileniyoruz.",
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
    ...over,
  };
}

async function addSource(propertyId: string) {
  return prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://example.com/cal.ics", lastSyncedAt: null } });
}
async function addKb(propertyId: string, title = "Wi-Fi", content = "Ağ adı Lixus, şifre dolabın içinde.") {
  const kb = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title, content, language: "tr", isActive: true } });
  // Gerçek damga: hafızanın observedAt'i KB'nin updatedAt'i olmalı (şimdi değil).
  await prisma.$executeRaw`UPDATE "KnowledgeBaseItem" SET "updatedAt" = '2026-01-01T00:00:00Z' WHERE id = ${kb.id}`;
  return kb;
}
async function enableQr(propertyId: string) {
  const token = generateChatToken();
  await prisma.property.update({ where: { id: propertyId }, data: { chatToken: token, chatEnabled: true } });
  const res = await prisma.reservation.create({
    data: { propertyId, guestName: "Misafir", arrivalDate: daysFromNow(-1), departureDate: daysFromNow(2), status: "confirmed", channel: "airbnb" },
  });
  return { token, reservationId: res.id };
}
function chat(token: string, message: string) {
  const req = new Request(`http://localhost/api/chat/${token}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ message }),
  });
  return CHAT_POST(req as never, { params: Promise.resolve({ token }) });
}
function importIcs(propertyId: string, body: string) {
  const form = new FormData();
  form.set("file", new File([body], "rez.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  return IMPORT_POST(new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form }), { params: Promise.resolve({}) });
}
const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const kbCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const events = (orgId: string) => prisma.ingestEvent.findMany({ where: { organizationId: orgId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
const signals = (propertyId: string) => prisma.signal.findMany({ where: { propertyId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
const memories = (propertyId: string) => prisma.propertyMemory.findMany({ where: { propertyId }, orderBy: { createdAt: "asc" } });

describe("V1 ürün akışı — Hospitable'sız kiracı (iCal · elle .ics · QR · KB)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    delete process.env.HOSPITABLE_API_TOKEN;
    delete process.env.PRIMARY_ORG_ID;
    process.env.GUEST_CHAT_ENABLED = "1";
    __resetRateLimit();
    mockHospitable.mockResolvedValue({ ...ZERO } as never);
    mockSuggest.mockResolvedValue(aiResult());
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => {
    restoreEnv();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sözleşme: Lixus-native kaynaklar kapalı kümede ve Hospitable ile aynı event tablosunu kullanır", () => {
    expect(INGEST_SOURCES).toEqual(["hospitable", "ical", "manual_file", "qr_chat"]);
  });

  it("iCal beslemesi → reservation.created (provider ical, bağlantısız) aynı geçişte tüketilir; KB → hafıza (observedAt = KB updatedAt); sinyal yok", async () => {
    await addSource(propertyId);
    const kb = await addKb(propertyId);
    mockFeed.mockResolvedValue(FEED_V1 as never);
    // Org'un Hospitable'ı YOK: token yok, bağlantı yok, env yok.
    expect(await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { hospitableTokenEnc: true } })).toEqual({ hospitableTokenEnc: null });
    expect(await prisma.channelConnection.count({ where: { organizationId: orgId } })).toBe(0);

    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);

    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(2);
    const evs = await events(orgId);
    expect(evs.map((e) => e.kind)).toEqual(["reservation.created", "reservation.created"]);
    expect(evs.every((e) => e.provider === "ical" && e.connectionId === null && e.entityType === "reservation")).toBe(true);
    // Aynı geçişte tüketildi (intelligence bacağı iCal bacağından SONRA koşar).
    expect(evs.every((e) => e.dispatchedAt !== null)).toBe(true);
    expect(await signals(propertyId)).toHaveLength(0);

    const mem = await memories(propertyId);
    expect(mem).toHaveLength(1);
    expect(mem[0]).toMatchObject({ organizationId: orgId, source: "kb_item", sourceRef: kb.id, status: "active", kind: "fact", title: "Wi-Fi" });
    expect(mem[0].observedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("besleme değişince tarih değişikliği + iptal → sinyaller; değişmeyen geçiş hiçbir şey üretmez (yeniden çalıştırma)", async () => {
    await addSource(propertyId);
    await addKb(propertyId);
    mockFeed.mockResolvedValue(FEED_V1 as never);
    await runScheduledSync();
    // Kadans: kaynak tekrar vadesi gelsin.
    await prisma.calendarSource.updateMany({ where: { propertyId }, data: { lastSyncedAt: null } });

    mockFeed.mockResolvedValue(FEED_V2 as never);
    await runScheduledSync();

    const evs = await events(orgId);
    expect(evs.map((e) => e.kind)).toEqual(["reservation.created", "reservation.created", "reservation.updated", "reservation.cancelled"]);
    const updated = evs.find((e) => e.kind === "reservation.updated")!;
    const changed = JSON.parse(updated.changedFieldsJson ?? "[]") as string[];
    expect(changed).toEqual(expect.arrayContaining(["arrivalDate", "departureDate"]));
    expect(changed).not.toContain("guestName"); // ad değişmedi → alan adı listelenmez
    const r1 = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: UID1 } });
    const r2 = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: UID2 } });
    expect(updated.entityId).toBe(r1.id);
    expect(evs.find((e) => e.kind === "reservation.cancelled")!.entityId).toBe(r2.id);
    expect(r2.status).toBe("cancelled");

    const sigs = await signals(propertyId);
    expect(sigs.map((s) => [s.category, s.reservationId, s.source])).toEqual([
      ["date_change", r1.id, "reservation"],
      ["cancellation", r2.id, "reservation"],
    ]);
    const view = await getPropertyMemory(orgId, propertyId);
    expect(view.recentSignals.map((s) => s.category).sort()).toEqual(["cancellation", "date_change"]);
    expect(view.facts).toHaveLength(1);

    // YENİDEN ÇALIŞTIRMA: aynı besleme → satır yazılmaz, event üretilmez, sinyal/hafıza değişmez.
    const memBefore = await memories(propertyId);
    await prisma.calendarSource.updateMany({ where: { propertyId }, data: { lastSyncedAt: null } });
    await runScheduledSync();
    expect((await events(orgId)).length).toBe(4);
    expect(await signals(propertyId)).toHaveLength(2);
    const memAfter = await memories(propertyId);
    expect(memAfter.map((m) => [m.id, m.updatedAt.getTime()])).toEqual(memBefore.map((m) => [m.id, m.updatedAt.getTime()]));
    expect(await prisma.ingestEvent.count({ where: { organizationId: orgId, dispatchedAt: null } })).toBe(0);
  });

  it("QR misafir mesajı → message.received (provider qr_chat) → şikayet sinyali konuşma+rezervasyona bağlı; AI cevabı event/sinyal değil; replay mükerrer üretmez", async () => {
    const { token, reservationId } = await enableQr(propertyId);
    const res = await chat(token, "Sıcak su gelmiyor, duş soğuk! Bu bir şikayet.");
    expect(res.status).toBe(200);

    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    expect(conv.externalReservationId?.startsWith("qr-chat:")).toBe(true);
    const msgs = await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: "asc" } });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const inbound = msgs.find((m) => m.direction === "inbound")!;

    const evs = await events(orgId);
    expect(evs).toHaveLength(1); // yalnız misafir satırı; bot cevabı bizim çıktımız
    expect(evs[0]).toMatchObject({ kind: "message.received", provider: "qr_chat", connectionId: null, entityType: "message", entityId: inbound.id, dispatchedAt: null });

    const totals = await runScheduledSync();
    expect(totals.ok).toBe(true);
    const sigs = await signals(propertyId);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toMatchObject({
      organizationId: orgId,
      source: "guest_message",
      kind: "message.intent",
      category: "complaint",
      sentiment: "negative",
      conversationId: conv.id,
      reservationId,
      sourceEntityId: inbound.id,
      sourceEventId: evs[0].id,
    });
    expect(sigs[0].occurredAt.getTime()).toBe(inbound.createdAt.getTime());

    // REPLAY: damga sıfırlansa bile aynı event ikinci kez sinyal üretmez.
    await prisma.ingestEvent.updateMany({ where: { organizationId: orgId }, data: { dispatchedAt: null } });
    const again = await processIngestEvents({ organizationId: orgId });
    expect(again).toMatchObject({ processed: 1, signals: 0, deduped: 1 });
    expect(await signals(propertyId)).toHaveLength(1);
  });

  it("elle .ics yükleme → reservation.created; STATUS:CANCELLED yüklemesi → reservation.cancelled → iptal sinyali (provider manual_file)", async () => {
    const one = ics(vevent("manual-1@x", "Cem Kaya", 20, 23));
    expect((await importIcs(propertyId, one)).status).toBe(200);
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "manual-1@x" } });
    expect(row.channel).toBe("ics");
    let evs = await events(orgId);
    expect(evs.map((e) => [e.kind, e.provider, e.entityId])).toEqual([["reservation.created", "manual_file", row.id]]);

    // Aynı dosya tekrar → dedupe, event yok.
    expect((await importIcs(propertyId, one)).status).toBe(200);
    expect((await events(orgId)).length).toBe(1);

    const cancel = ics(vevent("manual-1@x", "Cem Kaya", 20, 23, true));
    expect((await importIcs(propertyId, cancel)).status).toBe(200);
    evs = await events(orgId);
    expect(evs.map((e) => e.kind)).toEqual(["reservation.created", "reservation.cancelled"]);
    expect(evs[1].provider).toBe("manual_file");

    await processIngestEvents({ organizationId: orgId });
    const sigs = await signals(propertyId);
    expect(sigs.map((s) => [s.category, s.reservationId])).toEqual([["cancellation", row.id]]);
  });

  it("KİRACI İZOLASYONU: A'nın besleme/QR olayları B'de event, sinyal ya da hafıza üretmez; B'nin okuma yüzeyi A mülkünü görmez", async () => {
    const b = await makeOrgWithProperty();
    await addSource(propertyId);
    await addKb(propertyId);
    mockFeed.mockResolvedValue(FEED_V1 as never);
    await runScheduledSync();
    await prisma.calendarSource.updateMany({ where: { propertyId }, data: { lastSyncedAt: null } });
    mockFeed.mockResolvedValue(FEED_V2 as never);
    await runScheduledSync();
    const { token } = await enableQr(propertyId);
    expect((await chat(token, "Sıcak su gelmiyor, duş soğuk! Bu bir şikayet.")).status).toBe(200);
    await runScheduledSync();

    expect((await signals(propertyId)).length).toBe(3);
    expect(await prisma.ingestEvent.count({ where: { organizationId: b.orgId } })).toBe(0);
    expect(await prisma.signal.count({ where: { organizationId: b.orgId } })).toBe(0);
    expect(await prisma.propertyMemory.count({ where: { organizationId: b.orgId } })).toBe(0);
    expect(await getPropertyMemory(b.orgId, propertyId)).toEqual({ facts: [], patterns: [], recentSignals: [] });
    expect(await getPropertyMemory(b.orgId, b.propertyId)).toEqual({ facts: [], patterns: [], recentSignals: [] });
    // A'nın her sinyali/olayı A'nın org'una damgalı.
    expect((await events(orgId)).every((e) => e.organizationId === orgId)).toBe(true);
    expect((await signals(propertyId)).every((s) => s.organizationId === orgId)).toBe(true);
  });

  it("KB yazma yolları hafızayı ANINDA günceller: POST → aktif, PATCH içerik → güncel, PATCH pasif → retired, tekrar aktif → aktif, DELETE → retired; geçiş tekrarı değiştirmez", async () => {
    const created = await KB_CREATE(
      new NextRequest("http://localhost/api/kb", json({ propertyId, category: "parking", title: "Otopark", content: "Bina altı, 2. kat.", language: "tr", isActive: true })),
      { params: Promise.resolve({}) },
    );
    expect(created.status).toBe(201);
    const kbId = ((await created.json()) as { id: string }).id;
    let mem = await prisma.propertyMemory.findFirstOrThrow({ where: { propertyId, source: "kb_item", sourceRef: kbId } });
    expect(mem).toMatchObject({ status: "active", title: "Otopark", body: "Bina altı, 2. kat.", category: "parking", organizationId: orgId });

    expect((await KB_PATCH(new NextRequest("http://localhost/api/kb/x", { ...json({ content: "Bina altı, 3. kat." }), method: "PATCH" }), kbCtx(kbId))).status).toBe(200);
    mem = await prisma.propertyMemory.findFirstOrThrow({ where: { id: mem.id } });
    expect(mem.body).toBe("Bina altı, 3. kat.");
    expect(mem.status).toBe("active");

    expect((await KB_PATCH(new NextRequest("http://localhost/api/kb/x", { ...json({ isActive: false }), method: "PATCH" }), kbCtx(kbId))).status).toBe(200);
    expect((await prisma.propertyMemory.findFirstOrThrow({ where: { id: mem.id } })).status).toBe("retired");
    expect((await KB_PATCH(new NextRequest("http://localhost/api/kb/x", { ...json({ isActive: true }), method: "PATCH" }), kbCtx(kbId))).status).toBe(200);
    expect((await prisma.propertyMemory.findFirstOrThrow({ where: { id: mem.id } })).status).toBe("active");

    expect((await KB_DELETE(new NextRequest("http://localhost/api/kb/x", { method: "DELETE" }), kbCtx(kbId))).status).toBe(200);
    expect(await prisma.knowledgeBaseItem.count({ where: { id: kbId } })).toBe(0);
    expect((await prisma.propertyMemory.findFirstOrThrow({ where: { id: mem.id } })).status).toBe("retired");

    // Geçiş tekrarı: silinmiş kalem geri gelmez, satır sayısı değişmez (tek satır, retired).
    await runIntelligencePass(orgId);
    const all = await memories(propertyId);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("retired");
    // Okuma yüzeyi retired'ı göstermez.
    expect((await getPropertyMemory(orgId, propertyId)).facts).toEqual([]);
  });

  it("RETENTION: misafir-kaynaklı (QR) sinyal cutoff'tan eskiyse purge edilir; rezervasyon iptali sinyali ve KB hafızası kalır", async () => {
    await addSource(propertyId);
    await addKb(propertyId);
    mockFeed.mockResolvedValue(FEED_V1 as never);
    await runScheduledSync();
    await prisma.calendarSource.updateMany({ where: { propertyId }, data: { lastSyncedAt: null } });
    mockFeed.mockResolvedValue(FEED_V2 as never);
    await runScheduledSync();
    const { token } = await enableQr(propertyId);
    expect((await chat(token, "Sıcak su gelmiyor, duş soğuk! Bu bir şikayet.")).status).toBe(200);
    await runScheduledSync();
    const before = await signals(propertyId);
    expect(before.map((s) => s.source).sort()).toEqual(["guest_message", "reservation", "reservation"]);

    const qr = before.find((s) => s.source === "guest_message")!;
    await prisma.$executeRaw`UPDATE "Signal" SET "occurredAt" = now() - interval '800 days' WHERE id = ${qr.id}`;
    const purged = await purgeExpiredSignals(new Date(Date.now() - 30 * DAY));
    expect(purged.deleted).toBe(1);
    const after = await signals(propertyId);
    expect(after.map((s) => s.source).sort()).toEqual(["reservation", "reservation"]);
    expect(await prisma.propertyMemory.count({ where: { propertyId, status: "active" } })).toBe(1);
  });
});
