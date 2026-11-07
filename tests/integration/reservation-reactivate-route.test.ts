import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { REACTIVATION_BLOCKED_FIELD } from "@/lib/ingest/reactivation";
import { todayKey } from "@/modules/availability/core";
import { orgTimezone } from "@/lib/timezone";
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
import { PATCH } from "@/app/api/reservations/[id]/route";
import { findAttentionItems } from "@/modules/intelligence/incidents/attention";

const DAY = 86_400_000;
const req = (id: string) => new NextRequest(`http://localhost/api/reservations/${id}/reactivate`, { method: "POST" });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** `provider`: true (varsayılan) kanıtlı bağlantı damgalı sağlayıcı satırı · "legacy" damga öncesi sağlayıcı satırı (airbnb + referans,
 *  bağlantı damgası yok) · false sağlayıcıya ait OLMAYAN satır (`channel`: varsayılan dosya "ics"; elle "manual"). */
async function seed(opts: { role?: SessionPayload["role"]; signalDaysAgo?: number | null; status?: string; provider?: boolean | "legacy"; channel?: "ics" | "manual" } = {}) {
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
      channel: opts.provider === false ? (opts.channel ?? "ics") : "airbnb",
      // Sağlayıcıya ait satır — kanal işareti YALNIZ bunda aranır (kurucu D6, 10-15).
      ...(opts.provider === false || opts.provider === "legacy" ? {} : { connectionId: `conn-${orgId}`, connectionEvidence: "ingest", ingestedAt: new Date() }),
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

  it("🚨 kurucu D6: sağlayıcıya AİT OLMAYAN iptal (dosya / takvim / elle) kanal işareti ARANMADAN açılır; kurallar (bitmiş konaklama, denetim, görev) aynı", async () => {
    const s = await seed({ signalDaysAgo: null, provider: false });
    session = s.session;
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("confirmed");
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "reservation.reactivated" } })).toBe(1);
    expect(await prisma.task.count({ where: { reservationId: s.reservationId, origin: "system" } })).toBe(2);
    // Tekrarlanan istek ikinci görev AÇMAZ (409 not_cancelled).
    const again = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(again.status).toBe(409);
    expect(await prisma.task.count({ where: { reservationId: s.reservationId, origin: "system" } })).toBe(2);
  });

  it("elle girilmiş satır (kanal 'manual' + referans) da sağlayıcıya ait sayılmaz → işaret aranmadan açılır", async () => {
    const s = await seed({ signalDaysAgo: null, provider: false, channel: "manual" });
    session = s.session;
    expect((await POST(req(s.reservationId), ctx(s.reservationId))).status).toBe(200);
  });

  it("🚨 ŞÜPHEDE İŞARET ARANIR: bağlantı damgası öncesi eski sağlayıcı satırı (airbnb + referans, damga yok) işaretsiz → 409, iptal kalır", async () => {
    const s = await seed({ signalDaysAgo: null, provider: "legacy" });
    session = s.session;
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_channel_signal");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
    // Aynı eski satır kanal işaretiyle açılır (aşırı uygulama yok).
    const withSignal = await seed({ provider: "legacy" });
    session = withSignal.session;
    expect((await POST(req(withSignal.reservationId), ctx(withSignal.reservationId))).status).toBe(200);
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

  it("çıkış GÜNÜ (yalnız-tarih çapası, işletme takviminde bugün) → panel satırı var + yeniden açılır (tek tarih kuralı, Haiku 10-13)", async () => {
    const s = await seed();
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: s.orgId }, select: { timezone: true } });
    const today = todayKey(new Date(), orgTimezone(org.timezone));
    // Ham `departureDate < şimdi` kıyası bu satırı çıkış günü sabahı "bitmiş" sayıyordu (00:00Z çapası her zaman geçmişte).
    await prisma.reservation.update({
      where: { id: s.reservationId },
      data: { arrivalDate: new Date(Date.now() - 3 * DAY), departureDate: new Date(`${today}T00:00:00.000Z`) },
    });
    session = s.session;
    expect((await findAttentionItems(s.orgId)).some((i) => i.kind === "channel_reactivation")).toBe(true);
    const res = await POST(req(s.reservationId), ctx(s.reservationId));
    expect(res.status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("confirmed");
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

// ---------------------------------------------------------------------------
// KURUCU D6 (10-15): "API ve panel aynı yeniden açma kurallarını kullansın; yetki kontrolü, işlem kaydı ve otomatik görev ayarı korunsun.
// Sağlayıcıya ait olmayan rezervasyonda sağlayıcı işareti aranmasın. Tekrarlanan istek ikinci görev oluşturmasın."
// ---------------------------------------------------------------------------
const patch = (id: string, body: unknown) =>
  PATCH(
    new NextRequest(`http://localhost/api/reservations/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve({ id }) },
  );

describe("PATCH /api/reservations/[id] — iptalden çıkış 'Yeniden aç' kurallarıyla (kurucu D6)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("🚨 sağlayıcı satırı + kanal işareti YOK → 409 no_channel_signal; satır iptal kalır, görev açılmaz (eskiden kurallar atlanıyordu)", async () => {
    const s = await seed({ signalDaysAgo: null });
    session = s.session;
    const res = await patch(s.reservationId, { status: "confirmed" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("no_channel_signal");
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("cancelled");
    expect(await prisma.task.count({ where: { reservationId: s.reservationId } })).toBe(0);
  });

  it("sağlayıcıya ait olmayan satır → işaret aranmadan açılır: denetim kaydı (via api) + görevler; tekrar istek ikinci görev AÇMAZ", async () => {
    const s = await seed({ signalDaysAgo: null, provider: false });
    session = s.session;
    const res = await patch(s.reservationId, { status: "confirmed", notes: "misafir geri döndü" });
    expect(res.status).toBe(200);
    const row = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    expect([row.status, row.notes]).toEqual(["confirmed", "misafir geri döndü"]);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: s.orgId, action: "reservation.reactivated" } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).toContain("api");
    expect(await prisma.task.count({ where: { reservationId: s.reservationId, origin: "system" } })).toBe(2);
    const again = await patch(s.reservationId, { status: "confirmed" });
    expect(again.status).toBe(200);
    expect(await prisma.task.count({ where: { reservationId: s.reservationId, origin: "system" } })).toBe(2);
  });

  it("aşırı uygulama yok: zaten iptal satıra tekrar 'iptal' ONARIMDIR — başlanmış görev korunur, not alanı yazılır", async () => {
    const s = await seed({ signalDaysAgo: null, provider: false, status: "cancelled" });
    session = s.session;
    await prisma.task.create({ data: { propertyId: s.propertyId, reservationId: s.reservationId, type: "cleaning", origin: "system", title: "Çıkış temizliği", status: "in_progress" } });
    expect((await patch(s.reservationId, { status: "cancelled", notes: "tekrar" })).status).toBe(200);
    expect(await prisma.task.count({ where: { reservationId: s.reservationId, origin: "system" } })).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).notes).toBe("tekrar");
  });

  it("konaklaması bitmiş iptal → 409 past_stay (düğmeyle aynı)", async () => {
    const s = await seed({ provider: false });
    await prisma.reservation.update({
      where: { id: s.reservationId },
      data: { arrivalDate: new Date(Date.now() - 10 * DAY), departureDate: new Date(Date.now() - 7 * DAY) },
    });
    session = s.session;
    const res = await patch(s.reservationId, { status: "confirmed" });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("past_stay");
  });

  it("aşırı uygulama yok: iptal OLMAYAN satırda not / durum değişikliği eskisi gibi (yeniden açma kuralı devreye girmez)", async () => {
    const s = await seed({ status: "confirmed" });
    session = s.session;
    const res = await patch(s.reservationId, { status: "pending", notes: "n" });
    expect(res.status).toBe(200);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } })).status).toBe("pending");
    expect(await prisma.auditLog.count({ where: { organizationId: s.orgId, action: "reservation.reactivated" } })).toBe(0);
  });
});
