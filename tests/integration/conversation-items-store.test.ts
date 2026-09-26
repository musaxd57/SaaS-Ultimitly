import { describe, it, expect, beforeEach } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  applyItemEvent,
  applyWithdrawals,
  claimItemNotification,
  listConversationItems,
  openItemCounts,
  purgeExpiredConversationItems,
  releaseItemNotification,
  supersedeOlderItems,
  upsertTurnItems,
} from "@/lib/conversation-items/store";
import { buildItemsForMessage, buildLexicalItems } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// KONUŞMA ÖĞELERİ — kalıcı kayıt (migration 56). Kurucu: eski cevapsız risk KAYBOLMAZ, konuşmayı BLOKE ETMEZ.
// Pinlenen: iki geçişin birleşimi (hassaslık yalnız yükselir), geçişlerin CAS'ı, vazgeçme/yerine geçme kuralları,
// e-posta claim'i, "ev sahibi yazdı" türetmesi, kiracı yalıtımı, saklama temizliği.
// ---------------------------------------------------------------------------

const T0 = new Date("2026-09-20T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

async function seedConversation(orgId: string, propertyId: string, rows: [string, "inbound" | "outbound", string, number, string?][]) {
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: `res-${Math.random()}`, status: "new", lastMessageAt: at(0) },
  });
  const ids: string[] = [];
  for (const [label, direction, body, min, authorType] of rows) {
    const m = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction,
        body,
        senderName: direction === "inbound" ? "Alex" : authorType === "ai" ? "GuestOps AI" : "Ev Sahibi",
        authorType: authorType === "legacy" ? null : (authorType ?? (direction === "inbound" ? "guest" : "host")),
        createdAt: at(min),
      },
    });
    ids.push(m.id);
    void label;
  }
  return { conversationId: conversation.id, ids, orgId };
}

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  ({ orgId, propertyId } = await makeOrgWithProperty());
});

describe("yazma — iki geçiş aynı öğeyi BİRLEŞTİRİR", () => {
  it("senkron uyarısı (kelime ağı) + cevap geçişi (anlama katmanı): hassaslık korunur, kaynaklar birleşir", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [["m1", "inbound", "Daire çok kirli, otopark nerede?", 0]]);
    // 1) senkron uyarısı: model yok, yalnız kelime ağı.
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId: ids[0], items: buildLexicalItems(["complaint"]) }], now: at(1) });
    // 2) cevap geçişi: anlama katmanı şikâyet + otopark gördü; kelime ağı yine şikâyet.
    const out = await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId,
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "complaint_issue" }, { intent: "parking" }], lexicalLabels: ["complaint"] }) }],
      now: at(2),
    });
    expect(out.map((i) => [i.kind, i.sensitivity, i.riskType, i.sources, i.status])).toEqual([
      ["complaint_issue", "sensitive", "complaint", ["lexical", "understanding"], "open"],
      ["parking", "none", null, ["understanding"], "open"],
    ]);
  });

  it("hassaslık ASLA düşmez; tekrar yazmak idempotent", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [["m1", "inbound", "IBAN?", 0]]);
    const sensitive = buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] });
    const plain = buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: [] });
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId: ids[0], items: sensitive }], now: at(1) });
    const again = await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId: ids[0], items: plain }], now: at(2) });
    expect(again.map((i) => [i.kind, i.sensitivity, i.riskType])).toEqual([["payment_invoice", "sensitive", "platform_policy"]]);
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [{ messageId: ids[0], items: sensitive }], now: at(3) });
    expect(await prisma.conversationItem.count()).toBe(1);
  });

  it("boş tur yazmaz", async () => {
    const { conversationId } = await seedConversation(orgId, propertyId, [["m1", "inbound", "ok", 0]]);
    expect(await upsertTurnItems(prisma, { organizationId: orgId, conversationId, messages: [], now: at(1) })).toEqual([]);
    expect(await prisma.conversationItem.count()).toBe(0);
  });
});

