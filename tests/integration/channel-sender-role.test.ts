import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { importCanonicalThread } from "@/lib/ingest/write-service";
import { isAnsweringOutbound, notAutomationMessageWhere } from "@/lib/message-author";
import { listConversationItems } from "@/lib/conversation-items/store";
import type { CanonicalMessage, CanonicalReservation } from "@/lib/channels/ingest";

// ---------------------------------------------------------------------------
// L5 (kurucu 10-17, migration 71) — gerçek PostgreSQL: kanalın bildirdiği gönderen rolü yazılır; sahiplenme yolu yazmaz; üslup profili ve
// eylem önerileri kanalın KENDİ otomatik mesajını ev sahibinin sesi / sözü saymaz. "Cevap mı" kuralı bu fazda DEĞİŞMEZ (birim pini).
// ---------------------------------------------------------------------------

vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  summarizeHostStyle: vi.fn(async () => "1) TARZ: kısa ve sıcak."),
}));

import { summarizeHostStyle } from "@/lib/ai";
import { refreshStyleProfile } from "@/lib/automation";
import { getConversationSuggestions, getPropertyWifiSuggestions } from "@/lib/ai-suggestions/load";
import { executeHistoryLearnRun, startHistoryLearnRun } from "@/lib/history-learn/service";

const mockSummarize = vi.mocked(summarizeHostStyle);

function reservation(): CanonicalReservation {
  return {
    externalId: "res-l5-1",
    code: "L5CODE",
    channel: "airbnb",
    status: "confirmed",
    arrivalDate: new Date("2026-10-10T00:00:00Z"),
    departureDate: new Date("2026-10-20T00:00:00Z"),
    guest: { externalId: "g-l5", name: "Deniz Misafir", givenName: "Deniz", email: null, phone: null },
    totalAmount: null,
    currency: null,
    conversationExternalId: "conv-l5-1",
    conversationLanguage: null,
    lastMessageAt: new Date("2026-10-12T12:00:00Z"),
    terminal: false,
  };
}

const m = (externalId: string, over: Partial<CanonicalMessage>): CanonicalMessage => ({
  externalId,
  direction: "outbound",
  senderName: "Ev Sahibi",
  body: `gövde ${externalId}`,
  createdAt: new Date("2026-10-12T10:00:00Z"),
  ...over,
});

async function importThread(propertyId: string, messages: CanonicalMessage[]) {
  const p = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { organizationId: true } });
  return prisma.$transaction((tx) =>
    importCanonicalThread(tx, propertyId, reservation(), messages, null, { organizationId: p.organizationId, provider: "hospitable", connectionId: null }),
  );
}

beforeEach(async () => {
  await resetDb();
  mockSummarize.mockClear();
  // Q2 anahtarı (Opus 10-17 Q2-A): bu dosya açık hâli sınar; kapalı hâl ↓ ayrı testte.
  vi.stubEnv("CHANNEL_AUTOMATION_NOT_REPLY_ENABLED", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("senkron yazımı", () => {
  it("🚨 yeni satıra kanalın rolü yazılır (kapalı küme + yön tutarlılığı çekirdekte); rol vermeyen kanal NULL", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [
      m("e-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", createdAt: new Date("2026-10-12T09:00:00Z") }),
      m("e-host", { senderRole: "host", createdAt: new Date("2026-10-12T09:01:00Z") }),
      m("e-auto", { senderRole: "automation", createdAt: new Date("2026-10-12T09:02:00Z") }),
      m("e-none", { createdAt: new Date("2026-10-12T09:03:00Z") }),
      m("e-bad", { direction: "inbound", senderName: "Deniz", senderRole: "automation", createdAt: new Date("2026-10-12T09:04:00Z") }),
      m("e-odd", { senderRole: "weird" as never, createdAt: new Date("2026-10-12T09:05:00Z") }),
    ]);
    const rows = await prisma.message.findMany({ select: { externalId: true, authorType: true, channelSenderRole: true }, orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => [r.externalId, r.authorType, r.channelSenderRole])).toEqual([
      ["e-guest", "guest", "guest"],
      ["e-host", "host", "host"],
      ["e-auto", "automation", "automation"], // Q2 (kurucu 10-17): kanalın kendi otomatik mesajı yazar "automation" (bizim şablonumuz gibi)
      ["e-none", "host", null],
      ["e-bad", "guest", "unknown"],
      ["e-odd", "host", "unknown"],
    ]);
  });

  it("🚨 SAHİPLENME yolu rol YAZMAZ: bizim gönderdiğimiz (kimliksiz) ev sahibi mesajı sağlayıcıdan 'otomasyon' etiketiyle dönse de ev sahibi kanıtı kalır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [m("e-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", createdAt: new Date("2026-10-12T09:00:00Z") })]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    const local = await prisma.message.create({
      data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Otopark binanın arkasında.", createdAt: new Date("2026-10-12T09:10:00Z") },
    });
    await importThread(propertyId, [
      m("e-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", createdAt: new Date("2026-10-12T09:00:00Z") }),
      m("e-ours", { body: "Otopark binanın arkasında.", senderRole: "automation", createdAt: new Date("2026-10-12T09:10:01Z") }),
    ]);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ externalId: "e-ours", authorType: "host", channelSenderRole: null });
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(2);
    // Q2: bizim cevabımız "otomasyon" etiketiyle dönse de konuşmayı CEVAPLAR.
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("answered");
  });
});

