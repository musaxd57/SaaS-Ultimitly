import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ŞABLONLAR SAYFASI SUNUCUDA EN ÇOK 30 KAYIT OKUR (kurucu 11-19 akşam madde 1; T2-B8: sayfa bütün şablonları — pasifler dahil — tam gövdeyle
// okuyordu). Seçiciyle aynı sınırlı sorgu (`lib/template-list.ts`); arama ve sayfa adreste; aralık dışı sayfa son sayfaya yönlenir.
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

const render = async (sp: Record<string, string> = {}) => {
  const tree = await TemplatesPage({ searchParams: Promise.resolve(sp) });
  const props = findProps<ManagerProps>(tree, TemplateManager);
  expect(props).not.toBeNull();
  return props!;
};

let orgId = "";
beforeEach(async () => {
  await resetDb();
  orgId = (await makeOrgWithProperty()).orgId;
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  await prisma.messageTemplate.createMany({
    data: Array.from({ length: 45 }, (_, i) => ({
      organizationId: orgId,
      category: "general",
      title: i === 0 ? "Otopark tarifi" : `Şablon ${i}`,
      body: `Gövde ${i} `.padEnd(5_000, "x"),
      language: "tr",
      isActive: i % 10 !== 5, // pasifler de listelenir ve sayılır
      createdAt: new Date(Date.UTC(2026, 0, 5, 10, i)),
    })),
  });
});

describe("/templates — sınırlı sayfa", () => {
  it("🚨 ilk sayfa 30 satır, tam gövde YOK (önizleme); başlık toplamı 45 (pasifler dahil)", async () => {
    const p = await render();
    expect(p.customTemplates).toHaveLength(30);
    expect(p.totalCount).toBe(45);
    expect(p.listing).toEqual({ query: "", page: 1, pageSize: 30, matchCount: 45 });
    for (const t of p.customTemplates) {
      expect(t).not.toHaveProperty("body");
      expect(t.preview.length).toBeLessThanOrEqual(201);
    }
  });

  it("ikinci sayfa kalan 15; arama BÜTÜN şablonlarda (en eski şablon), başlık yine toplamı gösterir", async () => {
    const p2 = await render({ sayfa: "2" });
    expect(p2.customTemplates).toHaveLength(15);
    expect(p2.listing?.page).toBe(2);
    const found = await render({ q: "otopark" });
    expect(found.customTemplates.map((t) => t.title)).toEqual(["Otopark tarifi"]);
    expect(found.totalCount).toBe(45);
    expect(found.listing).toMatchObject({ query: "otopark", matchCount: 1 });
  });

  it("aralık dışı sayfa son geçerli sayfaya yönlenir (arama korunur)", async () => {
    await expect(render({ sayfa: "9" })).rejects.toThrow("NEXT_REDIRECT:/templates?sayfa=2");
    await expect(render({ q: "şablon", sayfa: "9" })).rejects.toThrow(/NEXT_REDIRECT:\/templates\?q=%C5%9Fablon&sayfa=2/);
  });
});
