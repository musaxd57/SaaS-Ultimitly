import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedRequestPathOrg, ownerSession } from "../helpers/request-path-fixture";

// ---------------------------------------------------------------------------
// /dashboard — İKİNCİ TUR ÖNE ALINDI, HATA SÖZLEŞMESİ AYNI (optimizasyon turu 11-19). Kurulum / Dikkat / Bugün / özet okumaları artık
// işletme satırıyla aynı anda başlar. İşletme okuması düşerse sayfa bugünkü gibi O hatayla düşer; öne alınan turun kendi hatası (aynı arıza
// onu da düşürür) işlenmemiş ret olarak kalmaz. Prisma temsilcisine casus kurulduğu için ayrı dosya.
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
vi.mock("@/lib/alert-state", async (orig) => ({
  ...(await orig<typeof import("@/lib/alert-state")>()),
  alertOnTransition: vi.fn().mockResolvedValue(undefined),
}));

import { requireAuth } from "@/lib/auth";
import DashboardPage from "@/app/(app)/dashboard/page";

describe("/dashboard işletme okuması düşerse", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("sayfa işletme hatasıyla düşer; öne alınan turun hatası işlenmemiş ret olmaz", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    vi.mocked(requireAuth).mockResolvedValue(ownerSession(f) as never);
    // İşletme satırı hiç okunamıyor: panonun kendi okuması da, ikinci turdaki bağlantı denetimi de (aynı tablo) düşer.
    const spy = vi.spyOn(prisma.organization, "findUnique").mockImplementation((() => Promise.reject(new Error("org okunamadı"))) as never);
    let orgReads = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(DashboardPage()).rejects.toThrow("org okunamadı");
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
      orgReads = spy.mock.calls.length;
      spy.mockRestore();
    }
    expect(orgReads).toBeGreaterThanOrEqual(2);
    expect(unhandled).toEqual([]);
  });
});
