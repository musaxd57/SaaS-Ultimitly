import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { countPriorOperatorReplies, loadConversationPhase } from "@/lib/operator-replies";

// Kuyruk (DURABLE_OUTBOX_ENABLED) KAPALIYKEN tablo boştur → "misafire ulaşmamış giden mesaj" süzgeci kuyruk tablosunu HİÇ okumaz
// (bugünkü maliyet; `MessageOutbox.conversationId` indekssiz). Prisma temsilcisine casus sonraki testlere sızdığı için AYRI dosya.

describe("selam sayımı — kuyruk kapalıyken kuyruk tablosu okunmaz", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("kapalı → 0 okuma; açık → okur (KONTROL)", async () => {
    await resetDb();
    const { propertyId } = await makeOrgWithProperty();
    const c = await prisma.conversation.create({ data: { propertyId, channel: "airbnb", guestIdentifier: "M", lastMessageAt: new Date() } });
    const spy = vi.spyOn(prisma.messageOutbox, "findMany");
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    await countPriorOperatorReplies(c.id);
    await loadConversationPhase(c.id);
    expect(spy).not.toHaveBeenCalled();
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "1");
    await countPriorOperatorReplies(c.id);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
