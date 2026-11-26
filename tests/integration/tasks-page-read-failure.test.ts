import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { seedRequestPathOrg, ownerSession } from "../helpers/request-path-fixture";

// ---------------------------------------------------------------------------
// /tasks — SAAT DİLİMİ OKUMASI ÖNE ALINDI, HATA SÖZLEŞMESİ AYNI (optimizasyon turu 11-19). Görev okumaları artık işletme satırını
// beklemez. İkisi birden düşerse sayfa bir hatayla düşer (bugünkü gibi) ve öne alınan okumanın hatası işlenmemiş ret olarak KALMAZ
// (personel görünümünde o okumanın bekleyeni yok — eksik temizlik sayımı yalnız yöneticide). Prisma temsilcisine casus → ayrı dosya.
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
import TasksPage from "@/app/(app)/tasks/page";

describe("/tasks işletme ve görev okuması birlikte düşerse", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("personel görünümü: sayfa düşer, işlenmemiş ret yok", async () => {
    const f = await seedRequestPathOrg({ properties: 1 });
    const staff = await prisma.user.create({ data: { organizationId: f.orgId, email: "tp-staff@test.local", name: "Zeynep", passwordHash: "x" } });
    vi.mocked(requireAuth).mockResolvedValue({ ...ownerSession(f), userId: staff.id, role: "staff" } as never);
    const org = vi.spyOn(prisma.organization, "findUnique").mockImplementation((() => Promise.reject(new Error("org okunamadı"))) as never);
    const task = vi.spyOn(prisma.task, "findMany").mockImplementation((() => Promise.reject(new Error("görev okunamadı"))) as never);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(TasksPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/okunamadı/);
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onUnhandled);
      org.mockRestore();
      task.mockRestore();
    }
    expect(unhandled).toEqual([]);
  });
});
