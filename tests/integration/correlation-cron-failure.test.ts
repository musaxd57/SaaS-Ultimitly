import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// TAKİP NUMARASI 2. dilim — senkron geçişinin özet satırı (route): yalnız İŞ yapılan ya da GERÇEK hatayla biten geçiş yazılır; boş tik ve
// zararsız erken çıkış ("zaten koşuyor" / "kilitli") yazılmaz (hacim — Haiku incelemesi 10-12); geçiş FIRLATIRSA "job.failed".
const { runScheduledSyncMock } = vi.hoisted(() => ({ runScheduledSyncMock: vi.fn() }));
vi.mock("@/lib/scheduled-sync", () => ({ runScheduledSync: runScheduledSyncMock }));

import { GET as cronGet } from "@/app/api/cron/sync/route";

const tick = () => cronGet(new NextRequest("http://localhost/api/cron/sync", { headers: { authorization: "Bearer cron-secret-for-tests" } }));
const totals = (over: Record<string, unknown>) => ({ ok: true, organizations: 1, conversations: 0, messages: 0, autoReplies: 0, welcomes: 0, checkins: 0, checkouts: 0, alerts: 0, ...over });
const finished = () => prisma.operationalEvent.findMany({ where: { event: "job.finished" } });

describe("zamanlanmış senkron — özet satırı ve fırlatma yolu", () => {
  beforeEach(async () => {
    await resetDb();
    vi.stubEnv("CRON_SECRET", "cron-secret-for-tests");
    runScheduledSyncMock.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("boş tik ve zararsız erken çıkış YAZILMAZ; iş yapılan geçiş ve gerçek hata YAZILIR", async () => {
    runScheduledSyncMock.mockResolvedValueOnce(totals({}));
    runScheduledSyncMock.mockResolvedValueOnce(totals({ ok: false, error: "already_running" }));
    runScheduledSyncMock.mockResolvedValueOnce(totals({ ok: false, error: "locked" }));
    for (let i = 0; i < 3; i++) expect((await tick()).status).toBe(200);
    expect(await finished()).toEqual([]);

    runScheduledSyncMock.mockResolvedValueOnce(totals({ messages: 2, autoReplies: 1 }));
    runScheduledSyncMock.mockResolvedValueOnce(totals({ ok: false, error: "db_down" }));
    await tick();
    await tick();
    const rows = await finished();
    expect(rows.map((r) => JSON.parse(r.dataJson!))).toEqual([
      expect.objectContaining({ job: "scheduled-sync", status: "ok", count: 2, replies: 1 }),
      expect.objectContaining({ job: "scheduled-sync", status: "db_down" }),
    ]);
    expect(rows.every((r) => r.organizationId === null)).toBe(true);
  });

  it("🚨 geçiş fırlatırsa 'job.failed' yazılır ve hata aynen yukarı gider", async () => {
    runScheduledSyncMock.mockRejectedValueOnce(new Error("geçiş çöktü"));
    await expect(tick()).rejects.toThrow(/geçiş çöktü/);
    const rows = await prisma.operationalEvent.findMany({ where: { event: "job.failed" } });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].dataJson!)).toMatchObject({ job: "scheduled-sync" });
  });
});
