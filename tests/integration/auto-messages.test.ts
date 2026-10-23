import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { seedAutoMessage } from "../helpers/auto-message";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// KURUCU T4 (10-21, migration 80) — OTOMATİK MESAJLAR AYRI BÖLÜM. Gerçek PostgreSQL. Pinlenen (kurucunun cümleleriyle):
//  · "Önceden kuyruğa alınmış giriş mesajı da gönderimden önce kontrol edilsin; silinen / pasifleştirilen kaydın eski metni gönderilmesin."
//    → işçi POST'tan önce dairenin GÜNCEL metnini okur: sürüm değiştiyse AYNI satırı güncel metinle yeniden kurar (ikinci satır YOK —
//    çift gönderim yok), metin boşaltıldıysa / doldurulamıyorsa göndermez ve bekletir.
//  · "Yeni kayıt seçildiğinde gecikmiş mesajlar körlemesine gönderilmesin; konaklama ve gönderim zamanı yeniden doğrulansın." → metin
//    değişse de iptal edilmiş konaklamaya gitmez (konaklama vetosu metinden ÖNCE).
//  · "Geçişte bugün gerçekten seçilecek metinler aynen taşınsın. Geçiş kendi başına mesaj göndermesin, önceki gönderim kayıtları korunsun."
//    → migration 80'in veri taşıma SQL'i göndericinin eski seçimiyle (aktif + legacy/approved, en son güncellenen) aynı metni kopyalar.
//  · "Kaydetmeden önce önizleme; boş / çözülemeyen değişken taşıyan mesaj gönderilmesin; host uyarı görsün." → rota (önizleme yazmaz,
//    kayıt sürümlü + 409, kiracılar arası 404, personel 403, denetim kaydı metinsiz).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "pm-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn().mockResolvedValue("test-token") }));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { GET, POST, PUT } from "@/app/api/properties/[id]/auto-messages/route";
import { sendDueWelcomes } from "@/lib/automation";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { autoMessageStillAt } from "@/lib/auto-messages/store";
import { sendOnChannel } from "@/lib/messaging";

const mockSend = vi.mocked(sendOnChannel);
const owner = (organizationId: string, role: SessionPayload["role"] = "owner"): SessionPayload => ({
  userId: "u-owner",
  organizationId,
  role,
  email: "o@example.com",
  name: "O",
  sessionEpoch: 0,
  mfa: false,
});
const json = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/properties/x/auto-messages", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const p = (id: string) => ({ params: Promise.resolve({ id }) });

/** Kuyruk açık işletme + karşılama metni + yakın tarihli onaylı rezervasyon. */
async function seedQueued(body = "Merhaba {isim}, kapı kodu 4821.") {
  const org = await prisma.organization.create({
    data: { name: "Org", autoWelcome: true, autoWelcomeEnabledAt: new Date(0), aiSignature: "İsa", autoCheckin: true, autoCheckout: true },
  });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  await seedAutoMessage(property.id, "welcome", body);
  const arrival = new Date(Date.now() + 3 * 86_400_000);
  const r = await prisma.reservation.create({
    data: {
      propertyId: property.id, guestName: "Bircan Yılmaz", arrivalDate: arrival,
      departureDate: new Date(arrival.getTime() + 2 * 86_400_000), channel: "airbnb", status: "confirmed", sourceReference: "res-1",
    },
  });
  return { orgId: org.id, propertyId: property.id, reservationId: r.id };
}
const capture = () => {
  const bodies: string[] = [];
  const send: OutboxSendFn = async (row) => {
    bodies.push(row.body);
    return { ok: true, providerMessageId: `p${bodies.length}` };
  };
  return { send, bodies };
};
const drain = (send: OutboxSendFn) => drainOutboxOnce({ send, tokenFor: async () => "t" });
const rowOf = (orgId: string) => prisma.messageOutbox.findFirstOrThrow({ where: { organizationId: orgId } });

