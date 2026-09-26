import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// F17 (Codex 09-05) — ZAMANLANMIŞ SENKRON ADALETİ, davranışsal.
//
// Geçiş seri ve 12 dk bütçeli; bütçe bitince sıradaki org'lar atlanır. Org listesi sırasız çekildiği için (pratikte
// sabit fiziksel sıra) her geçişte AYNI son org'lar atlanıyor, kalıcı olarak aç kalıyordu.
// Burada her org'un senkronu sahte saatte 13 dk sürer → her geçişte YALNIZ bir org işlenebilir. Adil sırada dört geçiş
// A, B, C, A'yı işler; eski kod A, A, A, A işliyordu (B ve C hiç senkronlanmıyordu).
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable-sync", () => ({ syncHospitable: vi.fn() }));
vi.mock("@/lib/hospitable", () => ({
  isHospitableConfigured: () => true,
  listProperties: vi.fn().mockResolvedValue([]),
  listReservations: vi.fn().mockResolvedValue([]),
  listMessages: vi.fn().mockResolvedValue([]),
  HospitableError: class HospitableError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock("@/lib/net/pinned-fetch", () => ({ fetchFeedText: vi.fn() }));
vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
  redactSensitive: (s: string) => s,
  formatErrorForLog: (e: unknown) => String(e),
}));

import { syncHospitable } from "@/lib/hospitable-sync";
import { runScheduledSync } from "@/lib/scheduled-sync";

const mockHospitable = vi.mocked(syncHospitable);

const ZERO = {
  properties: 0,
  reservations: 0,
  conversations: 0,
  messages: 0,
  threads: 0,
  skipped: 0,
  propertiesCapped: 0,
  reservationsUnwritable: 0,
  messagesUnimportable: 0,
};

async function seedBusyOrgs(n: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const org = await prisma.organization.create({ data: { name: `Org ${i}` } });
    await prisma.property.create({ data: { organizationId: org.id, name: `Lale ${i}` } });
    out.push(org.id);
  }
  return out.sort(); // taban sıra kimliğe göre
}

describe("F17 — bütçe yüzünden atlanan org sonraki geçişte önce gelir", () => {
  const seen: string[] = [];

  beforeEach(async () => {
    await resetDb();
    seen.length = 0;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-26T10:00:00.000Z"));
    // Her org senkronu 13 dk sürer (12 dk geçiş bütçesini tek başına aşar).
    mockHospitable.mockImplementation(async (orgId: string) => {
      seen.push(orgId);
      vi.setSystemTime(new Date(Date.now() + 13 * 60_000));
      return ZERO;
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    mockHospitable.mockReset();
  });

  it("🚨 dört geçiş: A, B, C, A — hiçbir org kalıcı olarak aç kalmaz", async () => {
    const [a, b, c] = await seedBusyOrgs(3);
    for (let pass = 0; pass < 4; pass++) {
      await runScheduledSync();
      vi.setSystemTime(new Date(Date.now() + 2 * 60_000)); // bir sonraki cron tıkı
    }
    expect(seen).toEqual([a, b, c, a]);
  });

  it("geçiş eksiksiz biterse imleç kalmaz (sonraki geçiş baştan başlar)", async () => {
    const [a, b] = await seedBusyOrgs(2);
    await runScheduledSync(); // A işlenir, B atlanır → imleç B
    mockHospitable.mockImplementation(async (orgId: string) => {
      seen.push(orgId); // artık hızlı: bütçe aşılmaz
      return ZERO;
    });
    await runScheduledSync(); // B'den başlar, A'ya döner; hepsi işlendi → imleç silinir
    await runScheduledSync(); // baştan: A, B
    expect(seen).toEqual([a, b, a, a, b]);
  });
});
