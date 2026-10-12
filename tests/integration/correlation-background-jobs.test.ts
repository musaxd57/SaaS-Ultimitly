import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { FakeOutboundProvider } from "../helpers/fake-channel";

// ---------------------------------------------------------------------------
// TAKİP NUMARASI 2. DİLİM — arka plan işleri (kurucu kararı 10-12 sabah: "Evet, yap"; migration yok, müşteriye giden değişmez).
//  · Zamanlanmış senkron geçişi kendi numarasıyla, geçiş başına TEK özet satırı ("job.finished").
//  · Her işletmenin işlenmesi kendi numarasıyla ve işletmesiyle → içindeki hata raporu olay günlüğünde O işletmeye bağlı.
//  · Giden mesaj kuyruğunda her satırın işlenmesi kendi numarasıyla ve satırın işletmesiyle ("job.outbox.row", satır kimliği + sonuç).
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return {
    ...actual,
    isHospitableConfigured: () => true,
    listProperties: vi.fn(),
    listReservations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));

import { listProperties } from "@/lib/hospitable";
import { GET as cronGet } from "@/app/api/cron/sync/route";
import { __setOutboundAdapterForTest } from "@/lib/channels";
import { enqueueOutbound } from "@/lib/outbox/enqueue";
import { drainOutboxOnce } from "@/lib/outbox/worker";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";
import { __resetEventLogLimits } from "@/lib/event-log";

const events = (where: Record<string, unknown> = {}) => prisma.operationalEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const data = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);

async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(async () => {
  await resetDb();
  __resetEventLogLimits();
  resetPrimaryOrgCache();
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllEnvs());

describe("zamanlanmış senkron", () => {
  it("🚨 geçiş kendi numarasıyla tek özet satırı; işletmenin hatası olay günlüğünde O işletmeye ve AYRI numaraya bağlı", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-for-tests");
    const org = await prisma.organization.create({ data: { name: "Org", hospitableTokenEnc: "enc" } });
    await prisma.property.create({ data: { organizationId: org.id, name: "Lale 7" } });
    vi.mocked(listProperties).mockRejectedValue(new Error("beklenmeyen sağlayıcı hatası"));

    const res = await cronGet(new NextRequest("http://localhost/api/cron/sync", { headers: { authorization: "Bearer cron-secret-for-tests" } }));
    expect(res.status).toBe(200);

    const finished = await events({ event: "job.finished" });
    expect(finished).toHaveLength(1);
    expect(finished[0].organizationId).toBeNull();
    expect(data(finished[0].dataJson)).toMatchObject({ job: "scheduled-sync", status: "ok" });

    const orgErrors = await waitFor(() => events({ event: "error.reported", organizationId: org.id }), (r) => r.length > 0);
    expect(orgErrors.length).toBeGreaterThan(0);
    // İşletme işlemesi geçişin numarasından AYRI bir numarada (operatör yalnız o işletmenin işlemesini görür).
    expect(orgErrors.every((e) => e.correlationId !== finished[0].correlationId)).toBe(true);
  });
});

describe("giden mesaj kuyruğu", () => {
  const fake = new FakeOutboundProvider();
  const RES = "res-corr-1";
  beforeEach(() => {
    fake.reset();
    __setOutboundAdapterForTest("hospitable", fake.adapter());
  });
  afterEach(() => __setOutboundAdapterForTest("hospitable", null));

  it("🚨 her satır kendi numarasıyla ve satırın işletmesiyle; sonuç + satır kimliği yazılır (metin yok)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    const conversation = await prisma.conversation.create({
      data: { propertyId, channel: "airbnb", guestIdentifier: "Misafir", status: "waiting", externalReservationId: RES },
    });
    await setOrgHospitableToken(orgId, "PAT-A", null);
    fake.registerReservation(RES, "PAT-A");
    const enq = (key: string) =>
      enqueueOutbound({
        organizationId: orgId, conversationId: conversation.id, channel: "airbnb", externalReservationId: RES, reservationId: null,
        body: "Merhaba, gizli metin", senderName: "Host", authorType: "host", messageType: "manual", idempotencyKey: key,
      });
    const a = await enq("k-a");
    const result = await drainOutboxOnce();
    expect(result.sent).toBe(1);
    const rows = await events({ event: "job.outbox.row" });
    expect(rows).toHaveLength(1);
    expect(rows[0].organizationId).toBe(orgId);
    expect(data(rows[0].dataJson)).toEqual({ status: "sent", outboxId: a.outboxId });
    expect(rows[0].dataJson).not.toMatch(/gizli|Merhaba/);
    // İkinci satır AYRI numara.
    const b = await enq("k-b");
    await drainOutboxOnce();
    const both = await events({ event: "job.outbox.row" });
    expect(both).toHaveLength(2);
    expect(data(both[1].dataJson)).toMatchObject({ outboxId: b.outboxId });
    expect(both[1].correlationId).not.toBe(both[0].correlationId);
  });
});
