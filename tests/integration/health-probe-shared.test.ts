import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// Y9 (Codex 10-07, 15c8663): sağlık ucu SÜREN yoklamayı paylaşır. Önbellek boşken aynı anda gelen N istek eskiden N × 2 sorgu
// atıyordu (sel / önbellek bitiminde yığılma). Doğru: önbellek penceresi başına TEK yoklama; arıza saklanmaz (sonraki istek
// yeniden yoklar). Prisma temsilcisine casus → AYRI dosya, dosya düzeyinde geçirgen casus.
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/health/route";
import { clearProbeCache } from "@/lib/health-probe";

let selectOnes = 0;
let failNext = 0;
const realQueryRaw = prisma.$queryRaw.bind(prisma);
vi.spyOn(prisma, "$queryRaw").mockImplementation(((...args: Parameters<typeof realQueryRaw>) => {
  selectOnes++;
  if (failNext > 0) {
    failNext--;
    return Promise.reject(new Error("db down"));
  }
  return realQueryRaw(...args);
}) as never);

const req = () => new NextRequest("http://localhost/api/health");

describe("Y9 — sağlık yoklaması paylaşılır", () => {
  beforeEach(async () => {
    await resetDb();
    await prisma.systemLock.create({ data: { name: "scheduled-sync", lockedUntil: new Date(0) } });
    clearProbeCache();
    selectOnes = 0;
    failNext = 0;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("🚨 önbellek boşken 20 eşzamanlı istek → TEK yoklama, hepsi 200", async () => {
    const res = await Promise.all(Array.from({ length: 20 }, () => GET(req())));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(selectOnes).toBe(1); // ⬅️ ARIZADA 20
    const body = await res[7].json();
    expect(body).toMatchObject({ ok: true, db: "up", sync: "ok" });
  });

  it("🚨 arıza paylaşılır ama SAKLANMAZ: eşzamanlı istekler 503, sonraki istek yeniden yoklar ve 200", async () => {
    failNext = 1;
    const res = await Promise.all(Array.from({ length: 5 }, () => GET(req())));
    expect(res.map((r) => r.status)).toEqual([503, 503, 503, 503, 503]);
    expect(selectOnes).toBe(1);
    const next = await GET(req());
    expect(next.status).toBe(200);
    expect(selectOnes).toBe(2);
  });

  it("KONTROL: taze önbellek varken sorgu yok; sıralı ikinci istek önbellekten", async () => {
    expect((await GET(req())).status).toBe(200);
    expect((await GET(req())).status).toBe(200);
    expect(selectOnes).toBe(1);
  });
});
