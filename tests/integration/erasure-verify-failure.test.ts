import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// K8 (Codex 11-25): silme işlemi COMMIT olduktan sonra koşan doğrulama geçişi arızalanınca rota genel 500 dönüyordu ("silme başarısız")
// ve ekranın önerdiği tekrar İKİNCİ denetim kaydı yazıyordu. Artık: sonuç ayrı ve tekrar edilebilir (503 + `erased: true`), arıza
// raporlanır; tekrar ikinci kayıt yazmaz ve doğrulamayı yeniden koşar.
// Arıza, doğrulama geçişinin İLK adımına (genel istemcinin `systemLock.deleteMany`'si — işlem içindeki maskeleme işlem istemcisini kullanır,
// bu casusu görmez) bir kez kurulur. Casus genel temsilcide olduğu için AYRI dosya (öteki testlere sızmasın).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { reportError } from "@/lib/report-error";
import { POST } from "@/app/api/reservations/[id]/erase/route";
import { ANON_NAME } from "@/lib/data-retention";

let failVerify = 0;
const realDeleteMany = prisma.systemLock.deleteMany.bind(prisma.systemLock);
const spy = vi.spyOn(prisma.systemLock, "deleteMany").mockImplementation(((args: Parameters<typeof realDeleteMany>[0]) => {
  const name = (args?.where as { name?: { startsWith?: string } } | undefined)?.name?.startsWith ?? "";
  if (failVerify > 0 && name.startsWith("outbound-send:qr-in:")) {
    failVerify--;
    return Promise.reject(new Error("veritabani kesintisi (test)"));
  }
  return realDeleteMany(args);
}) as never);

const ENV = "GUEST_ERASURE_ENABLED";
const req = (id: string) => new NextRequest(`http://localhost/api/reservations/${id}/erase`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({ data: { organizationId: orgId, name: "O", email: "o@x.com", passwordHash: "x", role: "owner" } });
  const stay = await prisma.reservation.create({
    data: { propertyId, guestName: "Ada Lale", guestEmail: "ada@example.com", sourceReference: "res-k8v", arrivalDate: stayDay(-3), departureDate: stayDay(-1), status: "completed", channel: "airbnb" },
  });
  const conv = await prisma.conversation.create({ data: { propertyId, reservationId: stay.id, channel: "airbnb", guestIdentifier: "Ada Lale", status: "answered" } });
  await prisma.message.create({ data: { conversationId: conv.id, direction: "inbound", senderName: "Ada Lale", body: "Merhaba, ben Ada" } });
  session = { userId: user.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  return { orgId, stayId: stay.id };
}
const audits = (orgId: string) => prisma.auditLog.count({ where: { organizationId: orgId, action: "kvkk.guest_erasure" } });

describe("K8 — commit sonrası doğrulama arızası silmeyi 'başarısız' göstermez, tekrar güvenli", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    failVerify = 0;
    vi.stubEnv(ENV, "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 doğrulama arızası → 503 + erased:true (genel 500 değil), silme kalıcı, arıza raporlandı; tekrar → 200, TEK denetim kaydı", async () => {
    const s = await seed();
    failVerify = 1;
    const res = await POST(req(s.stayId), ctx(s.stayId));
    expect(failVerify).toBe(0); // casus gerçekten tetiklendi
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, erased: true, verified: false, retryable: true });
    // Commit olan kısım kalıcı: maske + iz + tek denetim kaydı.
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.stayId } })).guestName).toBe(ANON_NAME);
    expect(await prisma.erasureTombstone.count()).toBeGreaterThan(0);
    expect(await audits(s.orgId)).toBe(1);
    expect(vi.mocked(reportError).mock.calls.map((c) => c[0])).toContain("erasure verify-pass");

    const retry = await POST(req(s.stayId), ctx(s.stayId));
    expect(retry.status).toBe(200);
    expect((await retry.json()).scope).toMatchObject({ alreadyErased: true, verified: true });
    expect(await audits(s.orgId)).toBe(1);
    expect(spy).toHaveBeenCalled();
  });

  it("KONTROL: arıza yoksa ilk istek 200 ve doğrulandı", async () => {
    const s = await seed();
    const res = await POST(req(s.stayId), ctx(s.stayId));
    expect(res.status).toBe(200);
    expect((await res.json()).scope).toMatchObject({ alreadyErased: false, verified: true });
    expect(await audits(s.orgId)).toBe(1);
  });
});
