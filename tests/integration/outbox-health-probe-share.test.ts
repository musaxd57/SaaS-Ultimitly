import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";
import { strictQueueState, __resetStrictQueueState } from "@/lib/outbox/health";

// ---------------------------------------------------------------------------
// SAĞLIK YOKLAMASI PAYLAŞILIR (Codex 10-16): `/api/health?strict=1` herkese açık; kuyruk okuması 30 sn önbellekli ama SÜREN yoklamaya
// katılma yoktu → önbellek boşken gelen 100 eşzamanlı istek 100 ayrı yoklama (400 veritabanı okuması) başlatıyordu. Artık tek yoklama
// paylaşılır; yoklama bitince (hata dahil) boşalır ve süre dolunca yeniden denenir.
// Prisma temsilcisine casus → AYRI dosya (CLAUDE.md: spy sonraki testlere sızar).
// ---------------------------------------------------------------------------

describe("strictQueueState — süren yoklama paylaşılır", () => {
  beforeEach(async () => {
    await resetDb();
    __resetStrictQueueState();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    __resetStrictQueueState();
  });

  it("🚨 önbellek boşken 100 eşzamanlı istek TEK yoklama yapar (eskiden 100)", async () => {
    const spy = vi.spyOn(prisma.emailOutbox, "findFirst");
    const states = await Promise.all(Array.from({ length: 100 }, () => strictQueueState()));
    expect(new Set(states)).toEqual(new Set(["ok"]));
    expect(spy).toHaveBeenCalledTimes(2); // tek yoklamanın iki e-posta kuyruğu okuması
  });

  it("yoklama hatası 'unknown' döner; süre dolunca yeniden denenir ve iyileşir (takılı kalan paylaşım yok)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
    const raw = vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("db down"));
    const first = await Promise.all(Array.from({ length: 10 }, () => strictQueueState()));
    expect(new Set(first)).toEqual(new Set(["unknown"]));
    expect(raw).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-16T12:00:31Z")); // önbellek süresi (30 sn) doldu
    expect(await strictQueueState()).toBe("ok");
    expect(raw).toHaveBeenCalledTimes(2);
  });
});
