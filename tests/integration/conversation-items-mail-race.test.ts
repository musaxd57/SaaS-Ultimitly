import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { emailService } from "@/lib/email";
import { notifyHeldItems } from "@/lib/conversation-items/flow";
import { applyItemEvent, upsertTurnItems } from "@/lib/conversation-items/store";
import { buildItemsForMessage } from "@/lib/conversation-items/core";

// ---------------------------------------------------------------------------
// K9 İKİNCİ TUR (Codex 10-01): "mesaj başına tek e-posta" öğe düzeyinde tekilleşiyordu — aynı mesajda ödeme + şikâyet öğesi
// varken iki EŞZAMANLI çağrı farklı öğeleri sahiplenip İKİ e-posta atıyordu. Yarış deterministik üretilir: iki çağrının öğe
// okuması bir engelde buluşur (ikisi de "bildirilmemiş" görür), sonra ikisi de sahiplenmeye geçer. Veritabanı temsilcisine spy
// YOK — çağrıya verilen `db` bir Proxy (yalnız `conversationItem.findMany` engelde bekler).
// ---------------------------------------------------------------------------

const mockMail = vi.mocked(emailService.sendReporting);

let orgId: string;
let propertyId: string;

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  mockMail.mockResolvedValue({ ok: true } as never);
  ({ orgId, propertyId } = await makeOrgWithProperty());
});

/** İki çağrının `conversationItem.findMany` okuması ikisi de okuyana kadar bekler. */
function barrierDb(parties: number) {
  let arrived = 0;
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const items = new Proxy(prisma.conversationItem, {
    get(target, prop, recv) {
      if (prop === "findMany") {
        return async (args: Parameters<typeof prisma.conversationItem.findMany>[0]) => {
          const rows = await prisma.conversationItem.findMany(args);
          arrived += 1;
          if (arrived >= parties) open();
          await gate;
          return rows;
        };
      }
      return Reflect.get(target, prop, recv);
    },
  });
  return new Proxy(prisma, {
    get(target, prop, recv) {
      if (prop === "conversationItem") return items;
      return Reflect.get(target, prop, recv);
    },
  }) as typeof prisma;
}

async function seedTwoSensitiveItems() {
  const conversation = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Alex", externalReservationId: `res-${Math.random()}`, status: "new" },
  });
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      body: "IBAN ile ödeyebilir miyim? Ayrıca dün gece gürültüden uyuyamadık.",
      senderName: "Alex",
      authorType: "guest",
    },
  });
  const rows = await upsertTurnItems(prisma, {
    organizationId: orgId,
    conversationId: conversation.id,
    now: new Date(),
    messages: [
      {
        messageId: message.id,
        items: buildItemsForMessage({ requests: [{ intent: "payment_invoice" }, { intent: "complaint_issue" }], lexicalLabels: [] }),
      },
    ],
  });
  await applyItemEvent(prisma, { organizationId: orgId, ids: rows.map((r) => r.id), event: "held", now: new Date() });
  expect(rows.filter((r) => r.sensitivity === "sensitive")).toHaveLength(2);
  return { conversation, message };
}

const input = (conversationId: string, messageId: string, now: Date) => ({
  organizationId: orgId,
  to: "host@example.test",
  orgName: "Org",
  conversation: { id: conversationId, guestIdentifier: "Alex", channel: "airbnb" },
  property: { name: "Lale", address: null, city: null },
  messageIds: [messageId],
  now,
});

