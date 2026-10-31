import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// V0.6 — INGEST WRITE SERVICE davranışsal testleri. Sağlayıcı = ortak ingest fake'i
// (`__setIngestAdapterForTest`), yazma yolu GERÇEK: `syncHospitable` → adaptör →
// canonical → write service → Postgres (+ aynı TX'te IngestEvent). Kapsam (kurucu
// talimatı): yinelenen · sırası değişmiş · yeniden oynatılan olaylar; rezervasyon
// değişikliği/iptali; kiracı sınırı; silme tombstone'u; provenance doğruluğu.
// ⚠️ Fake gerçek sağlayıcı DEĞİLDİR; fake'in varsayımları gerçek adaptöre HTTP
// stub'ıyla pinli (unit/ingest-adapter-conformance) — canlı doğrulama değildir.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { getConnection } from "@/lib/channels/connections";
import { describeProvenance } from "@/lib/channels/provenance";
import { eraseReservationData } from "@/lib/erasure";

const TOKEN_A = "tok-org-A";
const TOKEN_B = "tok-org-B";
const HP_A = "hp-A";
const HP_B = "hp-B";
const fake = new FakeIngestProvider();

const ORIGINAL_ENV = {
  PRIMARY_ORG_ID: process.env.PRIMARY_ORG_ID,
  HOSPITABLE_API_TOKEN: process.env.HOSPITABLE_API_TOKEN,
};
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrimaryOrgCache();
}

// Tarihler MODÜL düzeyinde sabit: her çağrıda yeniden hesaplanan `daysFromNow` milisaniye
// farkıyla "değişmiş" görünür ve sahte reservation.updated üretirdi (gerçek sağlayıcı
// YYYY-MM-DD verir, kararlıdır).
const ARR = daysFromNow(5);
const DEP = daysFromNow(9);
const R1 = (over: Record<string, unknown> = {}) =>
  canonicalReservation({
    externalId: "res-1",
    code: "HM1",
    arrivalDate: ARR,
    departureDate: DEP,
    conversationExternalId: "conv-1",
    conversationLanguage: "en",
    lastMessageAt: new Date("2026-05-30T10:00:00Z"),
    ...over,
  });
const m = (id: string, at: string, over: Record<string, unknown> = {}) =>
  canonicalMessage({ externalId: id, createdAt: new Date(at), body: `mesaj ${id}`, ...over });
const M1 = m("m-1", "2026-05-30T09:00:00Z");
const M2 = m("m-2", "2026-05-30T10:00:00Z", { direction: "outbound", senderName: "Ev Sahibi" });

