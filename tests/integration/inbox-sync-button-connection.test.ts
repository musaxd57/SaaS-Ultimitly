import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Gelen kutusu "Mesajları çek" — yalnız mesajlaşma bağlantısı varken (YOL-PLANI-DURUM kapı 2, 10-09). Bağlantısız hesapta
// düğme basınca yalnız "bağlı değil" diyen ölü bir düğmeydi. Bu dosya sayfayı GERÇEK test DB'siyle çağırır ve dönen React
// ağacında düğme bileşenini arar (kaynak-metin pinine ek davranışsal kanıt; inceleme 10-09 (c)). Bağlantı durumu kanal
// katmanından okunur → sahte erişimle iki durum kurulur.
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
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
import InboxPage from "@/app/(app)/inbox/page";
import { HospitableSyncButton } from "@/components/inbox/hospitable-sync-button";
import { __setMessagingAccessForTest } from "@/lib/channels";

const mockAuth = vi.mocked(requireAuth);

function countElements(root: unknown, type: unknown): number {
  let n = 0;
  const walk = (node: unknown): void => {
    if (node == null || typeof node === "boolean") return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (React.isValidElement(node)) {
      if (node.type === type) n++;
      walk((node.props as { children?: unknown }).children);
    }
  };
  walk(root);
  return n;
}

function access(connected: boolean) {
  return {
    provider: "hospitable" as const,
    credentialFor: vi.fn(async () => (connected ? "tok" : null)),
    onCredentialRejected: vi.fn(async () => "noop" as const),
    isConnected: vi.fn(async () => connected),
    activeConnectionId: vi.fn(async () => null),
  };
}

async function render(connected: boolean) {
  const org = await prisma.organization.create({ data: { name: "Inbox Org" } });
  mockAuth.mockResolvedValue({ userId: "u-inbox", organizationId: org.id, role: "owner", email: "o@t.com", name: "Owner", sessionEpoch: 0 } as never);
  const a = access(connected);
  __setMessagingAccessForTest("hospitable", a);
  const tree = await InboxPage({ searchParams: Promise.resolve({}) } as never);
  expect(a.isConnected).toHaveBeenCalledWith(org.id);
  return tree;
}

describe("gelen kutusu — 'Mesajları çek' bağlantıya bağlı", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => __setMessagingAccessForTest("hospitable", null));

  it("🚨 bağlantısız hesap: düğme ÇİZİLMEZ", async () => {
    expect(countElements(await render(false), HospitableSyncButton)).toBe(0);
  });

  it("KONTROL: bağlı hesap: düğme çizilir (kapı her zaman kapalı değil)", async () => {
    expect(countElements(await render(true), HospitableSyncButton)).toBe(1);
  });
});
