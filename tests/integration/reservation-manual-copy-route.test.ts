import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// UA-1 (kurucu 11-19): "Kayıtları karşılaştır" → elle girilen kopyayı kaldır. Gerçek PostgreSQL.
// Sabitlenen: elle / dosya satırı silinir ve tutma kalkar (gönderici ile AYNI yüklem) · takvim / kanal satırı 409, satır yerinde ·
// okuma ile silme arasında kaynağa bağlanan satır silinmez · personel 403 · bürünme 403 · başka işletme 404 · bağlı görev temizliği var olan
// silme yolundan · denetim kaydı (fail `auditActor`, misafir adı / kaynak kimliği yok) · genel silme ucu DEĞİŞMEDİ.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { prisma, resetDb } from "../helpers/db";
import { stayDay } from "../helpers/stay-dates";
import { DELETE as manualCopyDelete } from "@/app/api/reservations/[id]/manual-copy/route";
import { DELETE as reservationDelete } from "@/app/api/reservations/[id]/route";
import { bookingRefsInMultipleProperties } from "@/lib/booking-property-conflict";
import { __manualCopyHooks, MANUAL_COPY_LAST_ERROR, MANUAL_COPY_SOURCE_BOUND_ERROR, removeManualBookingCopy } from "@/lib/reservations/remove-manual-copy";

