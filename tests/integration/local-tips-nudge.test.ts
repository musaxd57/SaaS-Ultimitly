import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { treeText } from "../helpers/tree-text";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// B1 (kurucu 10-11, "ev sahibi döngüsü"; tasarım `docs/TASARIM-2026-10-11-acil-numara-ve-yer-onerisi.md` §6). Gerçek PostgreSQL.
//  · `localTipsDemand`: son 30 günde mülkte çevre önerisi soran AYRI konuşma sayısı (anlama katmanının `local_recommendations` öğesi);
//    başka mülk / başka kiracı / başka niyet / 30 günden eski sayılmaz.
//  · Mülk sayfası: "Yerel Tavsiye" kalemi YOKSA ve talep varsa hatırlatma; kalem varsa ya da talep yoksa YOK.
//  · Bilgi tabanı sayfası: adresteki ön doldurma forma gider; yabancı mülk yok sayılır.
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
import KnowledgePage from "@/app/(app)/knowledge/page";
import { KbManager } from "@/components/knowledge/kb-manager";
import { localTipsDemand, LOCAL_TIPS_DEMAND_CAP } from "@/lib/local-tips-demand";

const mockAuth = vi.mocked(requireAuth);
const DAY = 86_400_000;

async function seedOrg(name = "Nudge Org") {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale Daire 3", icalToken: `tok-${org.id}` } });
  return { org, property };
}
async function askedLocal(orgId: string, propertyId: string, opts: { daysAgo?: number; kind?: string; times?: number } = {}) {
  const convo = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb" } });
  for (let i = 0; i < (opts.times ?? 1); i++) {
    await prisma.conversationItem.create({
      data: {
        organizationId: orgId,
        conversationId: convo.id,
        messageId: `m-${convo.id}-${i}`,
        kind: opts.kind ?? "local_recommendations",
        sources: "understanding",
        createdAt: new Date(Date.now() - (opts.daysAgo ?? 1) * DAY),
      },
    });
  }
  return convo;
}
const session = (orgId: string, role = "owner") => ({ userId: "u-nudge", organizationId: orgId, role, email: "n@example.com" }) as never;
const renderProperty = (id: string) => PropertyDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

function findElement(node: unknown, match: (el: React.ReactElement) => boolean): React.ReactElement | null {
  if (node == null || typeof node === "boolean") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findElement(n, match);
      if (f) return f;
    }
    return null;
  }
  if (React.isValidElement(node)) {
    if (match(node)) return node;
    return findElement((node.props as { children?: unknown }).children, match);
  }
  return null;
}

describe("localTipsDemand", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("ayrı konuşma sayılır (aynı konuşmadaki iki soru tek misafir); başka niyet / mülk / kiracı / 30 günden eski sayılmaz", async () => {
    const a = await seedOrg();
    const other = await prisma.property.create({ data: { organizationId: a.org.id, name: "Lale Daire 4" } });
    const b = await seedOrg("Başka Org");
    await askedLocal(a.org.id, a.property.id, { times: 2 });
    await askedLocal(a.org.id, a.property.id, { daysAgo: 29 });
    await askedLocal(a.org.id, a.property.id, { daysAgo: 31 });
    await askedLocal(a.org.id, a.property.id, { kind: "wifi" });
    await askedLocal(a.org.id, other.id);
    await askedLocal(b.org.id, b.property.id);
    expect(await localTipsDemand(a.org.id, a.property.id)).toBe(2);
    // Kiracı kapsamı: başka kiracının kimliğiyle bu mülk sorulursa sıfır.
    expect(await localTipsDemand(b.org.id, a.property.id)).toBe(0);
  });

  it(`tavan: en çok ${LOCAL_TIPS_DEMAND_CAP} konuşma okunur`, async () => {
    const a = await seedOrg();
    const convos = await prisma.conversation.createManyAndReturn({
      data: Array.from({ length: LOCAL_TIPS_DEMAND_CAP + 3 }, () => ({ propertyId: a.property.id, guestIdentifier: "M", channel: "airbnb" })),
      select: { id: true },
    });
    await prisma.conversationItem.createMany({
      data: convos.map((c) => ({ organizationId: a.org.id, conversationId: c.id, messageId: `m-${c.id}`, kind: "local_recommendations", sources: "understanding" })),
    });
    expect(await localTipsDemand(a.org.id, a.property.id)).toBe(LOCAL_TIPS_DEMAND_CAP);
  });
});

