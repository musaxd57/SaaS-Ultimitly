import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// GÜNLÜK AI BÜTÇESİ, İŞİN GERÇEKTEN YAPILACAĞI ANLAŞILMADAN TÜKETİLMEZ.
//
// Tehdit (denetim 08-05, `ai-suggest`'te 08-01'de zaten kapatılmıştı):
// org içindeki ele geçirilmiş bir owner/manager, 404 dönen id'lerle dakikada 30
// istek atarak org'un günlük kotasını TEK bir model çağrısı üretmeden
// bitirebiliyor. Kota dolunca misafire giden OTO-YANIT da duruyor
// (`automation.ts` → `skippedReason:"daily_budget"`), yani iç gürültü misafir
// kaybına dönüşüyor.
//
// ⚠️ Kota model çağrısının ÖNÜNDE kalmalı — `daily-budget.ts:99-101` interaktif
// rotalar için "önce tüket" kuralını AÇIKÇA yazıyor. Buradaki düzeltme onu
// bozmuyor: tüketim yalnız DOĞRULAMALARIN altına iniyor, `translate()`in
// altına DEĞİL.
// ---------------------------------------------------------------------------

let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as translatePost } from "@/app/api/conversations/[id]/translate-message/route";
import { POST as summaryPost } from "@/app/api/hazirlik/summary/route";

const budgetKey = (orgId: string) => `ai-daily:${orgId}`;

async function budgetRow(orgId: string) {
  return prisma.rateLimitCounter.findUnique({ where: { key: budgetKey(orgId) } });
}

function makeSession(orgId: string): SessionPayload {
  return {
    userId: "u1",
    organizationId: orgId,
    role: "owner",
    email: "host@example.com",
    name: "Host",
    sessionEpoch: 0,
  };
}

describe("günlük AI bütçesi doğrulamadan SONRA tüketilir", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  // ── translate-message ────────────────────────────────────────────────────
  describe("POST /api/conversations/[id]/translate-message", () => {
    const req = (id: string, body: unknown) =>
      new NextRequest(`http://localhost/api/conversations/${id}/translate-message`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

    it("BAŞKA org'un / var olmayan konuşma id'si kotayı TÜKETMEZ", async () => {
      const { orgId } = await makeOrgWithProperty();
      session = makeSession(orgId);

      const res = await translatePost(
        req("yok-boyle-bir-konusma", { messageId: "m1", targetLanguage: "en" }),
        ctx("yok-boyle-bir-konusma"),
      );

      // 404 = istek gerçekten org kapsamı kontrolüne ULAŞTI (guard'da ölmedi).
      expect(res.status).toBe(404);
      // 🚨 ASIL İDDİA: hiç bütçe satırı yazılmadı.
      expect(await budgetRow(orgId)).toBeNull();
    });

    it("konuşma VAR ama mesaj id'si yoksa da kota TÜKETMEZ", async () => {
      const { orgId, propertyId } = await makeOrgWithProperty();
      const conv = await prisma.conversation.create({
        data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new" },
      });
      session = makeSession(orgId);

      const res = await translatePost(
        req(conv.id, { messageId: "yok-boyle-bir-mesaj", targetLanguage: "en" }),
        ctx(conv.id),
      );

      expect(res.status).toBe(404);
      expect(await budgetRow(orgId)).toBeNull();
    });

    // TERS YÖN: tüketimi tamamen silen bir mutasyon yukarıdaki iki testten
    // geçerdi. Bu test onu yasaklar — gerçek iş yapılırken kota YANMALI.
    it("gerçek konuşma + gerçek mesajda kota TÜKETİLİR", async () => {
      const { orgId, propertyId } = await makeOrgWithProperty();
      const conv = await prisma.conversation.create({
        data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "new" },
      });
      const msg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: "inbound",
          senderName: "Misafir",
          body: "Hello, what time is check-in?",
        },
      });
      session = makeSession(orgId);

      // Durum kodu BİLİNÇLİ olarak asserte edilmiyor: OPENAI_API_KEY yokken
      // `translate()` "not_configured" ile 502 döner ve tüketim ZATEN olmuştur.
      // İddia edilen şey davranış değil, SAYAÇ.
      await translatePost(
        req(conv.id, { messageId: msg.id, targetLanguage: "en" }),
        ctx(conv.id),
      );

      const row = await budgetRow(orgId);
      expect(row).not.toBeNull();
      expect(row?.count).toBe(1);
    });
  });

  // ── hazirlik/summary ─────────────────────────────────────────────────────
  describe("POST /api/hazirlik/summary", () => {
    const req = (body: unknown) =>
      new NextRequest("http://localhost/api/hazirlik/summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // TERS YÖN buraya YAZILMADI çünkü BAŞKA bir testle zaten pinli:
    // `tests/unit/ai-cost-guards.test.ts` her AI rotasının
    // `consumeDailyAiBudget(` ÇAĞIRDIĞINI kaynak taramasıyla asserte ediyor →
    // çağrıyı komple silen mutasyon orada kırmızıya döner.
    it("alınacak bir şey yoksa (boş hazırlık planı) kota TÜKETMEZ", async () => {
      const { orgId } = await makeOrgWithProperty();
      // `supplyAiConfigured()` anahtara bakar; yoksa rota 503 ile erken döner
      // ve test ölçmek istediği yere hiç ULAŞMAZ (vacuous olurdu).
      vi.stubEnv("OPENAI_API_KEY", "sk-testFAKE1234567890abcdefFAKE");
      session = makeSession(orgId);

      const res = await summaryPost(req({ days: 7 }), { params: Promise.resolve({}) });

      // Boş plan → `{ empty: true }`, model çağrısı YOK.
      expect(res.status).toBe(200);
      expect((await res.json()).empty).toBe(true);
      // 🚨 Model çağrılmadıysa kota da yanmamalı.
      expect(await budgetRow(orgId)).toBeNull();
    });
  });
});
