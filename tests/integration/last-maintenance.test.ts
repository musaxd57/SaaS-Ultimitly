import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Plan madde 9 (kurucu 11-25): "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı' (Ahmet)". Aynı dairede açık bir bakım görevi varken
// ev sahibi o dairenin SON kapanmış bakım işini görür. Görev "bitti" rotadan (gerçek yol) kapatılır; okuma toplu ve işletme kapsamlı.
// Tarihler bağıl (gerçek saatten gün farkı) — sabit tarih yok. Tasarım: docs/TASARIM-2026-11-25-son-bakim-isi-notu.md
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { PATCH } from "@/app/api/tasks/[id]/route";
import { lastMaintenanceLine } from "@/lib/tasks/last-maintenance";
import { lastClosedMaintenanceByProperty } from "@/lib/tasks/last-maintenance-query";
import { taskCardData } from "@/lib/tasks/card-data";
import { TASK_BOARD_INCLUDE } from "@/lib/tasks/board-include";

const TZ = "Europe/Istanbul";
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let orgId = "";
let propertyId = "";
let ahmetId = "";

async function close(taskId: string, body: Record<string, unknown>, userId = ahmetId) {
  session = { userId, organizationId: orgId, role: "owner", email: "a@x.com", name: "Ahmet", sessionEpoch: 0 };
  const req = new NextRequest(`http://localhost/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id: taskId }) });
}

async function task(over: Record<string, unknown> = {}) {
  return prisma.task.create({ data: { propertyId, type: "maintenance", title: "Bakım: kombi", status: "todo", origin: "manual", ...over } });
}

/** Kapanmış iş, kapanış satırı geçmiş bir günde (rota satırı "şimdi" yazar; en yeni / en eski kıyası için doğrudan kayıt). */
async function closedAt(daysBack: number, note: string | null, over: Record<string, unknown> = {}, userId: string | null = ahmetId) {
  const t = await task({ status: "done", ...over });
  await prisma.taskUpdate.create({ data: { taskId: t.id, userId, status: "done", note, createdAt: daysAgo(daysBack) } });
  return t;
}

beforeEach(async () => {
  await resetDb();
  const org = await prisma.organization.create({ data: { name: "Org" } });
  orgId = org.id;
  const ahmet = await prisma.user.create({ data: { organizationId: orgId, name: "Ahmet", email: "a@x.com", passwordHash: "x", role: "owner" } });
  ahmetId = ahmet.id;
  propertyId = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale" } })).id;
});

describe("son bakım işi — okuma (gerçek 'bitti' yolu)", () => {
  it("🚨 (a) notlu kapanış: 'bitti' + not TEK istekte → satır tarih + not + kişi", async () => {
    const old = await task();
    const res = await close(old.id, { status: "done", note: "reset yapıldı" });
    expect(res.status).toBe(200);
    // Durum + not aynı satırda (tek kayıt, kim = kapatan).
    expect(await prisma.taskUpdate.count({ where: { taskId: old.id } })).toBe(1);
    await task(); // aynı dairede yeni açık bakım işi
    const m = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId);
    expect(m).toMatchObject({ note: "reset yapıldı", by: "Ahmet" });
    const now = new Date();
    const day = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: TZ }).format(m!.closedAt);
    expect(lastMaintenanceLine(m!, TZ, now)).toBe(`Bu dairede son bakım işi: ${day} — 'reset yapıldı' (Ahmet)`);
  });

  it("🚨 (b) notsuz kapanış → tarih + kim; (g) notsuz 'bitti' eskisi gibi 200", async () => {
    const old = await task();
    expect((await close(old.id, { status: "done" })).status).toBe(200);
    const m = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!;
    expect(m.note).toBeNull();
    expect(lastMaintenanceLine(m, TZ, new Date())).toMatch(/^Bu dairede son bakım işi: \d{1,2} \p{L}+ \(Ahmet\)$/u);
  });

  it("(c) hiç kapanmış bakım işi yok → kayıt yok (açık bakım işi ve yarım kalan bakım sayılmaz)", async () => {
    await task();
    await task({ status: "in_progress" });
    expect((await lastClosedMaintenanceByProperty(orgId, [propertyId])).has(propertyId)).toBe(false);
  });

  it("🚨 (d) başka dairenin / başka işletmenin bakım işi gösterilmez", async () => {
    const otherProp = await prisma.property.create({ data: { organizationId: orgId, name: "Gül" } });
    await closedAt(1, "boru değişti", { propertyId: otherProp.id });
    const otherOrg = await prisma.organization.create({ data: { name: "Öteki" } });
    const foreignProp = await prisma.property.create({ data: { organizationId: otherOrg.id, name: "Lale" } });
    await closedAt(1, "yabancı not", { propertyId: foreignProp.id }, null);
    const map = await lastClosedMaintenanceByProperty(orgId, [propertyId, foreignProp.id]);
    expect(map.has(propertyId)).toBe(false);
    // Yabancı daire kimliği istense bile işletme sınırı okumaz.
    expect(map.has(foreignProp.id)).toBe(false);
    // Kendi öteki dairesi istenirse onunki gelir (sorgu daire başına ayrı).
    expect((await lastClosedMaintenanceByProperty(orgId, [otherProp.id])).get(otherProp.id)?.note).toBe("boru değişti");
  });

  it("🚨 (e) temizlik / çıkış kontrolü 'son bakım işi' sayılmaz", async () => {
    await closedAt(1, "temizlendi", { type: "cleaning" });
    await closedAt(1, "kontrol edildi", { type: "checkout_review" });
    expect((await lastClosedMaintenanceByProperty(orgId, [propertyId])).has(propertyId)).toBe(false);
  });

  it("🚨 (f) iki kapanmış iş → kapanışı EN YENİ olan (oluşturma sırası değil)", async () => {
    // Önce oluşturulan iş SONRA kapandı.
    await closedAt(3, "reset yapıldı");
    await closedAt(40, "eski çözüm");
    const m = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!;
    expect(m.note).toBe("reset yapıldı");
    expect(Math.round((Date.now() - m.closedAt.getTime()) / DAY)).toBe(3);
  });

  it("yeniden açılıp tekrar kapanan iş: en son 'bitti' satırı sayılır", async () => {
    const t = await task({ status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, status: "done", note: "ilk deneme", createdAt: daysAgo(20) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, status: "todo", createdAt: daysAgo(10) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, status: "done", note: "parça değişti", createdAt: daysAgo(2) } });
    const m = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!;
    expect(m.note).toBe("parça değişti");
  });

  it("kapanış satırı notsuz → işin en son SERBEST notu; 'Yapılamıyor' gerekçesi 'ne yapıldı' sayılmaz", async () => {
    const t = await task({ status: "done" });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, status: "blocked", note: "hastayım", createdAt: daysAgo(4) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, status: "done", note: null, createdAt: daysAgo(3) } });
    expect((await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!.note).toBeNull();
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: ahmetId, note: "  filtre temizlendi  ", createdAt: daysAgo(2) } });
    expect((await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!.note).toBe("filtre temizlendi");
  });

  it("kapatan kişi silinmiş / bilinmiyor → parantez yok; kapanış satırı olmayan eski kayıt görevin güncellenme anıyla", async () => {
    await closedAt(5, "reset yapıldı", {}, null);
    const m = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!;
    expect(m.by).toBeNull();
    expect(lastMaintenanceLine(m, TZ, new Date())).toMatch(/— 'reset yapıldı'$/);
    await resetDb();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    orgId = org.id;
    propertyId = (await prisma.property.create({ data: { organizationId: orgId, name: "Lale" } })).id;
    const legacy = await task({ status: "done" });
    const m2 = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId)!;
    expect(m2).toMatchObject({ note: null, by: null });
    expect(m2.closedAt.getTime()).toBe(legacy.updatedAt.getTime());
  });

  it("boş liste → sorgu yok, boş harita", async () => {
    expect((await lastClosedMaintenanceByProperty(orgId, [])).size).toBe(0);
  });
});

describe("son bakım işi — pano kartı", () => {
  async function card() {
    await closedAt(2, "reset yapıldı");
    const open = await task();
    const row = await prisma.task.findUniqueOrThrow({ where: { id: open.id }, include: TASK_BOARD_INCLUDE });
    const last = (await lastClosedMaintenanceByProperty(orgId, [propertyId])).get(propertyId) ?? null;
    return { row, last };
  }

  it("🚨 yönetici: AÇIK bakım kartında satır var", async () => {
    const { row, last } = await card();
    const c = taskCardData(row, { canManage: true, timeZone: TZ, now: new Date(), latestPhotoUrl: null, lastMaintenance: last });
    expect(c.lastMaintenance).toMatch(/^Bu dairede son bakım işi: .+ — 'reset yapıldı' \(Ahmet\)$/);
  });

  it("🚨 KONTROL — personel görünümünde satır YOK; bitmiş bakım kartında ve bakım dışı kartta YOK", async () => {
    const { row, last } = await card();
    const base = { timeZone: TZ, now: new Date(), latestPhotoUrl: null, lastMaintenance: last };
    expect(taskCardData(row, { ...base, canManage: false }).lastMaintenance).toBeNull();
    expect(taskCardData({ ...row, status: "done" }, { ...base, canManage: true }).lastMaintenance).toBeNull();
    expect(taskCardData({ ...row, type: "cleaning" }, { ...base, canManage: true }).lastMaintenance).toBeNull();
    expect(taskCardData(row, { ...base, canManage: true, lastMaintenance: null }).lastMaintenance).toBeNull();
  });
});

describe("lastMaintenanceLine — biçim", () => {
  const at = (iso: string) => new Date(iso);
  it("başka yılın işi yıllı yazılır; uzun / çok satırlı not tek satıra iner ve kısaltılır", () => {
    const now = at("2026-11-25T09:00:00Z");
    expect(lastMaintenanceLine({ closedAt: at("2025-05-17T09:00:00Z"), note: null, by: "Ahmet" }, TZ, now)).toBe(
      "Bu dairede son bakım işi: 17 Mayıs 2025 (Ahmet)",
    );
    expect(lastMaintenanceLine({ closedAt: at("2026-05-17T09:00:00Z"), note: "reset\n  yapıldı", by: null }, TZ, now)).toBe(
      "Bu dairede son bakım işi: 17 Mayıs — 'reset yapıldı'",
    );
    const long = lastMaintenanceLine({ closedAt: at("2026-05-17T09:00:00Z"), note: "a".repeat(200), by: "Ahmet" }, TZ, now);
    expect(long).toBe(`Bu dairede son bakım işi: 17 Mayıs — '${"a".repeat(79)}…' (Ahmet)`);
  });

  it("gün işletme saat diliminde: UTC 22:30 İstanbul'da ertesi gün", () => {
    const now = at("2026-11-25T09:00:00Z");
    expect(lastMaintenanceLine({ closedAt: at("2026-05-16T22:30:00Z"), note: null, by: null }, TZ, now)).toBe("Bu dairede son bakım işi: 17 Mayıs");
  });

  it("uzun not kod noktasıyla kesilir: emoji ortadan bölünmez (bozuk karakter kalmaz)", () => {
    const note = `${"a".repeat(78)}😀😀😀`;
    const line = lastMaintenanceLine({ closedAt: new Date(), note, by: null }, TZ, new Date());
    expect(line).toContain(`${"a".repeat(78)}😀…'`);
    // Tek başına kalmış vekil (surrogate) yok.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line)).toBe(false);
  });
});
