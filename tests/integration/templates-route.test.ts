import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// Template creation — pinned around the user-reported bug: the "Tüm mülkler"
// (org-wide) option submits propertyId: null, which the old string-only zod
// shape REJECTED, so every org-wide template creation 400'd with a bare
// "Doğrulama hatası".

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/templates/route";

const ctx = { params: Promise.resolve({}) };

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: "tpl@x.com", passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
  return { orgId, propertyId };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("POST /api/templates", () => {
  it("creates an ORG-WIDE template when propertyId is null (the form's 'Tüm mülkler' shape)", async () => {
    const { orgId } = await seed();
    const res = await POST(req({ title: "Hoş geldiniz", body: "hoşgeldiniz.", category: "general", language: "tr", propertyId: null }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.propertyId).toBeNull();
    expect(row.title).toBe("Hoş geldiniz");
  });

  it("empty-string propertyId also normalizes to org-wide (null)", async () => {
    const { orgId } = await seed();
    const res = await POST(req({ title: "Kurallar", body: "Sigara içilmez.", category: "rules", propertyId: "" }), ctx);
    expect(res.status).toBe(201);
    const row = await prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(row.propertyId).toBeNull();
  });

  it("property-scoped creation still works and foreign property is rejected", async () => {
    const { propertyId } = await seed();
    const ok = await POST(req({ title: "Wi-Fi", body: "Şifre: 1234", category: "wifi", propertyId }), ctx);
    expect(ok.status).toBe(201);

    const foreign = await prisma.organization.create({ data: { name: "Başka Org" } });
    const foreignProp = await prisma.property.create({
      data: { organizationId: foreign.id, name: "yabancı daire" },
    });
    const bad = await POST(req({ title: "Sızma", body: "deneme metni", category: "general", propertyId: foreignProp.id }), ctx);
    expect(bad.status).toBe(400); // tenant isolation: property must belong to the org
  });

  it("missing title returns a FIELD error the UI can show (not just a bare top-level error)", async () => {
    await seed();
    const res = await POST(req({ title: "", body: "içerik metni", category: "general", propertyId: null }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.fields?.title).toBeTruthy();
  });
});
