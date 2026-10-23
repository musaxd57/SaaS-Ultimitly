import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { prisma, resetDb } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// ÖDEME S2 TERS SIRA (Opus F2, 10-16) — gerçek PostgreSQL, iki bağlantı, BELİRLENİMCİ sıra.
// Hesap silmenin ön kontrolü (işlem içinde, işletme satırı kilitli) aboneliği okudu: deneme satırı, silmeye engel yok. Tam o anda ilk
// ödemeli Paddle olayı gelir. Abonelik güncellemesi işletme satırının kilidine takılmaz (yabancı anahtar değişmiyor). Eskiden güncelleme
// commit oluyor, olay "işlendi" sayılıyor, ALARM YOK; ardından silme aboneliği kademeyle siliyordu → müşteri ödedi, Paddle aboneliği canlı,
// işletme yok, kimse bilmiyor. Doğru: ön kontrol abonelik satırını kilitler → güncelleme silmenin sonucunu bekler → 0 satır → işletme
// yok → alarm + "inceleme" (S2 dalı).
// ---------------------------------------------------------------------------

const { reportErrorMock, hook } = vi.hoisted(() => ({
  reportErrorMock: vi.fn(),
  hook: { fn: null as null | (() => Promise<void>) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});
let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => currentSession), clearSessionCookie: vi.fn(async () => {}) };
});
// Sıra kancası: silme işleminin ön kontrolü (işlem içinde, abonelik okundu) GEÇTİKTEN hemen SONRA, kademeli silmeden ÖNCE çalışır.
vi.mock("@/lib/data-retention", async (orig) => {
  const actual = await orig<typeof import("@/lib/data-retention")>();
  return {
    ...actual,
    deleteAccountData: (organizationId: string, opts: Parameters<typeof actual.deleteAccountData>[1] = {}) =>
      actual.deleteAccountData(organizationId, {
        ...opts,
        precondition: async (tx) => {
          const verdict = opts.precondition ? await opts.precondition(tx) : null;
          const fn = hook.fn;
          hook.fn = null;
          if (verdict === null && fn) await fn();
          return verdict;
        },
      }),
  };
});

import { POST as deleteAccount } from "@/app/api/account/delete/route";
import { POST as paddleWebhook } from "@/app/api/webhooks/paddle/route";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";
const PASSWORD = "correct-horse";

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
}
const webhook = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return paddleWebhook(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
};
const deleteReq = () =>
  new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({ password: PASSWORD }),
  });

describe("ödeme S2 ters sıra — silme ön kontrolünden SONRA gelen ödemeli olay alarmsız düşmez", () => {
  let orgId = "";
  let consentId = "";
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    hook.fn = null;
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "Owner", email: "owner-s2@example.com", passwordHash: await hashPassword(PASSWORD), role: "owner", emailVerifiedAt: new Date() },
    });
    // Deneme satırı (silmeye engel değil) + az önce açılmış ödeme onayı: ilk ödemeli Paddle olayı işletmeyi onaydan bulur ve deneme
    // satırını "active" yapar (gerçek ilk ödeme akışı).
    await prisma.subscription.create({
      data: { organizationId: org.id, provider: "trial", status: "trialing", planCode: "pro", lastEventAt: new Date(Date.now() - 86_400_000) },
    });
    consentId = (
      await prisma.checkoutConsent.create({
        data: { organizationId: org.id, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      })
    ).id;
    currentSession = { userId: user.id, organizationId: org.id, role: "owner", email: user.email, name: user.name, sessionEpoch: user.sessionEpoch } as SessionPayload;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 ön kontrol okudu → ödemeli olay → silme tamamlanır: olay 'inceleme' + alarm (eskiden 'işlendi', alarm yok)", async () => {
    let webhookDone = false;
    let webhookPromise: Promise<Response> | null = null;
    hook.fn = async () => {
      webhookPromise = webhook({
        event_id: "evt_race_rev",
        event_type: "subscription.activated",
        occurred_at: new Date().toISOString(),
        data: { id: "sub_race", status: "active", customer_id: "ctm_1", items: [{ price: { id: "pri_pro" } }], custom_data: { consentId } },
      }).then((r) => {
        webhookDone = true;
        return r;
      });
      // Webhook'a silme işlemi açıkken ilerlemesi için süre ver. Kilitliyse BEKLER (bitmez).
      await new Promise((r) => setTimeout(r, 400));
      expect(webhookDone).toBe(false); // ⬅️ ESKİDE true (güncelleme kilitsiz geçiyordu)
    };
    const res = await deleteAccount(deleteReq());
    expect(res.status).toBe(200);
    expect(webhookPromise).not.toBeNull();
    expect((await webhookPromise!).status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0); // hesap geri açılmadı
    const evt = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_race_rev" } });
    expect(evt.status).toBe("error");
    expect(evt.error).toBe("needs_review: org_deleted");
    expect(reportErrorMock.mock.calls.filter(([c]) => c === "paddle-webhook-unlinked-payment")).toHaveLength(1);
  });

  it("KONTROL: ödemeli olay silmenin ön kontrolünden ÖNCE işlenirse silme 409 (aktif abonelik) — hiçbir şey silinmez", async () => {
    const r = await webhook({
      event_id: "evt_first",
      event_type: "subscription.activated",
      occurred_at: new Date().toISOString(),
      data: { id: "sub_race", status: "active", customer_id: "ctm_1", items: [{ price: { id: "pri_pro" } }], custom_data: { consentId } },
    });
    expect(r.status).toBe(200);
    expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId: orgId } })).status).toBe("active");
    expect((await deleteAccount(deleteReq())).status).toBe(409);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
  });
});
