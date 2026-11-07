import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// 🚨 Opus 11-05 N5: elle cevap sağlayıcıya KESİN teslim edildikten sonra veritabanı arızası (bağlantı havuzu / kısa kopma) olursa:
//   · eskiden kayıt hatası 500 "işlem tamamlanmadıysa birazdan tekrar deneyin" dönüyordu; istemci aynı istek kimliğini tutuyordu ve
//     talepler 2 dk'da düşünce (uzatma da aynı arızada yazılamıyordu) tekrar misafire İKİNCİ mesajı gönderiyordu;
//   · şimdi: teslim kesinse sonuç "gönderildi" (satır sonraki senkronla gelir), hata raporlanır; uzatma yazılamazsa bir kez daha denenir,
//     yine olmazsa raporlanır.
// Prisma casusu sonraki testlere sızmasın diye AYRI dosya (CLAUDE.md "DB arızası testi AYRI dosyada").
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/messaging", async (orig) => ({
  ...(await orig<typeof import("@/lib/messaging")>()),
  sendOnChannel: vi.fn(async () => ({ ok: true, id: "sent-1" })),
}));
vi.mock("@/lib/hospitable-credentials", () => ({ getOrgHospitableToken: vi.fn(async () => "tok") }));
const reported = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async (ctx: string) => {
    reported.calls.push(ctx);
    return "reported";
  }),
}));

import { sendOnChannel } from "@/lib/messaging";
import { POST } from "@/app/api/conversations/[id]/reply/route";
import { OUTBOUND_REQUEST_CLAIM_PREFIX } from "@/lib/outbound-claim-name";

const mockSend = vi.mocked(sendOnChannel);
const RID = "11111111-2222-4333-8444-555555555555";

function req(id: string, body: unknown) {
  return new NextRequest(`http://localhost/api/conversations/${id}/reply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Teslimden SONRAKİ kayıt işlemi (dizi biçimli `$transaction`) düşer; öteki işlemler gerçek. */
function failPersistOnce() {
  const real = prisma.$transaction.bind(prisma) as (arg: unknown) => Promise<unknown>;
  let armed = true;
  vi.spyOn(prisma, "$transaction").mockImplementation(((arg: unknown) => {
    if (armed && Array.isArray(arg)) {
      armed = false;
      return Promise.reject(new Error("db blip (test)"));
    }
    return real(arg);
  }) as never);
}

/** İstek talebinin uzatılması (24 sa) yazılamaz — aynı arızanın uzantısı. */
function failExtend() {
  const real = prisma.systemLock.updateMany.bind(prisma.systemLock) as (a: unknown) => Promise<unknown>;
  vi.spyOn(prisma.systemLock, "updateMany").mockImplementation(((a: { where?: { name?: unknown } }) =>
    typeof a?.where?.name === "string" && a.where.name.startsWith(OUTBOUND_REQUEST_CLAIM_PREFIX)
      ? Promise.reject(new Error("db blip (test)"))
      : real(a)) as never);
}

async function twoMinutesPass() {
  await prisma.systemLock.updateMany({
    where: { lockedUntil: { lt: new Date(Date.now() + 3 * 60_000) } },
    data: { lockedUntil: new Date(Date.now() - 1_000) },
  });
}

describe("elle cevap — teslimden sonra kayıt arızası", () => {
  let conversationId: string;
  const send = (body: string) => POST(req(conversationId, { body, requestId: RID }), { params: Promise.resolve({ id: conversationId }) });

  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    reported.calls.length = 0;
    vi.stubEnv("DURABLE_OUTBOX_ENABLED", "");
    mockSend.mockImplementation(async () => ({ ok: true, id: "sent-1" }));
    const org = await prisma.organization.create({ data: { name: "Org" } });
    const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale" } });
    const conv = await prisma.conversation.create({
      data: { propertyId: property.id, guestIdentifier: "Guest", channel: "airbnb", externalReservationId: "res-1", status: "waiting" },
    });
    conversationId = conv.id;
    session = { userId: "u", organizationId: org.id, role: "owner", email: "o@x.com", name: "Owner", sessionEpoch: 0 };
  });
  afterEach(() => vi.restoreAllMocks());

  // Casussuz kontrol İLK koşar: Prisma temsilcisine kurulan casus geri alınsa da sonraki testlere sızabilir (CLAUDE.md).
  it("KONTROL — arıza yoksa kayıt yazılır ve rapor YOK (yol aynı)", async () => {
    const res = await send("Kapı şifresi 4512");
    expect(res.status).toBe(201);
    expect(reported.calls).not.toContain("host-send.persist-after-delivery");
    expect(reported.calls).not.toContain("host-send.extend-request-claim");
    expect(await prisma.message.count({ where: { conversationId, direction: "outbound" } })).toBe(1);
  });

  it("🚨 teslim KESİN, kayıt düştü → 2xx 'gönderildi' (500 'tekrar deneyin' DEĞİL); hata raporlanır; aynı kimlik 2 dk sonra da İKİNCİ kez gitmez", async () => {
    failPersistOnce();
    const res = await send("Kapı şifresi 4512");
    expect(res.status).toBe(201);
    expect(reported.calls).toContain("host-send.persist-after-delivery");
    expect(mockSend).toHaveBeenCalledTimes(1);
    // (Kayıt casusu tek seferlik — kendini kapattı; `restoreAllMocks` burada çağrılmaz: gönderim taklidinin sayacını sıfırlardı.)
    await twoMinutesPass();
    // İstemci 2xx aldığı için kimliği bırakır; sunucu tarafında da uzatılmış talep aynı kimliğin tekrarını durdurur.
    expect((await send("Kapı şifresi 4512")).status).toBe(409);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("🚨 uzatma da yazılamadıysa (aynı arıza) bir kez daha denenir ve RAPORLANIR; yanıt yine 2xx (istemci aynı kimlikle yeniden basmaz)", async () => {
    failExtend();
    failPersistOnce();
    const res = await send("Kapı şifresi 4512");
    expect(res.status).toBe(201);
    expect(reported.calls).toContain("host-send.extend-request-claim");
    expect(reported.calls).toContain("host-send.persist-after-delivery");
    const extendCalls = vi
      .mocked(prisma.systemLock.updateMany)
      .mock.calls.filter(([a]) => typeof (a as { where?: { name?: unknown } })?.where?.name === "string" && String((a as { where: { name: string } }).where.name).startsWith(OUTBOUND_REQUEST_CLAIM_PREFIX));
    expect(extendCalls).toHaveLength(2);
  });

});
