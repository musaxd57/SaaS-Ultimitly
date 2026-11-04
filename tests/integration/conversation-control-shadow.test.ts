import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { activeBlocksOf, openBlockBestEffort } from "@/lib/conversation-control/blocks";
import { shadowCompareAutoSend } from "@/lib/conversation-control/shadow";

// ---------------------------------------------------------------------------
// Konuşma kontrolü G0 gölge (tasarım `docs/TASARIM-2026-11-04-konusma-kontrolu.md` §11): engel kaydı tekrar güvenli + metinsiz, okunamayan /
// yazılamayan durum bugünkü akışı düşürmez, gölge kıyası YALNIZ anahtar açıkken ve YALNIZ ayrışmada sayar (metin / kimlik yok).
// ---------------------------------------------------------------------------

async function seedConversation() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const conv = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Deniz", status: "answered", externalReservationId: "res-g0" },
  });
  return { orgId, conversationId: conv.id };
}

const facts = { draftItemIds: [] as string[], newerGuestMessage: false, hostQueued: false, commonVeto: null };
const mismatchEvents = () => prisma.operationalEvent.findMany({ where: { event: "conversation_control.shadow_mismatch" } });

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CONVERSATION_CONTROL_SHADOW_ENABLED", "1");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("engel kaydı — tekrar güvenli, metinsiz", () => {
  it("aynı mesajın aynı türü TEK satır; yeni tehlike mesajı yeni satır (konuşma zaten Sorunlu olsa da)", async () => {
    const { orgId, conversationId } = await seedConversation();
    const base = { organizationId: orgId, conversationId, kind: "safety_incident" as const, evidence: "model:safety_emergency" };
    expect(await openBlockBestEffort({ ...base, sourceMessageId: "m-1" })).toBe(true);
    expect(await openBlockBestEffort({ ...base, sourceMessageId: "m-1" })).toBe(false);
    expect(await openBlockBestEffort({ ...base, sourceMessageId: "m-2" })).toBe(true);
    expect(await prisma.conversationBlock.count({ where: { conversationId } })).toBe(2);
  });

  it("🚨 kanıt alanına metin GİRMEZ: kapalı-küme kod biçimi dışındaki değer boş yazılır", async () => {
    const { orgId, conversationId } = await seedConversation();
    await openBlockBestEffort({ organizationId: orgId, conversationId, kind: "hazard_unverified", sourceMessageId: "m-1", evidence: "Prizden duman çıkıyor!" });
    expect((await prisma.conversationBlock.findFirstOrThrow({ where: { conversationId } })).evidence).toBeNull();
  });

  it("🚨 yazılamayan engel (konuşma yok) fırlatmaz: null döner, ölçüm boşluğu sayılır", async () => {
    const { orgId } = await seedConversation();
    await expect(
      openBlockBestEffort({ organizationId: orgId, conversationId: "yok-boyle-konusma", kind: "safety_incident", sourceMessageId: "m-1", evidence: "model:safety_emergency" }),
    ).resolves.toBeNull();
    expect(await prisma.operationalEvent.count({ where: { event: "conversation_control.block_write_failed" } })).toBe(1);
  });

  it("aktif engeller: çözülmüş olan ve tanınmayan tür okunmaz", async () => {
    const { orgId, conversationId } = await seedConversation();
    await prisma.conversationBlock.createMany({
      data: [
        { organizationId: orgId, conversationId, kind: "safety_incident", sourceMessageId: "m-1", status: "active" },
        { organizationId: orgId, conversationId, kind: "hazard_unverified", sourceMessageId: "m-2", status: "resolved" },
        { organizationId: orgId, conversationId, kind: "bilinmeyen_tur", sourceMessageId: "m-3", status: "active" },
      ],
    });
    expect(await activeBlocksOf(conversationId)).toEqual([{ kind: "safety_incident", scope: "conversation", itemId: null }]);
  });
});

describe("gölge kıyası — yalnız anahtar açıkken, yalnız ayrışmada", () => {
  it("🚨 kurucunun bulduğu hata: açık tehlike varken bugün gönderiliyor → yeni model tutar → TEK sayım (metinsiz kodlar)", async () => {
    const { orgId, conversationId } = await seedConversation();
    await openBlockBestEffort({ organizationId: orgId, conversationId, kind: "safety_incident", sourceMessageId: "m-1", evidence: "model:safety_emergency" });
    await shadowCompareAutoSend({ organizationId: orgId, conversationId, point: "queue", oldAllowed: true, facts, legacyProblem: false });
    const ev = await mismatchEvents();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.dataJson!)).toEqual({ context: "queue", status: "new_blocks_old_sends", reason: "conversation_block", resource: "safety_incident" });
  });

  it("KONTROL: anahtar KAPALI → veritabanına bakılmaz, sayım yok", async () => {
    vi.stubEnv("CONVERSATION_CONTROL_SHADOW_ENABLED", "");
    const { orgId, conversationId } = await seedConversation();
    await openBlockBestEffort({ organizationId: orgId, conversationId, kind: "safety_incident", sourceMessageId: "m-1", evidence: "model:safety_emergency" });
    await shadowCompareAutoSend({ organizationId: orgId, conversationId, point: "queue", oldAllowed: true, facts, legacyProblem: false });
    expect(await mismatchEvents()).toHaveLength(0);
  });

  it("KONTROL: aynı karar → sayım yok; G0 öncesi Sorunlu (legacy) bugün tutuluyorsa yeni model de tutar → sayım yok", async () => {
    const { orgId, conversationId } = await seedConversation();
    await shadowCompareAutoSend({ organizationId: orgId, conversationId, point: "inline", oldAllowed: true, facts, legacyProblem: false });
    await shadowCompareAutoSend({ organizationId: orgId, conversationId, point: "inline", oldAllowed: false, facts, legacyProblem: true });
    expect(await mismatchEvents()).toHaveLength(0);
  });

  it("ters yön: bugün Sorunlu yüzünden tutuluyor ama engel yok (güvenlik dışı yükseltme, G0 sonrası) → yeni model gönderirdi → sayım", async () => {
    const { orgId, conversationId } = await seedConversation();
    await shadowCompareAutoSend({ organizationId: orgId, conversationId, point: "inline", oldAllowed: false, facts, legacyProblem: false });
    const ev = await mismatchEvents();
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.dataJson!)).toEqual({ context: "inline", status: "new_sends_old_blocks", reason: "none", resource: "none" });
  });
});
