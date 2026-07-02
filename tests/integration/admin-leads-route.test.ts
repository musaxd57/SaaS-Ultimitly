import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/admin/leads/[id]/route";

const OPERATOR_EMAIL = "operator@lixusai.com";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/admin/leads/x", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeSession(email: string): SessionPayload {
  return { userId: "u", organizationId: "org", role: "owner", email, name: "U", sessionEpoch: 0 };
}

describe("PATCH /api/admin/leads/[id] — operator mini-CRM", () => {
  let leadId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.stubEnv("SUPERADMIN_EMAILS", OPERATOR_EMAIL);
    const lead = await prisma.lead.create({
      data: { name: "Aday Host", email: "aday@example.com", consentAt: new Date() },
    });
    leadId = lead.id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects non-operators (a customer owner is NOT enough)", async () => {
    session = makeSession("customer@example.com");
    const res = await PATCH(req({ status: "contacted" }), ctx(leadId));
    expect(res.status).toBe(401);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("new");
  });

  it("lets the operator move a lead through the pipeline + save note/follow-up", async () => {
    session = makeSession(OPERATOR_EMAIL);
    const res = await PATCH(
      req({ status: "contacted", note: "WhatsApp'tan yazıldı", followUpAt: "2026-07-10" }),
      ctx(leadId),
    );
    expect(res.status).toBe(200);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("contacted");
    expect(lead?.handled).toBe(true); // status past "new" implies handled
    expect(lead?.note).toBe("WhatsApp'tan yazıldı");
    expect(lead?.followUpAt?.toISOString().slice(0, 10)).toBe("2026-07-10");
  });

  it("rejects an unknown status and an invalid date", async () => {
    session = makeSession(OPERATOR_EMAIL);
    expect((await PATCH(req({ status: "hacked" }), ctx(leadId))).status).toBe(400);
    expect((await PATCH(req({ followUpAt: "not-a-date" }), ctx(leadId))).status).toBe(400);
  });

  it("clears note and follow-up with null, keeps status untouched", async () => {
    session = makeSession(OPERATOR_EMAIL);
    await PATCH(req({ status: "demo", note: "n", followUpAt: "2026-07-10" }), ctx(leadId));
    const res = await PATCH(req({ note: null, followUpAt: null }), ctx(leadId));
    expect(res.status).toBe(200);
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    expect(lead?.status).toBe("demo");
    expect(lead?.note).toBeNull();
    expect(lead?.followUpAt).toBeNull();
  });

  it("404 for a missing lead id", async () => {
    session = makeSession(OPERATOR_EMAIL);
    const res = await PATCH(req({ status: "won" }), ctx("nonexistent"));
    expect(res.status).toBe(404);
  });
});