describe("Q2 — kanalın otomatik mesajı cevap sayılmaz (kurucu 10-17)", () => {
  const guestAt = new Date("2026-10-12T13:55:00Z");
  const tmplAt = new Date("2026-10-12T13:56:00Z");
  const guestQ = () => m("q-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", body: "Otopark var mı?", createdAt: guestAt });

  it("🚨 misafir 13:55 'Otopark var mı?' → kanalın zamanlanmış 'Giriş bilgileri' 13:56: konuşma YENİ kalır, etkinlik anı misafirin mesajı; KONTROL: ev sahibi yazsa cevaplanır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ(), m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileriniz: check-in 15:00 sonrası.", createdAt: tmplAt })]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    expect(conv.status).toBe("new");
    expect(conv.lastMessageAt?.toISOString()).toBe(guestAt.toISOString());
    const tmpl = await prisma.message.findFirstOrThrow({ where: { externalId: "q-tmpl" } });
    expect(isAnsweringOutbound(tmpl)).toBe(false);
    expect(await prisma.message.count({ where: { conversationId: conv.id, direction: "outbound", ...notAutomationMessageWhere() } })).toBe(0);

    // KONTROL (aşırı uygulama yok): aynı mesajı EV SAHİBİ yazınca konuşma cevaplanır.
    await resetDb();
    const { propertyId: p2 } = await makeOrgWithProperty();
    await importThread(p2, [guestQ(), m("q-host", { senderRole: "host", body: "Giriş bilgileriniz: check-in 15:00 sonrası.", createdAt: tmplAt })]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId: p2 } })).status).toBe("answered");
  });

  it("🚨 ANAHTAR KAPALI (varsayılan): bugünkü davranış — otomasyon rolü kaydedilir ama yazar ev sahibi, konuşma cevaplı", async () => {
    vi.stubEnv("CHANNEL_AUTOMATION_NOT_REPLY_ENABLED", "");
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ(), m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileri", createdAt: tmplAt })]);
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "q-tmpl" } })).toMatchObject({ authorType: "host", channelSenderRole: "automation" });
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("answered");
  });

  it.each([
    ["oto-yanıt teslimi doğrulanmadı", "delivery_unverified"],
    ["sağlayıcı arızası", "provider_outage"],
  ])("🚨 Opus Q2-B: konuşmada belirsiz gönderim (%s) varken gelen 'otomasyon' mesajı BİZİM olabilir → ev sahibi yazarıyla yazılır, konuşma yeniden AÇILMAZ (ikinci cevap yok)", async (_n, reason) => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ()]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    await prisma.conversation.update({ where: { id: conv.id }, data: { status: "answered", skippedReason: reason } });
    await importThread(propertyId, [guestQ(), m("q-ours", { senderRole: "automation", body: "Binanın arkasında otopark var.", createdAt: tmplAt })]);
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "q-ours" } })).toMatchObject({ authorType: "host" });
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("answered");
  });

  it("🚨 Opus Q2-B: elle cevabın çift gönderim kalkanı hâlâ tutuluyorsa (belirsiz gönderim) aynı koruma; KONTROL: kalkanın süresi dolmuşsa otomasyon sayılır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ()]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    await prisma.systemLock.create({ data: { name: `outbound-send:${conv.id}:abc`, lockedUntil: new Date(Date.now() + 60_000) } });
    await importThread(propertyId, [guestQ(), m("q-held", { senderRole: "automation", body: "Otopark binanın arkasında.", createdAt: tmplAt })]);
    expect((await prisma.message.findFirstOrThrow({ where: { externalId: "q-held" } })).authorType).toBe("host");
    await prisma.systemLock.update({ where: { name: `outbound-send:${conv.id}:abc` }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await importThread(propertyId, [guestQ(), m("q-held", { senderRole: "automation", body: "Otopark binanın arkasında.", createdAt: tmplAt }), m("q-later", { senderRole: "automation", body: "Çıkış hatırlatması", createdAt: new Date("2026-10-12T14:30:00Z") })]);
    expect((await prisma.message.findFirstOrThrow({ where: { externalId: "q-later" } })).authorType).toBe("automation");
  });

  it("rol vermeyen kanal / tanınmayan rol: bugünkü davranış (cevap sayılır) — yalnız KESİN otomasyon ayrılır", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ(), m("q-none", { body: "Giriş bilgileri", createdAt: tmplAt })]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("answered");
    await resetDb();
    const { propertyId: p2 } = await makeOrgWithProperty();
    await importThread(p2, [guestQ(), m("q-odd", { senderRole: "weird" as never, body: "Giriş bilgileri", createdAt: tmplAt })]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId: p2 } })).status).toBe("answered");
    expect(await prisma.message.findFirstOrThrow({ where: { externalId: "q-odd" } })).toMatchObject({ authorType: "host", channelSenderRole: "unknown" });
  });

  it("🚨 açık iş 'ev sahibi yazdı' diye DÜŞMEZ; KONTROL: ev sahibinin gerçek cevabı düşürür", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ()]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    const guestMsg = await prisma.message.findFirstOrThrow({ where: { externalId: "q-guest" } });
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: conv.id, messageId: guestMsg.id, kind: "payment_invoice", sensitivity: "sensitive", sources: "lexical", status: "pending_host", createdAt: new Date() },
    });
    await importThread(propertyId, [m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileriniz.", createdAt: tmplAt })]);
    expect((await listConversationItems(prisma, { organizationId: orgId, conversationId: conv.id })).map((i) => i.effective)).toEqual(["pending_host"]);
    await importThread(propertyId, [m("q-host", { senderRole: "host", body: "Faturanız e-postanızda.", createdAt: new Date("2026-10-12T14:00:00Z") })]);
    expect((await listConversationItems(prisma, { organizationId: orgId, conversationId: conv.id })).map((i) => i.effective)).toEqual(["host_replied"]);
  });

  it("yeniden senkron aynı kalır; daha önce ev sahibi diye YAZILMIŞ satır geriye dönük değiştirilmez (kayıtlı yazar otorite)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ(), m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileri", createdAt: tmplAt })]);
    await importThread(propertyId, [guestQ(), m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileri", createdAt: tmplAt })]);
    expect(await prisma.message.count({ where: { externalId: "q-tmpl" } })).toBe(1);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("new");

    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    await prisma.message.create({
      data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Eski satır", externalId: "q-old", channelSenderRole: "automation", createdAt: new Date("2026-10-12T13:57:00Z") },
    });
    await importThread(propertyId, [
      guestQ(),
      m("q-tmpl", { senderRole: "automation", body: "Giriş bilgileri", createdAt: tmplAt }),
      m("q-old", { senderRole: "automation", body: "Eski satır", createdAt: new Date("2026-10-12T13:57:00Z") }),
    ]);
    expect((await prisma.message.findFirstOrThrow({ where: { externalId: "q-old" } })).authorType).toBe("host");
    // Kayıtlı yazar otorite: ev sahibi diye yazılmış satır konuşmayı cevaplamış sayılır (yazar ile durum tutarlı).
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("answered");
  });

  it("🚨 Haiku 10-17: misafirin sorusundan sonra BOŞ gövdeli kanal otomasyonu → satır yazılmaz ve konuşma cevaplanmış SAYILMAZ", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ(), m("q-empty", { senderRole: "automation", body: "", createdAt: tmplAt })]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("new");
    expect(await prisma.message.count({ where: { externalId: "q-empty" } })).toBe(0);
    // KONTROL: boş gövdeli EV SAHİBİ mesajı (ör. yalnız fotoğraf) bugünkü gibi cevap sayılır.
    await resetDb();
    const { propertyId: p2 } = await makeOrgWithProperty();
    await importThread(p2, [guestQ(), m("q-photo", { senderRole: "host", body: "", createdAt: tmplAt })]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId: p2 } })).status).toBe("answered");
  });

  it("🚨 Haiku 10-17: sağlayıcı bizim kimliksiz cevabımızın gövdesini BOŞLUK / HARF farkıyla döndürürse yine bizimdir — otomatik mesaj yazılmaz, konuşma cevaplı", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [guestQ()]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    await prisma.message.create({
      data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Otopark binanın arkasında.", createdAt: new Date("2026-10-12T13:56:30Z") },
    });
    await importThread(propertyId, [guestQ(), m("q-norm", { senderRole: "automation", body: "otopark  binanın\narkasında.", createdAt: tmplAt })]);
    expect(await prisma.message.count({ where: { conversationId: conv.id, authorType: "automation" } })).toBe(0);
    // Opus Q2-E: bizim sayılan satırda otomasyon rolü de YAZILMAZ (öğrenme / öneriden düşmesin).
    expect(await prisma.message.count({ where: { conversationId: conv.id, channelSenderRole: "automation" } })).toBe(0);
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("answered");
  });

  it("🚨 yeni konuşmanın İLK senkronunda da (kuyruk / yerel satır yokken) kanal otomasyonu cevap sayılmaz", async () => {
    const { propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [
      m("n-tmpl1", { senderRole: "automation", body: "Rezervasyonunuz için teşekkürler!", createdAt: new Date("2026-10-12T09:00:00Z") }),
      guestQ(),
      m("n-tmpl2", { senderRole: "automation", body: "Giriş bilgileri", createdAt: tmplAt }),
    ]);
    const rows = await prisma.message.findMany({ where: { externalId: { startsWith: "n-" } }, select: { authorType: true } });
    expect(rows.map((r) => r.authorType)).toEqual(["automation", "automation"]);
    expect((await prisma.conversation.findFirstOrThrow({ where: { propertyId } })).status).toBe("new");
  });
});

