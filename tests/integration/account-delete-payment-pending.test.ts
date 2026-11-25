import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { hashPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// SONUÇLANMAMIŞ ÖDEME VARKEN HESAP SİLİNMEZ (K5, Codex 11-25 ikinci rapor) — gerçek PostgreSQL.
//
// Silme kapısı yalnız YEREL abonelik satırına bakıyordu. Ödemesi alınmış ama aboneliği henüz bağlanmamış işletme ("ödeme alındı" kaydı,
// `CheckoutIntent` "completed") ya da sonucu belli olmayan açık ödeme işlemi olan işletme silinebiliyordu: kayıt hesapla birlikte
// kademeyle gidiyor, alınmış paranın uzlaştırılacak izi kalmıyordu. Doğru: silme BEKLETİLİR (409 + var olan ödeme metni), hiçbir şey silinmez.
// ---------------------------------------------------------------------------

let currentSession: SessionPayload | null = null;
vi.mock("@/lib/auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn(async () => currentSession), clearSessionCookie: vi.fn(async () => {}) };
});
// Sıra kancası: rotanın işlem DIŞI denetimleri geçtikten SONRA, silme işlemi başlamadan ÖNCE bir kez çalışır (yarış penceresi).
const { hook } = vi.hoisted(() => ({ hook: { beforeDelete: null as null | (() => Promise<void>), ran: 0 } }));
vi.mock("@/lib/data-retention", async (orig) => {
  const actual = await orig<typeof import("@/lib/data-retention")>();
  return {
    ...actual,
    deleteAccountData: async (...args: Parameters<typeof actual.deleteAccountData>) => {
      const fn = hook.beforeDelete;
      hook.beforeDelete = null;
      if (fn) {
        hook.ran++;
        await fn();
      }
      return actual.deleteAccountData(...args);
    },
  };
});

import { POST } from "@/app/api/account/delete/route";
import { checkoutPendingLockName } from "@/lib/billing/checkout-pending";
import { CHECKOUT_PAID_AWAITING_MESSAGE, CHECKOUT_PENDING_MESSAGE } from "@/lib/billing/checkout-pending-shared";
import { CHECKOUT_INTENT_BUSY_MESSAGE } from "@/lib/billing/checkout-intent";

const PASSWORD = "correct-horse";
const MIN = 60_000;

function req() {
  return new NextRequest("http://localhost/api/account/delete", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify({ password: PASSWORD }),
  });
}

async function seed(name = "Lale") {
  const org = await prisma.organization.create({ data: { name } });
  const user = await makeUser({
    data: {
      organizationId: org.id,
      name: "Owner",
      email: `${name.toLowerCase()}@example.com`,
      passwordHash: await hashPassword(PASSWORD),
      role: "owner",
      emailVerifiedAt: new Date(),
    },
  });
  const consent = await prisma.checkoutConsent.create({ data: { organizationId: org.id, planCode: "pro", priceId: "pri_pro", legalVersion: "v" } });
  currentSession = {
    userId: user.id,
    organizationId: org.id,
    role: "owner",
    email: user.email,
    name: user.name,
    sessionEpoch: user.sessionEpoch,
  } as SessionPayload;
  return { orgId: org.id, consentId: consent.id };
}

async function intent(orgId: string, consentId: string, status: string, ref: string) {
  return prisma.checkoutIntent.create({
    data: {
      organizationId: orgId,
      consentId,
      planCode: "pro",
      priceId: "pri_pro",
      providerRef: ref,
      status,
      openKey: status === "open" || status === "opening" ? orgId : null,
      expiresAt: new Date(Date.now() + 60 * MIN),
      closedAt: status === "open" || status === "opening" ? null : new Date(Date.now() - 60 * MIN),
    },
  });
}

describe("hesap silme — sonuçlanmamış ödeme kapısı (K5)", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    currentSession = null;
    hook.beforeDelete = null;
    hook.ran = 0;
  });

  it("🚨 ödemesi alınmış, aboneliği bağlanmamış kayıt varken silme BEKLETİLİR (409, 'ödemeniz alındı' metni), hiçbir şey silinmez", async () => {
    const { orgId, consentId } = await seed();
    const row = await intent(orgId, consentId, "completed", "txn_k5a");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(CHECKOUT_PAID_AWAITING_MESSAGE);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    expect(await prisma.checkoutIntent.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  for (const status of ["open", "opening"]) {
    it(`sonucu belli olmayan ödeme işlemi ("${status}") varken silme BEKLETİLİR (409, 'açık bir ödemeniz var')`, async () => {
      const { orgId, consentId } = await seed();
      await intent(orgId, consentId, status, "txn_k5b");
      const res = await POST(req());
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(CHECKOUT_INTENT_BUSY_MESSAGE);
      expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    });
  }

  it("'ödemeniz işleniyor' kilidi geçerliyken silme BEKLETİLİR; kilidin süresi geçince silinir", async () => {
    const { orgId, consentId } = await seed();
    await prisma.systemLock.create({ data: { name: checkoutPendingLockName(orgId), lockedUntil: new Date(Date.now() + 5 * MIN), holder: consentId } });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(CHECKOUT_PENDING_MESSAGE);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);

    await prisma.systemLock.update({ where: { name: checkoutPendingLockName(orgId) }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    __resetRateLimit();
    expect((await POST(req())).status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });

  it("KONTROL (aşırı uygulama yok): yalnız kapanmış kayıtlar (bağlandı / bırakıldı / iptal / süresi doldu) varken silme olur", async () => {
    const { orgId, consentId } = await seed();
    let n = 0;
    for (const status of ["fulfilled", "released", "canceled", "expired", "failed"]) await intent(orgId, consentId, status, `txn_k5c${n++}`);
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });

  it("KİRACI: BAŞKA işletmenin bekleyen ödemesi bu işletmenin silinmesini engellemez", async () => {
    const other = await seed("Diger");
    await intent(other.orgId, other.consentId, "completed", "txn_k5d");
    const { orgId } = await seed();
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
    expect(await prisma.organization.count({ where: { id: other.orgId } })).toBe(1);
  });

  it("🚨 YARIŞ: dış denetim 'bekleyen ödeme yok' gördükten SONRA kapanmış niyetin işlemi ödenirse işlem içindeki denetim yakalar → 409", async () => {
    const { orgId, consentId } = await seed();
    const row = await intent(orgId, consentId, "expired", "txn_k5e");
    hook.beforeDelete = async () => {
      await prisma.checkoutIntent.update({ where: { id: row.id }, data: { status: "completed" } });
    };
    const res = await POST(req());
    expect(hook.ran).toBe(1);
    expect(res.status).toBe(409); // 401 değil — yeni neden eşlenmiş olmalı
    expect((await res.json()).error).toBe(CHECKOUT_PAID_AWAITING_MESSAGE);
    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(1);
    expect((await prisma.checkoutIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("completed");
  });
});
