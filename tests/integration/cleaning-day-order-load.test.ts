import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { treeText } from "../helpers/tree-text";
import { stayDayInZone } from "../helpers/stay-dates";

// ---------------------------------------------------------------------------
// Plan madde 10 (A) — temizlik gün sırası önerisi, gerçek PostgreSQL. Yükleyici yalnız yapılı kayıtları okur: görev (tür / durum / vade /
// atanan) · aynı gün girişi · erken giriş kaydı (`DecisionRequest`). Girişler sayfası kartı yalnız bir kişinin o gün EN AZ İKİ işi varsa çizer.
// Tarihler bugüne göre (zaman bombası yok).
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

import { requireAuth } from "@/lib/auth";
import { loadCleaningDayOrders } from "@/lib/tasks/day-order-load";
import ArrivalsPage from "@/app/(app)/arrivals/page";

const IST = "Europe/Istanbul";
const mockAuth = vi.mocked(requireAuth);

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
});

const today = () => stayDayInZone(0, IST);
const todayKey = () => today().toISOString().slice(0, 10);
const window = () => ({ fromKey: todayKey(), toKey: stayDayInZone(2, IST).toISOString().slice(0, 10), timeZone: IST });

async function setup() {
  const org = await prisma.organization.create({ data: { name: "Sıra", timezone: IST } });
  const owner = await prisma.user.create({ data: { email: `o-${org.id}@example.com`, name: "Sahip", passwordHash: "x", organizationId: org.id, role: "owner" } });
  const ayse = await prisma.user.create({ data: { email: `a-${org.id}@example.com`, name: "Ayşe", passwordHash: "x", organizationId: org.id, role: "staff" } });
  const prop = async (name: string, checkInTime: string) =>
    prisma.property.create({ data: { organizationId: org.id, name, checkInTime } });
  const [l3, l5, l7] = [await prop("Lale 3", "15:00"), await prop("Lale 5", "15:00"), await prop("Lale 7", "14:00")];
  return { org, owner, ayse, l3, l5, l7 };
}

const cleaning = (propertyId: string, assignedToId: string | null, extra: Record<string, unknown> = {}) =>
  prisma.task.create({ data: { propertyId, type: "cleaning", title: "Çıkış temizliği", origin: "system", assignedToId, dueAt: today(), ...extra } });

const arrival = (propertyId: string) =>
  prisma.reservation.create({
    data: { propertyId, guestName: "Deneme Misafir", arrivalDate: today(), departureDate: stayDayInZone(3, IST), status: "confirmed" },
  });

async function earlyDecision(orgId: string, propertyId: string, reservationId: string, data: Record<string, unknown>) {
  const conv = await prisma.conversation.create({ data: { propertyId, guestIdentifier: "Guest", channel: "airbnb", status: "waiting", reservationId } });
  const msg = await prisma.message.create({ data: { conversationId: conv.id, direction: "inbound", body: "erken gelebilir miyiz", senderName: "Guest" } });
  return prisma.decisionRequest.create({
    data: { organizationId: orgId, conversationId: conv.id, messageId: msg.id, reservationId, kind: "early_checkin", dayKey: todayKey(), lang: "tr", ...data },
  });
}

const names = (g: { jobs: { propertyName: string }[] }) => g.jobs.map((j) => j.propertyName);

