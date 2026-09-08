import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/reservations/import/route";

// ---------------------------------------------------------------------------
// "DOSYADAN İÇE AKTAR" — tek seferlik .ics aktarımı (Codex, 2026-09-08).
//
// Sözleşme:
//   · mode=preview → HİÇBİR ŞEY YAZILMAZ; mülk + eklenecek/güncellenecek/iptal/atlanacak
//     sayıları ve satır başına sınıf/gerekçe döner. Aktarım bütçesini (5/saat) TÜKETMEZ.
//   · Aynı UID ile tekrar yükleme çift kayıt ÜRETMEZ (değişmediyse "unchanged").
//   · Aynı UID + değişen tarih → önceki dosya aktarımının GÜNCELLEMESİ (reservation.updated,
//     changedFields) — yalnız bu yolun kendi satırı (calendarSourceId NULL + channel "ics").
//   · Aynı UID + STATUS:CANCELLED → doğru satırı bulur ve iptal eder (reservation.cancelled).
//   · Takvim bağlantısına (feed) ait satıra DOKUNULMAZ: önizleme bunu "başka kaynak" diye söyler.
//   · Dosyada BULUNMAYAN eski rezervasyonlar sırf eksik diye iptal EDİLMEZ.
//   · İptalli satır canlı görünen dosyayla GERİ AÇILMAZ (pozitif kanıt kuralı).
//   · Tenant: başka org'un mülkü → 400 (mevcut doğrulama korunur).
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const icsDay = (offset: number) =>
  new Date(Date.now() + offset * DAY).toISOString().slice(0, 10).replace(/-/g, "");

