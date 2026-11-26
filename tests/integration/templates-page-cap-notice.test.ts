import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ŞABLONLAR SAYFASI — SINIRA YAKLAŞINCA UYARI (kurucu 11-20 sabah Ş-2: "Evet, 450'de uyarı"). Sayı işletmenin bütün özel şablonları
// (pasifler dahil — sınırın saydığıyla aynı), sınır işletmenin yürürlükteki sınırı (plan tablosu / acil fren). 449'da satır yok, 450'de
// uyarı, sınırda bugünkü sınır metni. Arama sayıyı değiştirmez.
// ---------------------------------------------------------------------------

let session: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(async () => session),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import TemplatesPage from "@/app/(app)/templates/page";
import { TemplateManager } from "@/components/templates/template-manager";

type ManagerProps = React.ComponentProps<typeof TemplateManager>;

function findProps<P>(node: unknown, type: unknown): P | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findProps<P>(n, type);
      if (hit) return hit;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    if (node.type === type) return node.props as P;
    return findProps<P>((node.props as { children?: unknown }).children, type);
  }
  return null;
}

const notice = async (sp: Record<string, string> = {}) => {
  const props = findProps<ManagerProps>(await TemplatesPage({ searchParams: Promise.resolve(sp) }), TemplateManager);
  expect(props).not.toBeNull();
  return props!.capNotice ?? null;
};

async function seed(n: number, passiveEvery = 0) {
  for (let i = 0; i < n; i += 250) {
    await prisma.messageTemplate.createMany({
      data: Array.from({ length: Math.min(250, n - i) }, (_, k) => ({
        organizationId: orgId,
        category: "general",
        title: `Şablon ${i + k}`,
        body: `Metin ${i + k}.`,
        language: "tr",
        isActive: passiveEvery > 0 ? (i + k) % passiveEvery !== 0 : true,
      })),
    });
  }
}

let orgId = "";
beforeEach(async () => {
  await resetDb();
  orgId = (await makeOrgWithProperty()).orgId;
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
});
afterEach(() => vi.unstubAllEnvs());

describe("/templates — sınır uyarısı (başlangıç sınırı 500)", () => {
  it("🚨 449 şablonda satır YOK", async () => {
    await seed(449);
    expect(await notice()).toBeNull();
  });

  it("🚨 450 şablonda (pasifler dahil sayılır) uyarı satırı; arama sayıyı değiştirmez", async () => {
    await seed(450, 10); // 45'i pasif
    expect(await notice()).toBe("Özel şablon sınırına yaklaşıyorsunuz (450 / 500).");
    expect(await notice({ q: "Şablon 7" })).toBe("Özel şablon sınırına yaklaşıyorsunuz (450 / 500).");
  });

  it("🚨 sınırda bugünkü sınır metni (uyarı satırı yerine)", async () => {
    await seed(500);
    expect(await notice()).toBe("Özel şablon sınırına ulaştınız (500 şablon). Yeni şablon eklemek için kullanmadığınız bir şablonu silin.");
  });

  it("eşik yürürlükteki sınırdan türetilir (acil fren 20 → 18'de uyarı, 17'de yok)", async () => {
    vi.stubEnv("MESSAGE_TEMPLATE_CAP", "20");
    await seed(17);
    expect(await notice()).toBeNull();
    await seed(1);
    expect(await notice()).toBe("Özel şablon sınırına yaklaşıyorsunuz (18 / 20).");
  });
});