async function outbound(conversationId: string, body: string, channelSenderRole: string | null, minutesAgo = 5) {
  return prisma.message.create({
    data: { conversationId, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body, channelSenderRole, createdAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
}

describe("kendi gönderimimiz (Haiku 10-17)", () => {
  it("🚨 kuyruktan gönderdiğimiz mesaj (sağlayıcı kimliği kuyruk satırında) kanal 'otomasyon' dese de YENİ satırda rol yazılmaz; KONTROL: kuyrukta olmayan otomasyon yazılır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await importThread(propertyId, [m("e-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", createdAt: new Date("2026-10-12T09:00:00Z") })]);
    const conv = await prisma.conversation.findFirstOrThrow({ where: { propertyId } });
    await prisma.messageOutbox.create({
      data: { organizationId: orgId, conversationId: conv.id, channel: "airbnb", body: "Otopark binanın arkasında.", idempotencyKey: "k-ours", status: "sent", messageType: "manual", providerMessageId: "e-ours" },
    });
    // Senkron konuşmanın TAMAMINI yeniden okur (sağlayıcı bütün sayfaları döner) — misafir mesajı da listede.
    await importThread(propertyId, [
      m("e-guest", { direction: "inbound", senderName: "Deniz", senderRole: "guest", createdAt: new Date("2026-10-12T09:00:00Z") }),
      m("e-ours", { body: "Otopark binanın  arkasında.", senderRole: "automation", createdAt: new Date("2026-10-12T09:10:00Z") }),
      m("e-tmpl", { body: "Giriş bilgileri", senderRole: "automation", createdAt: new Date("2026-10-12T09:11:00Z") }),
    ]);
    const rows = await prisma.message.findMany({
      where: { externalId: { in: ["e-ours", "e-tmpl"] } },
      select: { externalId: true, authorType: true, channelSenderRole: true },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toEqual([
      { externalId: "e-ours", authorType: "host", channelSenderRole: null },
      { externalId: "e-tmpl", authorType: "automation", channelSenderRole: "automation" },
    ]);
    // Q2: kuyruktan giden bizim cevabımız "otomasyon" etiketiyle dönse de konuşmayı CEVAPLAR (ardından gelen şablon cevapsız bırakmaz).
    expect((await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe("answered");
  });
});

describe("üslup profili", () => {
  it("🚨 kanalın otomatik şablonları örneğe GİRMEZ; ev sahibi + rolsüz + tanınmayan rol girer", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test-not-used");
    const { orgId, propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir" } });
    await outbound(c.id, "Rica ederim, iyi tatiller!", "host", 10);
    await outbound(c.id, "Havlular dolapta, keyifli konaklamalar.", null, 9);
    await outbound(c.id, "Her zaman yazabilirsiniz.", "unknown", 8);
    await outbound(c.id, "Dear guest, your check-in details are below.", "automation", 7);
    await outbound(c.id, "Reminder: checkout is at 11:00.", "automation", 6);
    await outbound(c.id, "Otopark bina önünde, ücretsiz.", "host", 5);
    await outbound(c.id, "Kapı kodu giriş günü gelir.", "host", 4);
    const result = await refreshStyleProfile(orgId);
    expect(result.refreshed).toBe(true);
    const samples = (mockSummarize.mock.calls[0][0] as string[]).join("\n");
    expect(samples).not.toContain("check-in details");
    expect(samples).not.toContain("Reminder: checkout");
    for (const kept of ["Rica ederim", "Havlular dolapta", "Her zaman yazabilirsiniz", "Otopark bina önünde", "Kapı kodu"]) expect(samples, kept).toContain(kept);
  });
});

describe("eylem önerileri", () => {
  beforeEach(() => vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "1"));

  it("🚨 Wi-Fi: kanal şablonundaki şifre öneri ÜRETMEZ; aynı değeri ev sahibi yazınca öneri gelir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ LaleNet, şifre: eskiSifre1", isActive: true, source: "host", reviewState: "approved", updatedAt: new Date(Date.now() - 86_400_000) },
    });
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
    await outbound(c.id, "Welcome! Wi-Fi şifresi: YeniSifre22", "automation", 10);
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toEqual([]);
    await outbound(c.id, "Yeni Wi-Fi şifresi: YeniSifre22", "host", 5);
    expect((await getPropertyWifiSuggestions(orgId, propertyId)).map((s) => s.kind)).toEqual(["kb_wifi"]);
  });

  it("🚨 söz: kanal şablonundaki 'yarın teknisyen gelecek' söz önerisi ÜRETMEZ; ev sahibi yazınca üretir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.organization.update({ where: { id: orgId }, data: { autoTaskFromMessageEnabled: true } });
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
    await outbound(c.id, "Yarın teknisyen gelecek.", "automation", 10);
    expect(await getConversationSuggestions(orgId, c.id)).toEqual([]);
    const c2 = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir 2", channel: "airbnb", status: "new" } });
    await outbound(c2.id, "Yarın teknisyen gelecek.", "host", 10);
    expect((await getConversationSuggestions(orgId, c2.id)).map((s) => s.kind)).toEqual(["commitment"]);
  });
});

