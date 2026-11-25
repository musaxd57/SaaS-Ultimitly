import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { stayDayInZone } from "../helpers/stay-dates";
import { findAttentionItems, type AttentionItem } from "@/modules/intelligence/incidents/attention";
import { departureOpenDetail, departureOpenHeadline } from "@/modules/intelligence/incidents/departure-open";

// ---------------------------------------------------------------------------
// ÇIKIŞTAN ÖNCE AÇIK KONU (plan madde 7; tasarım `docs/TASARIM-2026-11-25-cikistan-once-acik-konu.md`). Kurucu örneği:
// "Lale 3 yarın 11:00'de çıkıyor; sıcak su konusu açık." Çıkışa ≤ 24 sa kala bir konaklamanın açık konuları (bırakılan istek · açık söz ·
// Sorunlu durumu) TEK satırda — yeni satır türü değil, "çıkışı yaklaşan" satırı + yapılı `departureOpen`. Aynı konu iki satırda görünmez.
// Tarihler bugüne göre (`stayDayInZone`, İstanbul takvim günü — tarih-yalnız çıkış Hospitable biçimi, 00:00Z).
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const TZ = "Europe/Istanbul";

interface Stay {
  orgId: string;
  propertyId: string;
  reservationId: string;
  conversationId: string;
  inboundMessageId: string;
}

/**
 * İşletme + "Lale 3" (çıkış saati 11:00) + rezervasyon + kanal konuşması. Misafir 3 saat önce yazdı; `answered` ise ev sahibi 1 saat önce
 * cevapladı (son söz bizde → cevapsız değil).
 */
async function stay(opts: {
  departureInDays: number;
  reservationStatus?: string;
  conversationStatus?: string;
  answered?: boolean;
  propertyName?: string;
  sourceReference?: string;
  orgId?: string;
  guestHoursAgo?: number;
}): Promise<Stay> {
  const now = Date.now();
  const orgId = opts.orgId ?? (await prisma.organization.create({ data: { name: "Test Org", timezone: TZ } })).id;
  const property = await prisma.property.create({
    data: { organizationId: orgId, name: opts.propertyName ?? "Lale 3", checkInTime: "15:00", checkOutTime: "11:00" },
  });
  const departureDate = stayDayInZone(opts.departureInDays, TZ);
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: "Misafir",
      arrivalDate: new Date(departureDate.getTime() - 3 * 24 * HOUR),
      departureDate,
      status: opts.reservationStatus ?? "confirmed",
      channel: "airbnb",
      currency: "EUR",
      ...(opts.sourceReference ? { sourceReference: opts.sourceReference } : {}),
    },
  });
  const guestAt = new Date(now - (opts.guestHoursAgo ?? 3) * HOUR);
  const convo = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      reservationId: reservation.id,
      guestIdentifier: "Misafir",
      channel: "airbnb",
      externalReservationId: `res-${reservation.id}`,
      status: opts.conversationStatus ?? (opts.answered ? "answered" : "new"),
      lastMessageAt: opts.answered ? new Date(now - HOUR) : guestAt,
    },
  });
  const inbound = await prisma.message.create({
    data: { conversationId: convo.id, direction: "inbound", senderName: "Misafir", authorType: "guest", body: "Sıcak su gelmiyor.", createdAt: guestAt },
  });
  if (opts.answered) {
    await prisma.message.create({
      data: { conversationId: convo.id, direction: "outbound", senderName: "Ev sahibi", body: "Bakıyoruz.", createdAt: new Date(now - HOUR) },
    });
  }
  return { orgId, propertyId: property.id, reservationId: reservation.id, conversationId: convo.id, inboundMessageId: inbound.id };
}

async function heldItem(s: Stay, over: { kind?: string; sensitivity?: string } = {}) {
  await prisma.conversationItem.create({
    data: {
      organizationId: s.orgId,
      conversationId: s.conversationId,
      messageId: s.inboundMessageId,
      kind: over.kind ?? "payment_invoice",
      sensitivity: over.sensitivity ?? "sensitive",
      sources: "lexical",
      status: "pending_host",
      createdAt: new Date(Date.now() - 3 * HOUR + 1000),
    },
  });
}

async function openCommitment(
  s: Stay,
  over: { topic?: string | null; dueInHours?: number; duePrecision?: "part" | "day"; dayPart?: string } = {},
) {
  await prisma.guestCommitment.create({
    data: {
      organizationId: s.orgId,
      conversationId: s.conversationId,
      kind: "maintenance",
      topic: over.topic === undefined ? "hot_water" : over.topic,
      dueAt: new Date(Date.now() + (over.dueInHours ?? 5) * HOUR),
      ...(over.duePrecision ? { duePrecision: over.duePrecision, dayPart: over.dayPart ?? null } : {}),
      status: "open",
    },
  });
}

