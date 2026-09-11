import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";

// ---------------------------------------------------------------------------
// V1 — Property Memory + Signals: IngestEvent TÜKETİCİSİ davranışsal testleri.
// Olaylar GERÇEK yoldan üretilir (fake ingest adaptörü → syncHospitable → write service →
// IngestEvent), sonra `processIngestEvents` tüketir. Kapsam (kurucu talimatı): tekrar işleme
// (aynı olay ikinci kez → mükerrer YOK), sırasız olay, yarıda kalıp yeniden başlama,
// iptal/değişiklik, silme-retention, kiracı/mülk kapsamı, zaman bilgisi (occurredAt gerçek).
// ⚠️ Fake ≠ canlı; Lale'nin akışı donukken bu sonuçlar canlı doğrulama DEĞİLDİR.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { eraseReservationData } from "@/lib/erasure";
import { processIngestEvents, __intelligenceHooks } from "@/modules/intelligence/consumer";
import { bootstrapMemoryFromKnowledgeBase } from "@/modules/intelligence/memory/bootstrap";
import { refreshPatternMemory, PATTERN_MIN_SIGNALS } from "@/modules/intelligence/memory/patterns";
import { purgeExpiredSignals } from "@/modules/intelligence/retention";
import { getPropertyMemory } from "@/modules/intelligence/memory/read";

const TOKEN_A = "tok-org-A";
const TOKEN_B = "tok-org-B";
const HP_A = "hp-A";
const HP_B = "hp-B";
const fake = new FakeIngestProvider();
const ARR = daysFromNow(5);
const DEP = daysFromNow(9);
const DEP2 = daysFromNow(10); // sabit: her çağrıda yeniden hesaplanan tarih ms farkıyla 'değişti' sayılır

const ORIGINAL_ENV = { PRIMARY_ORG_ID: process.env.PRIMARY_ORG_ID, HOSPITABLE_API_TOKEN: process.env.HOSPITABLE_API_TOKEN };
function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrimaryOrgCache();
}

const R1 = (over: Record<string, unknown> = {}) =>
  canonicalReservation({
    externalId: "res-1",
    code: "HM1",
    arrivalDate: ARR,
    departureDate: DEP,
    conversationExternalId: "conv-1",
    conversationLanguage: "tr",
    lastMessageAt: new Date("2026-05-30T10:00:00Z"),
    ...over,
  });
const m = (id: string, at: string, body: string, over: Record<string, unknown> = {}) =>
  canonicalMessage({ externalId: id, createdAt: new Date(at), body, ...over });
const COMPLAINT = m("m-1", "2026-05-30T09:00:00Z", "Sıcak su gelmiyor, duş soğuk! Bu bir şikayet.");
// Host cevabı BİLEREK şikayet kelimeleri taşır: yön/yazar kontrolü olmasa kelime ağı sinyal üretirdi.
const HOST_REPLY = m("m-2", "2026-05-30T10:00:00Z", "Şikayetiniz için üzgünüz, sıcak su sorunu çözüldü.", { direction: "outbound", senderName: "Ev Sahibi" });
const GENERAL = m("m-3", "2026-05-30T11:00:00Z", "Teşekkürler, iyi günler.");