describe("geçişler — hassas öğe yapay zekânın cevabıyla kapanmaz", () => {
  it("tut → ev sahibinde; cevap YALNIZ hassas olmayanı kapatır; kapanan geri açılmaz", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["iban", "inbound", "IBAN?", 0],
      ["wifi", "inbound", "Wi-Fi?", 1],
    ]);
    const items = await upsertTurnItems(prisma, {
      organizationId: orgId,
      conversationId,
      messages: [
        { messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) },
        { messageId: ids[1], items: buildItemsForMessage({ requests: [{ intent: "wifi" }], lexicalLabels: [] }) },
      ],
      now: at(2),
    });
    const [iban, wifi] = items;
    expect(await applyItemEvent(prisma, { organizationId: orgId, ids: [iban.id], event: "held", now: at(3) })).toBe(1);
    // Bir hata tüm turun öğelerini "cevaplandı" diye işaretlese bile hassas öğe kapanmaz:
    expect(await applyItemEvent(prisma, { organizationId: orgId, ids: [iban.id, wifi.id], event: "answered", now: at(4), answeredByMessageId: "out-1" })).toBe(1);
    const after = await prisma.conversationItem.findMany({ orderBy: { requestIndex: "asc" } });
    const byKind = Object.fromEntries(after.map((r) => [r.kind, r]));
    expect(byKind.payment_invoice.status).toBe("pending_host");
    expect(byKind.payment_invoice.resolvedAt).toBeNull();
    expect(byKind.wifi.status).toBe("answered");
    expect(byKind.wifi.answeredByMessageId).toBe("out-1");
    expect(byKind.wifi.resolvedAt).toEqual(at(4));
    // Kapanan öğe geri açılmaz; ev sahibi kapatır.
    expect(await applyItemEvent(prisma, { organizationId: orgId, ids: [wifi.id], event: "held", now: at(5) })).toBe(0);
    expect(await applyItemEvent(prisma, { organizationId: orgId, ids: [iban.id], event: "host_done", now: at(6) })).toBe(1);
    expect((await prisma.conversationItem.findUnique({ where: { id: iban.id } }))?.status).toBe("done");
  });
});

describe("vazgeçme — acil hariç", () => {
  it("bu turun mesajındaki öğe ve önceki turların aynı türden açık öğeleri kapanır; acil kapanmaz", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["old", "inbound", "Erken giriş olur mu?", 0],
      ["out", "outbound", "Ev sahibinize soruldu.", 1],
      ["gas", "inbound", "Gaz kokusu var", 2],
      ["new", "inbound", "12'de gelebilir miyiz?", 3],
      ["never", "inbound", "Boşverin, 15'te geleceğiz", 4],
    ]);
    const [oldEc] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(1),
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "early_checkin" }], lexicalLabels: [] }) }],
    });
    const turn = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(5),
      messages: [
        { messageId: ids[2], items: buildItemsForMessage({ requests: [{ intent: "emergency" }], lexicalLabels: ["safety_emergency"] }) },
        { messageId: ids[3], items: buildItemsForMessage({ requests: [{ intent: "early_checkin" }], lexicalLabels: [] }) },
        { messageId: ids[4], items: buildItemsForMessage({ requests: [{ intent: "checkin_time" }], lexicalLabels: [] }) },
      ],
    });
    const n = await applyWithdrawals(prisma, {
      organizationId: orgId, conversationId, now: at(6), turnMessageIds: [ids[2], ids[3], ids[4]],
      withdrawals: [
        { kind: "early_checkin", messageId: ids[3] },
        { kind: "early_checkin", earlier: true },
        { kind: "emergency", messageId: ids[2] },
        { kind: "emergency", earlier: true },
      ],
    });
    expect(n).toBe(2);
    const status = async (id: string) => (await prisma.conversationItem.findUnique({ where: { id } }))?.status;
    expect(await status(oldEc.id)).toBe("withdrawn");
    expect(await status(turn.find((i) => i.kind === "early_checkin")!.id)).toBe("withdrawn");
    expect(await status(turn.find((i) => i.kind === "emergency")!.id)).toBe("open");
    expect(await status(turn.find((i) => i.kind === "checkin_time")!.id)).toBe("open");
  });

  it("'önceki' vazgeçme bu turun AYNI türden yeni isteğini kapatmaz ('Boşverin eskisini, 13'te olur mu?')", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["old", "inbound", "11'de gelebilir miyiz?", 0],
      ["new", "inbound", "Boşverin eskisini, 13'te olur mu?", 5],
    ]);
    const [oldEc] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(1),
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "early_checkin" }], lexicalLabels: [] }) }],
    });
    const [newEc] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(6),
      messages: [{ messageId: ids[1], items: buildItemsForMessage({ requests: [{ intent: "early_checkin" }], lexicalLabels: [] }) }],
    });
    await applyWithdrawals(prisma, { organizationId: orgId, conversationId, now: at(7), turnMessageIds: [ids[1]], withdrawals: [{ kind: "early_checkin", earlier: true }] });
    expect((await prisma.conversationItem.findUnique({ where: { id: oldEc.id } }))?.status).toBe("withdrawn");
    expect((await prisma.conversationItem.findUnique({ where: { id: newEc.id } }))?.status).toBe("open");
  });
});

