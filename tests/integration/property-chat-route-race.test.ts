import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// QR "AÇ" YARIŞI — BELİRLENİMCİ (Opus 10-15 B8; mutasyon M6 `Promise.all` testinde YAŞADI). İlk istek mülkü okur (jeton boş), tam o
// anda ikinci istek BAŞTAN SONA koşup jetonu yazar; sonra ilk istek devam eder. Koşullu yazım varsa ilk istek jetonu EZMEZ ve ikisi de
// AYNI jetonu döndürür; koşulsuz yazımda ilk istek ikinci jetonu ezer → ikinci cevabın gösterdiği (basılan) QR ölü kalır.
// AYRI DOSYA: Prisma temsilcisine casus sonraki testlere sızmasın (CLAUDE.md dersi).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/properties/[id]/chat/route";

let interleave: (() => Promise<void>) | null = null;
const realFindFirst = prisma.property.findFirst.bind(prisma.property);
vi.spyOn(prisma.property, "findFirst").mockImplementation((async (args: Parameters<typeof realFindFirst>[0]) => {
  const out = await realFindFirst(args);
  const hook = interleave;
  interleave = null;
  if (hook) await hook();
  return out;
}) as never);

const req = (id: string, body: unknown) =>
  new NextRequest(`http://localhost/api/properties/${id}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("QR aç — okuma ile yazma arasında ikinci 'aç'", () => {
  let propertyId: string;
  beforeEach(async () => {
    await resetDb();
    interleave = null;
    const org = await prisma.organization.create({ data: { name: "Org" } });
    propertyId = (await prisma.property.create({ data: { organizationId: org.id, name: "Daire 1" } })).id;
    session = { userId: "u", organizationId: org.id, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 ilk istek jetonu EZMEZ; iki cevap ve veritabanı AYNI jeton", async () => {
    const ctx = { params: Promise.resolve({ id: propertyId }) };
    let second: { chatToken: string } | null = null;
    interleave = async () => {
      second = (await (await POST(req(propertyId, { enabled: true }), ctx)).json()) as { chatToken: string };
    };
    const first = (await (await POST(req(propertyId, { enabled: true }), ctx)).json()) as { chatToken: string };
    const stored = (await prisma.property.findUniqueOrThrow({ where: { id: propertyId } })).chatToken;
    expect(second).not.toBeNull();
    expect(second!.chatToken).toBe(stored);
    expect(first.chatToken).toBe(stored);
  });
});