describe("kurucu T4 — kuyruktaki otomatik mesaj gönderimden önce güncel metinle doğrulanır (kalıcı kuyruk açık)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("metin değişmediyse kuyruktaki gövde AYNEN gider (sürüm aynı)", async () => {
    const { orgId } = await seedQueued();
    await sendDueWelcomes(orgId);
    const queued = await rowOf(orgId);
    expect(queued.templateRevision).toBe(1);
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toEqual([queued.body]);
    expect(bodies[0]).toContain("4821");
  });

  it("🚨 kuyruğa girdikten sonra metin DEĞİŞTİ → eski metin GİTMEZ; aynı satır güncel metinle yeniden kurulur (ikinci satır yok)", async () => {
    const { orgId, propertyId } = await seedQueued();
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, YENİ kapı kodu 7310.");
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("7310");
    expect(bodies[0]).not.toContain("4821");
    expect(bodies[0]).toContain("Bircan");
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
    const row = await rowOf(orgId);
    expect(row).toMatchObject({ status: "sent", templateRevision: 2 });
    expect(row.body).toBe(bodies[0]); // gönderim izi / satır gövdesi gönderilenle aynı
  });

  it("🚨 metin BOŞALTILDI → gönderilmez, satır bekler (iptal değil); metin yeniden yazılınca güncel metin gider", async () => {
    const { orgId, propertyId } = await seedQueued();
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "  ");
    const first = capture();
    await drain(first.send);
    expect(first.bodies).toEqual([]);
    expect(await rowOf(orgId)).toMatchObject({ status: "pending", lastErrorCode: "template_missing" });
    expect((await prisma.reservation.findFirstOrThrow({ where: { sourceReference: "res-1" } })).welcomeSentAt).toBeNull();

    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, kod 5555.");
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { availableAt: new Date() } });
    const second = capture();
    await drain(second.send);
    expect(second.bodies).toHaveLength(1);
    expect(second.bodies[0]).toContain("5555");
    expect(await prisma.messageOutbox.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("🚨 yeni metin doldurulamıyor → gönderilmez, bekler; ev sahibine son atlama sebebi kartta", async () => {
    const { orgId, propertyId } = await seedQueued();
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "Adres: [AÇIK ADRES]");
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toEqual([]);
    expect(await rowOf(orgId)).toMatchObject({ status: "pending", lastErrorCode: "template_unfilled" });
    await vi.waitFor(async () => {
      expect((await prisma.autoMessageTemplate.findFirstOrThrow({ where: { propertyId } })).lastSkipReason).toBe("unfilled");
    });
  });

  it("🚨 metin değişti AMA konaklama iptal edildi → hiçbir şey gitmez (konaklama vetosu metinden önce)", async () => {
    const { orgId, propertyId } = await seedQueued();
    await sendDueWelcomes(orgId);
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, yeni metin.");
    await prisma.reservation.updateMany({ where: { sourceReference: "res-1" }, data: { status: "cancelled" } });
    const { send, bodies } = capture();
    const res = await drain(send);
    expect(bodies).toEqual([]);
    expect(res.canceled).toBe(1);
  });

  it("🚨 satırın rezervasyonu silindi (hayalet satır temizliği) → aynı kaynak kimliğinin kopyasından güncel metin kurulur; eski metin gitmez", async () => {
    const { orgId, reservationId } = await seedQueued();
    await sendDueWelcomes(orgId);
    // Yeniden bağlama sonrası çift satır başka mülkte durur (mülk + kaynak kimliği benzersiz).
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 4" } });
    const propertyId = other.id;
    const twin = await prisma.reservation.create({
      data: {
        propertyId, guestName: "Bircan Yılmaz", arrivalDate: new Date(Date.now() + 3 * 86_400_000),
        departureDate: new Date(Date.now() + 5 * 86_400_000), channel: "airbnb", status: "confirmed", sourceReference: "res-1",
      },
    });
    await prisma.reservation.delete({ where: { id: reservationId } });
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, güncel kod 6060.");
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("6060");
    expect(twin.id).toBeTruthy();
  });

  it("geçiş öncesi satır (sürüm YOK) güncel kayıttan yeniden kurulur — geçiş metni aynen taşıdığı için içerik aynı", async () => {
    const { orgId, reservationId } = await seedQueued("Merhaba {isim}, kod 4821.");
    await prisma.messageOutbox.create({
      data: {
        organizationId: orgId, reservationId, channel: "airbnb", externalReservationId: "res-1", messageType: "welcome",
        body: "Merhaba Bircan, kod 4821.", idempotencyKey: `welcome:${orgId}:res-1`, status: "pending", availableAt: new Date(),
      },
    });
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toEqual(["Merhaba Bircan, kod 4821."]);
    expect(await rowOf(orgId)).toMatchObject({ status: "sent", templateRevision: 1 });
  });
});

