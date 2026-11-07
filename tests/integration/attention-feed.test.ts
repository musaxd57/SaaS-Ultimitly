import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import {
  findAttentionItems,
  ATTENTION_MAX_ITEMS,
  UNANSWERED_HOURS,
  DEPARTING_UNANSWERED_HOURS,
} from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// V2.1 — "DİKKAT GEREKTİRENLER" (salt-okuma exception feed).
//
// NEREDEN GELDİ: panelin KENDİ kodundaki not (dashboard/page.tsx, "AI günlük
// özet" kartı kaldırılırken yazılmış): gerçek bir özet "kutucukların
// GÖSTEREMEDİĞİ şeyleri söylemeli (tekrar eden arıza, cevapsız kalıp çıkışı
// yaklaşan misafir) ve SAKİN GÜNDE HİÇ GÖRÜNMEMELİ". O not önbellek tablosu =
// migration diyordu; HESAPLANAN salt-okuma bir görünüm ise migration istemiyor.
//
// 🚨 BU DOSYADAKİ HER TEST BİR DAVRANIŞ PİNİ:
//  · sakin gün → TAMAMEN BOŞ (aksi hâlde kart duvar kağıdına döner)
//  · cevapsızlık GÖRÜNÜR SON MESAJDAN hesaplanır, `lastMessageAt`ten DEĞİL —
//    `resume-ai` sistem olayı `lastMessageAt`i İLERLETİYOR, yani o alana
//    bakan bir sorgu gerçekten cevapsız bir mesajı KAÇIRIRDI
//  · besleme URL'i (sır) çıktıya GİRMEZ
//  · misafir adı TAŞINMAZ — yeni bir PII yüzeyi açmıyoruz
//  · hiçbir şey YAZILMAZ
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function conversationWithLastMessage(
  propertyId: string,
  opts: {
    direction: "inbound" | "outbound";
    ageHours: number;
    /** Sonradan gelen, misafirin GÖRMEDİĞİ satır (sistem olayı). */
    laterSystemEvent?: boolean;
    reservationId?: string;
    lastMessageAtOverride?: Date;
    /** QR sohbeti "chat" doğar; kanal konuşmaları "airbnb"/"manual"/… */
    channel?: string;
  },
) {
  const at = new Date(Date.now() - opts.ageHours * HOUR);
  const convo = await prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: "Misafir A",
      status: "new",
      lastMessageAt: opts.lastMessageAtOverride ?? at,
      ...(opts.channel ? { channel: opts.channel } : {}),
      ...(opts.reservationId ? { reservationId: opts.reservationId } : {}),
    },
  });
  await prisma.message.create({
    data: {
      conversation: { connect: { id: convo.id } },
      direction: opts.direction,
      senderName: opts.direction === "inbound" ? "Misafir A" : "GuestOps AI",
      body: opts.direction === "inbound" ? "Klima çalışmıyor" : "İlgileniyoruz.",
      createdAt: at,
    },
  });
  if (opts.laterSystemEvent) {
    await prisma.message.create({
      data: {
        conversation: { connect: { id: convo.id } },
        direction: "outbound",
        senderName: "sistem",
        body: "",
        systemEventType: "guest_chat_ai_resumed",
        createdAt: new Date(),
      },
    });
    // 🚨 GERÇEK DAVRANIŞ: resume-ai rotası bu satırı yazarken konuşmanın
    // `lastMessageAt`ini de ŞİMDİ'ye çeker (route.ts).
    await prisma.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date() } });
  }
  return convo.id;
}

