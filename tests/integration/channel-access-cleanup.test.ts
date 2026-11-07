import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// V0.8 — hayalet rezervasyon temizliği kimlik bilgisini VE okuma adaptörünün sağlayıcısını KANAL KATMANINDAN alır
// (inceleme 10-09 6b: eski testler kimlik modülünü mock'luyordu, geri alınan bir değişikliği yalnız metin pini yakalardı).
// Kimlik modülü MOCK'LANMAZ: kayıtlı çözücünün üstüne sahte erişim + sahte okuma adaptörü konur.
// ---------------------------------------------------------------------------

import { __setIngestAdapterForTest, __setMessagingAccessForTest, type IngestAdapter } from "@/lib/channels";
import { cleanupStaleReservations } from "@/lib/reservations-cleanup";

function access(token: string | null) {
  return {
    provider: "hospitable" as const,
    credentialFor: vi.fn(async () => token),
    onCredentialRejected: vi.fn(async () => "noop" as const),
    isConnected: vi.fn(async () => token !== null),
    activeConnectionId: vi.fn(async () => null),
  };
}

function fakeIngest() {
  const listReservations = vi.fn<IngestAdapter["listReservations"]>(async () => []);
  const adapter: IngestAdapter = {
    provider: "hospitable",
    capabilities: new Set(["reservations.read"]) as IngestAdapter["capabilities"],
    listProperties: vi.fn(async () => []),
    listReservations,
    listMessages: vi.fn(async () => []),
  };
  return { adapter, listReservations };
}

describe("hayalet rezervasyon temizliği × kanal erişimi", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    __setMessagingAccessForTest("hospitable", null);
    __setIngestAdapterForTest("hospitable", null);
  });

  it("🚨 okuma adaptörüne giden kimlik bilgisi kayıtlı erişiminki (sağlayıcısıyla)", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: propertyId }, data: { hospitableId: "h-clean-1" } });
    const a = access("tok-cleanup");
    __setMessagingAccessForTest("hospitable", a);
    const f = fakeIngest();
    __setIngestAdapterForTest("hospitable", f.adapter);
    await cleanupStaleReservations(orgId);
    expect(a.credentialFor).toHaveBeenCalledWith(orgId);
    expect(f.listReservations).toHaveBeenCalledTimes(1);
    expect(f.listReservations.mock.calls[0][0]).toEqual({ provider: "hospitable", token: "tok-cleanup" });
  });

  it("🚨 erişim 'bağlı değil' → sağlayıcıya hiç okuma yok, hiçbir şey silinmez", async () => {
    const { orgId, propertyId } = await makeOrgWithProperty();
    await prisma.property.update({ where: { id: propertyId }, data: { hospitableId: "h-clean-2" } });
    __setMessagingAccessForTest("hospitable", access(null));
    const f = fakeIngest();
    __setIngestAdapterForTest("hospitable", f.adapter);
    const r = await cleanupStaleReservations(orgId);
    expect(f.listReservations).not.toHaveBeenCalled();
    expect(r.removed).toBe(0);
  });
});
