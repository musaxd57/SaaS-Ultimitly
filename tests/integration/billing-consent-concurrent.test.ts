import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// EŞZAMANLI ÖDEME ONAYI (consent) İSTEKLERİ (tasarım belgesi 2026-10-10 §1.3 test eksiği 4) — GERÇEK POSTGRESQL.
// Onay kaydı ödeme zincirinin çapasıdır: webhook işletmeyi YALNIZ bu satırdan bulur (`custom_data.consentId`), takip numarası da bu
// satırdan sürer. Eşzamanlı isteklerde kanıtlanması gerekenler:
//   1. İki sekme aynı anda → iki AYRI onay, ikisi de oturumun işletmesine / kullanıcısına; her satırın takip numarası KENDİ yanıtının
//      `X-Correlation-ID` başlığı (istekler birbirinin numarasını almaz).
//   2. İki FARKLI işletmenin sahibi aynı anda → her satır kendi işletmesine (eşzamanlılıkta da IDOR yok).
//   3. Saatte 20 sınırı eşzamanlı patlamada da tam 20 (veritabanı sayacı atomik — sıralı 21 istekle sınanan testin eşzamanlı karşılığı).
//   4. KONTROL: canlı Paddle aboneliği varken eşzamanlı isteklerin HİÇBİRİ onay almaz.
// BİLİNEN SINIR (bilinçli, test 1 bunu kayda geçirir): sunucu aynı işletmenin eşzamanlı iki onayını ENGELLEMEZ — iki ödeme ekranı açılabilir.
// Çift aboneliğe karşı koruma "Ödemeniz işleniyor" kilidi (ödeme TAMAMLANINCA yazılır) + webhook'un ikinci abonelik alarmıdır
// (`checkout-pending-second-subscription.test.ts`).
// Etkileşim BULUŞMA NOKTASIYLA zorlanır: iki istek de "canlı abonelik var mı" okumasında birbirini bekler, sonra ikisi de satırını
// yazar (sıralı koşup "eşzamanlı" demek olmaz). Prisma temsilcisi elle değiştirilir ve `finally`de geri konur → AYRI dosya.
// ---------------------------------------------------------------------------

// İstek başına oturum: her `requireSession` çağrısı sıradakini alır (Promise.all istekleri SIRAYLA başlatır; `withAuth` oturumu ilk
// `await`ten önce ister → atama belirlenimci). Sıra boşsa varsayılan oturum.
const { sessionQueue } = vi.hoisted(() => ({ sessionQueue: [] as SessionPayload[] }));
let session: SessionPayload | null;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => sessionQueue.shift() ?? session) };
});

import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import { POST } from "@/app/api/billing/consent/route";

const ctx = { params: Promise.resolve({} as Record<string, never>) };
const postReq = () =>
  new NextRequest("http://localhost/api/billing/consent", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "TestBrowser/1.0" },
    body: JSON.stringify({ planCode: "pro", priceId: "pri_pro" }),
  });

/** İki isteği aynı noktada buluşturur (biri gelmezse `timeoutMs` sonra açılır; `arrivals()` iddiası kırmızı olur). */
function meetingPoint(timeoutMs = 2_000) {
  let arrived = 0;
  let openGate: () => void = () => {};
  const bothArrived = new Promise<void>((resolve) => {
    openGate = resolve;
  });
  return {
    arrivals: () => arrived,
    async wait(): Promise<void> {
      arrived += 1;
      if (arrived === 2) openGate();
      await Promise.race([bothArrived, new Promise<void>((resolve) => setTimeout(resolve, timeoutMs).unref?.())]);
    },
  };
}

/** Onay rotasının "canlı abonelik var mı" okumasını (istek başına tek `subscription.findUnique`) buluşma noktasına bağlar. */
function gateLiveSubscriptionRead() {
  const gate = meetingPoint();
  const real = prisma.subscription.findUnique;
  prisma.subscription.findUnique = (async (args: never) => {
    const row = await real.call(prisma.subscription, args);
    await gate.wait();
    return row;
  }) as unknown as typeof real;
  const restore = () => {
    prisma.subscription.findUnique = real;
  };
  return { gate, restore };
}