describe("K9 — mesaj başına TEK e-posta, eşzamanlı çağrıda da", () => {
  it("🚨 aynı mesajın iki hassas öğesi, iki eşzamanlı çağrı (okumalar engelde buluşur) → TEK e-posta", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const db = barrierDb(2);
    const now = new Date();
    const [a, b] = await Promise.all([
      notifyHeldItems(db, input(conversation.id, message.id, now)),
      notifyHeldItems(db, input(conversation.id, message.id, now)),
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect([...a.mailed, ...b.mailed]).toEqual([message.id]);
    // Kaybeden çağrının öğesi bir sonraki geçişte SESSİZCE damgalanır (ikinci e-posta yok).
    await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(mockMail).toHaveBeenCalledTimes(1);
    const unnotified = await prisma.conversationItem.count({ where: { messageId: message.id, sensitivity: "sensitive", notifiedAt: null } });
    expect(unnotified).toBe(0);
  });

  it("🚨 yarışta KAZANANIN e-postası gidemezse kaybeden de damgasını geri vermiş olmalı — sonraki geçiş bir kez gönderir (e-posta kaybolmaz)", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    const db = barrierDb(2);
    const now = new Date();
    await Promise.all([
      notifyHeldItems(db, input(conversation.id, message.id, now)),
      notifyHeldItems(db, input(conversation.id, message.id, now)),
    ]);
    expect(mockMail).toHaveBeenCalledTimes(1);
    const retry = await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(retry.mailed).toEqual([message.id]);
    expect(mockMail).toHaveBeenCalledTimes(2);
  });

  it("başka bir çağrı mesajın e-posta talebini tutuyorsa e-posta ATILMAZ ve bu çağrının öğe damgaları geri verilir (kayıp yok)", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    await prisma.systemLock.create({ data: { name: `held-items-mail:${message.id}`, lockedUntil: new Date(Date.now() + 60_000) } });
    const out = await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(mockMail).not.toHaveBeenCalled();
    expect(out.mailed).toEqual([]);
    const unnotified = await prisma.conversationItem.count({ where: { messageId: message.id, sensitivity: "sensitive", notifiedAt: null } });
    expect(unnotified).toBe(2);
  });

  it("KONTROL: e-posta gidemezse talep geri verilir — sonraki geçiş yeniden dener ve bir kez gönderir", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    const first = await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(first.failed).toEqual([message.id]);
    const second = await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(second.mailed).toEqual([message.id]);
    expect(mockMail).toHaveBeenCalledTimes(2);
    await notifyHeldItems(prisma, input(conversation.id, message.id, new Date()));
    expect(mockMail).toHaveBeenCalledTimes(2);
  });

  it("KONTROL: farklı mesajlar ayrı e-posta alır (mesaj başına bir)", async () => {
    const one = await seedTwoSensitiveItems();
    const two = await seedTwoSensitiveItems();
    await notifyHeldItems(prisma, input(one.conversation.id, one.message.id, new Date()));
    await notifyHeldItems(prisma, input(two.conversation.id, two.message.id, new Date()));
    expect(mockMail).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Acil bildirim kancası (WhatsApp, tasarım §3.1 dilim 4): e-postanın YANINDA, yerine değil. Kanca mesaj başına talebi kazanan TEK çağrıda
// koşar, e-postayla AYNI ANDA başlar (yavaş sağlayıcı acil e-postayı geciktirmez) ve hatası e-postayı etkilemez.
// ---------------------------------------------------------------------------
describe("acil bildirim kancası (onUrgentMessage)", () => {
  it("🚨 kanca fırlatsa da e-posta gider", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const hook = vi.fn(async () => {
      throw new Error("meta down");
    });
    const out = await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), onUrgentMessage: hook });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(message.id, expect.stringContaining("IBAN"));
    expect(out.mailed).toEqual([message.id]);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("🚨 e-posta kancanın bitmesini BEKLEMEZ (ikisi aynı anda başlar)", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const order: string[] = [];
    let mailed!: () => void;
    const mailSeen = new Promise<void>((r) => (mailed = r));
    mockMail.mockImplementation((async () => {
      order.push("mail");
      mailed();
      return { ok: true };
    }) as never);
    const hook = vi.fn(async () => {
      // E-posta kancadan önce çağrılmazsa 1,5 sn sonra kendi kendine biter (kilitlenme yok, sıra yanlış kalır).
      await Promise.race([mailSeen, new Promise((r) => setTimeout(r, 1_500))]);
      order.push("hook-done");
    });
    await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), onUrgentMessage: hook });
    expect(order).toEqual(["mail", "hook-done"]);
  });

  it("eşzamanlı iki çağrıda kanca TEK kez; bildirilmiş mesaj yeniden işlenince kanca yok", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const hook = vi.fn(async () => null);
    const db = barrierDb(2);
    const now = new Date();
    await Promise.all([
      notifyHeldItems(db, { ...input(conversation.id, message.id, now), onUrgentMessage: hook }),
      notifyHeldItems(db, { ...input(conversation.id, message.id, now), onUrgentMessage: hook }),
    ]);
    expect(hook).toHaveBeenCalledTimes(1);
    // Bildirilmiş mesaj yeniden işlenince kanca yok.
    await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), onUrgentMessage: hook });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it("e-posta düşerse sonraki geçiş kancayı YENİDEN çağırır — ikinci WhatsApp'ı kancanın kendi tekilliği önler (alert:<mesaj>)", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const hook = vi.fn(async () => null);
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), onUrgentMessage: hook });
    await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), onUrgentMessage: hook });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(mockMail).toHaveBeenCalledTimes(2);
  });

  it("e-posta alıcısı yoksa kanca da çağrılmaz (bilinen sınır: bildirim e-postanın yanındadır)", async () => {
    const { conversation, message } = await seedTwoSensitiveItems();
    const hook = vi.fn(async () => null);
    await notifyHeldItems(prisma, { ...input(conversation.id, message.id, new Date()), to: null, onUrgentMessage: hook });
    expect(hook).not.toHaveBeenCalled();
  });
});