describe("kurucu T4 — kuyruk kapalı yol: seçimle talep arasında metin değiştiyse eski metin gitmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("autoMessageStillAt: sürüm arttıysa / boşaltıldıysa false", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const t1 = await seedAutoMessage(propertyId, "checkin", "Kod 1");
    expect(await autoMessageStillAt(prisma, t1.id, t1.revision)).toBe(true);
    const t2 = await seedAutoMessage(propertyId, "checkin", "Kod 2");
    expect(await autoMessageStillAt(prisma, t1.id, t1.revision)).toBe(false);
    expect(await autoMessageStillAt(prisma, t2.id, t2.revision)).toBe(true);
    await prisma.autoMessageTemplate.update({ where: { id: t2.id }, data: { body: "" } });
    expect(await autoMessageStillAt(prisma, t2.id, t2.revision)).toBe(false);
  });

  it("doğrudan gönderim yolu: güncel metin gider (kuyruk kapalı)", async () => {
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    const { orgId, propertyId } = await seedQueued("Merhaba {isim}, eski.");
    await seedAutoMessage(propertyId, "welcome", "Merhaba {isim}, güncel.");
    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(String(mockSend.mock.calls[0]?.[1])).toContain("güncel");
    vi.unstubAllEnvs();
  });
});

describe("kurucu T4 — migration 80 veri taşıma: bugünkü seçimin AYNISI, mesaj göndermez, gönderim kayıtları korunur", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const MIGRATION = readFileSync(join(process.cwd(), "prisma/migrations/80_auto_message_templates/migration.sql"), "utf8");
  const COPY_SQL = MIGRATION.slice(MIGRATION.indexOf('INSERT INTO "AutoMessageTemplate"'));

  it("🚨 seçim: aktif + legacy/approved içinden EN SON güncellenen; taslak / pasif / bilgi kategorisi taşınmaz; eşitlikte işaret", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
    const kb = (category: string, content: string, updatedAt: Date, extra: Record<string, unknown> = {}) =>
      prisma.knowledgeBaseItem.create({ data: { propertyId, category, title: category, content, updatedAt, ...extra } });
    await kb("welcome", "eski onaylı", t(1), { reviewState: "approved" });
    await kb("welcome", "yeni legacy", t(2));
    await kb("welcome", "taslak en yeni", t(3), { reviewState: "draft" });
    await kb("welcome", "pasif en yeni", t(4), { isActive: false });
    await kb("checkin", "giriş A", t(5));
    await kb("checkin", "giriş B", t(5));
    await kb("checkout", "çıkış aynı", t(5));
    await kb("checkout", "çıkış aynı", t(5)); // eşit zamanlı AYNI içerik → işaret YOK (seçim fark etmez)
    await kb("general", "bilgi", t(6));
    const before = await prisma.reservation.create({
      data: { propertyId, guestName: "X", arrivalDate: t(1), departureDate: t(9), status: "confirmed", welcomeSentAt: t(7) },
    });
    // Geçiş tablosu boşken (yalnız bu dosya) veri taşıma SQL'ini AYNEN koş.
    await prisma.autoMessageTemplate.deleteMany();
    await prisma.$executeRawUnsafe(COPY_SQL);

    const rows = await prisma.autoMessageTemplate.findMany({ where: { propertyId }, orderBy: { kind: "asc" } });
    expect(rows.map((r) => [r.kind, r.organizationId === orgId, r.revision])).toEqual([
      ["checkin", true, 1],
      ["checkout", true, 1],
      ["welcome", true, 1],
    ]);
    expect(rows.find((r) => r.kind === "checkout")).toMatchObject({ body: "çıkış aynı", needsReview: false });
    const welcome = rows.find((r) => r.kind === "welcome")!;
    expect(welcome).toMatchObject({ body: "yeni legacy", needsReview: false });
    const checkin = rows.find((r) => r.kind === "checkin")!;
    expect(["giriş A", "giriş B"]).toContain(checkin.body);
    expect(checkin.needsReview).toBe(true); // eşit zamanlı FARKLI içerik → ev sahibine "kontrol edin"
    // Geçiş mesaj göndermez, gönderim kayıtlarına dokunmaz.
    expect(await prisma.messageOutbox.count()).toBe(0);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: before.id } })).welcomeSentAt).toEqual(t(7));
  });
});