describe("loadCleaningDayOrders", () => {
  it("erken giriş istenen önce, sonra girişi olan, yalnız çıkış sonda; 'bitti' görev ve başka işletmenin görevi girmez", async () => {
    const s = await setup();
    await cleaning(s.l7.id, s.ayse.id); // girişi yok
    await cleaning(s.l3.id, s.ayse.id);
    await cleaning(s.l5.id, s.ayse.id);
    await cleaning(s.l7.id, s.ayse.id, { status: "done" }); // bitti → sıraya girmez
    await cleaning(s.l3.id, s.ayse.id, { type: "maintenance", title: "Bakım" }); // temizlik değil
    await arrival(s.l3.id);
    const r5 = await arrival(s.l5.id);
    await earlyDecision(s.org.id, s.l5.id, r5.id, { status: "pending", requestedTime: "12:00" });
    // Başka işletme: aynı kişi kimliğiyle bile görünmez.
    const other = await prisma.organization.create({ data: { name: "Başka", timezone: IST } });
    const op = await prisma.property.create({ data: { organizationId: other.id, name: "Yabancı 1" } });
    await cleaning(op.id, s.ayse.id);

    const out = await loadCleaningDayOrders(s.org.id, window());
    expect(out.truncated).toBe(false);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].assigneeName).toBe("Ayşe");
    expect(names(out.groups[0])).toEqual(["Lale 5", "Lale 3", "Lale 7"]);
    expect(out.groups[0].jobs.map((j) => j.arrival)).toEqual([
      { checkInTime: "12:00", early: "requested" },
      { checkInTime: "15:00", early: null },
      null,
    ]);
  });

  it("onaylı erken giriş kendi saatiyle öne geçer; reddedilen istek erken sayılmaz", async () => {
    const s = await setup();
    await cleaning(s.l3.id, s.ayse.id);
    await cleaning(s.l5.id, s.ayse.id);
    await cleaning(s.l7.id, s.ayse.id);
    const r3 = await arrival(s.l3.id);
    const r5 = await arrival(s.l5.id);
    const r7 = await arrival(s.l7.id);
    await earlyDecision(s.org.id, s.l3.id, r3.id, { status: "approved", requestedTime: "11:00", decidedTime: "11:30" });
    await earlyDecision(s.org.id, s.l5.id, r5.id, { status: "declined", requestedTime: "09:00" });
    void r7;
    const out = await loadCleaningDayOrders(s.org.id, window());
    expect(names(out.groups[0])).toEqual(["Lale 3", "Lale 7", "Lale 5"]);
    expect(out.groups[0].jobs[0].arrival).toEqual({ checkInTime: "11:30", early: "approved" });
    expect(out.groups[0].jobs[2].arrival).toEqual({ checkInTime: "15:00", early: null });
  });

  it("aşırı uygulama: kişinin o gün tek işi varsa grup yok; iki kişiye bölünmüş iki iş de grup üretmez", async () => {
    const s = await setup();
    await cleaning(s.l3.id, s.ayse.id);
    await cleaning(s.l5.id, s.owner.id);
    await cleaning(s.l7.id, s.ayse.id, { dueAt: stayDayInZone(1, IST) }); // başka gün
    expect((await loadCleaningDayOrders(s.org.id, window())).groups).toEqual([]);
  });

  it("atanmamış işler kendi grubunda", async () => {
    const s = await setup();
    await cleaning(s.l3.id, null);
    await cleaning(s.l5.id, null);
    const out = await loadCleaningDayOrders(s.org.id, window());
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].assigneeId).toBeNull();
  });
});

describe("Girişler sayfası — kart", () => {
  const asOwner = (s: Awaited<ReturnType<typeof setup>>) =>
    mockAuth.mockResolvedValue({
      userId: s.owner.id,
      organizationId: s.org.id,
      role: "owner",
      email: s.owner.email,
      name: "Sahip",
      sessionEpoch: 0,
    } as unknown as Awaited<ReturnType<typeof requireAuth>>);

  it("iki temizliği olan kişi için sıralı liste çizilir; öneri olduğunu ve görevin değişmediğini söyler", async () => {
    const s = await setup();
    await cleaning(s.l7.id, s.ayse.id);
    await cleaning(s.l3.id, s.ayse.id);
    await arrival(s.l3.id);
    asOwner(s);
    const text = treeText(await ArrivalsPage());
    expect(text).toContain("Temizlik sırası önerisi");
    expect(text).toContain("Görevlerin saati ve ataması değişmez.");
    const first = text.indexOf("1. Lale 3");
    const second = text.indexOf("2. Lale 7");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(text).toContain("o gün giriş yok");
    // Görev değişmedi (yalnız öneri).
    const tasks = await prisma.task.findMany({ where: { property: { organizationId: s.org.id } }, select: { status: true, assignedToId: true, dueAt: true } });
    expect(tasks.every((t) => t.status === "todo" && t.assignedToId === s.ayse.id && t.dueAt?.getTime() === today().getTime())).toBe(true);
  });

  it("aşırı uygulama: tek temizlikte kart HİÇ çizilmez", async () => {
    const s = await setup();
    await cleaning(s.l3.id, s.ayse.id);
    asOwner(s);
    const text = treeText(await ArrivalsPage());
    expect(text).not.toContain("Temizlik sırası önerisi");
    expect(text).not.toContain("1. Lale 3");
  });

  it("temizlikçi rolü Girişler sayfasını açamaz", async () => {
    const s = await setup();
    mockAuth.mockResolvedValue({
      userId: s.ayse.id,
      organizationId: s.org.id,
      role: "staff",
      email: s.ayse.email,
      name: "Ayşe",
      sessionEpoch: 0,
    } as unknown as Awaited<ReturnType<typeof requireAuth>>);
    await expect(ArrivalsPage()).rejects.toThrow(/^NEXT_REDIRECT:\/tasks$/);
  });
});