const del = (id: string) =>
  manualCopyDelete(new NextRequest(`http://localhost/api/reservations/${id}/manual-copy`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

type Row = { channel: string; calendarSourceId?: string | null; connectionId?: string | null; guestNameSource?: string | null };

async function world() {
  const org = await prisma.organization.create({ data: { name: "Org", timezone: "Europe/Istanbul" } });
  const a = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  const b = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 5" } });
  const owner = await prisma.user.create({ data: { organizationId: org.id, name: "Sahip", email: `o-${org.id}@x.com`, passwordHash: "x", role: "owner" } });
  const source = await prisma.calendarSource.create({ data: { propertyId: b.id, label: "Airbnb", url: "https://example.com/a.ics" } });
  session = { userId: owner.id, organizationId: org.id, role: "owner", email: owner.email, name: owner.name, sessionEpoch: 0 };
  return { orgId: org.id, a: a.id, b: b.id, ownerId: owner.id, sourceId: source.id };
}

async function booking(propertyId: string, ref: string, row: Row) {
  return prisma.reservation.create({
    data: {
      propertyId,
      guestName: "Ada Lale",
      arrivalDate: stayDay(4),
      departureDate: stayDay(7),
      status: "confirmed",
      sourceReference: ref,
      channel: row.channel,
      calendarSourceId: row.calendarSourceId ?? null,
      connectionId: row.connectionId ?? null,
      guestNameSource: row.guestNameSource ?? null,
    },
    select: { id: true },
  });
}

/** Öteki dairede kanaldan gelen etkin kopya — elle kopyanın kaldırılabilmesi için çakışmanın sürmesi gerekir (G1 11-19 E1). */
const channelCopy = (propertyId: string, ref: string) => booking(propertyId, ref, { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });

const conflicted = async (orgId: string, ref: string) =>
  (await bookingRefsInMultipleProperties(prisma, { organizationId: orgId, refs: [ref], now: new Date() })).has(ref);

describe("DELETE /api/reservations/[id]/manual-copy (gerçek PostgreSQL)", () => {
  beforeEach(async () => {
    await resetDb();
    __manualCopyHooks.afterClassRead = null;
  });
  afterEach(() => {
    __manualCopyHooks.afterClassRead = null;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 elle girilen kopya silinir → tutma KALKAR (gönderici ile aynı yüklem); kanal satırı yerinde; bağlı başlanmamış sistem görevi gider", async () => {
    const w = await world();
    const manual = await booking(w.a, "HM-1", { channel: "manual", guestNameSource: "host" });
    const channel = await booking(w.b, "HM-1", { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });
    const task = await prisma.task.create({
      data: { propertyId: w.a, reservationId: manual.id, type: "cleaning", origin: "system", status: "todo", title: "Çıkış temizliği", dueAt: stayDay(7) },
    });
    expect(await conflicted(w.orgId, "HM-1")).toBe(true);

    const res = await del(manual.id);

    expect(res.status).toBe(200);
    expect(await prisma.reservation.findUnique({ where: { id: manual.id } })).toBeNull();
    expect(await prisma.reservation.findUnique({ where: { id: channel.id } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await conflicted(w.orgId, "HM-1")).toBe(false);
    // Denetim kaydı: fail oturumdan (`auditActor`), kimlik + sınıf; misafir adı / kaynak kimliği yok.
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: w.orgId, action: "reservation.manual_copy_removed" } });
    expect(audit.actorUserId).toBe(w.ownerId);
    expect(JSON.parse(audit.metadataJson ?? "{}")).toEqual({ reservationId: manual.id, propertyId: w.a, sourceClass: "manual" });
    expect(audit.metadataJson).not.toContain("Ada");
    expect(audit.metadataJson).not.toContain("HM-1");
  });

  it("dosyayla gelen kopyalar da silinir: CSV (kanal 'manual' + ad kökeni 'file') ve .ics (kanal 'ics')", async () => {
    const w = await world();
    const csv = await booking(w.a, "HM-1", { channel: "manual", guestNameSource: "file" });
    const ics = await booking(w.a, "HM-2", { channel: "ics", guestNameSource: "file" });
    await channelCopy(w.b, "HM-1");
    await channelCopy(w.b, "HM-2");
    expect((await del(csv.id)).status).toBe(200);
    expect((await del(ics.id)).status).toBe(200);
    expect(await prisma.reservation.count({ where: { id: { in: [csv.id, ics.id] } } })).toBe(0);
    const classes = (await prisma.auditLog.findMany({ where: { action: "reservation.manual_copy_removed" }, select: { metadataJson: true } })).map(
      (a) => JSON.parse(a.metadataJson ?? "{}").sourceClass,
    );
    expect(classes.sort()).toEqual(["file", "file"]);
  });

  it("🚨 takvim satırı ve kanal satırı (bağlantılı / bağlantısız) silinmez: 409 + tasarımdaki cümle, satır YERİNDE, tutma sürer, kayıt yok", async () => {
    const w = await world();
    const cal = await booking(w.b, "HM-1", { channel: "airbnb", calendarSourceId: w.sourceId, guestNameSource: "calendar" });
    const linked = await booking(w.a, "HM-1", { channel: "airbnb", connectionId: "conn-1", guestNameSource: "channel" });
    // Etkin bağlantı yokken kanal senkronu bağlantı damgası basmaz (`hospitable-sync.ts`): bu satır da kanaldandır.
    const unlinked = await booking(w.a, "HM-2", { channel: "booking", guestNameSource: "placeholder" });
    // Takvim kimlikli satır kanal etiketi "manual" olsa da takvimdir.
    const calManual = await booking(w.a, "HM-3", { channel: "manual", calendarSourceId: w.sourceId });
    for (const id of [cal.id, linked.id, unlinked.id, calManual.id]) {
      const res = await del(id);
      expect(res.status, id).toBe(409);
      expect(await res.json()).toEqual({ error: MANUAL_COPY_SOURCE_BOUND_ERROR, code: "source_bound" });
      expect(await prisma.reservation.findUnique({ where: { id } }), id).not.toBeNull();
    }
    expect(MANUAL_COPY_SOURCE_BOUND_ERROR).toBe("Bu kayıt kaynağından geliyor; silinirse geri gelir.");
    expect(await conflicted(w.orgId, "HM-1")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "reservation.manual_copy_removed" } })).toBe(0);
  });

  it("🚨 yarış: sınıf okunduktan SONRA satır bir beslemeye bağlanırsa silinmez (409, satır yerinde) — süzgeç silme işleminin içinde", async () => {
    const w = await world();
    const manual = await booking(w.a, "HM-1", { channel: "manual", guestNameSource: "host" });
    await channelCopy(w.b, "HM-1");
    __manualCopyHooks.afterClassRead = async () => {
      await prisma.reservation.update({ where: { id: manual.id }, data: { calendarSourceId: w.sourceId, channel: "airbnb" } });
    };
    const res = await del(manual.id);
    expect(res.status).toBe(409);
    expect(await prisma.reservation.findUnique({ where: { id: manual.id } })).not.toBeNull();
  });

  it("kilitlenme DIŞINDAKİ hata yeniden denenmez: tek deneme, hata aynen fırlar (G1 11-19 T2-B6; mutasyon)", async () => {
    const w = await world();
    const manual = await booking(w.a, "HM-1", { channel: "manual", guestNameSource: "host" });
    await channelCopy(w.b, "HM-1");
    let calls = 0;
    __manualCopyHooks.afterClassRead = async () => {
      calls++;
      throw new Error("beklenmeyen arıza");
    };
    await expect(removeManualBookingCopy({ organizationId: w.orgId, reservationId: manual.id })).rejects.toThrow("beklenmeyen arıza");
    expect(calls).toBe(1);
    expect(await prisma.reservation.findUnique({ where: { id: manual.id } })).not.toBeNull();
  });

  it("yarış: sınıf okunduktan sonra satır başka yoldan silindiyse 404", async () => {
    const w = await world();
    const manual = await booking(w.a, "HM-1", { channel: "manual" });
    await channelCopy(w.b, "HM-1");
    __manualCopyHooks.afterClassRead = async () => {
      await prisma.reservation.delete({ where: { id: manual.id } });
    };
    expect((await del(manual.id)).status).toBe(404);
  });

  it("🚨 başka işletmenin elle girilen satırı: 404 (sahip de yönetici de), satır yerinde; olmayan kimlik 404", async () => {
    const mine = await world();
    const mineSession = session;
    const other = await world();
    const foreign = await booking(other.a, "HM-1", { channel: "manual", guestNameSource: "host" });
    session = mineSession;
    expect((await del(foreign.id)).status).toBe(404);
    session = { ...mineSession, role: "manager" };
    expect((await del(foreign.id)).status).toBe(404);
    expect(await prisma.reservation.findUnique({ where: { id: foreign.id } })).not.toBeNull();
    expect((await del("yok-boyle-bir-kayit")).status).toBe(404);
    expect(mine.orgId).not.toBe(other.orgId);
  });

  it("🚨 personel 403; bürünme (destek görünümü) 403 — satır yerinde; yönetici silebilir", async () => {
    const w = await world();
    const manual = await booking(w.a, "HM-1", { channel: "manual" });
    await channelCopy(w.b, "HM-1");
    const owner = session;
    session = { ...owner, role: "staff" };
    expect((await del(manual.id)).status).toBe(403);
    session = { ...owner, actorUserId: "operator-1", actorEmail: "op@x.com", actorName: "Operatör" };
    expect((await del(manual.id)).status).toBe(403);
    expect(await prisma.reservation.findUnique({ where: { id: manual.id } })).not.toBeNull();
    session = { ...owner, role: "manager" };
    expect((await del(manual.id)).status).toBe(200);
  });

  it("🚨 son kopya (G1 11-19 E1): başka dairede etkin kayıt yoksa elle kopya da kaldırılmaz — 409 + cümle, satır YERİNDE, kayıt yok", async () => {
    const w = await world();
    // Çakışma çözülmüş: öteki dairedeki kopya iptal (etkin değil) — kalan elle satır rezervasyonun kendisi.
    const manual = await booking(w.a, "HM-1", { channel: "manual", guestNameSource: "host" });
    const other = await channelCopy(w.b, "HM-1");
    await prisma.reservation.update({ where: { id: other.id }, data: { status: "cancelled" } });
    // Kaynak kimliği hiç olmayan elle satır da çakışmaya giremez.
    const lone = await prisma.reservation.create({
      data: { propertyId: w.a, guestName: "Ada Lale", arrivalDate: stayDay(4), departureDate: stayDay(7), status: "confirmed", channel: "manual" },
      select: { id: true },
    });
    for (const id of [manual.id, lone.id]) {
      const res = await del(id);
      expect(res.status, id).toBe(409);
      expect(await res.json()).toEqual({ error: MANUAL_COPY_LAST_ERROR, code: "last_copy" });
      expect(await prisma.reservation.findUnique({ where: { id } }), id).not.toBeNull();
    }
    // Kurucu 11-19 akşam madde 4, metin AYNEN: "kaldırılamaz" yerine neden ("artık yalnızca bir dairede") + ne yapılmadığı.
    expect(MANUAL_COPY_LAST_ERROR).toBe("Bu rezervasyon artık yalnızca bir dairede görünüyor. Son kaydı bu ekrandan kaldırmadık.");
    expect(await prisma.auditLog.count({ where: { action: "reservation.manual_copy_removed" } })).toBe(0);
    // KONTROL: öteki kopya yeniden etkinleşince aynı satır kaldırılır.
    await prisma.reservation.update({ where: { id: other.id }, data: { status: "confirmed" } });
    expect((await del(manual.id)).status).toBe(200);
  });

  it("🚨 yarış (G1 11-19 E1): iki elle kopya AYNI ANDA kaldırılırsa yalnız biri silinir — rezervasyon tümden gitmez", async () => {
    const w = await world();
    const c = await prisma.property.create({ data: { organizationId: w.orgId, name: "Lale 7" } });
    for (let round = 0; round < 5; round++) {
      const ref = `RACE-${round}`;
      const one = await booking(w.a, ref, { channel: "manual", guestNameSource: "host" });
      const two = await booking(c.id, ref, { channel: "manual", guestNameSource: "host" });
      const [r1, r2] = await Promise.all([
        removeManualBookingCopy({ organizationId: w.orgId, reservationId: one.id }),
        removeManualBookingCopy({ organizationId: w.orgId, reservationId: two.id }),
      ]);
      expect([r1.kind, r2.kind].sort(), ref).toEqual(["last_copy", "removed"]);
      expect(await prisma.reservation.count({ where: { sourceReference: ref } }), ref).toBe(1);
    }
  });

  it("KONTROL: genel silme ucu DEĞİŞMEDİ — takvim satırını da siler (kaynağa bakmaz; değiştirmek ayrı karar)", async () => {
    const w = await world();
    const cal = await booking(w.b, "HM-1", { channel: "airbnb", calendarSourceId: w.sourceId });
    const res = await reservationDelete(new NextRequest(`http://localhost/api/reservations/${cal.id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id: cal.id }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.reservation.findUnique({ where: { id: cal.id } })).toBeNull();
  });
});