describe("kurucu T4 — 'Otomatik mesajlar' rotası", () => {
  let orgId: string;
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    await prisma.property.update({ where: { id: propertyId }, data: { name: "Lale Daire 5" } });
    // Denetim kaydının faili gerçek kullanıcı olmalı (yabancı anahtar).
    const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    session = { ...owner(orgId), userId: user.id };
  });

  it("GET: üç tür, kayıt yokken boş + sürüm 0 + önizleme 'boş — gönderilmez'", async () => {
    const res = await GET(json("GET"), p(propertyId));
    expect(res.status).toBe(200);
    const { messages } = await res.json();
    expect(messages.map((m: { kind: string }) => m.kind)).toEqual(["welcome", "checkin", "checkout"]);
    expect(messages[0]).toMatchObject({ body: "", revision: 0, preview: { issue: "empty" } });
  });

  it("POST önizleme hiçbir şey YAZMAZ; misafire gidecek metni örnek adla ve doldurulmamış alanı söyler", async () => {
    const ok = await (await POST(json("POST", { kind: "checkin", body: "Daire {daire}: kod 12" }), p(propertyId))).json();
    expect(ok.preview).toMatchObject({ issue: null });
    expect(ok.preview.text).toContain("Merhaba Ayşe,");
    expect(ok.preview.text).toContain("Daire 5: kod 12");
    const bad = await (await POST(json("POST", { kind: "checkin", body: "Adres: [AÇIK ADRES]" }), p(propertyId))).json();
    expect(bad.preview.issue).toBe("unfilled");
    expect(await prisma.autoMessageTemplate.count()).toBe(0);
  });

  it("PUT: ilk kayıt sürüm 1; bayat sürümle 409 (üstüne yazma yok); kayıt sürümü artırır, uyarıları temizler; denetim kaydı METİNSİZ", async () => {
    const first = await PUT(json("PUT", { kind: "checkin", body: "Kod 4821", expectedRevision: 0 }), p(propertyId));
    expect(first.status).toBe(200);
    expect((await first.json()).revision).toBe(1);
    expect((await PUT(json("PUT", { kind: "checkin", body: "Yarış", expectedRevision: 0 }), p(propertyId))).status).toBe(409);
    await prisma.autoMessageTemplate.updateMany({ data: { needsReview: true, lastSkipReason: "unfilled", lastSkippedAt: new Date() } });
    const second = await PUT(json("PUT", { kind: "checkin", body: "Kod 7310", expectedRevision: 1 }), p(propertyId));
    expect((await second.json()).revision).toBe(2);
    expect((await PUT(json("PUT", { kind: "checkin", body: "Eski form", expectedRevision: 1 }), p(propertyId))).status).toBe(409);
    const row = await prisma.autoMessageTemplate.findFirstOrThrow({ where: { propertyId, kind: "checkin" } });
    expect(row).toMatchObject({ body: "Kod 7310", revision: 2, needsReview: false, lastSkipReason: null });
    const audits = await prisma.auditLog.findMany({ where: { organizationId: orgId, action: "property.auto_message_saved" } });
    expect(audits).toHaveLength(2);
    for (const a of audits) expect(a.metadataJson).not.toMatch(/4821|7310/);
  });

  it("doğrulama: geçersiz tür / çok uzun metin / sürüm yok → 400, yazma yok", async () => {
    expect((await PUT(json("PUT", { kind: "x", body: "a", expectedRevision: 0 }), p(propertyId))).status).toBe(400);
    expect((await PUT(json("PUT", { kind: "welcome", body: "a".repeat(20_001), expectedRevision: 0 }), p(propertyId))).status).toBe(400);
    expect((await PUT(json("PUT", { kind: "welcome", body: "a" }), p(propertyId))).status).toBe(400);
    expect(await prisma.autoMessageTemplate.count()).toBe(0);
  });

  it("🚨 KİRACILAR ARASI: başka işletmenin mülkü → GET / POST / PUT 404, hiçbir şey yazılmaz", async () => {
    const other = await makeOrgWithProperty();
    await seedAutoMessage(other.propertyId, "checkin", "Başkasının kodu 9999");
    expect((await GET(json("GET"), p(other.propertyId))).status).toBe(404);
    expect((await POST(json("POST", { kind: "checkin", body: "x" }), p(other.propertyId))).status).toBe(404);
    expect((await PUT(json("PUT", { kind: "checkin", body: "ele geçir", expectedRevision: 1 }), p(other.propertyId))).status).toBe(404);
    expect((await prisma.autoMessageTemplate.findFirstOrThrow({ where: { propertyId: other.propertyId } })).body).toBe("Başkasının kodu 9999");
  });

  it("personel (kapı kodu görebilir metin) → 403", async () => {
    session = { ...session, role: "staff" };
    expect((await GET(json("GET"), p(propertyId))).status).toBe(403);
    expect((await PUT(json("PUT", { kind: "checkin", body: "x", expectedRevision: 0 }), p(propertyId))).status).toBe(403);
  });
});

