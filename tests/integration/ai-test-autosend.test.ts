import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// /api/ai/test AUTO-SEND preview parity: when the REAL production gate says a
// reply would auto-send, the preview must include the machine-note exactly like
// the real outgoing body (reply → note → signature). A draft (gate says no)
// must stay note-free. The model is mocked to an "openai"-sourced result —
// the gate never passes the fallback source, so this can't be tested offline
// otherwise.

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/ai", () => ({ suggestReply: vi.fn(), classifyMessage: vi.fn() }));

import { suggestReply } from "@/lib/ai";
import { POST } from "@/app/api/ai/test/route";

const mockSuggest = vi.mocked(suggestReply);
const AUTO_NOTE_TR = "(Bu yanıt otomatik asistanımızca hazırlandı; bir hata olursa ekibimiz hemen düzeltir.)";

const SAFE_WIFI = {
  intent: "wifi",
  confidence: 0.9,
  reply: "Wi-Fi ağımız NUVEBUTİK, şifresi Nuve2025.",
  risk: null,
  priority: "standard" as const,
  source: "openai" as const,
  actionSuggestion: null,
  riskLevel: "none" as const,
  detectedLanguage: "tr",
  riskType: null,
  usedSources: [],
  missingInfo: [],
  statedCheckoutTime: null,
};

const req = (message: string) =>
  new NextRequest("http://localhost/api/ai/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
const ctx = { params: Promise.resolve({}) };

let n = 0;
async function seed(opts: { disclosure?: boolean } = {}) {
  const { orgId } = await makeOrgWithProperty();
  await prisma.organization.update({
    where: { id: orgId },
    data: { aiSignature: "Sevgiler,\nMusa", ...(opts.disclosure === false ? { autoReplyDisclosure: false } : {}) },
  });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `a${++n}@x.com`, passwordHash: "x", role: "owner" },
  });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
}

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  session = null;
});

describe("POST /api/ai/test — auto-send verdict + note parity", () => {
  it("gate-clean reply → wouldAutoSend true and the preview carries note ABOVE signature (real outgoing order)", async () => {
    await seed();
    mockSuggest.mockResolvedValue(SAFE_WIFI);
    const json = await (await POST(req("Merhaba, wifi şifresi nedir?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(true);
    expect(json.reply).toContain(AUTO_NOTE_TR);
    expect(json.reply.indexOf(AUTO_NOTE_TR)).toBeGreaterThan(json.reply.indexOf("Nuve2025")); // note after reply
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true); //                                signature last
  });

  it("disclosure OFF → auto-send preview has signature but NO note", async () => {
    await seed({ disclosure: false });
    mockSuggest.mockResolvedValue(SAFE_WIFI);
    const json = await (await POST(req("Merhaba, wifi şifresi nedir?"), ctx)).json();
    expect(json.wouldAutoSend).toBe(true);
    expect(json.reply).not.toContain(AUTO_NOTE_TR);
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true);
  });

  it("gate-blocked reply (refund) → wouldAutoSend false and the DRAFT stays note-free", async () => {
    await seed();
    mockSuggest.mockResolvedValue({ ...SAFE_WIFI, intent: "refund", reply: "İade talebinizi yöneticimize ilettim." });
    const json = await (await POST(req("Kısmi iade istiyorum."), ctx)).json();
    expect(json.wouldAutoSend).toBe(false); // blocklist intent — the gate never lets refunds out
    expect(json.reply).not.toContain(AUTO_NOTE_TR); // manual/approval draft never carries the note
    expect(json.reply.endsWith("Sevgiler,\nMusa")).toBe(true);
  });
});
