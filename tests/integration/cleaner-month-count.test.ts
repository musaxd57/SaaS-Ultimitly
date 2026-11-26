import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { treeText } from "../helpers/tree-text";

// ---------------------------------------------------------------------------
// Plan madde 10 (B) — temizlikçi başına ay sayımı ("Ayşe — 23 temizlik"), gerçek PostgreSQL. Sayılan: tür `cleaning`, şu an "bitti",
// bu ay (işletme diliminde) yazılmış "bitti" kaydı; kişi = atanan. Ay penceresi `now`dan kurulur (testte bugünün ayından türetilir —
// sabit takvim tarihi yok, zaman bombası yok).
// ---------------------------------------------------------------------------

vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Map([["host", "localhost:3000"]]),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/channels", async (orig) => ({
  ...(await orig<typeof import("@/lib/channels")>()),
  hasMessagingConnection: vi.fn(async () => false),
}));

import { requireAuth } from "@/lib/auth";
import { getCleanerMonthCounts } from "@/lib/reports";
import { zonedDateStart } from "@/lib/timezone";
import ReportsPage from "@/app/(app)/reports/page";

const IST = "Europe/Istanbul";
const mockAuth = vi.mocked(requireAuth);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

/** Bugünün İstanbul ayı: ay başı (İstanbul 00:00 = önceki gün 21:00Z) ve ayın 10'u öğlen (`now`). */
function month() {
  const [y, m] = new Date().toLocaleDateString("en-CA", { timeZone: IST }).split("-").map(Number);
  const start = zonedDateStart(y, m, 1, IST);
  return { start, now: new Date(start.getTime() + 9 * 86_400_000 + 12 * 3_600_000) };
}
const minutes = (d: Date, n: number) => new Date(d.getTime() + n * 60_000);

async function setup() {
  const org = await prisma.organization.create({ data: { name: "Sayım", timezone: IST } });
  const user = (name: string, role: string) =>
    prisma.user.create({ data: { email: `${name}-${org.id}@example.com`, name, passwordHash: "x", organizationId: org.id, role } });
  const owner = await user("Sahip", "owner");
  const ayse = await user("Ayşe", "staff");
  const mehmet = await user("Mehmet", "staff");
  const property = await prisma.property.create({ data: { organizationId: org.id, name: "Lale 3" } });
  return { org, owner, ayse, mehmet, property };
}

/** "Bitti" işaretlenmiş görev: rotanın yazdığı gibi görev durumu + aynı anlı `done` kaydı. */
async function doneTask(propertyId: string, assignedToId: string | null, doneAt: Date, extra: { type?: string; status?: string } = {}) {
  const task = await prisma.task.create({
    data: { propertyId, type: extra.type ?? "cleaning", title: "Çıkış temizliği", origin: "system", assignedToId, status: extra.status ?? "done" },
  });
  await prisma.taskUpdate.create({ data: { taskId: task.id, userId: assignedToId, status: "done", createdAt: doneAt } });
  return task;
}

