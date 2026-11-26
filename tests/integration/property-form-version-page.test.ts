import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Codex 11-17 H2 — mülk sayfası "Daire Ayarları" formuna satırın sürümünü verir. Sayfa ilk açılışta takvim anahtarını üretir (aynı satırı
// yazar, sürüm ilerler): forma yazımdan ÖNCEKİ sürüm verilseydi ev sahibi ilk kaydında kendi sayfasının yazımına çatışma (409) alırdı.
// Sayfa fonksiyonu gerçek test DB'siyle çağrılır, dönen React ağacındaki `PropertyForm` öğesinin özellikleri okunur (istemci bileşeni
// çalışmaz — `property-page-erasure.test.ts` yöntemi).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));

import { requireAuth } from "@/lib/auth";
import PropertyDetailPage from "@/app/(app)/properties/[id]/page";
import { PropertyForm, type PropertyFormData } from "@/components/properties/property-form";

const mockAuth = vi.mocked(requireAuth);

function findFormProperty(node: unknown): PropertyFormData | null {
  if (node == null || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findFormProperty(n);
      if (hit) return hit;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    const props = node.props as { property?: PropertyFormData; children?: unknown };
    if (node.type === PropertyForm) return props.property ?? null;
    return findFormProperty(props.children);
  }
  return null;
}

async function setup(icalToken: string | null) {
  const org = await prisma.organization.create({ data: { name: "Sürüm Org" } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 5", icalToken } });
  // Oluşturma anından belirgin biçimde eski bir sürüm: anahtar yazımının sürümü ilerlettiği kesin görülsün.
  await prisma.$executeRaw`UPDATE "Property" SET "updatedAt" = '2026-01-02 03:04:05.678' WHERE "id" = ${property.id}`;
  mockAuth.mockResolvedValue({ userId: "u-v", organizationId: org.id, role: "owner", email: "v@example.com" } as never);
  const tree = await PropertyDetailPage({ params: Promise.resolve({ id: property.id }), searchParams: Promise.resolve({}) });
  const row = await prisma.property.findUniqueOrThrow({ where: { id: property.id } });
  return { formProps: findFormProperty(tree), row };
}

describe("mülk sayfası — formun sürümü (H2)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "");
    vi.stubEnv("QR_PIN_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 ilk açılışta takvim anahtarı üretildi → form anahtar yazımından SONRAKİ sürümü alır", async () => {
    const { formProps, row } = await setup(null);
    expect(row.icalToken).not.toBeNull();
    expect(row.updatedAt.toISOString()).not.toBe("2026-01-02T03:04:05.678Z");
    expect(formProps?.updatedAt).toBe(row.updatedAt.toISOString());
  });

  it("KONTROL: anahtar zaten varsa sayfa satırı yazmaz, form okunan sürümü alır (milisaniyesiyle)", async () => {
    const { formProps, row } = await setup("tok-surum-test");
    expect(row.updatedAt.toISOString()).toBe("2026-01-02T03:04:05.678Z");
    expect(formProps?.updatedAt).toBe("2026-01-02T03:04:05.678Z");
  });
});
