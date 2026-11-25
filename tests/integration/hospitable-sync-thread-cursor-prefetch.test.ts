import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// HOSPITABLE SENKRONU — "THREAD GÜNCEL Mİ?" OKUMASI İLAN BAŞINA TOPLU (O1 optimizasyonu, 11-19).
//
// Senkron her 2 dakikada pencerendeki mesajlı HER rezervasyon için konuşmanın imlecini (`syncCursorAt`) tek tek okuyordu (rezervasyon
// başına bir SQL). Artık ilanın rezervasyon listesi geldiğinde konuşmalar TEK sorguda okunur; her kayıt EN ÇOK BİR KEZ kullanılır:
// sağlayıcı aynı rezervasyonu listede iki kez döndürebilir (ingest varsayımı 1) — ikinci geçişte konuşma bu koşuda yazılmış olabileceği
// için tek tek okumaya düşülür (eski yolla aynı sonuç: ilk geçiş içe aktarır, ikincisi "güncel" der, API'ye ikinci istek gitmez).
// Toplu okuma düşerse hepsi tek tek okunur (`hospitable-sync-thread-cursor-prefetch-db-failure.test.ts`).
// ---------------------------------------------------------------------------

const counter = vi.hoisted(() => ({ on: false, rows: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on(e: string, cb: (e: { query: string }) => void): void }).$on("query", (e) => {
    if (counter.on) counter.rows.push(e.query);
  });
  return { prisma: client };
});
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { beginQueryCount, flushQueryEvents } from "../helpers/query-event-barrier";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const TOKEN = "tok-prefetch";
const HP = "hp-prefetch";
const fake = new FakeIngestProvider();
const ARR = daysFromNow(5);
const DEP = daysFromNow(9);

const res = (n: number, lastMessageAt: Date) =>
  canonicalReservation({
    externalId: `res-${n}`,
    code: `HM${n}`,
    arrivalDate: ARR,
    departureDate: DEP,
    guest: { externalId: `g-${n}`, name: `Misafir ${n}`, email: null, phone: null },
    conversationExternalId: `conv-${n}`,
    lastMessageAt,
  });
const msg = (n: number, k: number, at: Date) => canonicalMessage({ externalId: `m-${n}-${k}`, createdAt: at, body: `Soru ${n}.${k}` });

async function setup() {
  const { orgId } = await makeOrgWithProperty();
  await setOrgHospitableToken(orgId, TOKEN, null);
  fake.addProperty(TOKEN, HP, "Test Property");
  return orgId;
}
const conversationReads = () => counter.rows.filter((q) => /^\s*SELECT/i.test(q) && /FROM\s+"public"\."Conversation"/i.test(q));
const messageFetches = (ext: string) => fake.requests.filter((r) => r.op === "messages" && r.arg === ext).length;

describe("syncHospitable — thread imleci ilan başına toplu okunur", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    resetPrimaryOrgCache();
  });

  it("🚨 6 mesajlı rezervasyon, hepsi güncel (senkronun olağan hâli): konuşma okuması TEK sorgu (eskiden rezervasyon başına bir)", async () => {
    const orgId = await setup();
    const t = new Date("2026-05-30T10:00:00Z");
    const list = Array.from({ length: 6 }, (_, n) => res(n, t));
    fake.setReservations(HP, list);
    for (let n = 0; n < 6; n++) fake.setMessages(`res-${n}`, [msg(n, 1, t)]);
    const first = await syncHospitable(orgId);
    expect(first).toMatchObject({ conversations: 6, messages: 6 });

    await beginQueryCount(prisma, counter); // önceki sorguların geç olayları ölçüme karışmasın (11-25)
    const again = await syncHospitable(orgId);
    await flushQueryEvents(prisma, counter); // son sorgunun olayı sonuçtan sonra gelebilir (CI 1841)
    counter.on = false;
    expect(again).toMatchObject({ threads: 6, skipped: 6, conversations: 0, messages: 0 });
    expect(conversationReads()).toHaveLength(1);
  });

  it("aşırı uygulama yok: sağlayıcı AYNI rezervasyonu iki kez döndürür → ilki içe aktarır, ikincisi güncel sayılır, mesaj API'si BİR kez", async () => {
    const orgId = await setup();
    const t1 = new Date("2026-05-30T10:00:00Z");
    fake.setReservations(HP, [res(1, t1)]);
    fake.setMessages("res-1", [msg(1, 1, t1)]);
    await syncHospitable(orgId);

    // Yeni mesaj geldi; sağlayıcı rezervasyonu listede İKİ kez döndürüyor.
    const t2 = new Date("2026-05-30T11:00:00Z");
    fake.setReservations(HP, [res(1, t2), res(1, t2)]);
    fake.setMessages("res-1", [msg(1, 1, t1), msg(1, 2, t2)]);
    fake.requests.length = 0;
    const r = await syncHospitable(orgId);
    expect(r).toMatchObject({ threads: 2, conversations: 1, messages: 1, skipped: 1 });
    expect(messageFetches("res-1")).toBe(1);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { externalReservationId: "res-1" } });
    expect(conv.syncCursorAt?.toISOString()).toBe(t2.toISOString());
  });

  it("karışık liste: yeni thread, güncel thread ve yeni mesajlı thread aynı ilanda — sonuçlar ve API istekleri eskisiyle aynı", async () => {
    const orgId = await setup();
    const t1 = new Date("2026-05-30T10:00:00Z");
    fake.setReservations(HP, [res(1, t1), res(2, t1)]);
    fake.setMessages("res-1", [msg(1, 1, t1)]);
    fake.setMessages("res-2", [msg(2, 1, t1)]);
    await syncHospitable(orgId);

    const t2 = new Date("2026-05-30T12:00:00Z");
    fake.setReservations(HP, [res(1, t1), res(2, t2), res(3, t2)]); // 1 güncel · 2 yeni mesaj · 3 yeni thread
    fake.setMessages("res-2", [msg(2, 1, t1), msg(2, 2, t2)]);
    fake.setMessages("res-3", [msg(3, 1, t2)]);
    fake.requests.length = 0;
    const r = await syncHospitable(orgId);
    expect(r).toMatchObject({ threads: 3, skipped: 1, conversations: 2, messages: 2 });
    expect([messageFetches("res-1"), messageFetches("res-2"), messageFetches("res-3")]).toEqual([0, 1, 1]);
  });

  it("güncel ama bağsız konuşma: rezervasyon bağı toplu okumayla da geri doldurulur (çit geri alınır)", async () => {
    const orgId = await setup();
    const t = new Date("2026-05-30T10:00:00Z");
    fake.setReservations(HP, [res(1, t)]);
    fake.setMessages("res-1", [msg(1, 1, t)]);
    await syncHospitable(orgId);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { externalReservationId: "res-1" } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { reservationId: null, skippedReason: "reservation_ended" } });
    await syncHospitable(orgId);
    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(after.reservationId).not.toBeNull();
    expect(after.skippedReason).toBeNull();
  });
});
