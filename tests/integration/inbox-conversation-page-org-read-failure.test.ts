import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedRequestPathOrg, ownerSession } from "../helpers/request-path-fixture";

// ---------------------------------------------------------------------------
// /inbox/[id] — İŞLETME OKUMASI ÖNE ALINDI, HATA SÖZLEŞMESİ AYNI (optimizasyon turu 11-19). İşletme satırı artık konuşma okumasıyla aynı
// anda başlar (sayfa 30 sn'de bir yenilenir). Eskiden konuşma yoksa işletme hiç okunmazdı → 404. Şimdi okuma başlamış olsa da: konuşma
// yoksa sonucu beklenmez, hatası yutulur → yine 404 (işlenmemiş ret de yok); konuşma varsa işletme okumasının hatası bugünkü gibi sayfaya
// çıkar. Prisma temsilcisine casus kurulduğu için AYRI dosya (casus sonraki testlere sızmasın).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAuth: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { requireAuth } from "@/lib/auth";
import ConversationPage from "@/app/(app)/inbox/[id]/page";

const sp = <T,>(v: T) => Promise.resolve(v);

describe("/inbox/[id] işletme okuması düşerse", () => {
  beforeEach(async () => {
    await resetDb();
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.$disconnect();
  });

  it("konuşma yok → yine 404 (işletme hatası yutulur, işlenmemiş ret yok)", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    const orgRead = vi.spyOn(prisma.organization, "findUnique").mockImplementation((() => Promise.reject(new Error("org okunamadı"))) as never);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(ConversationPage({ params: sp({ id: "yok" }), searchParams: sp({}) })).rejects.toThrow("NEXT_NOT_FOUND");
      await new Promise((r) => setTimeout(r, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(orgRead).toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("konuşma var → işletme okumasının hatası sayfaya çıkar (bugünkü gibi)", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    vi.spyOn(prisma.organization, "findUnique").mockImplementation((() => Promise.reject(new Error("org okunamadı"))) as never);
    await expect(ConversationPage({ params: sp({ id: f.arrivalConversationIds[0] }), searchParams: sp({}) })).rejects.toThrow("org okunamadı");
  });
});