describe("geçmişten öğren — uçtan uca (gerçek okuma sorgusu)", () => {
  beforeEach(() => {
    vi.stubEnv("HISTORY_LEARN_ENABLED", "1");
    vi.stubEnv("OPENAI_API_KEY", "test-key");
  });

  it("🚨 misafir sorusu → kanalın zamanlanmış şablonu → ev sahibinin cevabı: modele giden çiftin cevabı EV SAHİBİNİN, şablon modele gitmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const t0 = Date.now() - 3 * 86_400_000;
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "closed", lastMessageAt: new Date(t0) } });
    const rows = [
      { direction: "inbound", authorType: "guest", senderName: "Misafir", body: "Otopark var mı?", channelSenderRole: "guest" },
      { direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Giriş bilgileriniz: check-in 15:00 sonrası.", channelSenderRole: "automation" },
      { direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Binanın arkasında ücretsiz otopark var.", channelSenderRole: "host" },
    ];
    for (const [i, m] of rows.entries()) await prisma.message.create({ data: { ...m, conversationId: c.id, createdAt: new Date(t0 + i * 60_000) } });
    const prompts: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      prompts.push(String(body.messages?.at(-1)?.content ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ facts: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const started = (await startHistoryLearnRun({ organizationId: orgId, propertyId, userId: null })) as { runId: string };
    await executeHistoryLearnRun(started.runId, { fetchImpl, apiKey: "k" });
    expect((await prisma.historyLearnRun.findUniqueOrThrow({ where: { id: started.runId } })).pairCount).toBe(1);
    const sent = prompts.join("\n");
    expect(sent).toContain("Binanın arkasında ücretsiz otopark var.");
    expect(sent).not.toContain("Giriş bilgileriniz");
  });
});
