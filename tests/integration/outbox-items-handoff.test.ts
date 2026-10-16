import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";

// ---------------------------------------------------------------------------
// DEVİR KİLİDİ PARİTESİ — öğe kipi (Opus O1 hazırlık 1.1, 10-16). Satır içi yol öğe kipinde (`AI_CONVERSATION_ITEMS_ENABLED`, canlı)
// "insanla görüşmek istiyorum" niyetli cevaptan sonra yapay zekâyı 12 saat SUSTURMAZ (`automation.ts` `human_request && !itemsPlan` — insan
// talebi ev sahibinde açık kalır, misafirin sonraki güvenli soruları cevap almaya devam eder). Kuyruk yolu (`DURABLE_OUTBOX_ENABLED`) bu ayrımı
// yapmıyordu: bayrak açılınca misafir 12 saat cevapsız kalırdı. Teslim etkisi ve onarıcı artık aynı kuralı izler: TUR (son cevaptan sonraki
// misafir mesajları, tetik dahil) öğe taşıyorsa ve tur düzeyinde (acil / enjeksiyon) tutulmuyorsa kilit kurulmaz.
// ---------------------------------------------------------------------------

const okSend: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "prov-h" }));

type ItemSpec = { on: "trigger" | "first" | "earlier"; sensitivity?: "none" | "sensitive" | "emergency"; riskType?: string | null };

async function seed(opts: { items: ItemSpec[]; twoMessageTurn?: boolean; automationBetween?: boolean }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const c = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new", externalReservationId: "res-h" },
  });
  const t0 = Date.now() - 10 * 60_000;
  const at = (min: number) => new Date(t0 + min * 60_000);
  // Önceki tur: misafir mesajı + ev sahibinin cevabı (turun başını belirler).
  const earlier = await prisma.message.create({
    data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Merhaba, park yeri var mı?", createdAt: at(0) },
  });
  await prisma.message.create({
    data: { conversationId: c.id, direction: "outbound", senderName: "Ev sahibi", authorType: "manual", body: "Evet, var.", createdAt: at(1) },
  });
  const first = await prisma.message.create({
    data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Ev sahibiyle görüşmek istiyorum.", createdAt: at(2) },
  });
  if (opts.automationBetween) {
    // Otomatik şablon mesajı (giriş bilgisi) CEVAP değildir — turu bölmez (`isAnsweringOutbound`).
    await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", senderName: "GuestOps AI", authorType: "automation", body: "Giriş bilgileri.", createdAt: at(3) },
    });
  }
  const trigger = opts.twoMessageTurn
    ? await prisma.message.create({
        data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Teşekkürler.", createdAt: at(4) },
      })
    : first;
  const target = { trigger: trigger.id, first: first.id, earlier: earlier.id };
  for (const [i, it] of opts.items.entries()) {
    await prisma.conversationItem.create({
      data: {
        organizationId: orgId,
        conversationId: c.id,
        messageId: target[it.on],
        kind: i === 0 ? "human_request" : "other",
        sensitivity: it.sensitivity ?? "sensitive",
        riskType: it.riskType ?? null,
        sources: "understanding",
      },
    });
  }
  const r = await enqueueOutbound({
    organizationId: orgId,
    conversationId: c.id,
    channel: "airbnb",
    externalReservationId: "res-h",
    body: "Wi-Fi şifresi Lale2025.",
    senderName: "GuestOps AI",
    authorType: "ai",
    messageType: "ai",
    aiIntent: "human_request",
    idempotencyKey: `auto:${c.id}:${trigger.id}`,
  });
  return { conversationId: c.id, outboxId: r.outboxId };
}

async function holdOf(conversationId: string) {
  return (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).autoReplyHoldUntil;
}

describe("kuyruk teslim etkisi — devir kilidi öğe kipinde KURULMAZ (satır içi yol paritesi)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // Genel kapatma (Y5) açık değilse kuyruktaki yapay zekâ cevabı gönderim anında iptal edilir — teslim yolu sınanamaz.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 öğe kipi turu: human_request cevabı teslim edilince yapay zekâ SUSTURULMAZ", async () => {
    const { conversationId } = await seed({ items: [{ on: "trigger" }] });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(okSend).toHaveBeenCalledTimes(1);
    expect(await holdOf(conversationId)).toBeNull();
  });

  it("öğesiz (eski liste kipi) tur: devir kilidi eskisi gibi KURULUR", async () => {
    const { conversationId } = await seed({ items: [] });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    const hold = await holdOf(conversationId);
    expect(hold).toBeInstanceOf(Date);
    expect(hold!.getTime()).toBeGreaterThan(Date.now());
  });

  it("🚨 iki mesajlı tur (Haiku 10-16): öğe ilk mesajda, tetik 'Teşekkürler' öğesiz → yine öğe kipi, kilit KURULMAZ", async () => {
    const { conversationId } = await seed({ items: [{ on: "first" }], twoMessageTurn: true });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(okSend).toHaveBeenCalledTimes(1);
    expect(await holdOf(conversationId)).toBeNull();
  });

  it("otomatik şablon mesajı turu bölmez: öğe şablondan ÖNCEKİ misafir mesajında → yine öğe kipi", async () => {
    const { conversationId } = await seed({ items: [{ on: "first" }], twoMessageTurn: true, automationBetween: true });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(await holdOf(conversationId)).toBeNull();
  });

  it("ÖNCEKİ turun öğesi bu turu öğe kipi yapmaz (ev sahibi cevabı turu böler) → kilit KURULUR", async () => {
    const { conversationId } = await seed({ items: [{ on: "earlier" }] });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(await holdOf(conversationId)).toBeInstanceOf(Date);
  });

  it("tur düzeyinde tutulan tur (acil öğe) öğe kipi sayılmaz → kilit KURULUR (satır içi `turn_level` → itemsPlan yok)", async () => {
    const { conversationId } = await seed({
      items: [{ on: "trigger" }, { on: "trigger", sensitivity: "emergency", riskType: "safety_emergency" }],
    });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(await holdOf(conversationId)).toBeInstanceOf(Date);
  });

  it("tur düzeyinde tutulan tur (enjeksiyon etiketi) öğe kipi sayılmaz → kilit KURULUR", async () => {
    const { conversationId } = await seed({ items: [{ on: "trigger", riskType: "prompt_injection" }] });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(await holdOf(conversationId)).toBeInstanceOf(Date);
  });

  it("onarıcı da aynı kuralı izler: teslim edilmiş öğe kipi satırında kaçmış kilit KURULMAZ, öğesizde kurulur", async () => {
    const items = await seed({ items: [{ on: "first" }], twoMessageTurn: true });
    const plain = await seed({ items: [] });
    // Teslim edilmiş ama etkisi uygulanmamış satır (settle ile yan etki arasında çökme) — onarıcı yolunu sınar.
    const sentAt = new Date(Date.now() - 60 * 60_000);
    await prisma.messageOutbox.updateMany({ where: { id: { in: [items.outboxId, plain.outboxId] } }, data: { status: "sent", sentAt } });
    await drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });
    expect(okSend).not.toHaveBeenCalled();
    expect(await holdOf(items.conversationId)).toBeNull();
    expect(await holdOf(plain.conversationId)).toBeInstanceOf(Date);
  });
});