describe("mülk sayfası — 'Yerel Tavsiye' hatırlatması", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("GUEST_CHAT_ENABLED", "");
    vi.stubEnv("QR_PIN_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kalem yok + son 30 günde 2 misafir sordu → hatırlatma + ön dolu bağlantı", async () => {
    const { org, property } = await seedOrg();
    await askedLocal(org.id, property.id);
    await askedLocal(org.id, property.id);
    mockAuth.mockResolvedValue(session(org.id));
    const tree = await renderProperty(property.id);
    const nudge = findElement(tree, (el) => (el.props as { "data-testid"?: string })["data-testid"] === "local-tips-nudge");
    expect(nudge).not.toBeNull();
    expect(treeText(nudge)).toContain("Son 30 günde 2 misafir");
    const link = findElement(nudge, (el) => typeof (el.props as { href?: string }).href === "string");
    expect((link!.props as { href: string }).href).toBe(
      `/knowledge?property=${property.id}&category=local_tips&title=Yak%C4%B1ndaki+yerler`,
    );
  });

  it("KONTROL: 'Yerel Tavsiye' kalemi varsa hatırlatma YOK (talep olsa da)", async () => {
    const { org, property } = await seedOrg();
    await askedLocal(org.id, property.id);
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: property.id, category: "local_tips", title: "Kahvaltı", content: "Köşedeki fırın", isActive: true },
    });
    mockAuth.mockResolvedValue(session(org.id));
    expect(treeText(await renderProperty(property.id))).not.toContain("çevre önerisi sordu");
  });

  it("KONTROL: talep yoksa hatırlatma YOK", async () => {
    const { org, property } = await seedOrg();
    mockAuth.mockResolvedValue(session(org.id));
    expect(treeText(await renderProperty(property.id))).not.toContain("çevre önerisi sordu");
  });
});

describe("bilgi tabanı sayfası — adresten ön doldurma", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  const managerOf = (tree: unknown) => findElement(tree, (el) => el.type === KbManager);

  it("kendi mülkü → form ön dolu (mülk / kategori / başlık)", async () => {
    const { org, property } = await seedOrg();
    mockAuth.mockResolvedValue(session(org.id));
    const tree = await KnowledgePage({
      searchParams: Promise.resolve({ property: property.id, category: "local_tips", title: "Yakındaki kahvaltı yerleri" }),
    });
    expect((managerOf(tree)!.props as { prefill: unknown }).prefill).toEqual({
      propertyId: property.id,
      category: "local_tips",
      title: "Yakındaki kahvaltı yerleri",
    });
  });

  it("🚨 başka kiracının mülkü → ön doldurma YOK", async () => {
    const { org } = await seedOrg();
    const foreign = await seedOrg("Başka Org");
    mockAuth.mockResolvedValue(session(org.id));
    const tree = await KnowledgePage({ searchParams: Promise.resolve({ property: foreign.property.id, title: "x" }) });
    expect((managerOf(tree)!.props as { prefill: unknown }).prefill).toBeNull();
  });

  it("KONTROL: parametresiz açılış → ön doldurma YOK", async () => {
    const { org } = await seedOrg();
    mockAuth.mockResolvedValue(session(org.id));
    const tree = await KnowledgePage({});
    expect((managerOf(tree)!.props as { prefill: unknown }).prefill).toBeNull();
  });
});
