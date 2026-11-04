import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Codex 11-04 P2 — eski bilgi tabanı düzenleyicisi YENİ bilgiyi geri yazamaz. İki sekme aynı kalemi açar; A yeni Wi-Fi şifresini kaydeder;
// B (eski formla) yalnız başlığı değiştirip kaydeder — eskiden B'nin eski içeriği A'nın yeni şifresini sessizce geri getiriyordu.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/kb/[id]/route";
import { KB_STALE_EDIT_MESSAGE } from "@/lib/kb/stale-edit";

const patch = (id: string, body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/kb/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), {
    params: Promise.resolve({ id }),
  });

describe("bilgi tabanı — eski düzenleyici koruması", () => {
  let itemId = "";
  let openedAt = "";
  beforeEach(async () => {
    await resetDb();
    const { orgId, propertyId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O" } as SessionPayload;
    const item = await prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ: Ev_5G, şifre: eski1234", language: "tr" },
    });
    itemId = item.id;
    openedAt = item.updatedAt.toISOString(); // iki sekme de bu sürümle açıldı
  });

  it("🚨 A yeni şifreyi kaydetti → B eski formla (yalnız başlık değişik) kaydedince 409, A'nın içeriği KORUNUR", async () => {
    const a = await patch(itemId, { category: "wifi", title: "Wi-Fi", content: "Ağ: Ev_5G, şifre: yeni5678", expectedUpdatedAt: openedAt });
    expect(a.status).toBe(200);
    const b = await patch(itemId, { category: "wifi", title: "Kablosuz ağ", content: "Ağ: Ev_5G, şifre: eski1234", expectedUpdatedAt: openedAt });
    expect(b.status).toBe(409);
    expect((await b.json()).error).toBe(KB_STALE_EDIT_MESSAGE);
    const row = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(row.content).toBe("Ağ: Ev_5G, şifre: yeni5678");
    expect(row.title).toBe("Wi-Fi");
  });

  it("KONTROL: güncel sürümle kaydetmek geçer; sürüm göndermeyen istek (ör. pasife alma) bugünkü gibi geçer", async () => {
    const first = await patch(itemId, { content: "Ağ: Ev_5G, şifre: yeni5678", expectedUpdatedAt: openedAt });
    expect(first.status).toBe(200);
    const fresh = (await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: itemId } })).updatedAt.toISOString();
    expect((await patch(itemId, { title: "Kablosuz ağ", expectedUpdatedAt: fresh })).status).toBe(200);
    expect((await patch(itemId, { isActive: false })).status).toBe(200);
    expect(await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({ title: "Kablosuz ağ", isActive: false });
  });

  it("geçersiz sürüm metni 400; değişiklik içermeyen kayıt (eski sürümle bile) bir şey yazmadığı için 200", async () => {
    expect((await patch(itemId, { title: "X", expectedUpdatedAt: "dün" })).status).toBe(400);
    await patch(itemId, { content: "Ağ: Ev_5G, şifre: yeni5678", expectedUpdatedAt: openedAt });
    const same = await patch(itemId, { content: "Ağ: Ev_5G, şifre: yeni5678", expectedUpdatedAt: openedAt });
    expect(same.status).toBe(200);
  });
});