describe("dikkat gerektirenler — salt-okuma exception feed", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  // --- 1) SAKİN GÜN -------------------------------------------------------

  it("sakin günde HİÇBİR satır üretmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Sağlıklı besleme + zamanında cevaplanmış konuşma.
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/a.ics", lastStatus: "ok" },
    });
    await conversationWithLastMessage(propertyId, { direction: "outbound", ageHours: 48 });

    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  it("YENİ gelen (henüz eşiğin altındaki) misafir mesajı satır ÜRETMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await conversationWithLastMessage(propertyId, {
      direction: "inbound",
      ageHours: Math.max(0, UNANSWERED_HOURS - 1),
    });
    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  // --- 2) BOZUK BESLEME ---------------------------------------------------

  it("bozuk takvim beslemesi satır üretir — ve URL'i TAŞIMAZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const secretUrl = "https://airbnb.example/calendar/SUPER-GIZLI-TOKEN.ics";
    await prisma.calendarSource.create({
      data: {
        propertyId,
        label: "Airbnb",
        url: secretUrl,
        lastStatus: "error",
        lastResult: "Bağlantıya ulaşılamadı",
        lastSyncedAt: new Date(Date.now() - 2 * HOUR),
      },
    });

    const items = await findAttentionItems(orgId);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("feed_broken");
    // Bozuk besleme bir GÖZLEMDİR: senkron bu hatayı kendisi yazdı.
    expect(items[0].certainty).toBe("observed");
    expect(items[0].sourceLabel).toBe("Airbnb");

    // 🚨 SIR SIZINTISI PİNİ: URL hiçbir alanda geçmez.
    const dumped = JSON.stringify(items);
    expect(dumped).not.toContain("SUPER-GIZLI-TOKEN");
    expect(dumped).not.toContain(secretUrl);
    expect(dumped).not.toMatch(/https?:\/\//);
  });

  // --- 3) CEVAPSIZ MESAJ --------------------------------------------------

  it("eşiği aşan cevapsız misafir mesajı satır üretir", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await conversationWithLastMessage(propertyId, { direction: "inbound", ageHours: UNANSWERED_HOURS + 3 });

    const items = await findAttentionItems(orgId);
    expect(items.map((i) => i.kind)).toEqual(["unanswered_aging"]);
    expect(items[0].hoursWaiting).toBeGreaterThanOrEqual(UNANSWERED_HOURS);
    expect(items[0].certainty).toBe("observed");
  });

  // ── BAĞLANTI KANALA GÖRE (kurucu bildirimi 09-12) ───────────────────────
  //
  // 🚨 BU İKİ SATIR BİR İNCELEME BULGUSUNDAN DOĞDU. Kusur önce yalnız KAYNAK
  // TARAMASIYLA pinlenmişti (`attention-qr-conversation-href.test.ts`) ve o pin
  // YAŞAYAN BİR MUTANT bırakıyordu: `conversationHref(convo.id, "airbnb")` —
  // yani yardımcı çağrılır, `channel` seçilir, iki çağrı noktası da yerinde
  // durur, BEŞ İDDİANIN BEŞİ DE GEÇER ve QR sohbetleri sessizce kanal yüzeyine
  // geri döner. Kaynak taraması tek yönlüdür: metin durur, davranış ölür.

  it("🚨 QR sohbeti KENDİ yüzeyine bağlanır (davranışsal)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await conversationWithLastMessage(propertyId, {
      direction: "inbound",
      ageHours: UNANSWERED_HOURS + 3,
      channel: "chat",
    });

    const items = await findAttentionItems(orgId);
    expect(items).toHaveLength(1);
    expect(items[0].href).toMatch(/^\/guest-chats\//);
    expect(items[0].href).not.toMatch(/^\/inbox\//);
  });

  it("kanal konuşması ESKİSİ GİBİ inbox'a bağlanır (aşırı uygulama kontrolü)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await conversationWithLastMessage(propertyId, {
      direction: "inbound",
      ageHours: UNANSWERED_HOURS + 3,
      channel: "airbnb",
    });

    const items = await findAttentionItems(orgId);
    expect(items).toHaveLength(1);
    expect(items[0].href).toMatch(/^\/inbox\//);
  });

  it("son mesaj BİZDEN ise cevapsız SAYILMAZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await conversationWithLastMessage(propertyId, { direction: "outbound", ageHours: UNANSWERED_HOURS + 10 });
    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  it("🚨 SİSTEM OLAYI lastMessageAt'i ilerletse de cevapsız mesaj KAYBOLMAZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    // Misafir 20 saat önce yazdı; sonra AI yeniden devreye alındı (sistem olayı)
    // ve `lastMessageAt` ŞİMDİ'ye çekildi. Misafire giden bir cevap YOK.
    await conversationWithLastMessage(propertyId, {
      direction: "inbound",
      ageHours: 20,
      laterSystemEvent: true,
    });

    const items = await findAttentionItems(orgId);
    // `lastMessageAt`e bakan bir uygulama burada BOŞ dönerdi — asıl kusur bu.
    expect(items.map((i) => i.kind)).toEqual(["unanswered_aging"]);
    expect(items[0].hoursWaiting).toBeGreaterThanOrEqual(19);
  });

  it("çıkışı yaklaşan misafirin cevapsız mesajı AYRI ve DAHA ÖNCELİKLİ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const soon = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Ayrılan Misafir",
        arrivalDate: new Date(Date.now() - 3 * DAY),
        departureDate: new Date(Date.now() + 6 * HOUR),
        status: "confirmed",
        channel: "manual",
        currency: "EUR",
      },
    });
    await conversationWithLastMessage(propertyId, {
      direction: "inbound",
      ageHours: DEPARTING_UNANSWERED_HOURS + 1,
      reservationId: soon.id,
    });
    // Aynı mülkte, çıkışı yaklaşmayan, daha ESKİ bir cevapsız mesaj.
    await conversationWithLastMessage(propertyId, { direction: "inbound", ageHours: UNANSWERED_HOURS + 40 });

    const items = await findAttentionItems(orgId);
    expect(items.map((i) => i.kind)).toEqual(["departing_unanswered", "unanswered_aging"]);
    // 🚨 Sıralama YAŞA göre değil ÖNEME göre: daha yeni ama çıkışı yaklaşan
    // mesaj, çok daha eski ama misafiri kalmaya devam eden mesajın ÜSTÜNDE.
    expect(items[0].severity).toBeGreaterThan(items[1].severity);
  });

  // --- 4) TEKRAR EDEN ARIZA ----------------------------------------------

  it("örüntü hafızası 'tekrar eden arıza' satırı üretir ve ÇIKARIMDIR", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.propertyMemory.create({
      data: {
        organizationId: orgId,
        propertyId,
        kind: "pattern",
        category: "hot_water",
        title: "hot_water: 4 sinyal / 118 gün",
        source: "signal_pattern",
        sourceRef: "hot_water",
        evidenceJson: JSON.stringify([{ type: "signal", id: "a" }, { type: "signal", id: "b" }, { type: "signal", id: "c" }]),
        confidence: 0.7,
        observedAt: new Date(Date.now() - 2 * DAY),
        status: "active",
      },
    });

    const items = await findAttentionItems(orgId);
    expect(items.map((i) => i.kind)).toEqual(["recurring_issue"]);
    // 🚨 Kelime ağıyla sınıflandırılmış sinyallerden TÜRETİLDİ → gözlem değil.
    expect(items[0].certainty).toBe("inferred");
    expect(items[0].evidenceCount).toBe(3);
  });

  it("KB'den gelen hafıza (source=kb_item) arıza satırı ÜRETMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.propertyMemory.create({
      data: {
        organizationId: orgId,
        propertyId,
        kind: "fact",
        category: "wifi",
        title: "Wi-Fi",
        source: "kb_item",
        sourceRef: "kb1",
        evidenceJson: "[]",
        confidence: 0.9,
        observedAt: new Date(),
        status: "active",
      },
    });
    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  it("retired örüntü satır ÜRETMEZ", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.propertyMemory.create({
      data: {
        organizationId: orgId,
        propertyId,
        kind: "pattern",
        category: "noise",
        title: "noise: 3 sinyal / 40 gün",
        source: "signal_pattern",
        sourceRef: "noise",
        evidenceJson: "[]",
        confidence: 0.6,
        observedAt: new Date(),
        status: "retired",
      },
    });
    expect(await findAttentionItems(orgId)).toEqual([]);
  });

  // --- 5) KİRACI YALITIMI -------------------------------------------------

  it("BAŞKA kiracının satırları HİÇ görünmez (davranışsal)", async () => {
    const a = await makeOrgWithProperty();
    const b = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId: b.propertyId, label: "Airbnb", url: "https://b.example/x.ics", lastStatus: "error" },
    });
    await conversationWithLastMessage(b.propertyId, { direction: "inbound", ageHours: UNANSWERED_HOURS + 5 });
    await prisma.propertyMemory.create({
      data: {
        organizationId: b.orgId,
        propertyId: b.propertyId,
        kind: "pattern",
        category: "hot_water",
        title: "x",
        source: "signal_pattern",
        sourceRef: "hot_water",
        evidenceJson: "[]",
        confidence: 0.6,
        observedAt: new Date(),
        status: "active",
      },
    });

    expect(await findAttentionItems(a.orgId)).toEqual([]);
    expect((await findAttentionItems(b.orgId)).length).toBe(3);
  });

  // --- 6) SALT-OKUMA + TAVAN ---------------------------------------------

  it("HİÇBİR ŞEY YAZMAZ (satır sayıları değişmez)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://x.example/a.ics", lastStatus: "error" },
    });
    await conversationWithLastMessage(propertyId, { direction: "inbound", ageHours: UNANSWERED_HOURS + 2 });

    const before = {
      conversation: await prisma.conversation.count(),
      message: await prisma.message.count(),
      calendarSource: await prisma.calendarSource.count(),
      propertyMemory: await prisma.propertyMemory.count(),
      signal: await prisma.signal.count(),
      auditLog: await prisma.auditLog.count(),
    };
    await findAttentionItems(orgId);
    const after = {
      conversation: await prisma.conversation.count(),
      message: await prisma.message.count(),
      calendarSource: await prisma.calendarSource.count(),
      propertyMemory: await prisma.propertyMemory.count(),
      signal: await prisma.signal.count(),
      auditLog: await prisma.auditLog.count(),
    };
    expect(after).toEqual(before);
  });

  it("liste TAVANI aşmaz ve en önemliler üstte kalır", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    for (let i = 0; i < ATTENTION_MAX_ITEMS + 4; i++) {
      await prisma.calendarSource.create({
        data: { propertyId, label: `Kaynak ${i}`, url: `https://x.example/${i}.ics`, lastStatus: "error" },
      });
    }
    const items = await findAttentionItems(orgId);
    expect(items).toHaveLength(ATTENTION_MAX_ITEMS);
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].severity).toBeGreaterThanOrEqual(items[i].severity);
    }
  });

  it("misafir ADI hiçbir alanda TAŞINMAZ (yeni PII yüzeyi yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const res = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Zeynep Kayaalp",
        arrivalDate: new Date(Date.now() - DAY),
        departureDate: new Date(Date.now() + 5 * HOUR),
        status: "confirmed",
        channel: "manual",
        currency: "EUR",
      },
    });
    const convo = await prisma.conversation.create({
      data: {
        propertyId,
        reservationId: res.id,
        guestIdentifier: "Zeynep Kayaalp",
        status: "new",
        lastMessageAt: new Date(Date.now() - 5 * HOUR),
      },
    });
    await prisma.message.create({
      data: {
        conversation: { connect: { id: convo.id } },
        direction: "inbound",
        senderName: "Zeynep Kayaalp",
        body: "Anahtarı nereye bırakayım?",
        createdAt: new Date(Date.now() - 5 * HOUR),
      },
    });

    const dumped = JSON.stringify(await findAttentionItems(orgId));
    expect(dumped).not.toContain("Zeynep");
    expect(dumped).not.toContain("Kayaalp");
    // Mesaj gövdesi de taşınmaz.
    expect(dumped).not.toContain("Anahtarı");
  });
});