const departureRows = (items: AttentionItem[]) => items.filter((i) => i.departureOpen);
const text = (i: AttentionItem) => [departureOpenHeadline(i.propertyName, i.departureOpen!), departureOpenDetail(i.departureOpen!)];
// Kesin saatli sözün zamanı konu adının yanında kalır ("sıcak su (söz bugün 18:00)"); gün / saat koşu anına bağlı → biçim kalıbı.
const WHEN = String.raw`\(söz (?:bugün|yarın) \d{2}:\d{2}\)`;
/** İşletmenin (İstanbul, sabit +03:00) bugününde verilen saat — "şimdi"yi sabitlemek için. */
const todayAt = (clock: string) => new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: TZ })}T${clock}:00+03:00`);

describe("Çıkıştan önce açık konu — tek satır", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 (a) çıkış yarın + açık söz (sıcak su), konuşma cevaplanmış → TEK satır: 'Lale 3 yarın 11:00'de çıkıyor' / 'sıcak su konusu açık'", async () => {
    const s = await stay({ departureInDays: 1, answered: true });
    await openCommitment(s);
    const items = await findAttentionItems(s.orgId);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("departing_unanswered");
    expect(items[0].href).toBe(`/inbox/${s.conversationId}`);
    expect(items[0].certainty).toBe("observed");
    expect(text(items[0])[0]).toBe("Lale 3 yarın 11:00'de çıkıyor");
    // Söz verdiğiniz saat birleşik satırda kaybolmaz (söz satırı yutulduğu için tek görünen yer burası).
    expect(text(items[0])[1]).toMatch(new RegExp(`^sıcak su ${WHEN} konusu açık$`));
    // Söz satırı ayrıca görünmez (aynı konu iki satırda yok).
    expect(items.filter((i) => i.kind === "commitment_due")).toHaveLength(0);
  });

  it("🚨 (a2) açık istek, misafir 3 saattir cevapsız → TEK satır; istek satırı + cevapsız satırı yutulur; sınıflandırma çıkarım", async () => {
    const s = await stay({ departureInDays: 1 });
    await heldItem(s);
    const items = await findAttentionItems(s.orgId);
    expect(items).toHaveLength(1);
    expect(items[0].certainty).toBe("inferred");
    expect(text(items[0])).toEqual(["Lale 3 yarın 11:00'de çıkıyor", "ödeme / fatura konusu açık · misafir 3 saattir cevap bekliyor"]);
    // Önem bırakılan isteğin (88) ve çıkış satırının (90 + 3) en büyüğü.
    expect(items[0].severity).toBe(93);
  });

  it("aşırı uygulama: misafir 1 saat önce yazdı (çıkış eşiği 2 sa) → birleşik satır cevapsızlık parçası taşımaz", async () => {
    const s = await stay({ departureInDays: 1, guestHoursAgo: 1 });
    await heldItem(s);
    const items = await findAttentionItems(s.orgId);
    expect(items).toHaveLength(1);
    expect(items[0].hoursWaiting).toBeUndefined();
    expect(text(items[0])).toEqual(["Lale 3 yarın 11:00'de çıkıyor", "ödeme / fatura konusu açık"]);
    expect(items[0].severity).toBe(90);
  });

  it("(b) çıkış yarın ama açık konu yok (cevaplanmış, Sorunlu değil) → hiçbir satır", async () => {
    const s = await stay({ departureInDays: 1, answered: true });
    expect(await findAttentionItems(s.orgId)).toEqual([]);
  });

  it("(b2) çıkış yarın, YALNIZ cevapsız mesaj → bugünkü 'çıkışı yaklaşan' satırı AYNEN (birleşik alan yok)", async () => {
    const s = await stay({ departureInDays: 1 });
    const items = await findAttentionItems(s.orgId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "departing_unanswered", hoursWaiting: 3, severity: 93 });
    expect(items[0].departureOpen).toBeUndefined();
  });

  it("🚨 (c) çıkış 3 gün sonra → birleşik satır yok; istek ve söz satırları eskisi gibi ayrı", async () => {
    const s = await stay({ departureInDays: 3 });
    await heldItem(s);
    await openCommitment(s);
    const items = await findAttentionItems(s.orgId);
    expect(departureRows(items)).toHaveLength(0);
    expect(items.map((i) => i.kind).sort()).toEqual(["commitment_due", "held_request"]);
  });

  it("🚨 (d) açık istek + açık söz + cevapsız mesaj → TEK satır, konu iki kez görünmez", async () => {
    const s = await stay({ departureInDays: 1 });
    await heldItem(s);
    await openCommitment(s);
    const items = await findAttentionItems(s.orgId);
    expect(items).toHaveLength(1);
    expect(items[0].departureOpen?.topics).toMatchObject([
      { source: "commitment", kind: "maintenance", topic: "hot_water" },
      { source: "held", kind: "payment_invoice" },
    ]);
    expect(items[0].departureOpen?.topics).toHaveLength(2);
    expect(text(items[0])[1]).toMatch(new RegExp(`^sıcak su ${WHEN}, ödeme / fatura konuları açık · misafir 3 saattir cevap bekliyor$`));
  });

  it("saatsiz söz (gün dilimi) → söz saati UYDURULMAZ: parantez yok", async () => {
    const s = await stay({ departureInDays: 1, answered: true });
    await openCommitment(s, { duePrecision: "part", dayPart: "evening" });
    const items = await findAttentionItems(s.orgId);
    expect(departureRows(items)).toHaveLength(1);
    expect(text(items[0])[1]).toBe("sıcak su konusu açık");
  });

  it("🚨 yutulan söz, söz satırı tavanında (3) yer tutmaz: öteki konaklamaların üç sözü de görünür", async () => {
    // Çıkışı yarın olan konaklamanın sözü GECİKMİŞ (en önemli); öteki üç konaklamanın sözü yaklaşıyor (daha az önemli).
    const leaving = await stay({ departureInDays: 1, answered: true });
    await openCommitment(leaving, { dueInHours: -2 });
    for (const name of ["Lale 4", "Lale 5", "Lale 6"]) {
      const other = await stay({ departureInDays: 5, answered: true, orgId: leaving.orgId, propertyName: name });
      await openCommitment(other, { dueInHours: 1 });
    }
    const items = await findAttentionItems(leaving.orgId);
    expect(departureRows(items)).toHaveLength(1);
    // Yutulan söz tavanda yer tutsaydı öteki üç sözden biri düşerdi (2 satır).
    expect(items.filter((i) => i.kind === "commitment_due")).toHaveLength(3);
  });

  it("🚨 (e) iptal edilmiş rezervasyon → birleşik satır yok (söz satırı bugünkü gibi)", async () => {
    const s = await stay({ departureInDays: 1, reservationStatus: "cancelled", answered: true });
    await openCommitment(s);
    const items = await findAttentionItems(s.orgId);
    expect(departureRows(items)).toHaveLength(0);
    expect(items.map((i) => i.kind)).toEqual(["commitment_due"]);
  });

  it("🚨 (f) başka işletmenin çıkışı / konusu sızmaz", async () => {
    const a = await stay({ departureInDays: 1, answered: true });
    await openCommitment(a, { topic: "ac" });
    const b = await stay({ departureInDays: 1, answered: true, propertyName: "Lale 9" });
    await openCommitment(b);
    await heldItem(b);
    const items = await findAttentionItems(a.orgId);
    expect(items).toHaveLength(1);
    expect(text(items[0])[0]).toBe("Lale 3 yarın 11:00'de çıkıyor");
    expect(text(items[0])[1]).toMatch(new RegExp(`^klima ${WHEN} konusu açık$`));
  });

  it("Sorunlu konuşma tek başına (son söz bizde) → 'konuşma Sorunlu olarak işaretli'; çıkış bugün, saat henüz gelmedi", async () => {
    const s = await stay({ departureInDays: 0, answered: true, conversationStatus: "problem" });
    const items = await findAttentionItems(s.orgId, { now: todayAt("09:00") });
    expect(items).toHaveLength(1);
    expect(text(items[0])).toEqual(["Lale 3 bugün 11:00'de çıkıyor", "konuşma Sorunlu olarak işaretli"]);
  });

  it("🚨 çıkış saati bugün GEÇTİYSE saat yazılmaz (15:00'te 'bugün 11:00'de çıkıyor' denmez); tam saatinde de yazılmaz", async () => {
    const s = await stay({ departureInDays: 0, answered: true, conversationStatus: "problem" });
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("15:00") }))[0])[0]).toBe("Lale 3 bugün çıkıyor");
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("11:00") }))[0])[0]).toBe("Lale 3 bugün çıkıyor");
    // KONTROL: bir dakika önce saat hâlâ yazılır.
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("10:59") }))[0])[0]).toBe("Lale 3 bugün 11:00'de çıkıyor");
  });

  it("🚨 onaylı geç çıkış (14:00) varsa satır dairenin saatini (11:00) DEĞİL onaylı saati yazar; 11:00'i geçince de 14:00 durur", async () => {
    const s = await stay({ departureInDays: 0, answered: true, conversationStatus: "problem" });
    await prisma.decisionRequest.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        messageId: s.inboundMessageId,
        reservationId: s.reservationId,
        kind: "late_checkout",
        dayKey: new Date().toLocaleDateString("en-CA", { timeZone: TZ }),
        lang: "tr",
        status: "approved",
        decidedTime: "14:00",
      },
    });
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("10:00") }))[0])[0]).toBe("Lale 3 bugün 14:00'te çıkıyor");
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("12:30") }))[0])[0]).toBe("Lale 3 bugün 14:00'te çıkıyor");
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("14:00") }))[0])[0]).toBe("Lale 3 bugün çıkıyor");
  });

  it("KONTROL: reddedilen geç çıkış isteği saati değiştirmez", async () => {
    const s = await stay({ departureInDays: 0, answered: true, conversationStatus: "problem" });
    await prisma.decisionRequest.create({
      data: {
        organizationId: s.orgId,
        conversationId: s.conversationId,
        messageId: s.inboundMessageId,
        reservationId: s.reservationId,
        kind: "late_checkout",
        dayKey: new Date().toLocaleDateString("en-CA", { timeZone: TZ }),
        lang: "tr",
        status: "rejected",
        decidedTime: "14:00",
      },
    });
    expect(text((await findAttentionItems(s.orgId, { now: todayAt("10:00") }))[0])[0]).toBe("Lale 3 bugün 11:00'de çıkıyor");
  });

  it("aşırı uygulama: çıkışı 3 gün sonra olan Sorunlu konuşma satır üretmez (bugünkü gibi)", async () => {
    const s = await stay({ departureInDays: 3, answered: true, conversationStatus: "problem" });
    expect(await findAttentionItems(s.orgId)).toEqual([]);
  });

  it("acil bırakılan istek yutulmaz: kendi satırı kalır, birleşik satır çıkmaz", async () => {
    const s = await stay({ departureInDays: 1 });
    await heldItem(s, { kind: "emergency", sensitivity: "emergency" });
    const items = await findAttentionItems(s.orgId);
    expect(items.map((i) => [i.kind, i.severity])).toEqual([["held_request", 99]]);
    expect(departureRows(items)).toHaveLength(0);
  });

  it("aynı rezervasyon iki dairede etkin kayıtlı → birleşik satır yok (daire tahmin edilmez; iki daire uyarısı ayrı)", async () => {
    const s = await stay({ departureInDays: 1, answered: true, sourceReference: "HM-ORTAK" });
    await openCommitment(s);
    const other = await prisma.property.create({ data: { organizationId: s.orgId, name: "Lale 5" } });
    await prisma.reservation.create({
      data: {
        propertyId: other.id,
        guestName: "Misafir",
        arrivalDate: new Date(stayDayInZone(1, TZ).getTime() - 3 * 24 * HOUR),
        departureDate: stayDayInZone(1, TZ),
        status: "confirmed",
        channel: "airbnb",
        currency: "EUR",
        sourceReference: "HM-ORTAK",
      },
    });
    const items = await findAttentionItems(s.orgId);
    expect(departureRows(items)).toHaveLength(0);
    expect(items.map((i) => i.kind).sort()).toEqual(["booking_two_properties", "commitment_due"]);
  });

  it("saatli çıkış kaydı (iCal) → saat kaydın kendisinden, işletmenin saatiyle", async () => {
    const s = await stay({ departureInDays: 1, answered: true });
    // Yarın 10:30 İstanbul (07:30Z) — tarih-yalnız değil.
    const d = stayDayInZone(1, TZ);
    await prisma.reservation.update({ where: { id: s.reservationId }, data: { departureDate: new Date(d.getTime() + 7.5 * HOUR) } });
    await openCommitment(s);
    // "Şimdi" = bugün 12:00 İstanbul (09:00Z) → çıkış 22,5 sa sonra (pencere içinde, yarın).
    const now = new Date(stayDayInZone(0, TZ).getTime() + 9 * HOUR);
    const items = await findAttentionItems(s.orgId, { now });
    const rows = departureRows(items);
    expect(rows).toHaveLength(1);
    expect(rows[0].departureOpen?.time).toBe("10:30");
    expect(text(rows[0])[0]).toBe("Lale 3 yarın 10:30'da çıkıyor");
  });
});
