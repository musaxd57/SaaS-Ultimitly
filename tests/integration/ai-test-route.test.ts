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

  it("flags a PURE closing (channel would skip/courtesy it) and mirrors the org toggle", async () => {
    const { orgId } = await seed();
    const closing = await (await POST(req({ message: "Tamam, teşekkürler! 🙏" }), ctx)).json();
    expect(closing.closingAck).toBe(true);
    expect(closing.closingReplyEnabled).toBe(false); // default OFF
    expect(closing.closingReplyPreview).toBeNull(); //  nothing would be sent

    await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
    const closing2 = await (await POST(req({ message: "👍" }), ctx)).json();
    expect(closing2.closingAck).toBe(true);
    expect(closing2.closingReplyEnabled).toBe(true);

    // Pure praise is the PRAISE kind (courtesy-class) — not a bare closing.
    const mixed = await (await POST(req({ message: "Çok teşekkürler, her şey harikaydı! 😊" }), ctx)).json();
    expect(mixed.closingKind).toBe("praise");
    // Thanks + a real question is NEITHER — the model answers it normally.
    const question = await (await POST(req({ message: "Teşekkürler! Peki wifi şifresi nedir?" }), ctx)).json();
    expect(question.closingAck).toBe(false);
    expect(question.closingKind).toBeNull();
  });

  it("closing preview shows the EXACT outgoing courtesy — default text, or the host's custom line, + signature", async () => {
    const { orgId } = await seed("Sevgiler,\nMusa");
    await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });

    // Default text (Turkish closing → Turkish default), signature at the end.
    const def = await (await POST(req({ message: "Tamam, teşekkürler! 🙏" }), ctx)).json();
    expect(def.closingReplyPreview.startsWith("Rica ederiz")).toBe(true);
    expect(def.closingReplyPreview.endsWith("Sevgiler,\nMusa")).toBe(true);

    // Custom text wins — verbatim, even for a non-Turkish closing.
    await prisma.organization.update({ where: { id: orgId }, data: { closingReplyText: "Ne demek, her zaman bekleriz!" } });
    const custom = await (await POST(req({ message: "thanks!" }), ctx)).json();
    expect(custom.closingReplyPreview.startsWith("Ne demek, her zaman bekleriz!")).toBe(true);
    expect(custom.closingReplyPreview.endsWith("Sevgiler,\nMusa")).toBe(true);
  });

  it("PRAISE preview: sober feedback text, no machine-note, no emotion claims", async () => {
    const { orgId } = await seed("Sevgiler,\nMusa");
    await prisma.organization.update({ where: { id: orgId }, data: { autoClosingReplyEnabled: true } });
    const praise = await (await POST(req({ message: "Çok teşekkürler, her şey harikaydı! 😊" }), ctx)).json();
    expect(praise.closingKind).toBe("praise");
    expect(praise.closingReplyPreview.startsWith("Güzel geri bildiriminiz için teşekkür ederiz.")).toBe(true);
    expect(praise.closingReplyPreview).not.toContain("otomatik asistanımızca"); // note dropped by design
    expect(praise.closingReplyPreview).not.toContain("sevindim"); //               üslup kuralı
    expect(praise.closingReplyPreview.endsWith("Sevgiler,\nMusa")).toBe(true);
  });
});
