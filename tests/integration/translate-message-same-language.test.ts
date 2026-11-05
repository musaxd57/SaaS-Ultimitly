import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Tur 6 DIL-3 (11-05, ölçüldü, çürütücüyle yeniden üretildi): kayıtlı mesaj dili hedef dile eşitse rota kaynak dili olarak onu verip
// `translate()`in "aynı dil → çevirmeden döndür" kısa devresine düşüyordu. Kayıtlı dil KONUŞMANIN (kanalın) dilidir; "tr" kayıtlı
// İngilizce mesajda "Çevir" ev sahibine orijinali çeviri diye gösteriyordu. Artık o durumda kaynak dil verilmez (model karar verir).
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const calls = vi.hoisted(() => [] as Array<{ text: string; target: string; source: string | undefined }>);
vi.mock("@/lib/ai/translate", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/translate")>()),
  translate: vi.fn(async (text: string, target: string, source?: string) => {
    calls.push({ text, target, source });
    return { ok: true, text: `[${target}] ${text}` };
  }),
}));

import { POST } from "@/app/api/conversations/[id]/translate-message/route";

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  calls.length = 0;
});

async function seed(language: string | null) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const owner = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
  session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Alex", status: "new" } });
  const msg = await prisma.message.create({
    data: { conversationId: conv.id, direction: "inbound", senderName: "Alex", body: "Hello, where can we leave the keys?", language },
  });
  return { convId: conv.id, msgId: msg.id };
}

const post = (convId: string, body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/conversations/${convId}/translate-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: convId }) },
  );

describe("Çevir — kayıtlı dil hedefle aynıysa kaynak dil verilmez", () => {
  it("🚨 kayıtlı 'tr', hedef 'tr' (İngilizce mesaj) → model kaynak dilsiz çağrılır; ev sahibi çeviriyi görür", async () => {
    const { convId, msgId } = await seed("tr");
    const res = await post(convId, { messageId: msgId, targetLanguage: "tr" });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ text: "Hello, where can we leave the keys?", target: "tr", source: undefined }]);
    expect((await res.json()).translation).toBe("[tr] Hello, where can we leave the keys?");
  });

  it("KONTROL: kayıtlı dil hedeften farklıysa kaynak dil aynen verilir", async () => {
    const { convId, msgId } = await seed("en");
    await post(convId, { messageId: msgId, targetLanguage: "tr" });
    expect(calls).toEqual([{ text: "Hello, where can we leave the keys?", target: "tr", source: "en" }]);
  });
});