describe("Claude 2. dalga #95 (10-21): veto ile metin yenileme AYNI rezervasyon kopyasını seçer — başka dairenin metni / kapı kodu gitmez", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ORG_IDS", "*");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function seedTwoUnits() {
    const { orgId, propertyId, reservationId } = await seedQueued("Merhaba {isim}, A dairesi kapı kodu 4821.");
    const other = await prisma.property.create({ data: { organizationId: orgId, name: "Lale 5" } });
    await seedAutoMessage(other.id, "welcome", "Merhaba {isim}, B dairesi kapı kodu 9999.");
    await sendDueWelcomes(orgId);
    const own = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    return { orgId, propertyId, ownId: reservationId, otherPropertyId: other.id, own };
  }

  it("kendi kopyası İPTAL, aynı kaynak kimliğiyle başka dairede ONAYLI kopya → metin onaylı kopyanın dairesinden kurulur", async () => {
    const { orgId, ownId, otherPropertyId, own } = await seedTwoUnits();
    await prisma.reservation.update({ where: { id: ownId }, data: { status: "cancelled" } });
    await prisma.reservation.create({
      data: {
        propertyId: otherPropertyId, guestName: "Bircan Yılmaz", arrivalDate: own.arrivalDate, departureDate: own.departureDate,
        channel: "airbnb", status: "confirmed", sourceReference: "res-1",
      },
    });
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("9999");
    expect(bodies[0]).not.toContain("4821");
  });

  it("kendi kopyası silinmiş; erken tarihli BEKLEYEN kopya + onaylı kopya → onaylı kopyanın dairesi (vetoyla aynı)", async () => {
    const { orgId, ownId, propertyId, otherPropertyId, own } = await seedTwoUnits();
    await prisma.messageOutbox.updateMany({ where: { organizationId: orgId }, data: { reservationId: null } });
    await prisma.reservation.delete({ where: { id: ownId } });
    await prisma.reservation.create({
      data: {
        propertyId, guestName: "Bircan Yılmaz", arrivalDate: new Date(own.arrivalDate.getTime() - 86_400_000), departureDate: own.departureDate,
        channel: "airbnb", status: "pending", sourceReference: "res-1",
      },
    });
    await prisma.reservation.create({
      data: {
        propertyId: otherPropertyId, guestName: "Bircan Yılmaz", arrivalDate: own.arrivalDate, departureDate: own.departureDate,
        channel: "airbnb", status: "confirmed", sourceReference: "res-1",
      },
    });
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("9999");
    expect(bodies[0]).not.toContain("4821");
  });

  it("KONTROL: kendi kopyası canlı → kendi dairesinin metni gider (davranış değişmedi)", async () => {
    const { orgId } = await seedTwoUnits();
    const { send, bodies } = capture();
    await drain(send);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("4821");
    expect(await rowOf(orgId)).toMatchObject({ status: "sent" });
  });
});
