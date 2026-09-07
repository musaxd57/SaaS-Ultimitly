import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// TESLİM ACK'İ ↔ KONUŞMANIN İŞ DURUMU (Codex F05 — P1)
//
// 🚨 KAPATILAN AÇIK: `markConversationDelivered` teslimden sonra `status !=
// closed` olan konuşmayı KOŞULSUZ `answered` yapıyordu. Gönderim-öncesi veto ile
// sağlayıcı cevabı arasında yeni bir misafir mesajı gelip konuşmayı `problem`a
// çevirdiyse (ya da yalnız yeni bir soru bıraktıysa), ESKİ gönderimin tamamlanması
// YENİ sorunu "cevaplandı" diye kapatıyordu — host bir daha görmüyordu.
// `lastMessageAt` de işin `now`ıyla yazılıyordu (geriye kayabilir).
//
// Yeni sözleşme: "answered" kararı KOŞULLUDUR — yanıtın kendi Message'ından
// SONRA gelen inbound yoksa. AI satırı bir `problem` kilidini ASLA ezmez (o
// kilit "thread insana ait" demektir). `lastMessageAt` yalnız ileri yönde yazılır.
// Yarış, gerçek worker + gerçek DB ile, POST içine yerleştirilen olayla ölçülür.
// ---------------------------------------------------------------------------

async function seed(status = "new") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conversation = await prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: "Ayşe",
      status,
      externalReservationId: "res-race",
      lastMessageAt: new Date(Date.now() - 60_000),
      messages: { create: [{ direction: "inbound", senderName: "Ayşe", body: "Wifi?", createdAt: new Date(Date.now() - 60_000) }] },
    },
  });
  return { orgId, conversationId: conversation.id };
}

function enqueue(orgId: string, conversationId: string, author: "host" | "ai", key: string) {
  return enqueueOutbound({
    organizationId: orgId,
    conversationId,
    channel: "airbnb",
    externalReservationId: "res-race",
    reservationId: null,
    body: author === "host" ? "Şifre: 1234" : "Wifi şifresi 1234.",
    senderName: author === "host" ? "Host" : "Lixus AI",
    authorType: author,
    messageType: author === "host" ? "manual" : "ai",
    idempotencyKey: key,
  });
}

const conv = (id: string) => prisma.conversation.findUniqueOrThrow({ where: { id } });
const outbox = (id: string) => prisma.messageOutbox.findUniqueOrThrow({ where: { id } });

/** POST sırasında olan biteni simüle eden gönderici: önce `during`, sonra başarı. */
const sendWith = (during: () => Promise<void>): OutboxSendFn =>
  vi.fn(async () => {
    await during();
    return { ok: true, providerMessageId: "PROV-RACE" };
  });

