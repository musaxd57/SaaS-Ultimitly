import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// İlan başına toplu "thread güncel mi?" okuması (O1, 11-19) DÜŞERSE: senkron durmaz, her rezervasyon eski yoldan tek tek okunur — sonuç
// aynı. AYRI DOSYA: Prisma temsilcisine kurulan casus sonraki testlere sızar (depo kuralı).
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: false, throttled: false, configured: false })),
}));

import { prisma, resetDb, makeOrgWithProperty, daysFromNow } from "../helpers/db";
import { FakeIngestProvider, canonicalMessage, canonicalReservation } from "../helpers/fake-ingest";
import { __setIngestAdapterForTest } from "@/lib/channels/ingest";
import { syncHospitable } from "@/lib/hospitable-sync";
import { setOrgHospitableToken, resetPrimaryOrgCache } from "@/lib/hospitable-credentials";

const TOKEN = "tok-prefetch-fail";
const HP = "hp-prefetch-fail";
const fake = new FakeIngestProvider();

describe("syncHospitable — toplu imleç okuması düşerse tek tek okumaya düşer", () => {
  beforeEach(async () => {
    await resetDb();
    fake.reset();
    __setIngestAdapterForTest("hospitable", fake.adapter());
    resetPrimaryOrgCache();
  });
  afterEach(() => vi.restoreAllMocks());

  it("🚨 toplu okuma fırlatır → güncel thread'ler yine atlanır, yeni mesajlı thread içe aktarılır (sonuç eskisiyle aynı)", async () => {
    const { orgId } = await makeOrgWithProperty();
    await setOrgHospitableToken(orgId, TOKEN, null);
    fake.addProperty(TOKEN, HP, "Test Property");
    const t1 = new Date("2026-05-30T10:00:00Z");
    const t2 = new Date("2026-05-30T12:00:00Z");
    const r = (n: number, at: Date) =>
      canonicalReservation({ externalId: `res-${n}`, arrivalDate: daysFromNow(5), departureDate: daysFromNow(9), conversationExternalId: `c-${n}`, lastMessageAt: at });
    fake.setReservations(HP, [r(1, t1), r(2, t1)]);
    fake.setMessages("res-1", [canonicalMessage({ externalId: "m1", createdAt: t1 })]);
    fake.setMessages("res-2", [canonicalMessage({ externalId: "m2", createdAt: t1 })]);
    await syncHospitable(orgId);

    fake.setReservations(HP, [r(1, t1), r(2, t2)]);
    fake.setMessages("res-2", [canonicalMessage({ externalId: "m2", createdAt: t1 }), canonicalMessage({ externalId: "m3", createdAt: t2 })]);
    const real = prisma.conversation.findMany.bind(prisma.conversation);
    let calls = 0;
    vi.spyOn(prisma.conversation, "findMany").mockImplementation(((args: Parameters<typeof real>[0]) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("geçici veritabanı hatası"));
      return real(args);
    }) as never);
    fake.requests.length = 0;
    const res = await syncHospitable(orgId);
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(res).toMatchObject({ threads: 2, skipped: 1, conversations: 1, messages: 1 });
    expect(fake.requests.filter((q) => q.op === "messages").map((q) => q.arg)).toEqual(["res-2"]);
  });
});
