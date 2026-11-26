import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { strictQueueState, __resetStrictQueueState } from "@/lib/outbox/health";

// ---------------------------------------------------------------------------
// SAĞLIK YOKLAMASI PAYLAŞILIR (Codex 10-16): `/api/health?strict=1` herkese açık; kuyruk okuması 30 sn önbellekli ama SÜREN yoklamaya
// katılma yoktu → önbellek boşken gelen 100 eşzamanlı istek 100 ayrı yoklama (400 veritabanı okuması) başlatıyordu. Artık tek yoklama
// paylaşılır; yoklama bitince (hata dahil) boşalır ve önbellek süresi dolunca yeniden denenir.
// Prisma temsilcisine casus → AYRI dosya ve dosya düzeyinde TEK casus, GERİ ALINMAZ (CLAUDE.md: geri alınan casus istemciyi bozuk bırakıyor).
// ---------------------------------------------------------------------------

const probe = vi.hoisted(() => ({ calls: 0, failNext: false }));
const realQueryRaw = prisma.$queryRaw.bind(prisma);
vi.spyOn(prisma, "$queryRaw").mockImplementation(((...args: Parameters<typeof realQueryRaw>) => {
  probe.calls += 1;
  if (probe.failNext) {
    probe.failNext = false;
    return Promise.reject(new Error("db down"));
  }
  return realQueryRaw(...args);
}) as never);

describe("strictQueueState — süren yoklama paylaşılır", () => {
  beforeEach(async () => {
    await resetDb();
    __resetStrictQueueState();
    probe.calls = 0;
    probe.failNext = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    __resetStrictQueueState();
  });

  it("🚨 önbellek boşken 100 eşzamanlı istek TEK yoklama yapar (eskiden 100)", async () => {
    const states = await Promise.all(Array.from({ length: 100 }, () => strictQueueState()));
    expect(new Set(states)).toEqual(new Set(["ok"]));
    expect(probe.calls).toBe(1); // tek yoklamanın tek ham sorgusu
  });

  it("yoklama hatası 'unknown' döner; önbellek süresi dolunca yeniden denenir ve iyileşir (takılı kalan paylaşım yok)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    probe.failNext = true;
    const first = await Promise.all(Array.from({ length: 10 }, () => strictQueueState()));
    expect(new Set(first)).toEqual(new Set(["unknown"]));
    expect(probe.calls).toBe(1);
    vi.setSystemTime(new Date("2026-10-16T12:00:31Z")); // önbellek süresi (30 sn) doldu
    expect(await strictQueueState()).toBe("ok");
    expect(probe.calls).toBe(2);
  });
});