function vevent(uid: string, o?: { cancelled?: boolean; summary?: string; from?: number; to?: number }) {
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${icsDay(o?.from ?? 10)}`,
    `DTEND;VALUE=DATE:${icsDay(o?.to ?? 13)}`,
    `SUMMARY:${o?.summary ?? "Lixus Test Rezervasyonu (sahte)"}`,
    ...(o?.cancelled ? ["STATUS:CANCELLED"] : []),
    "END:VEVENT",
  ].join("\r\n");
}
const calendar = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");

function req(propertyId: string, ics: string, mode?: "preview") {
  const form = new FormData();
  form.set("file", new File([ics], "test-reservation.ics", { type: "text/calendar" }));
  form.set("propertyId", propertyId);
  if (mode) form.set("mode", mode);
  return new NextRequest("http://localhost/api/reservations/import", { method: "POST", body: form });
}
const call = (r: NextRequest) => POST(r, { params: Promise.resolve({}) });

const UID = "lixus-v1-test-2026-09-08-001@lixusai.com";

describe("POST /api/reservations/import — dosyadan içe aktar (önizleme + aynı UID akışı)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@x.com", name: "O", sessionEpoch: 0 };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("ÖNİZLEME hiçbir şey yazmaz: mülk adı + sayılar + satır sınıfı döner; rezervasyon/event/görev 0", async () => {
    const res = await call(req(propertyId, calendar(vevent(UID)), "preview"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: propertyId }, select: { name: true } });
    expect(body.preview).toBe(true);
    expect(body.property).toEqual({ id: propertyId, name: prop.name });
    expect(body.counts).toEqual({ create: 1, update: 0, cancel: 0, skipped: 0 });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ uid: UID, action: "create" });
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
    expect(await prisma.ingestEvent.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.task.count({ where: { property: { organizationId: orgId } } })).toBe(0);
  });

  it("SIRALI AKIŞ: normal dosya → 1 eklendi; AYNI dosya tekrar → 0 (mükerrer yok, 'unchanged'); iptal dosyası (aynı UID) → doğru satır iptal + reservation.cancelled", async () => {
    const r1 = await call(req(propertyId, calendar(vevent(UID))));
    expect(await r1.json()).toMatchObject({ imported: 1, updated: 0, cancelled: 0, skipped: 0 });
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: UID } });
    expect(row.status).toBe("confirmed");
    expect(row.channel).toBe("ics");
    expect(row.calendarSourceId).toBeNull();

    // Aynı dosya ikinci kez: önizleme "unchanged", aktarım 0 yazma.
    const p2 = await (await call(req(propertyId, calendar(vevent(UID)), "preview"))).json();
    expect(p2.counts).toEqual({ create: 0, update: 0, cancel: 0, skipped: 1 });
    expect(p2.rows[0]).toMatchObject({ action: "skip", reason: "unchanged" });
    const r2 = await call(req(propertyId, calendar(vevent(UID))));
    expect(await r2.json()).toMatchObject({ imported: 0, updated: 0, cancelled: 0, skipped: 1 });
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1);

    // İptal dosyası: önizleme "cancel", aktarım iptal eder, event yazar.
    const p3 = await (await call(req(propertyId, calendar(vevent(UID, { cancelled: true })), "preview"))).json();
    expect(p3.counts).toEqual({ create: 0, update: 0, cancel: 1, skipped: 0 });
    expect(p3.rows[0]).toMatchObject({ uid: UID, action: "cancel" });
    const r3 = await call(req(propertyId, calendar(vevent(UID, { cancelled: true }))));
    expect(await r3.json()).toMatchObject({ imported: 0, updated: 0, cancelled: 1, skipped: 0 });
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("cancelled");
    const evs = await prisma.ingestEvent.findMany({ where: { organizationId: orgId }, orderBy: { occurredAt: "asc" } });
    expect(evs.map((e) => [e.kind, e.provider, e.entityId])).toEqual([
      ["reservation.created", "manual_file", row.id],
      ["reservation.cancelled", "manual_file", row.id],
    ]);
  });

  it("AYNI UID + değişen tarih → önceki dosya aktarımının GÜNCELLEMESİ (update, reservation.updated + changedFields); ad değişmedi", async () => {
    await call(req(propertyId, calendar(vevent(UID))));
    const before = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: UID } });

    const p = await (await call(req(propertyId, calendar(vevent(UID, { from: 12, to: 15 })), "preview"))).json();
    expect(p.counts).toEqual({ create: 0, update: 1, cancel: 0, skipped: 0 });
    expect(p.rows[0]).toMatchObject({ uid: UID, action: "update" });

    const r = await call(req(propertyId, calendar(vevent(UID, { from: 12, to: 15 }))));
    expect(await r.json()).toMatchObject({ imported: 0, updated: 1, cancelled: 0, skipped: 0 });
    const after = await prisma.reservation.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.arrivalDate.getTime()).not.toBe(before.arrivalDate.getTime());
    expect(after.status).toBe("confirmed");
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1); // mükerrer yok
    const upd = await prisma.ingestEvent.findFirstOrThrow({ where: { organizationId: orgId, kind: "reservation.updated" } });
    expect(upd.entityId).toBe(before.id);
    expect(upd.provider).toBe("manual_file");
    expect(JSON.parse(upd.changedFieldsJson ?? "[]").sort()).toEqual(["arrivalDate", "departureDate"]);
  });

  it("dosyada BULUNMAYAN eski rezervasyon sırf eksik diye iptal EDİLMEZ", async () => {
    await call(req(propertyId, calendar(vevent(UID), vevent("ikinci@lixusai.com", { from: 20, to: 22 }))));
    expect(await prisma.reservation.count({ where: { propertyId, status: "confirmed" } })).toBe(2);
    // İkinci dosya yalnız birinciyi içeriyor → diğeri hiç dokunulmadan kalır.
    const r = await call(req(propertyId, calendar(vevent(UID))));
    expect(await r.json()).toMatchObject({ imported: 0, updated: 0, cancelled: 0, skipped: 1 });
    expect(await prisma.reservation.count({ where: { propertyId, status: "confirmed" } })).toBe(2);
  });

  it("takvim bağlantısına (feed) ait satıra DOKUNULMAZ: önizleme 'owned_by_feed' der; iptal ve güncelleme atlanır", async () => {
    const src = await prisma.calendarSource.create({
      data: { propertyId, label: "Airbnb", url: "https://example.com/feed.ics" },
    });
    const feedRow = await prisma.reservation.create({
      data: {
        propertyId,
        guestName: "Feed Misafiri",
        arrivalDate: new Date(Date.now() + 10 * DAY),
        departureDate: new Date(Date.now() + 13 * DAY),
        channel: "airbnb",
        status: "confirmed",
        sourceReference: UID,
        calendarSourceId: src.id,
        currency: "EUR",
      },
    });
    const p = await (await call(req(propertyId, calendar(vevent(UID, { cancelled: true })), "preview"))).json();
    expect(p.counts).toEqual({ create: 0, update: 0, cancel: 0, skipped: 1 });
    expect(p.rows[0]).toMatchObject({ action: "skip", reason: "owned_by_feed" });
    const r = await call(req(propertyId, calendar(vevent(UID, { cancelled: true }))));
    expect(await r.json()).toMatchObject({ cancelled: 0, skipped: 1 });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: feedRow.id } })).status).toBe("confirmed");
    // Güncelleme de dokunmaz.
    const r2 = await call(req(propertyId, calendar(vevent(UID, { from: 12, to: 15 }))));
    expect(await r2.json()).toMatchObject({ imported: 0, updated: 0, skipped: 1 });
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: feedRow.id } })).arrivalDate.getTime()).toBe(
      feedRow.arrivalDate.getTime(),
    );
  });

  it("iptalli satır canlı görünen dosyayla GERİ AÇILMAZ (pozitif kanıt kuralı): önizleme 'cancelled_stays'", async () => {
    await call(req(propertyId, calendar(vevent(UID))));
    await call(req(propertyId, calendar(vevent(UID, { cancelled: true }))));
    const p = await (await call(req(propertyId, calendar(vevent(UID)), "preview"))).json();
    expect(p.rows[0]).toMatchObject({ action: "skip", reason: "cancelled_stays" });
    const r = await call(req(propertyId, calendar(vevent(UID))));
    expect(await r.json()).toMatchObject({ imported: 0, updated: 0, cancelled: 0, skipped: 1 });
    const row = await prisma.reservation.findFirstOrThrow({ where: { propertyId, sourceReference: UID } });
    expect(row.status).toBe("cancelled");
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(1);
  });

  it("iptal dosyası eşleşen kayıt bulamazsa iptal UYDURULMAZ ('cancel_no_match'); önizleme bunu söyler", async () => {
    const p = await (await call(req(propertyId, calendar(vevent("yok@lixusai.com", { cancelled: true })), "preview"))).json();
    expect(p.counts).toEqual({ create: 0, update: 0, cancel: 0, skipped: 1 });
    expect(p.rows[0]).toMatchObject({ action: "skip", reason: "cancel_no_match" });
    const r = await call(req(propertyId, calendar(vevent("yok@lixusai.com", { cancelled: true }))));
    expect(await r.json()).toMatchObject({ imported: 0, cancelled: 0, skipped: 1 });
    expect(await prisma.reservation.count({ where: { propertyId } })).toBe(0);
  });

  it("TENANT: başka org'un mülkü önizlemede de 400 (mevcut doğrulama korunur)", async () => {
    const other = await makeOrgWithProperty();
    const res = await call(req(other.propertyId, calendar(vevent(UID)), "preview"));
    expect(res.status).toBe(400);
    expect(await prisma.reservation.count({ where: { propertyId: other.propertyId } })).toBe(0);
  });

  it("önizleme aktarım bütçesini TÜKETMEZ: 6 önizleme sonra gerçek aktarım hâlâ geçer", async () => {
    for (let i = 0; i < 6; i++) {
      const res = await call(req(propertyId, calendar(vevent(UID)), "preview"));
      expect(res.status).toBe(200);
    }
    const r = await call(req(propertyId, calendar(vevent(UID))));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ imported: 1 });
  });
});
