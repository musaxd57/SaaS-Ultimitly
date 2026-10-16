import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce, type OutboxSendFn } from "@/lib/outbox/worker";
import { HANDOFF_EXEMPT_PREFIX, handoffExemptName } from "@/lib/outbox/handoff-exempt";

// ---------------------------------------------------------------------------
// DEVİR KİLİDİ PARİTESİ — öğe kipi (Opus O1 hazırlık 1.1 + dilim kontrolü B1/B2, 10-16). Satır içi yol öğe kipinde
// (`AI_CONVERSATION_ITEMS_ENABLED`, canlı) "insanla görüşmek istiyorum" niyetli cevaptan sonra yapay zekâyı 12 saat SUSTURMAZ
// (`automation.ts` `human_request && !itemsPlan`). Kuyruk yolu (`DURABLE_OUTBOX_ENABLED`) bu kararı bilmiyordu (bayrak açılınca misafir
// 12 saat cevapsız kalırdı). Karar teslimde YENİDEN KURULMAZ (iki yönde de yanıldı — B1: bu geçiş öğe kipine girmedi ama turda eski öğe var →
// kilit atlanıyordu; B2: teslim edilmemiş eski taslak turu bölüyordu): kuyruğa girişte satırla AYNI işlemde işaretlenir, teslim ve onarıcı
// yalnız işarete bakar. İşaret yoksa kilit kurulur (güvenli yön).
// ---------------------------------------------------------------------------

const okSend: OutboxSendFn = vi.fn(async () => ({ ok: true, providerMessageId: "prov-h" }));

async function seed(opts: { exempt: boolean; staleItem?: boolean; key?: string }) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const c = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new", externalReservationId: "res-h" },
  });
  const t0 = Date.now() - 10 * 60_000;
  const first = await prisma.message.create({
    data: { conversationId: c.id, direction: "inbound", senderName: "Misafir", body: "Havuz var mı?", createdAt: new Date(t0) },
  });
  const trigger = await prisma.message.create({
    data: {
      conversationId: c.id,
      direction: "inbound",
      senderName: "Misafir",
      body: "Ev sahibiyle görüşmek istiyorum.",
      createdAt: new Date(t0 + 60_000),
    },
  });
  if (opts.staleItem) {
    // B1: aynı cevapsız turun ÖNCEKİ mesajında önceki bir öğe kipi geçişinin öğesi (cevap gitmemişti). Bu geçiş öğe kipine GİRMEDİ.
    await prisma.conversationItem.create({
      data: { organizationId: orgId, conversationId: c.id, messageId: first.id, kind: "amenities", sensitivity: "none", sources: "understanding" },
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
    idempotencyKey: opts.key ?? `auto:${c.id}:${trigger.id}`,
    handoffHoldExempt: opts.exempt,
  });
  return { orgId, conversationId: c.id, outboxId: r.outboxId, triggerId: trigger.id };
}

async function holdOf(conversationId: string) {
  return (await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } })).autoReplyHoldUntil;
}

const drain = () => drainOutboxOnce({ send: okSend, tokenFor: async () => "t" });

describe("kuyruk teslim etkisi — devir kilidi kuyruğa girişteki karara uyar", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // Genel kapatma (Y5) açık değilse kuyruktaki yapay zekâ cevabı gönderim anında iptal edilir — teslim yolu sınanamaz.
    vi.stubEnv("AUTO_REPLY_ENABLED", "1");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 öğe kipi (işaretli) insan talebi cevabı teslim edilince yapay zekâ SUSTURULMAZ", async () => {
    const { conversationId, outboxId } = await seed({ exempt: true });
    expect(await prisma.systemLock.findUnique({ where: { name: handoffExemptName(outboxId) } })).not.toBeNull();
    await drain();
    expect(okSend).toHaveBeenCalledTimes(1);
    expect(await holdOf(conversationId)).toBeNull();
  });

  it("işaretsiz (öğe kipine girmeyen geçiş) insan talebi cevabı: devir kilidi eskisi gibi KURULUR", async () => {
    const { conversationId } = await seed({ exempt: false });
    await drain();
    const hold = await holdOf(conversationId);
    expect(hold).toBeInstanceOf(Date);
    expect(hold!.getTime()).toBeGreaterThan(Date.now());
  });

  it("🚨 B1: turda önceki geçişin öğesi olsa da bu geçiş işaretlemediyse kilit KURULUR (öğeden yeniden kurma YOK)", async () => {
    const { conversationId } = await seed({ exempt: false, staleItem: true });
    await drain();
    expect(await holdOf(conversationId)).toBeInstanceOf(Date);
  });

  it("işaret teslimde SİLİNMEZ: sonraki geçişin onarıcısı kilidi geri KURMAZ", async () => {
    const { conversationId, outboxId } = await seed({ exempt: true });
    await drain();
    await drain(); // onarıcı (48 sa penceresi) teslim edilmiş satırı yeniden işler
    expect(await holdOf(conversationId)).toBeNull();
    expect(await prisma.systemLock.findUnique({ where: { name: handoffExemptName(outboxId) } })).not.toBeNull();
  });

  it("onarıcı aynı kararı izler: teslim edilmiş ama etkisi kaçmış satırda işaretliye kilit KURULMAZ, işaretsize kurulur", async () => {
    const exempt = await seed({ exempt: true });
    const plain = await seed({ exempt: false });
    // Teslim edilmiş ama etkisi uygulanmamış satır (settle ile yan etki arasında çökme) — onarıcı yolunu sınar.
    const sentAt = new Date(Date.now() - 60 * 60_000);
    await prisma.messageOutbox.updateMany({ where: { id: { in: [exempt.outboxId, plain.outboxId] } }, data: { status: "sent", sentAt } });
    await drain();
    expect(okSend).not.toHaveBeenCalled();
    expect(await holdOf(exempt.conversationId)).toBeNull();
    expect(await holdOf(plain.conversationId)).toBeInstanceOf(Date);
  });

  it("aynı anahtarla tekrar kuyruğa giriş (tekilleştirme) ilk kararı DEĞİŞTİRMEZ: ikinci girişin işareti yazılmaz", async () => {
    const first = await seed({ exempt: false });
    const again = await enqueueOutbound({
      organizationId: first.orgId,
      conversationId: first.conversationId,
      channel: "airbnb",
      externalReservationId: "res-h",
      body: "Wi-Fi şifresi Lale2025.",
      senderName: "GuestOps AI",
      authorType: "ai",
      messageType: "ai",
      aiIntent: "human_request",
      idempotencyKey: `auto:${first.conversationId}:${first.triggerId}`,
      handoffHoldExempt: true,
    });
    expect(again.deduped).toBe(true);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: HANDOFF_EXEMPT_PREFIX } } })).toBe(0);
    await drain();
    expect(await holdOf(first.conversationId)).toBeInstanceOf(Date);
  });

  it("süresi dolan işaret süpürülür, süresi dolmayan kalır", async () => {
    const a = await seed({ exempt: true });
    const b = await seed({ exempt: true });
    await prisma.systemLock.update({ where: { name: handoffExemptName(a.outboxId) }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    await drain();
    expect(await prisma.systemLock.findUnique({ where: { name: handoffExemptName(a.outboxId) } })).toBeNull();
    expect(await prisma.systemLock.findUnique({ where: { name: handoffExemptName(b.outboxId) } })).not.toBeNull();
  });
});
