import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// ÖDEME P1 (Codex 11-10) — gerçek PostgreSQL, BELİRLENİMCİ sıra.
// Nasıl yaşanır: işletmenin iki aboneliği var (ikinci ödeme ekranından ikinci ödeme). Eski abonelik (A) için Paddle "aktif" bir güncelleme
// yolluyor (ör. operatör A'yı dönem sonunda iptale aldı) ve AYNI anda yeni aboneliğin (B) aktifleşme olayı işleniyor. A'nın olayı satırı
// okuduğunda satır hâlâ A'ydı (kendi aboneliği → "yerine geçme" denetimi hiç koşmadı); o sırada B yazıldı; A'nın yazımı yalnız işletme +
// olay zamanına baktığı için satırı yeniden A yaptı. Sonra A'nın iptali hesabı kapattı — B her ay ödendiği hâlde.
// Sıralı gelişte B-1 kuralı (11-04) bunu zaten reddediyordu; açık yalnız eşzamanlılıktaydı: AKTİF olayın yazım koşulunda abonelik kimliği yoktu.
// Doğrusu: aktif olay ancak satır HÂLÂ okuduğu abonelikse (ya da kendi aboneliğiyse) yazar; değiştiyse — kendi aboneliği başka bir
// abonelikle değiştirildiyse olay düşer + operatöre alarm; başka bir abonelik araya girdiyse karar taze satırla YENİDEN verilir.
// Prisma temsilcisine casus → AYRI dosya (CLAUDE.md: spy sonraki testlere sızar).
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/paddle/route";
import { prisma, resetDb } from "../helpers/db";

const SECRET = "test-webhook-hmac-key-not-a-real-secret";

// Sıra kancası: webhook abonelik satırını OKUDUKTAN hemen sonra (yazmadan önce) BİR kez çalışır.
let interleave: (() => Promise<void>) | null = null;
const realFindUnique = prisma.subscription.findUnique.bind(prisma.subscription);
const findUniqueSpy = vi.spyOn(prisma.subscription, "findUnique").mockImplementation((async (args: Parameters<typeof realFindUnique>[0]) => {
  const out = await realFindUnique(args);
  const hook = interleave;
  interleave = null;
  if (hook) await hook();
  return out;
}) as never);
const realCreate = prisma.subscription.create.bind(prisma.subscription);
let createHook: (() => Promise<void>) | null = null;
vi.spyOn(prisma.subscription, "create").mockImplementation((async (args: Parameters<typeof realCreate>[0]) => {
  const hook = createHook;
  createHook = null;
  if (hook) await hook();
  return realCreate(args);
}) as never);

