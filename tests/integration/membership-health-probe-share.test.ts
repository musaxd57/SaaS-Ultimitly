import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeUser } from "../helpers/db";
import { GET as health } from "@/app/api/health/route";
import { clearProbeCache } from "@/lib/health-probe";
import { __resetStrictQueueState } from "@/lib/outbox/health";
import { __resetStrictMembershipState } from "@/lib/membership/health";

// ---------------------------------------------------------------------------
// M-2 dilim 2 (Opus S2): `/api/health?strict=1` herkese açık ve kimliksiz. İlk yazımda üyelik denetimi İSTEK BAŞINA bütün kullanıcı tablosunu
// sayıyordu (10-16'da kuyruk okuması için ölçülüp kapatılan yük sınıfı). Artık kuyrukla aynı desen: 30 sn önbellek + süren yoklama paylaşılır.
// Sayaç, kullanıcı tablosuna ÜYELİK süzgeciyle gelen her okumayı sayar (sayım ya da varlık sorusu fark etmez).
// Prisma temsilcisine casus → AYRI dosya ve dosya düzeyinde casus, GERİ ALINMAZ (CLAUDE.md: geri alınan casus istemciyi bozuk bırakıyor).
// ---------------------------------------------------------------------------

const probe = vi.hoisted(() => ({ calls: 0, failNext: false }));
const touchesMemberships = (args: unknown) => JSON.stringify((args as { where?: unknown } | undefined)?.where ?? {}).includes("memberships");
const realFindFirst = prisma.user.findFirst.bind(prisma.user);
const realCount = prisma.user.count.bind(prisma.user);
vi.spyOn(prisma.user, "findFirst").mockImplementation(((args: Parameters<typeof realFindFirst>[0]) => {
  if (touchesMemberships(args)) {
    probe.calls += 1;
    if (probe.failNext) {
      probe.failNext = false;
      return Promise.reject(new Error("db down"));
    }
  }
  return realFindFirst(args);
}) as never);
vi.spyOn(prisma.user, "count").mockImplementation(((args: Parameters<typeof realCount>[0]) => {
  if (touchesMemberships(args)) probe.calls += 1;
  return realCount(args);
}) as never);

const strict = () => health(new NextRequest("http://localhost/api/health?strict=1"));

describe("strict sağlık — üyelik yoklaması paylaşılır ve önbelleklidir", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.systemLock.create({ data: { name: "scheduled-sync", lockedUntil: new Date(0) } }); // taze nabız
    clearProbeCache();
    __resetStrictQueueState();
    __resetStrictMembershipState();
    probe.calls = 0;
    probe.failNext = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetStrictMembershipState();
  });

  it("🚨 önbellek boşken 100 eşzamanlı strict isteği üyelik tablosunu TEK kez sorar (eskiden istek başına tam tablo sayımı)", async () => {
    const org = await prisma.organization.create({ data: { name: "Lale" } });
    await makeUser({ data: { organizationId: org.id, name: "Sahip", email: "sahip-hp@example.test", passwordHash: "x" } });
    const res = await Promise.all(Array.from({ length: 100 }, () => strict()));
    expect(new Set(res.map((r) => r.status))).toEqual(new Set([200]));
    expect(new Set(await Promise.all(res.map(async (r) => (await r.json()).membership)))).toEqual(new Set(["ok"]));
    expect(probe.calls).toBe(1);
  });

  it("üyeliksiz kullanıcı → 503 users_without_membership; onarımdan sonra önbellek süresi dolunca 200", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    const org = await prisma.organization.create({ data: { name: "Eski kod" } });
    const orphan = await prisma.user.create({ data: { organizationId: org.id, name: "Ü", email: "orphan-hp@example.test", passwordHash: "x", role: "owner" } });
    const first = await strict();
    expect(first.status).toBe(503);
    expect(await first.json()).toMatchObject({ ok: false, membership: "missing", reason: "users_without_membership" });
    // Onarım (betiğin yazdığı satırın aynısı) — süre dolmadan önbellek eski sonucu verir, sonra yeniden okunur.
    await prisma.membership.create({ data: { userId: orphan.id, organizationId: org.id, role: "owner", origin: "backfill", singleMembershipGuard: orphan.id } });
    vi.setSystemTime(t0 + 10_000);
    expect((await strict()).status).toBe(503);
    vi.setSystemTime(t0 + 31_000);
    const healed = await strict();
    expect(healed.status).toBe(200);
    expect(await healed.json()).toMatchObject({ ok: true, membership: "ok" });
    expect(probe.calls).toBe(2);
  });

  it("yoklama hatası 'unknown' döner ve SAYFALAMAZ; süre dolunca yeniden denenir", async () => {
    const t0 = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
    probe.failNext = true;
    const first = await Promise.all(Array.from({ length: 10 }, () => strict()));
    expect(new Set(first.map((r) => r.status))).toEqual(new Set([200]));
    expect(await first[0]!.json()).toMatchObject({ ok: true, membership: "unknown" });
    expect(probe.calls).toBe(1);
    vi.setSystemTime(t0 + 31_000);
    expect(await (await strict()).json()).toMatchObject({ ok: true, membership: "ok" });
    expect(probe.calls).toBe(2);
  });
});
