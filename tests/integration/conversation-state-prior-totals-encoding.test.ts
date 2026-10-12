// ---------------------------------------------------------------------------
// Kesit öncesi cevap toplamlarının boşluk kalıbı Unicode karakter içerir; UTF8 dışı kodlamada (SQL_ASCII) bayt bazında eşleşir ve
// boş OLMAYAN gövdeleri boş sayar (CI #1420: test kümesi SQL_ASCII ile kurulmuştu, sayım 1 yerine 0). Canlı UTF8; başka kodlamada
// sayım YAPILMAZ, fırlatır → yükleyici kayıt bloğunu yazmaz. Prisma `spyOn` sonraki testlere sızmasın diye AYRI dosya.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "../helpers/db";
import { conversationStatePriorTotals, loadConversationState } from "@/lib/ai/conversation-state-loader";

describe("kesit öncesi cevap toplamları — veritabanı kodlaması", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("🚨 UTF8 dışı kodlamada fırlatır (yanlış sayım yerine sayım yok); yükleyici kayıt bloğunu yazmaz", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ encoding: "SQL_ASCII", found: 1, outbound: 3, hostOutbound: 1 }] as never);
    await expect(conversationStatePriorTotals({ conversationId: "c", before: { id: "m" }, excludedIds: [] })).rejects.toThrow(/UTF8 değil/);
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    const state = await loadConversationState({
      organizationId: "o",
      messages: [],
      conversationId: "c",
      priorBefore: { row: { id: "m" }, excludedIds: [] },
    });
    expect(state).toBeUndefined();
  });

  it("KONTROL: UTF8'de sayım döner", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ encoding: "UTF8", found: 1, outbound: 3, hostOutbound: 1 }] as never);
    await expect(conversationStatePriorTotals({ conversationId: "c", before: { id: "m" }, excludedIds: [] })).resolves.toEqual({
      outbound: 3,
      hostOutbound: 1,
    });
  });

  it("test kümesinin kendisi UTF8 (canlıyla aynı; global-setup `initdb -E UTF8`)", async () => {
    const [{ enc }] = await prisma.$queryRaw<{ enc: string }[]>`SELECT current_setting('server_encoding') AS enc`;
    expect(enc).toBe("UTF8");
  });
});
