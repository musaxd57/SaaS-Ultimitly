import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// G2 TUR 9 — T9-B16: bağı kopmuş (konuşması / rezervasyonu silinmiş) kuyruk satırının misafir metni saklama süresinden sonra da kalıyor.
// T8-B15 silme rotalarında sonuçlanmış satırın gövdesini boşaltıyor; ama (a) silme anında uçuşta olan satır sonradan sonuçlanınca, (b) takvimden
// kaybolan / elle kopyası kaldırılan rezervasyonun yaşam döngüsü satırı (`automation.ts` rezervasyon silme yolu kuyruğa dokunmaz), (c) bu kural
// öncesi silinmiş konuşmaların satırları gövdeyi taşımaya devam eder. `anonymizeOldGuestData` kuyruk gövdesine YALNIZ var olan konuşma /
// rezervasyon kimliğiyle ulaşır → bu satırlar hiçbir zaman süpürülmez.
// Beklenen: saklama süresinden eski, SONUÇLANMIŞ ve bağı kopmuş satırın gövdesi `ANON_BODY`; uçuştaki, taze ve bağı duran satıra dokunulmaz.
// ---------------------------------------------------------------------------

import { anonymizeOldGuestData, ANON_BODY, retentionCutoff } from "@/lib/data-retention";

const GUEST_TEXT = "Merhaba Ayşe Yılmaz, kapı kodunuz 4821.";
const DAY = 86_400_000;

