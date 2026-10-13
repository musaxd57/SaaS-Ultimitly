import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// H2 (kurucu kararı 10-13 "Evet, düğme ekle"): kanal iptal edilmiş rezervasyonu yeniden etkin gösterdiyse (G9 panel satırı) ev sahibi
// "Gerçekten etkin — yeniden aç" ile rezervasyonu onaylıya döndürür. Yalnız sahip / yönetici; yalnız kanal sinyali olan iptal; başka kiracı
// 404; bürünmede yazma yok; denetim kaydı; eksik yaşam döngüsü görevleri oluşturulur.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST } from "@/app/api/reservations/[id]/reactivate/route";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

const DAY = 86_400_000;
const req = (id: string) => new NextRequest(`http://localhost/api/reservations/${id}/reactivate`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function seed(opts: { role?: SessionPayload["role"]; signalDaysAgo?: number | null; status?: string } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `o-${orgId}@x.com`, passwordHash: "x", role: opts.role ?? "owner" },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ayşe Yılmaz",
      sourceReference: `res-${orgId}`,
      arrivalDate: new Date(Date.now() + 10 * DAY),
      departureDate: new Date(Date.now() + 13 * DAY),
      status: opts.status ?? "cancelled",
      channel: "airbnb",
    },
  });
  if (opts.signalDaysAgo !== null) {
    await prisma.ingestEvent.create({
      data: {
        organizationId: orgId,
        provider: "hospitable",
        entityType: "reservation",
        entityId: reservation.id,
        kind: "reservation.updated",
        changedFieldsJson: JSON.stringify([REACTIVATION_BLOCKED_FIELD]),
        occurredAt: new Date(Date.now() - (opts.signalDaysAgo ?? 0) * DAY),
      },
    });
  }
  const s: SessionPayload = {
    userId: user.id,
    organizationId: orgId,
    role: opts.role ?? "owner",
    email: user.email,
    name: "O",
    sessionEpoch: 0,
  };
  return { orgId, propertyId, reservationId: reservation.id, session: s };
}

describe("POST /api/reservations/[id]/reactivate (H2)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 kanal sinyali olan iptal → onaylı + denetim kaydı + panel satırı kalkar + yaşam döngüsü görevleri", async () => {
    const s = await seed();
    session = s.session;
    expect((await findAttentionItems(s.orgId)).some((i) => i.kind === "channel_reactivation")).toBe(true);

    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("confirmed");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: s.orgId, action: "reservation.reactivated" } });
    expect(JSON.parse(audit.metadataJson ?? "{}")).toMatchObject({ reservationId: s.reservationId });
    expect((await findAttentionItems(s.orgId)).some((i) => i.kind === "channel_reactivation")).toBe(false);
    expect(await prisma.task.count({ where: { reservationId: s.reservationId } })).toBeGreaterThan(0);
  });

  it("KONTROL: kanal sinyali YOK (ya da eski) → 409, rezervasyon iptal kalır", async () => {
    const none = await seed({ signalDaysAgo: null });
    session = none.session;
    const r1 = await POST(req(none.reservationId), ctx(none.reservationId));
    expect(r1.status).toBe(409);
    expect((await r1.json()).code).toBe("no_channel_signal");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: none.reservationId } })).status).toBe("cancelled");

    const old = await seed({ signalDaysAgo: 10 });
    session = old.session;
    expect((await POST(req(old.reservationId), ctx(old.reservationId))).status).toBe(409);
  });

  it("KONTROL: konaklaması bitmiş rezervasyon → 409 past_stay (panel kapsamıyla aynı)", async () => {
    const s = await seed();
    await prisma.reservation.update({
      where: { id: s.reservationId },
      data: { arrivalDate: new Date(Date.now() - 5 * DAY), departureDate: new Date(Date.now() - 2 * DAY) },
    });
    session = s.session;
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("past_stay");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
  });

  it("KONTROL: zaten etkin rezervasyon → 409 not_cancelled", async () => {
    const s = await seed({ status: "confirmed" });
    session = s.session;
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_cancelled");
  });

  it("KİRACI SINIRI: başka işletmenin rezervasyonu → 404, dokunulmaz", async () => {
    const victim = await seed();
    const attacker = await seed();
    session = attacker.session;
    const res = await POST(req(victim.reservationId), ctx(victim.reservationId));
    expect(res.status).toBe(404);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: victim.reservationId } })).status).toBe("cancelled");
  });

  it("ROL: personel (staff) → 403", async () => {
    const s = await seed({ role: "staff" });
    session = s.session;
    expect((await POST(req(s.reservationId), ctx(s.reservationId))).status).toBe(403);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
  });

  it("BÜRÜNME: destek görünümünde yazma yok", async () => {
    const s = await seed();
    session = { ...s.session, actorUserId: "operator-1", actorEmail: "op@lixusai.com" };
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
  });
});
