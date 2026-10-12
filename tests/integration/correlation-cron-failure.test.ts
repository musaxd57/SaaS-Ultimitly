import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// TAKİP NUMARASI 2. dilim: senkron geçişi FIRLATIRSA "job.failed" satırı geçişin numarasıyla yazılır, hata yukarı aynen gider.
vi.mock("@/lib/scheduled-sync", () => ({ runScheduledSync: vi.fn(async () => { throw new Error("geçiş çöktü"); }) }));

import { GET as cronGet } from "@/app/api/cron/sync/route";

describe("zamanlanmış senkron — fırlatma yolu", () => {
  it("🚨 geçiş fırlatırsa 'job.failed' yazılır ve hata aynen yukarı gider", async () => {
    await resetDb();
    vi.stubEnv("CRON_SECRET", "cron-secret-for-tests");
    await expect(
      cronGet(new NextRequest("http://localhost/api/cron/sync", { headers: { authorization: "Bearer cron-secret-for-tests" } })),
    ).rejects.toThrow(/geçiş çöktü/);
    const rows = await prisma.operationalEvent.findMany({ where: { event: "job.failed" } });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].dataJson!)).toMatchObject({ job: "scheduled-sync" });
    vi.unstubAllEnvs();
  });
});
