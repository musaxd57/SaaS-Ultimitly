import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// U38 (Codex 10-07, 15c8663): TAKVİM KAYNAĞI TAVANI paralel eklemede AŞILMAZ — gerçek PostgreSQL.
// Eski rota sayıp sonra ekliyordu (kilitsiz): 9 kaynak varken iki paralel istek ikisi de 9 saydı → 11 kaynak. Doğru: sayım + ekleme
// tek işlemde, mülk satırı kilitli → tavan her koşulda 10.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/[id]/calendar-sources/route";

const req = (propertyId: string, n: number) =>
  new NextRequest(`http://localhost/api/properties/${propertyId}/calendar-sources`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: `Kanal ${n}`, url: `https://example.com/cal-${n}.ics` }),
  });

async function seed(existing: number) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  for (let i = 0; i < existing; i++) {
    await prisma.calendarSource.create({ data: { propertyId, label: `Var ${i}`, url: `https://example.com/var-${i}.ics` } });
  }
  return propertyId;
}

describe("U38 — takvim kaynağı tavanı atomik", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 9 kaynak varken iki paralel ekleme → yalnız BİRİ başarılı, toplam 10", async () => {
    const propertyId = await seed(9);
    const res = await Promise.all([1, 2].map((n) => POST(req(propertyId, n), { params: Promise.resolve({ id: propertyId }) })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(10); // ⬅️ ARIZADA 11
  });

  it("🚨 5 kaynak varken 8 paralel ekleme → tam 5'i başarılı, toplam 10", async () => {
    const propertyId = await seed(5);
    const res = await Promise.all(
      Array.from({ length: 8 }, (_, n) => POST(req(propertyId, n), { params: Promise.resolve({ id: propertyId }) })),
    );
    expect(res.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(10);
  });

  it("KONTROL: tavanın altında sıralı ekleme çalışır; başka kiracının mülkü reddedilir", async () => {
    const propertyId = await seed(0);
    expect((await POST(req(propertyId, 1), { params: Promise.resolve({ id: propertyId }) })).status).toBe(201);
    expect((await POST(req(propertyId, 2), { params: Promise.resolve({ id: propertyId }) })).status).toBe(201);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(2);
    session = { ...session, organizationId: "baska-org" };
    expect((await POST(req(propertyId, 3), { params: Promise.resolve({ id: propertyId }) })).status).toBe(400);
    expect(await prisma.calendarSource.count({ where: { propertyId } })).toBe(2);
  });
});