async function seedOrg(token: string, hp: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await setOrgHospitableToken(orgId, token, "A");
  fake.addProperty(token, hp, "Test Property");
  return { orgId, propertyId };
}
const signals = (propertyId: string) =>
  prisma.signal.findMany({ where: { propertyId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
const pendingEvents = (orgId: string) => prisma.ingestEvent.count({ where: { organizationId: orgId, dispatchedAt: null } });

describe("V1 intelligence — IngestEvent tüketicisi", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    __intelligenceHooks.afterEvent = null;
  });
  afterEach(() => {
    __setIngestAdapterForTest("hospitable", null);
    __intelligenceHooks.afterEvent = null;
    restoreEnv();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("misafir şikayeti → negatif sinyal (kategori complaint, occurredAt = mesajın gerçek zamanı, kaynak event/id); host cevabı ve 'general' mesaj sinyal üretmez; event'ler damgalanır", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [COMPLAINT, HOST_REPLY, GENERAL]);
    await syncHospitable(orgId);
    expect(await pendingEvents(orgId)).toBeGreaterThan(0);

    const r = await processIngestEvents({ organizationId: orgId });
    expect(r.processed).toBeGreaterThan(0);
    expect(await pendingEvents(orgId)).toBe(0);

    const s = await signals(propertyId);
    expect(s).toHaveLength(1);
    const msg = await prisma.message.findFirstOrThrow({ where: { externalId: "m-1" } });
    expect(s[0]).toMatchObject({
      organizationId: orgId,
      propertyId,
      source: "guest_message",
      kind: "message.intent",
      category: "complaint",
      sentiment: "negative",
      sourceEntityType: "message",
      sourceEntityId: msg.id,
      conversationId: msg.conversationId,
    });
    expect(s[0].severity).toBeGreaterThan(0.5);
    expect(s[0].confidence).toBeLessThan(1);
    expect(s[0].occurredAt.getTime()).toBe(new Date("2026-05-30T09:00:00Z").getTime()); // mesaj zamanı, işleme zamanı DEĞİL
    expect(s[0].sourceEventId).toBeTruthy();
    expect(Object.keys(s[0])).not.toContain("body"); // PII'siz
  });

  it("🚨 TEKRAR İŞLEME: aynı olaylar ikinci kez işlenince (damga sıfırlansa bile) mükerrer sinyal YOK", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [COMPLAINT]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    const before = (await signals(propertyId)).map((x) => x.id);
    await prisma.ingestEvent.updateMany({ where: { organizationId: orgId }, data: { dispatchedAt: null } });
    const r = await processIngestEvents({ organizationId: orgId });
    expect(r.signals).toBe(0);
    expect((await signals(propertyId)).map((x) => x.id)).toEqual(before);
    // Ve senkron replay'i de (yeni event yok) sinyal üretmez.
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    expect(await signals(propertyId)).toHaveLength(before.length);
  });

  it("SIRASIZ OLAY: event zamanları ters çevrilse de sinyal kümesi ve occurredAt (mesaj zamanı) AYNI", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    const C2 = m("m-9", "2026-05-31T09:00:00Z", "Klima çalışmıyor, çok sıcak, şikayet ediyorum.");
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-05-31T09:00:00Z") })]);
    fake.setMessages("res-1", [COMPLAINT, C2]);
    await syncHospitable(orgId);
    const evs = await prisma.ingestEvent.findMany({ where: { organizationId: orgId, kind: "message.imported" }, orderBy: { occurredAt: "asc" } });
    expect(evs.length).toBe(2);
    // Sağlayıcı sırasını boz: ilk event'i en sona at.
    await prisma.ingestEvent.update({ where: { id: evs[0].id }, data: { occurredAt: new Date(evs[1].occurredAt.getTime() + 60_000) } });
    await processIngestEvents({ organizationId: orgId });
    const s = await signals(propertyId);
    expect(s.map((x) => x.occurredAt.toISOString())).toEqual(["2026-05-30T09:00:00.000Z", "2026-05-31T09:00:00.000Z"]);
    expect(s.map((x) => x.category)).toEqual(["complaint", "complaint"]);
  });

  it("🚨 YARIDA KALMA: ilk olaydan sonra çöken tüketici yeniden başlayınca kaldığı yerden bitirir; mükerrer yok, damgasız event kalmaz", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    const C2 = m("m-9", "2026-05-31T09:00:00Z", "Klima çalışmıyor, çok sıcak, şikayet ediyorum.");
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-05-31T09:00:00Z") })]);
    fake.setMessages("res-1", [COMPLAINT, C2]);
    await syncHospitable(orgId);
    const total = await pendingEvents(orgId);
    let seen = 0;
    __intelligenceHooks.afterEvent = async () => {
      seen++;
      if (seen === 1) throw new Error("simulated crash after first event");
    };
    await expect(processIngestEvents({ organizationId: orgId })).rejects.toThrow(/simulated crash/);
    const mid = await pendingEvents(orgId);
    expect(mid).toBe(total - 1);
    __intelligenceHooks.afterEvent = null;
    await processIngestEvents({ organizationId: orgId });
    expect(await pendingEvents(orgId)).toBe(0);
    expect(await signals(propertyId)).toHaveLength(2);
  });

  it("İPTAL / DEĞİŞİKLİK: iptal → cancellation sinyali; çıkış tarihi değişince date_change; ad değişikliği sinyal ÜRETMEZ; replay ikinci sinyal üretmez", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    fake.setReservations(HP_A, [R1({ lastMessageAt: null })]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    expect(await signals(propertyId)).toHaveLength(0); // created tek başına sinyal değil

    fake.setReservations(HP_A, [R1({ lastMessageAt: null, departureDate: DEP2 })]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    let s = await signals(propertyId);
    expect(s.map((x) => x.category)).toEqual(["date_change"]);
    expect(s[0]).toMatchObject({ source: "reservation", kind: "reservation.dates_changed", sourceEntityType: "reservation" });
    const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
    expect(s[0].reservationId).toBe(res.id);

    fake.setReservations(HP_A, [R1({ lastMessageAt: null, departureDate: DEP2, guest: { externalId: "guest-1", name: "Alex G.", email: null, phone: null } })]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    expect((await signals(propertyId)).map((x) => x.category)).toEqual(["date_change"]); // ad → sinyal yok

    fake.setReservations(HP_A, [R1({ lastMessageAt: null, departureDate: DEP2, status: "cancelled", terminal: true })]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    s = await signals(propertyId);
    expect(s.map((x) => x.category).sort()).toEqual(["cancellation", "date_change"]);
    await syncHospitable(orgId); // replay
    await processIngestEvents({ organizationId: orgId });
    expect(await signals(propertyId)).toHaveLength(2);
  });

  it("KİRACI/MÜLK KAPSAMI: A ve B'nin olayları yalnız kendi mülklerine sinyal üretir; org filtresiyle işleme diğerine dokunmaz", async () => {
    const a = await seedOrg(TOKEN_A, HP_A);
    const b = await seedOrg(TOKEN_B, HP_B);
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [COMPLAINT]);
    fake.setReservations(HP_B, [canonicalReservation({ externalId: "res-b", arrivalDate: ARR, departureDate: DEP, conversationExternalId: "conv-b", lastMessageAt: new Date("2026-05-30T10:00:00Z") })]);
    fake.setMessages("res-b", [m("mb-1", "2026-05-30T09:30:00Z", "Wifi şifresi nedir?")]);
    await syncHospitable(a.orgId);
    await syncHospitable(b.orgId);

    await processIngestEvents({ organizationId: a.orgId });
    expect(await pendingEvents(b.orgId)).toBeGreaterThan(0); // B'ye dokunulmadı
    expect(await signals(b.propertyId)).toHaveLength(0);
    await processIngestEvents({ organizationId: b.orgId });
    const sa = await signals(a.propertyId);
    const sb = await signals(b.propertyId);
    expect(sa.map((x) => x.category)).toEqual(["complaint"]);
    expect(sb.map((x) => x.category)).toEqual(["wifi"]);
    expect(sa.every((x) => x.organizationId === a.orgId)).toBe(true);
    expect(sb.every((x) => x.organizationId === b.orgId)).toBe(true);
  });

  it("SİLME/RETENTION: erasure sonrası sinyal PII'siz kalır; retention sinyali eşikten eskiyse purge eder, KB hafızasına dokunmaz", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    fake.setReservations(HP_A, [R1()]);
    fake.setMessages("res-1", [COMPLAINT]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    // KB kalemi ESKİ (cutoff'tan önce): retention yalnız misafir-kaynaklı sinyali silmeli, hafızayı DEĞİL.
    await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "wifi", title: "Wifi", content: "Ağ: Lixus, şifre dolapta", isActive: true, updatedAt: new Date("2026-01-01T00:00:00Z") } });
    await bootstrapMemoryFromKnowledgeBase(orgId);

    const res = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: "res-1" } });
    await eraseReservationData(orgId, res.id);
    const after = await signals(propertyId);
    expect(after).toHaveLength(1);
    expect(JSON.stringify(after[0])).not.toMatch(/Sıcak su|Alex/); // metin/ad yok

    const purged = await purgeExpiredSignals(new Date("2026-06-01T00:00:00Z")); // sinyal 05-30 → eski
    expect(purged.deleted).toBe(1);
    expect(await signals(propertyId)).toHaveLength(0);
    expect(await prisma.propertyMemory.count({ where: { propertyId, source: "kb_item" } })).toBe(1);
  });
});

