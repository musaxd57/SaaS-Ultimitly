import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { loadConversationState, loadConversationStateForConversation } from "@/lib/ai/conversation-state-loader";

// ---------------------------------------------------------------------------
// Bayrak KAPALI (varsayılan): yükleyici HİÇ sorgu atmaz ve `undefined` döner → istem bayt bayt aynı (bugünkü davranış).
// Prisma temsilcisine spy ayrı dosyada: sonraki testlere sızmasın (çalışma dersi).
// ---------------------------------------------------------------------------

describe("loadConversationState — bayrak kapalı", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(["", "0", "true", "yes", " 1"])("🚨 bayrak %j → undefined ve SIFIR sorgu (yalnız tam '1' açar)", async (value) => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", value);
    const risk = vi.spyOn(prisma.riskEvent, "findMany");
    const reservation = vi.spyOn(prisma.reservation, "findFirst");
    const message = vi.spyOn(prisma.message, "findMany");
    const msgs = [{ id: "m1", direction: "inbound", senderName: "Ayşe", body: "Merhaba" }];
    expect(await loadConversationState({ organizationId: "org", messages: msgs, reservationId: "res" })).toBeUndefined();
    expect(await loadConversationStateForConversation({ organizationId: "org", conversationId: "c", reservationId: "res" })).toBeUndefined();
    expect(risk).not.toHaveBeenCalled();
    expect(reservation).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
  });

  it("🚨 okuma hatası cevap akışını DURDURMAZ: durum yok (undefined), fırlatma yok", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    vi.spyOn(prisma.riskEvent, "findMany").mockRejectedValue(new Error("db down"));
    vi.spyOn(prisma.message, "findMany").mockRejectedValue(new Error("db down"));
    const msgs = [{ id: "m1", direction: "inbound", senderName: "Ayşe", body: "Merhaba" }];
    await expect(loadConversationState({ organizationId: "org", messages: msgs })).resolves.toBeUndefined();
    await expect(loadConversationStateForConversation({ organizationId: "org", conversationId: "c" })).resolves.toBeUndefined();
  });

  it("KONTROL: bayrak '1' iken aynı çağrı sorgu atar (spy gerçekten bağlı)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const risk = vi.spyOn(prisma.riskEvent, "findMany");
    const msgs = [{ id: "m1", direction: "inbound", senderName: "Ayşe", body: "Merhaba" }];
    await loadConversationState({ organizationId: "org", messages: msgs });
    expect(risk).toHaveBeenCalledTimes(1);
  });
});
