import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// BOŞ "KAYDET" YAZMAZ (kurucu kararı 10-12 sabah: "Değişiklik yoksa yazma"). Bilgi tabanı kalemi hiçbir alan değişmeden kaydedilince
// veritabanına yazılmaz → `updatedAt` ilerlemez: yapay zekânın "en güncel kalem" sırası değişmez, ⑤ Wi-Fi önerisinin tazelik denetimi
// (kalem mesajdan sonra düzenlendiyse öneri yok) boş kaydetle bozulmaz. Bir alan değişirse eskisi gibi yazılır.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/kb/[id]/route";
import { getPropertyWifiSuggestions } from "@/lib/ai-suggestions/load";

const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/kb/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) },
  );
const DAY_AGO = () => new Date(Date.now() - 86_400_000);

describe("bilgi tabanı — değişmeden kaydet", () => {
  let orgId = "";
  let propertyId = "";
  beforeEach(async () => {
    await resetDb();
    ({ orgId, propertyId } = await makeOrgWithProperty());
    const u = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: "owner" } });
    session = { userId: u.id, organizationId: orgId, role: "owner", email: u.email, name: "O", sessionEpoch: 0 } as SessionPayload;
    vi.stubEnv("AI_ACTION_SUGGESTIONS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  async function item() {
    return prisma.knowledgeBaseItem.create({
      data: { propertyId, category: "wifi", title: "Wi-Fi", content: "Ağ adı: LaleNet\nŞifre: Eski12345", isActive: true, language: "tr", updatedAt: DAY_AGO() },
    });
  }

  it("🚨 bütün alanlar AYNI → 200, kalem aynen döner, `updatedAt` İLERLEMEZ; boş gövde de yazmaz", async () => {
    const kb = await item();
    const res = await patch(kb.id, { title: "Wi-Fi", content: kb.content, category: "wifi", isActive: true, language: "tr" });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(kb.id);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } })).updatedAt.getTime()).toBe(kb.updatedAt.getTime());
    expect((await patch(kb.id, {})).status).toBe(200);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } })).updatedAt.getTime()).toBe(kb.updatedAt.getTime());
  });

  it("boş kaydet yazmaz ama Mülk Hafızası eşitlemesi yine koşar (kaydet hafızanın kendini onarma yoluydu)", async () => {
    const kb = await item();
    await prisma.propertyMemory.deleteMany({ where: { propertyId } });
    await patch(kb.id, { title: "Wi-Fi" });
    expect(await prisma.propertyMemory.count({ where: { propertyId, sourceRef: kb.id } })).toBeGreaterThan(0);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } })).updatedAt.getTime()).toBe(kb.updatedAt.getTime());
  });

  it("tek alan değişirse yazılır (başlık / aktiflik)", async () => {
    const kb = await item();
    expect((await patch(kb.id, { title: "Wi-Fi bilgisi" })).status).toBe(200);
    const after = await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } });
    expect(after.title).toBe("Wi-Fi bilgisi");
    expect(after.updatedAt.getTime()).toBeGreaterThan(kb.updatedAt.getTime());
    expect((await patch(kb.id, { isActive: false })).status).toBe(200);
    expect((await prisma.knowledgeBaseItem.findUniqueOrThrow({ where: { id: kb.id } })).isActive).toBe(false);
  });

  it("🚨 uçtan uca: misafire yeni şifre yazıldıktan sonra kalem DEĞİŞMEDEN kaydedilirse Wi-Fi önerisi kaybolmaz; içerik değişirse kaybolur", async () => {
    const kb = await item();
    const c = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Misafir", channel: "airbnb", status: "new" } });
    await prisma.message.create({
      data: { conversationId: c.id, direction: "outbound", authorType: "host", senderName: "Ev Sahibi", body: "Yeni Wi-Fi şifresi: Lale2025x", createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toHaveLength(1);
    await patch(kb.id, { title: "Wi-Fi", content: kb.content, category: "wifi", isActive: true });
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toHaveLength(1);
    // Kontrol: gerçek düzenleme mesajdan sonra → öneri bayat sayılır (temkinli kural aynen).
    await patch(kb.id, { content: "Ağ adı: LaleNet\nŞifre: Elle2026x" });
    expect(await getPropertyWifiSuggestions(orgId, propertyId)).toEqual([]);
  });
});