describe("POST /api/billing/consent — eşzamanlı istekler", () => {
  let orgId = "";
  let userId = "";

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    sessionQueue.length = 0;
    vi.stubEnv("PADDLE_PRICE_PRO", "pri_pro");
    orgId = (await prisma.organization.create({ data: { name: "Org" } })).id;
    userId = (
      await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } })
    ).id;
    session = { userId, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 iki sekme aynı anda: iki AYRI onay, ikisi de oturumun işletmesine; her satırın takip numarası kendi yanıtının başlığı (karışmaz)", async () => {
    const { gate, restore } = gateLiveSubscriptionRead();
    const responses = await Promise.all([POST(postReq(), ctx), POST(postReq(), ctx)]).finally(restore);

    expect(gate.arrivals()).toBe(2); // iki istek de yazmadan önce aynı anda rotanın içindeydi
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    const bodies = (await Promise.all(responses.map((r) => r.json()))) as Array<{ consentId: string }>;
    expect(bodies[0].consentId).not.toBe(bodies[1].consentId);

    const rows = await prisma.checkoutConsent.findMany({ where: { organizationId: orgId } });
    expect(rows).toHaveLength(2); // BİLİNEN SINIR: sunucu eşzamanlı iki onayı engellemez (koruma kilit + alarm)
    responses.forEach((res, i) => {
      const row = rows.find((r) => r.id === bodies[i].consentId);
      expect(row).toMatchObject({ organizationId: orgId, userId, planCode: "pro", priceId: "pri_pro", userAgent: "TestBrowser/1.0" });
      const header = res.headers.get("x-correlation-id");
      expect(header).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.correlationId).toBe(header); // ödeme zinciri bu numarayla sürer → başka isteğin numarası OLAMAZ
    });
    expect(rows[0].correlationId).not.toBe(rows[1].correlationId);
  }, 15_000);

  it("🚨 iki FARKLI işletmenin sahibi aynı anda: her onay kendi işletmesine ve kullanıcısına (eşzamanlılıkta IDOR yok)", async () => {
    const otherOrgId = (await prisma.organization.create({ data: { name: "Diğer" } })).id;
    const otherUserId = (
      await prisma.user.create({ data: { organizationId: otherOrgId, name: "D", email: "d@x.com", passwordHash: "x", role: "owner" } })
    ).id;
    sessionQueue.push(session!, { userId: otherUserId, organizationId: otherOrgId, role: "owner", email: "d@x.com", name: "D", sessionEpoch: 0 });

    const { gate, restore } = gateLiveSubscriptionRead();
    const [resA, resB] = await Promise.all([POST(postReq(), ctx), POST(postReq(), ctx)]).finally(restore);

    expect(gate.arrivals()).toBe(2);
    expect(sessionQueue).toHaveLength(0); // iki istek de kendi oturumunu aldı
    expect([resA.status, resB.status]).toEqual([201, 201]);
    const idA = ((await resA.json()) as { consentId: string }).consentId;
    const idB = ((await resB.json()) as { consentId: string }).consentId;
    expect(await prisma.checkoutConsent.findUniqueOrThrow({ where: { id: idA } })).toMatchObject({ organizationId: orgId, userId });
    expect(await prisma.checkoutConsent.findUniqueOrThrow({ where: { id: idB } })).toMatchObject({
      organizationId: otherOrgId,
      userId: otherUserId,
    });
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: otherOrgId } })).toBe(1);
  }, 15_000);

  it("🚨 eşzamanlı 25 istek: saatte 20 sınırı TAM 20 (atomik sayaç) — 20 × 201, 5 × 429, 20 satır", async () => {
    const responses = await Promise.all(Array.from({ length: 25 }, () => POST(postReq(), ctx)));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(20);
  }, 20_000);

  it("KONTROL: canlı Paddle aboneliği varken eşzamanlı isteklerin HİÇBİRİ onay almaz (400, satır yok)", async () => {
    await prisma.subscription.create({
      data: { organizationId: orgId, planCode: "pro", status: "active", provider: "paddle", providerRef: "sub_live" },
    });
    const responses = await Promise.all([POST(postReq(), ctx), POST(postReq(), ctx), POST(postReq(), ctx)]);
    expect(responses.map((r) => r.status)).toEqual([400, 400, 400]);
    expect(await prisma.checkoutConsent.count({ where: { organizationId: orgId } })).toBe(0);
  });
});
