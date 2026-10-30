import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn<(context: string, err: unknown) => Promise<string>>(async () => "reported") }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { POST } from "@/app/api/webhooks/host-channel/whatsapp/route";
import { prisma, resetDb } from "../helpers/db";
import { startHostBinding, confirmHostBindingFromInbound } from "@/lib/host-channel/binding";
import { WHATSAPP_CLOUD_PROVIDER } from "@/lib/host-channel/providers";
import { __setHostChannelTransportForTest } from "@/lib/host-channel-runtime";

// ---------------------------------------------------------------------------
// WhatsApp web kancası — işleme yarıda düşerse (AYRI dosya: Prisma temsilcisine `vi.spyOn` sonraki testlere sızar). Pinlenen: 500 döner (Meta
// yeniden dener), o mesajın tekrar kilidi BIRAKILIR, aynı teslimat yeniden gelince işlenir; hata kaydına numara gitmez. Kilit de silinemezse
// (veritabanı kesintisi) hemen gelen tekrar 503 alır, kira dolunca işlenir — "tekrar" sayılıp kaybolmaz.
// ---------------------------------------------------------------------------

// Casuslar dosya başında BİR KEZ kurulur, hiç geri alınmaz (Prisma temsilcisinde geri alma yöntemi siliyor, casusun kendi geçişi bağlamı
// kaybediyor — `two-factor-reenroll-race.test.ts` deseni); arıza bayraklarla açılır, kapalıyken gerçek fonksiyona geçer.
let failBindingUpdates = 0;
let failLockDeletes = false;
const realBindingUpdateMany = prisma.hostChannelBinding.updateMany.bind(prisma.hostChannelBinding);
const realLockDeleteMany = prisma.systemLock.deleteMany.bind(prisma.systemLock);
const bindingUpdateSpy = vi.spyOn(prisma.hostChannelBinding, "updateMany").mockImplementation(((args: Parameters<typeof realBindingUpdateMany>[0]) => {
  if (failBindingUpdates > 0) {
    failBindingUpdates--;
    return Promise.reject(new Error("baglanti koptu 905321112233"));
  }
  return realBindingUpdateMany(args);
}) as never);
vi.spyOn(prisma.systemLock, "deleteMany").mockImplementation(((args: Parameters<typeof realLockDeleteMany>[0]) =>
  failLockDeletes ? Promise.reject(new Error("baglanti koptu")) : realLockDeleteMany(args)) as never);

const APP_SECRET = "test-whatsapp-app-secret-0123456789";
const PNID = "109876543210987";
const DIGITS = "905321112233";

function raw(id: string): string {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PNID },
              messages: [{ from: DIGITS, id, timestamp: "1761850000", type: "text", text: { body: "otopark var" } }],
            },
          },
        ],
      },
    ],
  });
}
const post = (b: string) =>
  POST(
    new NextRequest("https://www.lixusai.com/api/webhooks/host-channel/whatsapp", {
      method: "POST",
      body: b,
      headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(b).digest("hex")}` },
    }),
  );

describe("WhatsApp web kancası — yarıda düşme", () => {
  beforeEach(async () => {
    await resetDb();
    reportErrorMock.mockClear();
    vi.stubEnv("HOST_CHANNEL_ENABLED", "1");
    vi.stubEnv("HOST_CHANNEL_ORG_IDS", "*");
    vi.stubEnv("HOST_CHANNEL_HMAC_SECRET", "test-host-channel-secret-0123456789abcdef");
    vi.stubEnv("WHATSAPP_APP_SECRET", APP_SECRET);
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", PNID);
    __setHostChannelTransportForTest(null);
  });
  afterEach(() => {
    failBindingUpdates = 0;
    failLockDeletes = false;
    vi.unstubAllEnvs();
    __setHostChannelTransportForTest(undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("500 + kilit bırakılır + yeniden teslimat işlenir; hata kaydında numara yok", async () => {
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
    });
    const r = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 33", optInTextVersion: "v1" });
    if (!r.ok) throw new Error(r.reason);
    const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: DIGITS, code: r.code });
    if (!c.ok) throw new Error(c.reason);
    await prisma.hostChannelBinding.update({ where: { id: r.bindingId }, data: { lastInboundAt: null } });

    failBindingUpdates = 1;
    bindingUpdateSpy.mockClear();
    const res = await post(raw("wamid.f1"));
    expect(res.status).toBe(500);
    expect(bindingUpdateSpy).toHaveBeenCalledTimes(1);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-in:" } } })).toBe(0);
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0]![0]).toBe("host-channel-webhook");
    expect(String(reportErrorMock.mock.calls[0]![1])).not.toContain("5321112233");
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).lastInboundAt).toBeNull();

    const again = await post(raw("wamid.f1"));
    expect(again.status).toBe(200);
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).lastInboundAt).not.toBeNull();
    expect(await prisma.systemLock.count({ where: { name: { startsWith: "host-in:" } } })).toBe(1);
  });

  it("🚨 veritabanı kesintisinde kilit de silinemezse: hemen gelen tekrar 503 (kaybolmaz), kira dolunca yeniden deneme işler (Haiku 10-30 P2-2)", async () => {
    const org = await prisma.organization.create({ data: { name: "Test Org" } });
    const user = await prisma.user.create({
      data: { organizationId: org.id, name: "Ev Sahibi", email: `u${Math.random().toString(36).slice(2)}@example.test`, passwordHash: "x", role: "owner" },
    });
    const r = await startHostBinding({ organizationId: org.id, userId: user.id, provider: WHATSAPP_CLOUD_PROVIDER, rawNumber: "+90 532 111 22 33", optInTextVersion: "v1" });
    if (!r.ok) throw new Error(r.reason);
    const c = await confirmHostBindingFromInbound({ provider: WHATSAPP_CLOUD_PROVIDER, fromDigits: DIGITS, code: r.code });
    if (!c.ok) throw new Error(c.reason);
    await prisma.hostChannelBinding.update({ where: { id: r.bindingId }, data: { lastInboundAt: null } });

    failBindingUpdates = 1;
    failLockDeletes = true;
    expect((await post(raw("wamid.f2"))).status).toBe(500);
    failLockDeletes = false;
    const lock = await prisma.systemLock.findFirstOrThrow({ where: { name: { startsWith: "host-in:" } } });
    expect(lock.holder).toBe("processing");

    // Meta hemen yeniden denerse: "tekrar" sayılıp yutulmaz, 503 → sonra yine dener.
    expect((await post(raw("wamid.f2"))).status).toBe(503);
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).lastInboundAt).toBeNull();

    // Kira dolunca yeniden deneme devralır ve işler.
    await prisma.systemLock.update({ where: { name: lock.name }, data: { lockedUntil: new Date(Date.now() - 1_000) } });
    expect((await post(raw("wamid.f2"))).status).toBe(200);
    expect((await prisma.hostChannelBinding.findUniqueOrThrow({ where: { id: r.bindingId } })).lastInboundAt).not.toBeNull();
  });
});
