import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { lockProbe } from "../helpers/lock-probe";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-04 P2 — plan sınırı (daire başına etkin bilgi kaydı) eşzamanlı FARKLI yazıcılarla aşılamaz. N−1 etkin kalemde iki farklı ekleme
// (ya da ekleme + etkinleştirme) ikisi de N−1 sayıp geçiyordu → N+1. Ortak mülk kilidi (`lib/kb/cap-lock.ts`) sayım + yazmayı sıraya koyar.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as CREATE } from "@/app/api/kb/route";
import { PATCH } from "@/app/api/kb/[id]/route";
import { __kbCapHooks } from "@/lib/kb/cap-lock";
import { limitsForOrg } from "@/lib/billing/plan-limits";

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const create = (propertyId: string, title: string, requestId: string) =>
  CREATE(json("/api/kb", "POST", { propertyId, category: "faq", title, content: `${title} bilgisi.`, requestId }), { params: Promise.resolve({}) } as never);
const activeCount = (propertyId: string) => prisma.knowledgeBaseItem.count({ where: { propertyId, isActive: true } });

describe("bilgi tabanı plan sınırı — eşzamanlı farklı yazıcılar", () => {
  let propertyId = "";
  let cap = 0;
  beforeEach(async () => {
    await resetDb();
    const made = await makeOrgWithProperty();
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: made.orgId, role: "owner", email: "o@x.com", name: "O" } as SessionPayload;
    cap = (await limitsForOrg(made.orgId)).kbItemsPerProperty;
    await prisma.knowledgeBaseItem.createMany({
      data: Array.from({ length: cap - 1 }, (_, i) => ({ propertyId, category: "faq", title: `K${i}`, content: `Kalem ${i}.`, language: "tr" })),
    });
  });
  afterEach(() => {
    __kbCapHooks.afterCount = null;
  });

  it("🚨 N−1'de iki FARKLI ekleme aynı anda → yalnız biri yazılır (diğeri sınır), kilitli bölgeye aynı anda tek istek", async () => {
    const probe = lockProbe();
    __kbCapHooks.afterCount = probe.hook;
    const [a, b] = await Promise.all([create(propertyId, "Otopark", "req-a"), create(propertyId, "Havuz", "req-b")]);
    expect(probe.maxInside()).toBe(1);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    expect(await activeCount(propertyId)).toBe(cap);
  });

  it("🚨 N−1'de ekleme + pasif bir kalemi ETKİNLEŞTİRME aynı anda → toplam sınırı aşmaz", async () => {
    const passive = await prisma.knowledgeBaseItem.create({ data: { propertyId, category: "faq", title: "Pasif", content: "Pasif kalem.", language: "tr", isActive: false } });
    const probe = lockProbe();
    __kbCapHooks.afterCount = probe.hook;
    const [a, b] = await Promise.all([
      create(propertyId, "Otopark", "req-c"),
      PATCH(json(`/api/kb/${passive.id}`, "PATCH", { isActive: true }), { params: Promise.resolve({ id: passive.id }) }),
    ]);
    expect(probe.maxInside()).toBe(1);
    expect([a.status, b.status].filter((s) => s === 400)).toHaveLength(1);
    expect(await activeCount(propertyId)).toBe(cap);
  });

  it("KONTROL: sınırın altında iki ekleme de yazılır; aynı istek kimliğinin tekrarı kazananın kalemini döner", async () => {
    await prisma.knowledgeBaseItem.deleteMany({ where: { propertyId, title: "K0" } });
    await prisma.knowledgeBaseItem.deleteMany({ where: { propertyId, title: "K1" } });
    const [a, b] = await Promise.all([create(propertyId, "Otopark", "req-d"), create(propertyId, "Havuz", "req-e")]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const again = await create(propertyId, "Otopark", "req-d");
    expect(again.status).toBe(200);
    expect(await activeCount(propertyId)).toBe(cap - 1); // (cap − 1) − 2 silinen + 2 eklenen
  });
});