describe("V1 intelligence — hafıza", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    restoreEnv();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => __setIngestAdapterForTest("hospitable", null));

  it("KB'den başlangıç hafızası: kaynak kb_item, observedAt = KB'nin gerçek updatedAt'i (şimdi DEĞİL), idempotent, pasif kalem retired, kiracı-kapsamlı", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    const kb = await prisma.knowledgeBaseItem.create({
      data: { propertyId: a.propertyId, category: "checkin", title: "Giriş", content: "Kapı kodu resepsiyonda", isActive: true, updatedAt: new Date("2026-03-01T12:00:00Z") },
    });
    await prisma.knowledgeBaseItem.create({ data: { propertyId: b.propertyId, category: "rules", title: "Kurallar", content: "Parti yok", isActive: true } });

    const r1 = await bootstrapMemoryFromKnowledgeBase(a.orgId);
    expect(r1).toMatchObject({ created: 1, updated: 0, retired: 0 });
    const mem = await prisma.propertyMemory.findFirstOrThrow({ where: { propertyId: a.propertyId } });
    expect(mem).toMatchObject({ source: "kb_item", sourceRef: kb.id, kind: "fact", category: "checkin", confidence: 1, status: "active" });
    expect(mem.observedAt.getTime()).toBe(new Date("2026-03-01T12:00:00Z").getTime());
    expect(JSON.parse(mem.evidenceJson)).toEqual([{ type: "kb_item", id: kb.id }]);
    expect(await prisma.propertyMemory.count({ where: { propertyId: b.propertyId } })).toBe(0); // B'ye dokunulmadı

    const r2 = await bootstrapMemoryFromKnowledgeBase(a.orgId);
    expect(r2).toMatchObject({ created: 0, updated: 0, retired: 0 });
    await prisma.knowledgeBaseItem.update({ where: { id: kb.id }, data: { isActive: false } });
    const r3 = await bootstrapMemoryFromKnowledgeBase(a.orgId);
    expect(r3.retired).toBe(1);
    expect((await prisma.propertyMemory.findUniqueOrThrow({ where: { id: mem.id } })).status).toBe("retired");
  });

  it("örüntü hafızası: aynı kategoride ≥ PATTERN_MIN_SIGNALS negatif sinyal → 'pattern' (kanıt = sinyal id'leri, observedAt = son sinyal); eşiğin altı üretmez; yeniden hesap idempotent", async () => {
    const { orgId, propertyId } = await seedOrg(TOKEN_A, HP_A);
    const mk = (i: number) => m(`c-${i}`, `2026-0${5 + Math.floor(i / 20)}-${String(10 + (i % 20)).padStart(2, "0")}T09:00:00Z`, `Sıcak su yok, şikayet ${i}`);
    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-06-15T09:00:00Z") })]);
    fake.setMessages("res-1", [mk(0), mk(1)]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    expect(PATTERN_MIN_SIGNALS).toBe(3);
    await refreshPatternMemory(orgId);
    expect(await prisma.propertyMemory.count({ where: { propertyId, source: "signal_pattern" } })).toBe(0);

    fake.setReservations(HP_A, [R1({ lastMessageAt: new Date("2026-06-16T09:00:00Z") })]);
    fake.setMessages("res-1", [mk(0), mk(1), mk(2)]);
    await syncHospitable(orgId);
    await processIngestEvents({ organizationId: orgId });
    const r = await refreshPatternMemory(orgId);
    expect(r.upserted).toBe(1);
    const pat = await prisma.propertyMemory.findFirstOrThrow({ where: { propertyId, source: "signal_pattern" } });
    const sig = await signals(propertyId);
    expect(pat).toMatchObject({ kind: "pattern", category: "complaint", sourceRef: "complaint", status: "active" });
    expect(JSON.parse(pat.evidenceJson).map((e: { id: string }) => e.id).sort()).toEqual(sig.map((x) => x.id).sort());
    expect(pat.observedAt.getTime()).toBe(sig[sig.length - 1].occurredAt.getTime());
    expect(pat.confidence).toBeGreaterThan(0);
    expect(pat.confidence).toBeLessThanOrEqual(1);
    await refreshPatternMemory(orgId);
    expect(await prisma.propertyMemory.count({ where: { propertyId, source: "signal_pattern" } })).toBe(1);

    const view = await getPropertyMemory(orgId, propertyId);
    expect(view.patterns.map((p) => p.category)).toEqual(["complaint"]);
    expect(view.recentSignals.length).toBe(3);
  });
});
