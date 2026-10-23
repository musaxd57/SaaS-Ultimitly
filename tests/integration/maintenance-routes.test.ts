import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty, dropConversationIdentityUnique, restoreConversationIdentityUnique } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// BAKIM / ÖNİZLEME ROTALARI — davranışsal kapı testleri (gece-4 S7-08: bu rotaların hiçbir doğrudan testi yoktu; rol ve kapsam pinleri
// yalnız durağandır). Her rota için: personel → 403 (sarmalayıcı), dakika tavanı → 429 (anahtarı doğru öznede: işletme ya da kullanıcı),
// işletme kapsamı (başka işletmenin verisi ne okunur ne silinir). Sağlayıcı bağlantısı yok → ağa çıkılmaz.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as syncPost } from "@/app/api/hospitable/sync/route";
import { POST as cleanupPost } from "@/app/api/conversations/cleanup-duplicates/route";
import { POST as autoReplyPreview } from "@/app/api/hospitable/auto-reply-test/route";
import { POST as checkinPreview } from "@/app/api/hospitable/checkin-test/route";
import { POST as checkoutPreview } from "@/app/api/hospitable/checkout-test/route";
import { __resetRateLimit } from "@/lib/rate-limit";

const ctx = { params: Promise.resolve({}) };
type Handler = (req: NextRequest, c: never) => Promise<Response>;
const call = (h: Handler, path: string) => h(new NextRequest(`http://localhost${path}`, { method: "POST" }), ctx as never);

const DAY = 24 * 60 * 60_000;

async function tenant(tag: string, role: SessionPayload["role"] = "owner") {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: tag, email: `${tag}@x.com`, passwordHash: "x", role } });
  const s = { userId: user.id, organizationId: orgId, role, email: user.email, name: tag, sessionEpoch: 0 } as SessionPayload;
  return { orgId, propertyId, userId: user.id, session: s };
}

beforeEach(async () => {
  await resetDb();
  __resetRateLimit();
  session = null;
});

const ROUTES: Array<{ name: string; handler: Handler; path: string; limit: number; perUser: boolean }> = [
  { name: "hospitable/sync", handler: syncPost as unknown as Handler, path: "/api/hospitable/sync", limit: 6, perUser: false },
  { name: "conversations/cleanup-duplicates", handler: cleanupPost as unknown as Handler, path: "/api/conversations/cleanup-duplicates", limit: 4, perUser: false },
  { name: "hospitable/auto-reply-test", handler: autoReplyPreview as unknown as Handler, path: "/api/hospitable/auto-reply-test", limit: 6, perUser: true },
  { name: "hospitable/checkin-test", handler: checkinPreview as unknown as Handler, path: "/api/hospitable/checkin-test", limit: 6, perUser: true },
  { name: "hospitable/checkout-test", handler: checkoutPreview as unknown as Handler, path: "/api/hospitable/checkout-test", limit: 6, perUser: true },
];

describe.each(ROUTES)("$name — rol ve dakika tavanı (S7-08)", ({ handler, path, limit, perUser }) => {
  it("personel → 403; oturumsuz → 401", async () => {
    const staff = await tenant("personel", "staff");
    session = staff.session;
    expect((await call(handler, path)).status).toBe(403);
    session = null;
    expect((await call(handler, path)).status).toBe(401);
  });

  it(`dakikada ${limit} çağrı → sonraki 429; tavan ${perUser ? "kullanıcıya" : "işletmeye"} ait (başka işletme etkilenmez)`, async () => {
    const a = await tenant("a");
    const b = await tenant("b");
    session = a.session;
    for (let i = 0; i < limit; i++) expect((await call(handler, path)).status).toBe(200);
    const over = await call(handler, path);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
    session = b.session;
    expect((await call(handler, path)).status).toBe(200);
    if (perUser) {
      // Aynı işletmenin BAŞKA yöneticisi kendi kotasıyla çalışır (anahtar kullanıcı başına).
      const other = await prisma.user.create({ data: { organizationId: a.orgId, name: "a2", email: "a2@x.com", passwordHash: "x", role: "manager" } });
      session = { ...a.session, userId: other.id, role: "manager", email: other.email };
      expect((await call(handler, path)).status).toBe(200);
    } else {
      // İşletme anahtarı: aynı işletmenin başka yöneticisi de tavanda.
      const other = await prisma.user.create({ data: { organizationId: a.orgId, name: "a2", email: "a2@x.com", passwordHash: "x", role: "manager" } });
      session = { ...a.session, userId: other.id, role: "manager", email: other.email };
      expect((await call(handler, path)).status).toBe(429);
    }
  });
});