async function seedOrgA() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await setOrgHospitableToken(orgId, TOKEN_A, "A");
  fake.addProperty(TOKEN_A, HP_A, "Test Property"); // linkProperty adla eşler
  const conn = await getConnection(orgId, "hospitable");
  return { orgId, propertyId, connId: conn!.id };
}
const events = (orgId: string) =>
  prisma.ingestEvent.findMany({ where: { organizationId: orgId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
const kinds = async (orgId: string) => (await events(orgId)).map((e) => e.kind).sort();
const rows = async (propertyId: string, ref = "res-1") => {
  const reservation = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: ref } });
  const conversation = await prisma.conversation.findFirst({
    where: { propertyId, externalReservationId: ref },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return { reservation, conversation, messages: conversation?.messages ?? [] };
};

describe("V0.6 ingest write service (fake adaptör → gerçek yazma yolu)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => {
    __setIngestAdapterForTest("hospitable", null);
    restoreEnv();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ilk ingest: rezervasyon + konuşma + mesajlar 'ingest' provenance'ıyla doğar; aynı TX'te PII'siz event'ler (created ×2, imported ×2), bağlantı damgalı", async () => {
    const { orgId, propertyId, connId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [M1, M2]);

    const r = await syncHospitable(orgId);
    expect(r).toMatchObject({ properties: 1, reservations: 1, conversations: 1, messages: 2, threads: 1 });

    const { reservation, conversation, messages } = await rows(propertyId);
    for (const x of [reservation, conversation!, ...messages]) expect(describeProvenance(x)).toBe("ingest");
    expect(messages.map((x) => x.externalId)).toEqual(["m-1", "m-2"]);
    expect(conversation!.status).toBe("answered"); // host son konuştu

    const ev = await events(orgId);
    expect(ev.map((e) => e.kind).sort()).toEqual(["conversation.created", "message.imported", "message.imported", "reservation.created"]);
    for (const e of ev) {
      expect(e.connectionId).toBe(connId);
      expect(e.provider).toBe("hospitable");
      expect(e.schemaVersion).toBe(1);
      expect(Object.keys(e)).not.toContain("body"); // PII'siz: metin/ad/sağlayıcı kimliği yok
    }
    expect(ev.find((e) => e.kind === "reservation.created")!.entityId).toBe(reservation.id);
  });

  it("REPLAY: aynı batch ikinci kez → yeni satır YOK, yeni event YOK (source-scoped idempotency)", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [M1, M2]);
    await syncHospitable(orgId);
    const before = { events: (await events(orgId)).length, messages: await prisma.message.count(), reservations: await prisma.reservation.count() };
    const first = await rows(propertyId);

    const r = await syncHospitable(orgId);
    expect(r.messages).toBe(0);
    expect((await events(orgId)).length).toBe(before.events);
    expect(await prisma.message.count()).toBe(before.messages);
    expect(await prisma.reservation.count()).toBe(before.reservations);
    const again = await rows(propertyId);
    expect(again.reservation.ingestedAt?.getTime()).toBe(first.reservation.ingestedAt?.getTime());
    expect(again.reservation.updatedAt.getTime()).toBe(first.reservation.updatedAt.getTime()); // değişmeyen senkron yazmaz
  });

  it("BATCH İÇİ TEKRAR: aynı rezervasyon iki kez, aynı mesaj iki kez → tek satır, tek event", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1(), R1()]);
    fake.setMessages("res-1", [M1, M1, M2]);
    await syncHospitable(orgId);
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1);
    expect(await prisma.conversation.count({ where: { propertyId } })).toBe(1);
    const { messages } = await rows(propertyId);
    expect(messages.map((x) => x.externalId)).toEqual(["m-1", "m-2"]);
    expect(await kinds(orgId)).toEqual(["conversation.created", "message.imported", "message.imported", "reservation.created"]);
  });

  it("SIRASI DEĞİŞMİŞ mesajlar: sağlayıcı sırası karışık → kronolojik saklanır, durum son mesajdan; sonraki batch'te GEÇ GELEN ESKİ mesaj da alınır", async () => {
    const { orgId, propertyId } = await seedOrgA();
    const M3 = m("m-3", "2026-05-30T11:00:00Z");
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-05-30T11:00:00Z") })]);
    fake.setMessages("res-1", [M3, M1, M2]); // karışık
    await syncHospitable(orgId);
    let { conversation, messages } = await rows(propertyId);
    expect(messages.map((x) => x.externalId)).toEqual(["m-1", "m-2", "m-3"]);
    expect(conversation!.status).toBe("new"); // kronolojik son = misafir (m-3)
    expect(conversation!.syncCursorAt?.toISOString()).toBe("2026-05-30T11:00:00.000Z");

    // İkinci batch: yeni m-4 + daha önce hiç gelmemiş ESKİ m-0 (sağlayıcı geç düşürdü)
    const M0 = m("m-0", "2026-05-30T08:00:00Z");
    const M4 = m("m-4", "2026-05-30T12:00:00Z");
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-05-30T12:00:00Z") })]);
    fake.setMessages("res-1", [M4, M0, M3, M1, M2]);
    const r = await syncHospitable(orgId);
    expect(r.messages).toBe(2);
    ({ conversation, messages } = await rows(propertyId));
    expect(messages.map((x) => x.externalId)).toEqual(["m-0", "m-1", "m-2", "m-3", "m-4"]);
    expect((await events(orgId)).filter((e) => e.kind === "message.imported")).toHaveLength(5);
    expect((await events(orgId)).filter((e) => e.kind === "conversation.updated")).toHaveLength(1);
  });

  it("DEĞİŞİKLİK: çıkış tarihi değişince satır güncellenir + reservation.updated; maskelenen misafir adı GERİLETİLMEZ ve event ÜRETMEZ", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    await syncHospitable(orgId);

    const newOut = daysFromNow(10);
    fake.setReservations(HP_A, [R1({ departureDate: newOut })]);
    await syncHospitable(orgId);
    let { reservation } = await rows(propertyId);
    expect(reservation.departureDate.getTime()).toBe(newOut.getTime());
    expect(await kinds(orgId)).toEqual(["reservation.created", "reservation.updated"]);

    // Sağlayıcı misafiri maskeledi (ad/e-posta null) → ad korunur, değişiklik yok → event yok
    fake.setReservations(HP_A, [R1({ departureDate: newOut, guest: { externalId: "g-1", name: null, email: null, phone: null } })]);
    await syncHospitable(orgId);
    ({ reservation } = await rows(propertyId));
    expect(reservation.guestName).toBe("Alex Guest");
    expect(await kinds(orgId)).toEqual(["reservation.created", "reservation.updated"]);
  });

  it("İPTAL: status cancelled + terminal → satır cancelled, reservation.cancelled event'i (updated değil); tekrar oynatma ikinci event üretmez", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    await syncHospitable(orgId);
    fake.setReservations(HP_A, [R1({ status: "cancelled", terminal: true })]);
    await syncHospitable(orgId);
    const { reservation } = await rows(propertyId);
    expect(reservation.status).toBe("cancelled");
    expect(await kinds(orgId)).toEqual(["reservation.cancelled", "reservation.created"]);
    await syncHospitable(orgId);
    expect(await kinds(orgId)).toEqual(["reservation.cancelled", "reservation.created"]);
  });

  it("KİRACI SINIRI: B org'unun token'ı yalnız kendi mülkünü görür; A'nın senkronu B'nin satırına, B'ninki A'nınkine dokunmaz; event'ler org-kapsamlı", async () => {
    const a = await seedOrgA();
    const b = await makeOrgWithProperty();
    await setOrgHospitableToken(b.orgId, TOKEN_B, "B");
    fake.addProperty(TOKEN_B, HP_B, "Test Property");
    fake.setReservations(HP_A, [R1()]);
    fake.setReservations(HP_B, [canonicalReservation({ externalId: "res-B", arrivalDate: daysFromNow(5), departureDate: daysFromNow(9) })]);

    await syncHospitable(a.orgId);
    expect(await prisma.reservation.count({ where: { property: { organizationId: a.orgId } } })).toBe(1);
    expect(await prisma.reservation.count({ where: { property: { organizationId: b.orgId } } })).toBe(0);
    await syncHospitable(b.orgId);
    expect(await prisma.reservation.findFirst({ where: { property: { organizationId: b.orgId } }, select: { sourceReference: true } })).toEqual({ sourceReference: "res-B" });
    expect(await prisma.reservation.count({ where: { property: { organizationId: a.orgId } } })).toBe(1);
    expect((await events(a.orgId)).every((e) => e.organizationId === a.orgId)).toBe(true);
    expect((await events(b.orgId)).map((e) => e.kind)).toEqual(["reservation.created"]);
    // Fake'te HP_A'yı yalnız TOKEN_A görür: B'nin senkronu A'nın mülkünü hiç istememiş olmalı
    expect(fake.requests.filter((q) => q.op === "reservations" && q.arg === HP_A).every((q) => q.token === TOKEN_A)).toBe(true);
  });

  it("TOMBSTONE: silinen rezervasyon replay'de GERİ GELMEZ — yeni mesajı bile alınmaz, event yok; başka rezervasyon normal akar", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [M1]);
    await syncHospitable(orgId);
    const { reservation, conversation } = await rows(propertyId);
    await eraseReservationData(orgId, reservation.id);
    const eventsAfterErase = (await events(orgId)).length;
    const messagesAfterErase = await prisma.message.count({ where: { conversation: { propertyId } } });

    // Sağlayıcı aynı konaklamayı YENİ bir misafir mesajıyla tekrar oynatır.
    fake.setReservations(HP_A, [
      R1({ lastMessageAt: new Date("2026-05-30T12:00:00Z") }),
      canonicalReservation({ externalId: "res-2", arrivalDate: daysFromNow(20), departureDate: daysFromNow(22) }),
    ]);
    fake.setMessages("res-1", [M1, m("m-9", "2026-05-30T12:00:00Z")]);
    const r = await syncHospitable(orgId);
    expect(r.skipped).toBe(1); // yalnız res-1 tombstone'dan atlandı
    expect(r.messages).toBe(0);
    expect(await prisma.message.count({ where: { conversation: { propertyId } } })).toBe(messagesAfterErase); // m-9 GİRMEDİ
    if (conversation) {
      const conv = await prisma.conversation.findUnique({ where: { id: conversation.id }, include: { messages: true } });
      expect(conv?.messages.some((x) => x.externalId === "m-9") ?? false).toBe(false);
    }
    const res1 = await prisma.reservation.findFirst({ where: { propertyId, sourceReference: "res-1" } });
    if (res1) expect(res1.guestName).not.toBe("Alex Guest"); // maskeli kaldıysa PII geri yazılmadı
    expect(await prisma.reservation.count({ where: { propertyId, sourceReference: "res-2" } })).toBe(1);
    const newEvents = (await events(orgId)).slice(eventsAfterErase);
    expect(newEvents.map((e) => e.kind)).toEqual(["reservation.created"]); // yalnız res-2
  });

  it("PROVENANCE: env fallback ile alınan satır 'unbound'; DB bağlantısı gelince gözlemlenen satır 'observed', yeni satır 'ingest'; event'ler bağlantıyı doğru taşır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    process.env.PRIMARY_ORG_ID = orgId;
    process.env.HOSPITABLE_API_TOKEN = "env-token";
    resetPrimaryOrgCache();
    fake.addProperty("env-token", HP_A, "Test Property");
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [M1]);
    await syncHospitable(orgId);
    let { reservation, messages } = await rows(propertyId);
    expect(describeProvenance(reservation)).toBe("unbound");
    expect(describeProvenance(messages[0])).toBe("unbound");
    expect((await events(orgId)).every((e) => e.connectionId === null)).toBe(true);

    await setOrgHospitableToken(orgId, TOKEN_A, "A");
    const conn = await getConnection(orgId, "hospitable");
    fake.addProperty(TOKEN_A, HP_A, "Test Property");
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-05-30T11:00:00Z") })]);
    fake.setMessages("res-1", [M1, m("m-3", "2026-05-30T11:00:00Z")]);
    await syncHospitable(orgId);
    ({ reservation, messages } = await rows(propertyId));
    expect(describeProvenance(reservation)).toBe("observed");
    expect(describeProvenance(messages.find((x) => x.externalId === "m-1")!)).toBe("unbound"); // mesaj satırı yeniden yazılmaz
    expect(describeProvenance(messages.find((x) => x.externalId === "m-3")!)).toBe("ingest");
    const late = (await events(orgId)).filter((e) => e.connectionId === conn!.id).map((e) => e.kind).sort();
    expect(late).toEqual(["conversation.updated", "message.imported"]);
  });

  it("GÖVDESİZ mesaj: satır yok, event yok, messagesUnimportable sayar", async () => {
    const { orgId, propertyId } = await seedOrgA();
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [M1, m("m-x", "2026-05-30T10:30:00Z", { body: null })]);
    const r = await syncHospitable(orgId);
    expect(r.messagesUnimportable).toBe(1);
    const { messages } = await rows(propertyId);
    expect(messages.map((x) => x.externalId)).toEqual(["m-1"]);
    expect((await events(orgId)).filter((e) => e.kind === "message.imported")).toHaveLength(1);
  });
});