describe("teslim tamamlanması — yeni inbound/problem EZİLMEZ", () => {
  beforeEach(resetDb);

  it("🚨 Codex kanıtı: POST sırasında yeni şikâyet gelip thread 'problem' olduysa teslim onu 'answered' YAPMAZ", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "host", "k1");
    const send = sendWith(async () => {
      // Veto geçildi, sağlayıcı cevabı bekleniyor; bu sırada misafir yazar ve
      // escalation konuşmayı 'problem'a çevirir (sync + kelime yolu).
      await prisma.message.create({
        data: { conversationId, direction: "inbound", senderName: "Ayşe", body: "Musluk patladı, her yer su!" },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: "problem", lastMessageAt: new Date() } });
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });

    expect((await outbox(outboxId)).status).toBe("sent"); // teslimat gerçeği satırda
    expect((await conv(conversationId)).status).toBe("problem"); // ⬅️ ARIZADA: "answered" — yeni şikâyet kapanıyordu
  });

  it("🚨 POST sırasında yalnız YENİ SORU geldiyse (escalation yok) thread 'new' KALIR — cevapsız mesaj gizlenmez", async () => {
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "k2");
    const send = sendWith(async () => {
      await prisma.message.create({
        data: { conversationId, direction: "inbound", senderName: "Ayşe", body: "Bir de otopark var mı?" },
      });
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect((await conv(conversationId)).status).toBe("new"); // ⬅️ ARIZADA: "answered"
  });

  it("🚨 AI satırı, POST sırasında (yeni mesaj olmadan) konan 'problem' kilidini de EZMEZ", async () => {
    // Escalation'ın kaynağı eski inbound olsa bile (işleme gecikmiş), kilit insana ait.
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "k3");
    const send = sendWith(async () => {
      await prisma.conversation.update({ where: { id: conversationId }, data: { status: "problem" } });
    });
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect((await conv(conversationId)).status).toBe("problem");
  });

  it("KONTROL: HOST yanıtı, daha ESKİ bir inbound'un açtığı 'problem'ı meşru olarak kapatır (insan devraldı)", async () => {
    // Bu olmadan "problem'i asla answered yapma" aşırı-uygulaması da geçerdi.
    const { orgId, conversationId } = await seed("problem");
    await enqueue(orgId, conversationId, "host", "k4");
    const send = sendWith(async () => {});
    await drainOutboxOnce({ send, tokenFor: async () => "tok" });
    expect((await conv(conversationId)).status).toBe("answered");
  });

  it("KONTROL: araya kimse girmezse teslim 'answered' yapar (mevcut davranış)", async () => {
    const { orgId, conversationId } = await seed();
    await enqueue(orgId, conversationId, "ai", "k5");
    await drainOutboxOnce({ send: sendWith(async () => {}), tokenFor: async () => "tok" });
    expect((await conv(conversationId)).status).toBe("answered");
  });

  it("closed thread hiçbir hâlde açılmaz (mevcut değişmez)", async () => {
    const { orgId, conversationId } = await seed("closed");
    await enqueue(orgId, conversationId, "host", "k6");
    await drainOutboxOnce({ send: sendWith(async () => {}), tokenFor: async () => "tok" });
    expect((await conv(conversationId)).status).toBe("closed");
  });
});

describe("lastMessageAt — yalnız İLERİ yönde yazılır", () => {
  beforeEach(resetDb);

  it("🚨 teslim anı, konuşmanın daha YENİ lastMessageAt'ini GERİYE çekmez", async () => {
    const { orgId, conversationId } = await seed();
    const { outboxId } = await enqueue(orgId, conversationId, "host", "k7");
    const future = new Date(Date.now() + 60 * 60_000); // sağlayıcı damgası ileri (yeni inbound)
    await prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: future } });
    const past = new Date(Date.now() - 30 * 60_000); // işin `now`ı geride kalmış (uzun claim / onarım)
    // ⚠️ VACUOUS TUZAĞI (ilk yazımda düşüldü): `now = past` iken satır `availableAt <= now`
    // koşulunu SAĞLAMAZ → claim edilmez → teslim olmaz → iddia bedava geçer. Satır
    // açıkça vadesi gelmiş yapılır; kanıt olarak teslim de asserte edilir.
    await prisma.messageOutbox.update({ where: { id: outboxId }, data: { availableAt: new Date(0) } });
    const res = await drainOutboxOnce({ send: sendWith(async () => {}), tokenFor: async () => "tok", now: () => past });
    expect(res.sent).toBe(1); // teslim GERÇEKTEN oldu
    expect((await conv(conversationId)).lastMessageAt.getTime()).toBe(future.getTime()); // ⬅️ ARIZADA: past
  });

  it("KONTROL: ESKİ lastMessageAt teslim anına İLERLER", async () => {
    const { orgId, conversationId } = await seed(); // seed: lastMessageAt = -60 sn
    await enqueue(orgId, conversationId, "host", "k8");
    const now = new Date(Date.now() + 1000);
    const res = await drainOutboxOnce({ send: sendWith(async () => {}), tokenFor: async () => "tok", now: () => now });
    expect(res.sent).toBe(1);
    expect((await conv(conversationId)).lastMessageAt.getTime()).toBe(now.getTime());
  });
});