describe("getCleanerMonthCounts", () => {
  it("iki temizlikçi farklı sayılar; atanan kişiye göre; çoktan aza", async () => {
    const s = await setup();
    const { start, now } = month();
    for (let i = 0; i < 3; i++) await doneTask(s.property.id, s.ayse.id, minutes(start, 60 + i));
    await doneTask(s.property.id, s.mehmet.id, minutes(start, 90));
    // Yönetici Mehmet adına "bitti" işaretledi → yine Mehmet'in satırı.
    const t = await prisma.task.create({ data: { propertyId: s.property.id, type: "cleaning", title: "x", assignedToId: s.mehmet.id, status: "done" } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: s.owner.id, status: "done", createdAt: minutes(start, 120) } });
    const r = await getCleanerMonthCounts(s.org.id, now);
    expect(r.rows.map((x) => [x.name, x.count])).toEqual([
      ["Ayşe", 3],
      ["Mehmet", 2],
    ]);
    expect(r.unassigned).toBe(0);
  });

  it("sayılmayanlar: 'bitti' olmayan · temizlik dışı tür · önceki ayın 'bitti'si (sınır İstanbul ay başı) · gelecek ay", async () => {
    const s = await setup();
    const { start, now } = month();
    await doneTask(s.property.id, s.ayse.id, minutes(start, 1)); // ay başından 1 dk sonra (UTC'de hâlâ önceki ay) → SAYILIR
    await doneTask(s.property.id, s.ayse.id, minutes(start, -1)); // ay başından 1 dk önce → önceki ay
    await doneTask(s.property.id, s.ayse.id, minutes(start, 60), { status: "in_progress" }); // "bitti" kaydı var ama geri alınmış
    await doneTask(s.property.id, s.ayse.id, minutes(start, 60), { type: "checkin_prep" });
    await doneTask(s.property.id, s.ayse.id, minutes(start, 60), { type: "maintenance" });
    const nextMonth = zonedDateStart(Number(now.toLocaleDateString("en-CA", { timeZone: IST }).slice(0, 4)), Number(now.toLocaleDateString("en-CA", { timeZone: IST }).slice(5, 7)) + 1, 1, IST);
    await doneTask(s.property.id, s.ayse.id, minutes(nextMonth, 5));
    // Kaydı olmayan "bitti" görev (kanıtsız) sayılmaz.
    await prisma.task.create({ data: { propertyId: s.property.id, type: "cleaning", title: "x", assignedToId: s.ayse.id, status: "done" } });
    const r = await getCleanerMonthCounts(s.org.id, now);
    expect(r.rows.map((x) => [x.name, x.count])).toEqual([["Ayşe", 1]]);
  });

  it("aynı ay içinde geri alınıp yeniden bitirilen görev bir kez sayılır; atanmamış ayrı sayılır", async () => {
    const s = await setup();
    const { start, now } = month();
    const t = await doneTask(s.property.id, s.ayse.id, minutes(start, 60));
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: s.ayse.id, status: "in_progress", createdAt: minutes(start, 70) } });
    await prisma.taskUpdate.create({ data: { taskId: t.id, userId: s.ayse.id, status: "done", createdAt: minutes(start, 80) } });
    await doneTask(s.property.id, null, minutes(start, 60));
    await doneTask(s.property.id, null, minutes(start, 61));
    const r = await getCleanerMonthCounts(s.org.id, now);
    expect(r.rows.map((x) => [x.name, x.count])).toEqual([["Ayşe", 1]]);
    expect(r.unassigned).toBe(2);
  });

  it("başka işletmenin görevleri sızmaz", async () => {
    const s = await setup();
    const { start, now } = month();
    const other = await prisma.organization.create({ data: { name: "Başka", timezone: IST } });
    const op = await prisma.property.create({ data: { organizationId: other.id, name: "Yabancı 1" } });
    await doneTask(op.id, s.ayse.id, minutes(start, 60));
    const r = await getCleanerMonthCounts(s.org.id, now);
    expect(r.rows).toEqual([]);
    expect(r.unassigned).toBe(0);
  });
});

describe("Raporlar sayfası — 'Temizlikler' kartı", () => {
  const as = (s: Awaited<ReturnType<typeof setup>>, who: { id: string; email: string }, role: string) =>
    mockAuth.mockResolvedValue({
      userId: who.id,
      organizationId: s.org.id,
      role,
      email: who.email,
      name: "x",
      sessionEpoch: 0,
    } as unknown as Awaited<ReturnType<typeof requireAuth>>);

  it("satır 'Ayşe' + '2 temizlik'; atanmamış satırı; para alanı yok", async () => {
    const s = await setup();
    await doneTask(s.property.id, s.ayse.id, new Date());
    await doneTask(s.property.id, s.ayse.id, new Date());
    await doneTask(s.property.id, null, new Date());
    as(s, s.owner, "owner");
    const text = treeText(await ReportsPage());
    expect(text).toContain("Temizlikler (");
    expect(text).toMatch(/Ayşe2 temizlik/);
    expect(text).toMatch(/Kimseye atanmamış1 temizlik/);
    expect(text).toContain("Yalnız bu ay “bitti” işaretlenen temizlikler sayılır");
  });

  it("bu ay hiç yoksa boş durum metni", async () => {
    const s = await setup();
    as(s, s.owner, "owner");
    expect(treeText(await ReportsPage())).toContain("Bu ay “bitti” işaretlenen temizlik yok");
  });

  it("temizlikçi rolü sayım verisini alamaz: Raporlar sayfası /tasks'a yönlenir", async () => {
    const s = await setup();
    await doneTask(s.property.id, s.mehmet.id, new Date());
    as(s, s.ayse, "staff");
    await expect(ReportsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/tasks$/);
  });
});
