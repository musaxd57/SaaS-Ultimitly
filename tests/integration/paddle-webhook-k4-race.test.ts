import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { prisma, resetDb } from "../helpers/db";
import { POST } from "@/app/api/webhooks/paddle/route";

// ---------------------------------------------------------------------------
// K4 İKİNCİ TUR (Codex 10-01): ESKİ aboneliğin iptali, satırı okuduktan SONRA yeni abonelik aktifleşirse güncelleme yalnız
// kuruluş + olay zamanına bakıp satırı yeniden "eski / iptal" yapıyordu. Eşzamanlılık BAYAT OKUMAYLA birebir üretilir:
// rotanın abonelik okuması bir kez eski satırı (A, aktif) döndürür, veritabanında ise yeni abonelik (B, aktif) durur.
// Prisma temsilcisine spy sonraki testlere sızar → bu dosya AYRI (CLAUDE.md).
// ---------------------------------------------------------------------------

const SECRET = "test-webhook-hmac-key-not-a-real-secret";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex");
  return `ts=${ts};h1=${h1}`;
}
function req(body: string) {
  return new NextRequest("http://localhost/api/webhooks/paddle", {
    method: "POST",
    headers: { "content-type": "application/json", "paddle-signature": sign(body) },
    body,
  });
}

let orgId = "";
let consentId = "";

beforeAll(() => {
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_PRICE_PRO = "pri_pro";
});
afterAll(async () => {
  delete process.env.PADDLE_WEBHOOK_SECRET;
  delete process.env.PADDLE_PRICE_PRO;
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  const org = await prisma.organization.create({ data: { name: "Org" } });
  orgId = org.id;
  consentId = (
    await prisma.checkoutConsent.create({
      data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
      select: { id: true },
    })
  ).id;
});
afterEach(() => vi.restoreAllMocks());

const subEvent = (eventId: string, subId: string, status: string, occurredAt: string) =>
  JSON.stringify({
    event_id: eventId,
    event_type: status === "canceled" ? "subscription.canceled" : "subscription.updated",
    occurred_at: occurredAt,
    data: { id: subId, status, custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
  });

// Spy TEK bir testte kurulur ve dosyanın tek testidir (Prisma temsilcisindeki spy, geri alınsa da sonraki testi bozar — CLAUDE.md).
describe("K4 — eşzamanlı eski iptal yeni aboneliği bozmaz (kimlik şartı atomik güncellemede)", () => {
  it("🚨 bayat okuma senaryoları: eski iptal yeni aboneliği bozmaz; kendi iptali ve yeni aktifleşme uygulanır; ilk kayıt çatışması dalı aynı şartla", async () => {
    const stale = vi.spyOn(prisma.subscription, "findUnique");
    const state = () => prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });

    // 1) iptal A'yı okudu → B aktifleşti → bekleyen A iptali satırı DEĞİŞTİRMEZ (B / aktif kalır).
    const tA = new Date(Date.now() - 180_000);
    const tB = new Date(Date.now() - 120_000);
    const tCancel = new Date(Date.now() - 60_000);
    let body = subEvent("evt_a", "sub_a", "active", tA.toISOString());
    expect((await POST(req(body))).status).toBe(200);
    body = subEvent("evt_b", "sub_b", "active", tB.toISOString());
    expect((await POST(req(body))).status).toBe(200);
    expect((await state()).providerRef).toBe("sub_b");
    stale.mockResolvedValueOnce({ lastEventAt: tA, pastDueSince: null, providerRef: "sub_a" } as never);
    body = subEvent("evt_a_cancel", "sub_a", "canceled", tCancel.toISOString());
    expect((await POST(req(body))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" });

    // 2) KONTROL: kayıtlı aboneliğin KENDİ iptali (bayat okuma olsa da) uygulanır.
    stale.mockResolvedValueOnce({ lastEventAt: tB, pastDueSince: null, providerRef: "sub_b" } as never);
    body = subEvent("evt_b_cancel", "sub_b", "canceled", new Date(Date.now() - 30_000).toISOString());
    expect((await POST(req(body))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "canceled" });

    // 3) KONTROL: yeni aboneliğin AKTİFLEŞMESİ bayat okumada da eskisinin yerine geçer.
    stale.mockResolvedValueOnce({ lastEventAt: tB, pastDueSince: null, providerRef: "sub_b" } as never);
    body = subEvent("evt_c", "sub_c", "active", new Date(Date.now() - 20_000).toISOString());
    expect((await POST(req(body))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_c", status: "active" });

    // 4) İlk kayıt çatışması dalı (P2002): satır yokmuş gibi okunur → create düşer → yedek güncelleme; C aktifken A'nın iptali bozmaz.
    stale.mockResolvedValueOnce(null as never);
    body = subEvent("evt_a_cancel2", "sub_a", "canceled", new Date().toISOString());
    expect((await POST(req(body))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_c", status: "active" });
  });
});