describe("yerine geçme + e-posta devri", () => {
  it("aynı istek tekrar sorulunca eski öğe 'yerine yenisi geldi'; e-posta devralınır (ikinci e-posta yok)", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["a", "inbound", "IBAN?", 0],
      ["b", "inbound", "IBAN'ı atar mısınız artık?", 30],
    ]);
    const [older] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(1),
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) }],
    });
    await applyItemEvent(prisma, { organizationId: orgId, ids: [older.id], event: "held", now: at(2) });
    expect(await claimItemNotification(prisma, { organizationId: orgId, id: older.id, now: at(3) })).toEqual(at(3));
    const turn = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(31),
      messages: [{ messageId: ids[1], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) }],
    });
    expect(await supersedeOlderItems(prisma, { organizationId: orgId, conversationId, turnItems: turn, turnMessageOrder: [ids[1]], now: at(32) })).toBe(1);
    const rows = await prisma.conversationItem.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.messageId === ids[0] ? "old" : "new", r.status, r.notifiedAt?.toISOString() ?? null])).toEqual([
      ["old", "superseded", at(3).toISOString()],
      ["new", "open", at(3).toISOString()],
    ]);
  });

  it("daha az hassas yeni öğe ve acil öğe yerine geçmez", async () => {
    // (Eski fikstür "IBAN? → Fatura keser misiniz?" idi; 09-26 kurucu kararıyla ödeme niyeti kendi başına hassas — ikinci
    // istek artık "daha az hassas" değil. Aynı kural, hâlâ daha az hassas olan bir çiftle: şikâyet etiketli Wi-Fi → düz Wi-Fi.)
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["a", "inbound", "Wi-Fi çalışmıyor, rezalet!", 0],
      ["b", "inbound", "Gaz kokusu", 1],
      ["c", "inbound", "Wi-Fi şifresi neydi?", 30],
      ["d", "inbound", "Acil durum", 31],
    ]);
    await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(2),
      messages: [
        { messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "wifi" }], lexicalLabels: ["complaint"] }) },
        { messageId: ids[1], items: buildItemsForMessage({ requests: [{ intent: "emergency" }], lexicalLabels: [] }) },
      ],
    });
    const turn = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(32),
      messages: [
        { messageId: ids[2], items: buildItemsForMessage({ requests: [{ intent: "wifi" }], lexicalLabels: [] }) },
        { messageId: ids[3], items: buildItemsForMessage({ requests: [{ intent: "emergency" }], lexicalLabels: [] }) },
      ],
    });
    expect(await supersedeOlderItems(prisma, { organizationId: orgId, conversationId, turnItems: turn, turnMessageOrder: [ids[2], ids[3]], now: at(33) })).toBe(0);
    expect(await prisma.conversationItem.count({ where: { status: "superseded" } })).toBe(0);
  });
});

describe("e-posta claim'i", () => {
  it("yalnız ev sahibinde bekleyen öğe, bir kez; geri alma yalnız kendi damgasını", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [["a", "inbound", "IBAN?", 0]]);
    const [item] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(1),
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) }],
    });
    expect(await claimItemNotification(prisma, { organizationId: orgId, id: item.id, now: at(2) })).toBeNull(); // henüz tutulmadı
    await applyItemEvent(prisma, { organizationId: orgId, ids: [item.id], event: "held", now: at(3) });
    expect(await claimItemNotification(prisma, { organizationId: orgId, id: item.id, now: at(4) })).toEqual(at(4));
    expect(await claimItemNotification(prisma, { organizationId: orgId, id: item.id, now: at(5) })).toBeNull();
    expect(await releaseItemNotification(prisma, { organizationId: orgId, id: item.id, claimedAt: at(9) })).toBe(false);
    expect(await releaseItemNotification(prisma, { organizationId: orgId, id: item.id, claimedAt: at(4) })).toBe(true);
    expect(await claimItemNotification(prisma, { organizationId: orgId, id: item.id, now: at(6) })).toEqual(at(6));
  });
});