function sign(body: string): string {
  const ts = Math.floor(Date.now() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", SECRET).update(`${ts}:${body}`, "utf8").digest("hex")}`;
}
const post = (event: Record<string, unknown>) => {
  const body = JSON.stringify(event);
  return POST(
    new NextRequest("http://localhost/api/webhooks/paddle", {
      method: "POST",
      headers: { "content-type": "application/json", "paddle-signature": sign(body) },
      body,
    }),
  );
};
const alarms = (context: string) => reportErrorMock.mock.calls.filter(([c]) => c === context);

describe("ödeme P1 — eşzamanlı eski aboneliğin AKTİF olayı yeni aboneliğin üstüne dönemez", () => {
  let orgId = "";
  let consentId = "";
  // Olay zamanı onay kaydından en çok 5 dk önce olabilir (webhook kuralı: olay kendi onayından eskiyse bağlanmaz) → bütün zamanlar < 300 sn.
  const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
  const sub = (eventId: string, subId: string, status: string, occurredAt: string) => ({
    event_id: eventId,
    event_type: status === "canceled" ? "subscription.canceled" : "subscription.updated",
    occurred_at: occurredAt,
    data: { id: subId, status, customer_id: "ctm_1", custom_data: { consentId }, items: [{ price: { id: "pri_pro" } }] },
  });
  const state = () => prisma.subscription.findUniqueOrThrow({ where: { organizationId: orgId } });

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    interleave = null;
    createHook = null;
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("PADDLE_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    consentId = (
      await prisma.checkoutConsent.create({
        data: { organizationId: orgId, planCode: "pro", priceId: "pri_pro", legalVersion: "2026-06", ip: "1.2.3.4" },
        select: { id: true },
      })
    ).id;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 A'nın aktif güncellemesi satırı okudu → B aktifleşti → A'nın yazımı B'yi EZMEZ; operatöre alarm; A'nın iptali de hesabı kapatmaz", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    expect((await state()).providerRef).toBe("sub_a");

    // A'nın yeni "aktif" olayı (B'den SONRA oluşmuş) satırı okur; tam o arada B'nin aktifleşmesi işlenir.
    interleave = async () => {
      expect((await post(sub("evt_b1", "sub_b", "active", at(120)))).status).toBe(200);
    };
    expect((await post(sub("evt_a2", "sub_a", "active", at(60)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" }); // ⬅️ ESKİDE sub_a (yeni abonelik eziliyordu)
    expect(alarms("paddle-webhook-older-subscription-event")).toHaveLength(1);
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_a2" } })).status).toBe("processed");

    // A'nın dönem sonu iptali: B aktif kalır (hesap kapanmaz).
    expect((await post(sub("evt_a3", "sub_a", "canceled", at(10)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" });
  });

  it("KONTROL: kayıtlı aboneliğin KENDİ aktif güncellemesi (araya aynı aboneliğin olayı girse de) uygulanır; alarm yok", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    interleave = async () => {
      expect((await post(sub("evt_a_mid", "sub_a", "past_due", at(120)))).status).toBe(200);
    };
    expect((await post(sub("evt_a2", "sub_a", "active", at(60)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_a", status: "active" });
    expect(alarms("paddle-webhook-older-subscription-event")).toHaveLength(0);
  });

  it("KONTROL: yerinden eden abonelik olaydan DAHA TAZE ise eski aboneliğin olayı bayattır → sessizce düşer, alarm yok (sıralı gelişle aynı)", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    interleave = async () => {
      expect((await post(sub("evt_b1", "sub_b", "active", at(30)))).status).toBe(200);
    };
    expect((await post(sub("evt_a2", "sub_a", "active", at(60)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" });
    expect(alarms("paddle-webhook-older-subscription-event")).toHaveLength(0);
  });

  it("KONTROL: yeni aboneliğin DAHA TAZE olayı satırı eskiyken okudu, araya aynı aboneliğin eski olayı girdi → taze olay yine uygulanır", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    interleave = async () => {
      expect((await post(sub("evt_b1", "sub_b", "active", at(60)))).status).toBe(200);
    };
    const b2 = at(30);
    expect((await post(sub("evt_b2", "sub_b", "active", b2))).status).toBe(200);
    const row = await state();
    expect(row.providerRef).toBe("sub_b");
    expect(row.lastEventAt?.toISOString()).toBe(b2); // ⬅️ taze olay kaybolmadı
  });

  it("KONTROL: yerinden edilen aboneliğin AKTİF OLMAYAN olayı (iptal) sessizce düşer — alarm yok, yeniden karar yok (K4 akışı)", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    interleave = async () => {
      expect((await post(sub("evt_b1", "sub_b", "active", at(120)))).status).toBe(200);
    };
    expect((await post(sub("evt_a2", "sub_a", "canceled", at(60)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" });
    expect(alarms("paddle-webhook-older-subscription-event")).toHaveLength(0);
  });

  it("araya ÜÇÜNCÜ bir abonelik girerse karar taze satırla yeniden verilir: C (en yeni) yine yerine geçer", async () => {
    expect((await post(sub("evt_a1", "sub_a", "active", at(240)))).status).toBe(200);
    // C aktifleşmesi satırı A olarak okudu; tam o arada B, A'nın yerine geçti.
    interleave = async () => {
      expect((await post(sub("evt_b1", "sub_b", "active", at(120)))).status).toBe(200);
    };
    expect((await post(sub("evt_c1", "sub_c", "active", at(60)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_c", status: "active" });
  });

  it("ilk kayıtta tekillik çakışması + satırı BAŞKA abonelik yaratmış: aktif olay sessizce düşmez, karar taze satırla verilir (yeni abonelik yerine geçer)", async () => {
    // B'nin aktifleşmesi satırı "yok" okudu; `create`ten hemen önce A'nın ilk olayı satırı yarattı (gerçek tekillik çakışması).
    createHook = async () => {
      await realCreate({ data: { organizationId: orgId, provider: "paddle", providerRef: "sub_a", status: "active", planCode: "pro", lastEventAt: new Date(Date.now() - 120_000) } });
    };
    expect((await post(sub("evt_b1", "sub_b", "active", at(5)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_b", status: "active" });
    expect((await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_b1" } })).status).toBe("processed");
  });

  it("🚨 P5 — ilk kayıtta tekillik çakışması + işletme o arada silindi: yedek güncelleme 0 satır → alarm + inceleme (sessiz düşmez)", async () => {
    // Abonelik satırı yok (ilk olay). `create` çağrılmadan hemen önce hesap silinir ve çağrı tekillik çakışmasıyla düşer (eşzamanlı ilk
    // olay satırı yaratmış, ardından hesap silinmiş — satır kademeyle gitmiş).
    createHook = async () => {
      await prisma.organization.delete({ where: { id: orgId } });
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
    };
    expect((await post(sub("evt_first", "sub_n", "active", at(5)))).status).toBe(200);
    expect(alarms("paddle-webhook-unlinked-payment")).toHaveLength(1); // ⬅️ ESKİDE 0
    const evt = await prisma.webhookEvent.findUniqueOrThrow({ where: { providerEventId: "evt_first" } });
    expect([evt.status, evt.error]).toEqual(["error", "needs_review: org_deleted"]); // ⬅️ ESKİDE "processed"
    expect(await prisma.organization.count()).toBe(0);
  });

  it("KONTROL: ilk kayıtta tekillik çakışması, işletme duruyor (eşzamanlı aynı aboneliğin ilk olayı) → yedek güncelleme uygulanır, alarm yok", async () => {
    createHook = async () => {
      await realCreate({ data: { organizationId: orgId, provider: "paddle", providerRef: "sub_n", status: "active", planCode: "pro", lastEventAt: new Date(Date.now() - 60_000) } });
    };
    expect((await post(sub("evt_first", "sub_n", "active", at(5)))).status).toBe(200);
    expect(await state()).toMatchObject({ providerRef: "sub_n", status: "active" });
    expect(alarms("paddle-webhook-unlinked-payment")).toHaveLength(0);
    // En sık yarış bu (Paddle ilk olayları birlikte yollar): yedek güncelleme TEK turda uygular — yeniden karar turu (ek okumalar) yok.
    expect(findUniqueSpy).toHaveBeenCalledTimes(1);
  });
});
