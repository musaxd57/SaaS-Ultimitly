import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Kurucu onayı 11-05 (Tur 7 S7-1, kodda doğrulandı): "AI cevabını gör" deneme kartı kayıtlı yanıt tonunu yok sayıyordu — kart isteğe ton
// koymuyor, rota da işletmenin `aiReplyTone`unu okumayıp "sıcak" kullanıyordu. Kart "aşağıdaki metin misafire birebir gidecek olandır"
// dediği hâlde gerçek gönderim (ve "AI öner") kayıtlı tonu kullanıyor. Artık istek ton vermezse KAYITLI ton (aynı `replyToneOrWarm` kuralı).
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
const tones = vi.hoisted(() => [] as unknown[]);
vi.mock("@/lib/ai", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai")>();
  return {
    ...actual,
    suggestReply: vi.fn((input: Parameters<typeof actual.suggestReply>[0], ...rest: unknown[]) => {
      tones.push((input as { tone?: unknown }).tone);
      return (actual.suggestReply as (...a: unknown[]) => unknown)(input, ...rest);
    }),
  };
});

import { POST } from "@/app/api/ai/test/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/ai/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) };

beforeEach(async () => {
  await resetDb();
  tones.length = 0;
  session = null;
});

async function seed(aiReplyTone?: string) {
  const { orgId } = await makeOrgWithProperty();
  if (aiReplyTone) await prisma.organization.update({ where: { id: orgId }, data: { aiReplyTone } });
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o${Date.now()}@x.com`, passwordHash: "x", role: "owner" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: user.email, name: "O", sessionEpoch: 0 };
}

describe("AI deneme kartı — kayıtlı yanıt tonu", () => {
  it("🚨 kayıtlı ton 'Kısa' → önizleme 'short' tonla kurulur (kart ton göndermez)", async () => {
    await seed("short");
    expect((await POST(req({ message: "Otopark var mı, arabayla geliyoruz?" }), ctx)).status).toBe(200);
    expect(tones).toEqual(["short"]);
  });

  it("istek açıkça ton verirse o kullanılır", async () => {
    await seed("short");
    await POST(req({ message: "Otopark var mı?", tone: "formal" }), ctx);
    expect(tones).toEqual(["formal"]);
  });

  it("KONTROL: kayıtlı ton yok / geçersiz → 'warm' (bugünkü varsayılan)", async () => {
    await seed("bilinmeyen");
    await POST(req({ message: "Otopark var mı?" }), ctx);
    expect(tones).toEqual(["warm"]);
  });
});
