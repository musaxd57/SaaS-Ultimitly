import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// /api/ai/test PREVIEW PARITY: the playground must show the reply exactly as the
// real send path composes it — including the host's configured signature (the
// user-reported gap: "imzayı işaretledim ama AI yazmıyor"). No OPENAI_API_KEY in
// tests → suggestReply deterministically uses the fallback, so this runs offline.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/ai/test/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("POST /api/ai/test — signature preview parity", () => {
  async function seed(aiSignature?: string) {
    const { orgId, propertyId } = await makeOrgWithProperty();
    if (aiSignature) await prisma.organization.update({ where: { id: orgId }, data: { aiSignature } });
    const user = await prisma.user.create({
      data: { organizationId: orgId, name: "O", email: `o${Date.now()}@x.com`, passwordHash: "x", role: "owner" },
    });
    session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
    return { orgId, propertyId };
  }

  it("appends the org's signature to the previewed reply (exactly like the real send)", async () => {
    await seed("Sevgiler,\nMusa");
    const res = await POST(req({ message: "Check-in saat kaçta?" }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.reply).toBe("string");
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true);
  });

  it("no signature configured → reply is returned untouched", async () => {
    await seed();
    const res = await POST(req({ message: "Check-in saat kaçta?" }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.reply).not.toContain("Sevgiler");
  });
});