describe("okuma — 'ev sahibi yazdı' türetilir", () => {
  it("ev sahibi öğenin mesajından SONRA yazdıysa açık öğe 'ev sahibi yazdı'; yapay zekâ mesajı saymaz; eski satır türetilir", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["a", "inbound", "IBAN?", 0],
      ["ai", "outbound", "Wi-Fi şifresi dolapta.", 5, "ai"],
      ["b", "inbound", "Şikâyetim var", 10],
    ]);
    const items = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(11),
      messages: [
        { messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) },
        { messageId: ids[2], items: buildItemsForMessage({ requests: [{ intent: "complaint_issue" }], lexicalLabels: [] }) },
      ],
    });
    await applyItemEvent(prisma, { organizationId: orgId, ids: items.map((i) => i.id), event: "held", now: at(12) });
    expect((await listConversationItems(prisma, { organizationId: orgId, conversationId })).map((i) => i.effective)).toEqual([
      "pending_host",
      "pending_host",
    ]);
    // Ev sahibi 7. dakikada yazsaydı (eski satır: yazar alanı boş, ad yapay zekâ değil) yalnız ilk öğe kapanırdı.
    await prisma.message.create({ data: { conversationId, direction: "outbound", body: "Ödeme platformdan.", senderName: "Ev Sahibi", authorType: null, createdAt: at(7) } });
    expect((await listConversationItems(prisma, { organizationId: orgId, conversationId })).map((i) => i.effective)).toEqual([
      "host_replied",
      "pending_host",
    ]);
    expect(await openItemCounts(prisma, { organizationId: orgId, conversationIds: [conversationId] })).toEqual(new Map([[conversationId, 1]]));
  });
});

describe("kiracı yalıtımı", () => {
  it("başka org'un kimliğiyle hiçbir öğe okunmaz/değişmez/sayılmaz", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [["a", "inbound", "IBAN?", 0]]);
    const [item] = await upsertTurnItems(prisma, {
      organizationId: orgId, conversationId, now: at(1),
      messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: ["platform_policy"] }) }],
    });
    const other = await makeOrgWithProperty();
    expect(await applyItemEvent(prisma, { organizationId: other.orgId, ids: [item.id], event: "held", now: at(2) })).toBe(0);
    expect(await claimItemNotification(prisma, { organizationId: other.orgId, id: item.id, now: at(2) })).toBeNull();
    expect(await listConversationItems(prisma, { organizationId: other.orgId, conversationId })).toEqual([]);
    expect(await openItemCounts(prisma, { organizationId: other.orgId, conversationIds: [conversationId] })).toEqual(new Map());
    expect(
      await applyWithdrawals(prisma, { organizationId: other.orgId, conversationId, now: at(3), turnMessageIds: [], withdrawals: [{ kind: "payment_invoice", earlier: true }] }),
    ).toBe(0);
    expect((await prisma.conversationItem.findUnique({ where: { id: item.id } }))?.status).toBe("open");
  });
});

describe("saklama süresi (KVKK) + silme", () => {
  it("süresi dolan öğe silinir, yenisi kalır; konuşma silinince öğeler de gider", async () => {
    const { conversationId, ids } = await seedConversation(orgId, propertyId, [
      ["a", "inbound", "IBAN?", 0],
      ["b", "inbound", "Wi-Fi?", 1],
    ]);
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, now: at(-60 * 24 * 800), messages: [{ messageId: ids[0], items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }], lexicalLabels: [] }) }] });
    await upsertTurnItems(prisma, { organizationId: orgId, conversationId, now: at(2), messages: [{ messageId: ids[1], items: buildItemsForMessage({ requests: [{ intent: "wifi" }], lexicalLabels: [] }) }] });
    expect(await purgeExpiredConversationItems(prisma, at(-60 * 24 * 700))).toEqual({ deleted: 1 });
    expect(await prisma.conversationItem.count()).toBe(1);
    await prisma.conversation.delete({ where: { id: conversationId } });
    expect(await prisma.conversationItem.count()).toBe(0);
  });
});
