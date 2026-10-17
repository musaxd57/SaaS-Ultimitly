import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { loadConversationState, loadConversationStateForConversation } from "@/lib/ai/conversation-state-loader";
import { reportError } from "@/lib/report-error";

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => undefined) };
});

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
    // QR yükleyicisi önce kiracı kapsamını okur (10-12 gece): o okuma da, ardından gelen mesaj okuması da hata verse sonuç aynı.
    const owner = vi.spyOn(prisma.conversation, "findFirst").mockRejectedValueOnce(new Error("db down"));
    await expect(loadConversationStateForConversation({ organizationId: "org", conversationId: "c" })).resolves.toBeUndefined();
    owner.mockResolvedValueOnce({ id: "c" } as never);
    await expect(loadConversationStateForConversation({ organizationId: "org", conversationId: "c" })).resolves.toBeUndefined();
    expect(owner).toHaveBeenCalledTimes(2);
    // Sessiz değil: üç okuma hatasının üçü de raporlandı (yükleyici + QR yükleyicisinin iki dalı).
    expect(vi.mocked(reportError).mock.calls.filter(([where]) => where === "conversation-state-load")).toHaveLength(3);
  });

  it("KONTROL: bayrak '1' iken aynı çağrı sorgu atar (spy gerçekten bağlı)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const risk = vi.spyOn(prisma.riskEvent, "findMany");
    const msgs = [{ id: "m1", direction: "inbound", senderName: "Ayşe", body: "Merhaba" }];
    await loadConversationState({ organizationId: "org", messages: msgs });
    expect(risk).toHaveBeenCalledTimes(1);
  });
});
