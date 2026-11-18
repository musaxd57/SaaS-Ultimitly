import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// E5 (Codex 11-17 / kurucu 11-18 "Görev saati: saat dilimsiz 15:00 sunucunun saat dilimine göre farklı anlara dönüşüyor"). Form
// `datetime-local` değerini ("2026-11-20T15:00") dilimsiz gönderir; eski şema onu SÜRECİN diliminde okuyordu (Railway imajı UTC → İstanbul'un
// 15:00'i 15:00Z = 18:00 olarak kaydediliyordu). Artık İŞLETMENİN diliminde okunur. Testler süreç dilimini UTC ve New York yapıp aynı SABİT
// UTC sonucu bekler (sunucudan bağımsızlık); dilim taşıyan değer bugünkü gibi mutlak an.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { POST as createTaskRoute } from "@/app/api/tasks/route";
import { PATCH as patchTaskRoute } from "@/app/api/tasks/[id]/route";
import { taskDueTimeLabel } from "@/lib/tasks/card-data";

const ORIGINAL_TZ = process.env.TZ;

function post(body: Record<string, unknown>) {
  return createTaskRoute(
    new NextRequest("http://localhost/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({} as Record<string, never>) },
  );
}
function patch(id: string, body: Record<string, unknown>) {
  return patchTaskRoute(
    new NextRequest(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
}

describe("görev vadesi işletmenin saat diliminde (E5)", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Istanbul" } });
    const owner = await prisma.user.create({ data: { organizationId: orgId, name: "Sahip", email: "o@x.com", passwordHash: "x", role: "owner" } });
    session = { userId: owner.id, organizationId: orgId, role: "owner", email: "o@x.com", name: "Sahip", sessionEpoch: 0 };
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const body = (dueAt: string) => ({ propertyId, type: "cleaning", title: "Balkonu yıka", status: "todo", priority: "standard", dueAt });

  for (const processTz of ["UTC", "America/New_York"]) {
    it(`🚨 KIRMIZI-ÖNCE: süreç dilimi ${processTz} iken formdan gelen 15:00 İstanbul'un 15:00'i olarak kaydedilir; kartta 15:00 görünür`, async () => {
      process.env.TZ = processTz;
      const res = await post(body("2026-11-20T15:00"));
      expect(res.status).toBe(201);
      const { id } = (await res.json()) as { id: string };
      const t = await prisma.task.findUniqueOrThrow({ where: { id } });
      // 12:00:00.000Z saatsiz gün çapasıdır → 1 ms ileri (`lib/tasks/due-at.ts`); an İstanbul 15:00.
      expect(t.dueAt!.toISOString()).toBe("2026-11-20T12:00:00.001Z");
      // Gidiş-dönüş: girilen saat, pano / panel / e-postanın kullandığı gösterimde AYNI saat (işletme dilimi).
      expect(taskDueTimeLabel(t.dueAt, "Europe/Istanbul")).toBe("15:00");
    });
  }

  it("KONTROL — dilim taşıyan değer (API istemcisi, Z) bugünkü gibi mutlak an; çapaya dokunulmaz", async () => {
    process.env.TZ = "UTC";
    const a = (await (await post(body("2026-11-20T15:00:00Z"))).json()) as { id: string };
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.id } })).dueAt!.toISOString()).toBe("2026-11-20T15:00:00.000Z");
    const b = (await (await post(body("2026-11-20T15:00+03:00"))).json()) as { id: string };
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.id } })).dueAt!.toISOString()).toBe("2026-11-20T12:00:00.000Z");
  });

  it("🚨 düzenleme (PATCH) aynı kural: dilimsiz 09:30 → İstanbul 09:30 (06:30Z); dilim taşıyan bugünkü gibi", async () => {
    process.env.TZ = "UTC";
    const { id } = (await (await post(body(""))).json()) as { id: string };
    expect((await patch(id, { dueAt: "2026-11-21T09:30" })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).dueAt!.toISOString()).toBe("2026-11-21T06:30:00.000Z");
    expect((await patch(id, { dueAt: "2026-11-21T09:30:00Z" })).status).toBe(200);
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).dueAt!.toISOString()).toBe("2026-11-21T09:30:00.000Z");
  });

  it("yaz saati olan işletme (Europe/Berlin): boşluktaki 02:30 → 03:30 yaz saati (01:30Z); çift saat 02:30 → kış saati (01:30Z)", async () => {
    process.env.TZ = "UTC";
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: "Europe/Berlin" } });
    const gap = (await (await post(body("2026-03-29T02:30"))).json()) as { id: string };
    expect((await prisma.task.findUniqueOrThrow({ where: { id: gap.id } })).dueAt!.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    const overlap = (await (await post(body("2026-10-25T02:30"))).json()) as { id: string };
    expect((await prisma.task.findUniqueOrThrow({ where: { id: overlap.id } })).dueAt!.toISOString()).toBe("2026-10-25T01:30:00.000Z");
  });

  it("KONTROL — vadesiz görev vadesiz; takvimde olmayan saat 400 'Geçersiz tarih', görev açılmaz", async () => {
    const { id } = (await (await post(body(""))).json()) as { id: string };
    expect((await prisma.task.findUniqueOrThrow({ where: { id } })).dueAt).toBeNull();
    const bad = await post(body("2026-02-31T10:00"));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields?: Record<string, string> }).fields?.dueAt).toBe("Geçersiz tarih");
    expect(await prisma.task.count({ where: { propertyId } })).toBe(1);
  });
});