describe("işletme kapsamı (S7-08)", () => {
  it("elle senkron: bağlantısı olmayan işletme → 200 + 'bağlı değil' (ağa çıkılmaz)", async () => {
    const a = await tenant("a");
    session = a.session;
    const res = await call(syncPost as unknown as Handler, "/api/hospitable/sync");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
  });

  describe("kopya konuşmalar (eski veri biçimi — tekil kısıt bu blokta geçici kaldırılır, temizlik testleriyle aynı yardımcı)", () => {
    beforeAll(dropConversationIdentityUnique);
    afterAll(restoreConversationIdentityUnique);

    it("🚨 kopya temizliği yalnız KENDİ işletmesinin kopyalarını siler", async () => {
      const a = await tenant("a");
      const b = await tenant("b");
      const dupPair = async (propertyId: string) => {
        const base = { propertyId, guestIdentifier: "Misafir Lale", channel: "airbnb", externalReservationId: `hx-${propertyId}` };
        const keeper = await prisma.conversation.create({ data: { ...base, externalConversationId: `c1-${propertyId}` } });
        await prisma.message.create({ data: { conversationId: keeper.id, direction: "inbound", senderName: "Misafir Lale", body: "Merhaba", externalId: `m-${propertyId}` } });
        await prisma.conversation.create({ data: { ...base, externalConversationId: `c1-${propertyId}` } });
      };
      await dupPair(a.propertyId);
      await dupPair(b.propertyId);
      session = a.session;
      const res = await call(cleanupPost as unknown as Handler, "/api/conversations/cleanup-duplicates");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, removed: 1 });
      expect(await prisma.conversation.count({ where: { propertyId: a.propertyId } })).toBe(1);
      expect(await prisma.conversation.count({ where: { propertyId: b.propertyId } })).toBe(2);
    });
  });

  it("🚨 giriş önizlemesi başka işletmenin misafirini göstermez (kendi misafiri görünür)", async () => {
    const a = await tenant("a");
    const b = await tenant("b");
    const arrive = (propertyId: string, guestName: string, ref: string) =>
      prisma.reservation.create({
        data: {
          propertyId,
          guestName,
          sourceReference: ref,
          status: "confirmed",
          channel: "airbnb",
          arrivalDate: new Date(Date.now() + 3 * DAY),
          departureDate: new Date(Date.now() + 6 * DAY),
        },
      });
    await arrive(a.propertyId, "Misafir Alfa", "ref-a");
    await arrive(b.propertyId, "Misafir Beta", "ref-b");
    session = a.session;
    const text = JSON.stringify(await (await call(checkinPreview as unknown as Handler, "/api/hospitable/checkin-test")).json());
    expect(text).toContain("Misafir Alfa");
    expect(text).not.toContain("Misafir Beta");
    const out = JSON.stringify(await (await call(checkoutPreview as unknown as Handler, "/api/hospitable/checkout-test")).json());
    expect(out).toContain("Misafir Alfa"); // Opus gece-4 E2: kendi misafiri görünmezse "Beta yok" iddiası boş geçerdi
    expect(out).not.toContain("Misafir Beta");
  });
});
