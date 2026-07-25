import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Inbox — görsel kalite turu (Codex) + doğrulanmış a11y bulguları.
//
// Pinlenen sözleşmeler:
//   • Sayaç MAKİNE ÇIKTISI değil CÜMLE: tek sayfada "N konuşma", çok sayfada
//     "N konuşmadan a–b arası · Sayfa p / t". "1–4 / 4" gitti.
//   • Tek sayfada sayfalama düğmeleri HİÇ basılmaz (tıklanacak şey yokken
//     görünmemeli).
//   • Arama kutusunun GERÇEK bir etiketi var (placeholder ad değildir) ve form
//     role="search" taşır.
//   • Aktif filtre aria-current ile bildirilir — eskiden YALNIZ renkti, yani
//     ekran okuyucu kullanıcısı boş listeyi "hiç kaydım yok" sanıyordu.
//   • "Acil" ikonu tek başına bilgi taşıyamaz → sr-only metin eşlik eder.
//
// Desen: list-pagination-pages.test.ts ile aynı — sayfa fonksiyonu GERÇEK test
// DB'siyle çağrılır, dönen React ağacı yürünür.
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
import InboxPage from "@/app/(app)/inbox/page";

const mockAuth = vi.mocked(requireAuth);

function treeText(root: unknown): string {
  const parts: string[] = [];
  const collect = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (React.isValidElement(node)) collect((node.props as { children?: unknown }).children);
  };
  collect(root);
  return parts.join("");
}

/** Belirli bir prop'u taşıyan tüm elementleri toplar. */
function elementsWithProp(root: unknown, prop: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as Record<string, unknown>;
      if (props[prop] !== undefined) found.push(props);
      walk(props.children);
    }
  };
  walk(root);
  return found;
}

/**
 * Sayfalama düğmelerinin etiketleri. LinkOrDisabled bir BİLEŞEN olduğu için
 * etiket `children` değil PROP'tur; treeText onu göremez. (Aynı tuzağa
 * list-pagination-pages.test.ts'te TaskBoard için de düşülmüştü.)
 */
function paginationLabels(root: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (React.isValidElement(node)) {
      const props = node.props as { label?: unknown; href?: unknown; children?: unknown };
      if (typeof props.label === "string" && "href" in props) out.push(props.label);
      walk(props.children);
    }
  };
  walk(root);
  return out;
}

function sessionFor(orgId: string) {
  return {
    userId: "user-inbox-test",
    organizationId: orgId,
    role: "owner",
    email: "owner@test.com",
    name: "Owner",
    sessionEpoch: 0,
  } as unknown as Awaited<ReturnType<typeof requireAuth>>;
}

const sp = <T,>(v: T) => Promise.resolve(v);

async function seed(name: string, conversationCount: number, opts: { urgent?: boolean } = {}) {
  const org = await prisma.organization.create({ data: { name } });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Daire A" },
  });
  for (let i = 0; i < conversationCount; i++) {
    await prisma.conversation.create({
      data: {
        propertyId: property.id,
        channel: "airbnb",
        guestIdentifier: `Misafir-${String(i).padStart(3, "0")}`,
        status: "new",
        priority: opts.urgent && i === 0 ? "urgent" : "standard",
        lastMessageAt: new Date(Date.now() - i * 60_000),
      },
    });
  }
  return org;
}

describe("Inbox sayacı — makine çıktısı değil, cümle", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("TEK sayfa: sadece toplam yazar, aralık/sayfa YOK", async () => {
    const org = await seed("Inbox Tek", 4);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({}) }));
    expect(text).toContain("4 konuşma");
    expect(text).not.toContain("1–4"); // eski "1–4 / 4"
    expect(text).not.toContain("Sayfa");
  });

  it("TEK sayfa: sayfalama düğmeleri hiç basılmaz", async () => {
    const org = await seed("Inbox Tek 2", 4);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    expect(paginationLabels(await InboxPage({ searchParams: sp({}) }))).toEqual([]);
  });

  it("ÇOK sayfa: nerede olduğunu SÖYLER ve düğmeler görünür", async () => {
    const org = await seed("Inbox Cok", 55); // 50/sayfa → 2 sayfa
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({}) });
    expect(treeText(tree)).toContain("55 konuşmadan 1–50 arası · Sayfa 1 / 2");
    expect(paginationLabels(tree)).toEqual(["Önceki", "Sonraki"]);
  });

  it("ÇOK sayfa, 2. sayfa: aralık ve sayfa numarası ilerler", async () => {
    const org = await seed("Inbox Cok 2", 55);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({ sayfa: "2" }) }));
    expect(text).toContain("55 konuşmadan 51–55 arası · Sayfa 2 / 2");
  });
});

describe("Inbox erişilebilirliği", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
  });

  it("arama kutusunun GERÇEK etiketi var ve form role=search taşır", async () => {
    const org = await seed("Inbox Ara", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));
    const tree = await InboxPage({ searchParams: sp({}) });

    // Görünmez ama gerçek <label htmlFor> — placeholder bir AD DEĞİLDİR.
    const labels = elementsWithProp(tree, "htmlFor");
    expect(labels.some((p) => p.htmlFor === "inbox-search")).toBe(true);
    expect(treeText(tree)).toContain("Misafir adına göre ara");
    expect(elementsWithProp(tree, "role").some((p) => p.role === "search")).toBe(true);
  });

  it("aktif filtre aria-current ile bildirilir (yalnız renk değil)", async () => {
    const org = await seed("Inbox Filtre", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({ status: "new" }) });
    const current = elementsWithProp(tree, "aria-current").filter(
      (p) => p["aria-current"] === "page",
    );
    // TAM BİR tane: aktif olan. Hepsine konsaydı bilgi yine kaybolurdu.
    expect(current).toHaveLength(1);
  });

  it("filtre seçili değilken hiçbir çip aria-current taşımaz", async () => {
    const org = await seed("Inbox Filtre 2", 3);
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const tree = await InboxPage({ searchParams: sp({}) });
    const current = elementsWithProp(tree, "aria-current").filter(
      (p) => p["aria-current"] === "page",
    );
    expect(current).toHaveLength(1); // "Tümü" aktif
  });

  it("ACİL önceliği ikonun yanında METİN olarak da vardır", async () => {
    const org = await seed("Inbox Acil", 2, { urgent: true });
    mockAuth.mockResolvedValue(sessionFor(org.id));

    const text = treeText(await InboxPage({ searchParams: sp({}) }));
    // lucide <svg> ne <title> ne aria taşır (kod-doğrulandı) → sr-only metin şart.
    expect(text).toContain("Acil");
  });
});