describe("T9-B16 — saklama süpürgesi bağı kopmuş kuyruk satırının gövdesini boşaltır", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("DATA_RETENTION_MONTHS", "12");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 eski + sonuçlanmış + bağı kopmuş satır boşalır; uçuştaki / taze / bağı duran satır dokunulmaz", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Bağı DURAN satır: konaklaması dün biten (saklama süresi dolmamış) konuşma — eski tarihli de olsa süpürge konaklama kuralıyla karar verir.
    const res = await prisma.reservation.create({
      data: { propertyId, guestName: "Ada", arrivalDate: new Date(Date.now() - 3 * DAY), departureDate: new Date(Date.now() - DAY), status: "confirmed" },
    });
    const conv = await prisma.conversation.create({ data: { propertyId, reservationId: res.id, guestIdentifier: "Ada", channel: "airbnb" } });
    const old = new Date(Date.now() - 800 * DAY);
    const row = (key: string, data: Record<string, unknown>) =>
      prisma.messageOutbox.create({ data: { organizationId: orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: key, ...data } });
    await row("yetim-yanit-gonderildi", { conversationId: "silinmis-konusma", status: "sent", createdAt: old });
    await row("yetim-yasam-iptal", { reservationId: "silinmis-rezervasyon", status: "canceled", messageType: "checkin", createdAt: old });
    await row("yetim-basarisiz", { conversationId: "silinmis-konusma-2", status: "failed", createdAt: old });
    await row("yetim-ucusta", { conversationId: "silinmis-konusma-3", status: "sending", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000), createdAt: old });
    await row("yetim-taze", { conversationId: "silinmis-konusma-4", status: "sent", createdAt: new Date(Date.now() - DAY) });
    await row("bagli-eski", { conversationId: conv.id, reservationId: res.id, status: "sent", createdAt: old });
    // YARI bağlı satırlar (gece mutasyonu 11-21: iki "ebeveyn var mı" koşulundan biri silinince yaşıyordu): ebeveynlerden BİRİ duruyorsa satır bu
    // geçişe girmez — karar o ebeveynin konaklama kuralındadır (burada konaklama dün bitti → metin kalır).
    await row("yari-bagli-konusma-duruyor", { conversationId: conv.id, reservationId: "silinmis-rezervasyon-2", status: "sent", createdAt: old });
    await row("yari-bagli-rezervasyon-duruyor", { conversationId: "silinmis-konusma-5", reservationId: res.id, status: "sent", createdAt: old });

    await anonymizeOldGuestData();

    const rows = await prisma.messageOutbox.findMany({ select: { idempotencyKey: true, body: true } });
    const got = Object.fromEntries(rows.map((r) => [r.idempotencyKey, r.body === ANON_BODY ? "ANON" : r.body === GUEST_TEXT ? "METIN" : r.body]));
    expect(got).toEqual({
      "yetim-yanit-gonderildi": "ANON",
      "yetim-yasam-iptal": "ANON",
      "yetim-basarisiz": "ANON",
      "yetim-ucusta": "METIN",
      "yetim-taze": "METIN",
      "bagli-eski": "METIN",
      "yari-bagli-konusma-duruyor": "METIN",
      "yari-bagli-rezervasyon-duruyor": "METIN",
    });
  });

  it("KONTROL: saklama kapalıyken (DATA_RETENTION_MONTHS yok) hiçbir satıra dokunulmaz", async () => {
    vi.stubEnv("DATA_RETENTION_MONTHS", "");
    const { orgId } = await makeOrgWithProperty();
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: "k", conversationId: "yok", status: "sent", createdAt: new Date(Date.now() - 800 * DAY) },
    });
    await anonymizeOldGuestData();
    expect((await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "k" } })).body).toBe(GUEST_TEXT);
  });

  it("SINIR (iki yön): kesimden 1 sn önce yazılmış yetim satır boşalır, kesimden 1 sn sonra yazılmış satır kalır; bekleyen / belirsiz / inceleme / uzlaştırılan satır eski de olsa kalır", async () => {
    const { orgId } = await makeOrgWithProperty();
    const now = new Date();
    const cutoff = retentionCutoff(now)!;
    const row = (key: string, data: Record<string, unknown>) =>
      prisma.messageOutbox.create({ data: { organizationId: orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: key, conversationId: `yok-${key}`, ...data } });
    await row("kesimden-once", { status: "sent", createdAt: new Date(cutoff.getTime() - 1_000) });
    await row("kesimden-sonra", { status: "sent", createdAt: new Date(cutoff.getTime() + 1_000) });
    const old = new Date(cutoff.getTime() - 30 * DAY);
    await row("eski-bekleyen", { status: "pending", createdAt: old });
    await row("eski-belirsiz", { status: "ambiguous", createdAt: old });
    await row("eski-inceleme", { status: "review", createdAt: old });
    await row("eski-uzlastirma", { status: "reconciling", claimedBy: "w1", claimExpiresAt: new Date(Date.now() + 60_000), createdAt: old });
    await row("eski-engelli", { status: "blocked", createdAt: old });
    // Ebeveyn kimliği hiç yok (iki alan da boş) — bağsız sayılır.
    await prisma.messageOutbox.create({ data: { organizationId: orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: "kimliksiz", status: "canceled", createdAt: old } });

    await anonymizeOldGuestData(now);

    const rows = await prisma.messageOutbox.findMany({ select: { idempotencyKey: true, body: true, status: true } });
    const got = Object.fromEntries(rows.map((r) => [r.idempotencyKey, `${r.status}:${r.body === ANON_BODY ? "ANON" : r.body === GUEST_TEXT ? "METIN" : r.body}`]));
    expect(got).toEqual({
      "kesimden-once": "sent:ANON",
      "kesimden-sonra": "sent:METIN",
      "eski-bekleyen": "pending:METIN",
      "eski-belirsiz": "ambiguous:METIN",
      "eski-inceleme": "review:METIN",
      "eski-uzlastirma": "reconciling:METIN",
      "eski-engelli": "blocked:ANON",
      kimliksiz: "canceled:ANON",
    });
  });

  it("BAYRAK KURALI: RETENTION_MESSAGE_AGE_ANCHOR açık da kapalı da yetim geçişi AYNI (ebeveyn yok → satırın kendi yaşı); ikinci koşu hiçbir şey değiştirmez (sonlanır)", async () => {
    for (const flag of ["", "1"]) {
      await resetDb();
      vi.stubEnv("RETENTION_MESSAGE_AGE_ANCHOR", flag);
      const { orgId } = await makeOrgWithProperty();
      await prisma.messageOutbox.create({
        data: { organizationId: orgId, channel: "airbnb", body: GUEST_TEXT, idempotencyKey: "y", conversationId: "yok", status: "sent", createdAt: new Date(Date.now() - 800 * DAY) },
      });
      await anonymizeOldGuestData();
      const first = await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "y" }, select: { body: true, updatedAt: true } });
      expect(first.body).toBe(ANON_BODY);
      await anonymizeOldGuestData();
      const second = await prisma.messageOutbox.findFirstOrThrow({ where: { idempotencyKey: "y" }, select: { body: true, updatedAt: true } });
      expect(second).toEqual(first);
    }
  });
});
