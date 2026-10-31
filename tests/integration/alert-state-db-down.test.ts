import { describe, it, expect, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// GEÇİŞ TABANLI ALARM — durum deposu (DB) düşerse alarm SUSMAZ.
//
// ⚠️ AYRI DOSYA, BİLEREK (ölçüldü 09-23): Prisma model temsilcisine `vi.spyOn` koyunca
// casus aynı dosyadaki SONRAKİ testlere sızıyor (`mockRestore` sonrası
// `createMany is not a function`; geri yüklemesiz hâlde `clearAllMocks` sonrası
// `undefined` döndüren boş casus). Dosya başına modül yalıtımı bu sızıntıyı sınırlar.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", () => ({
  reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
}));

import { reportError } from "@/lib/report-error";
import { IngestError } from "@/lib/channels/ingest";
import { alertOnTransition } from "@/lib/alert-state";

describe("alertOnTransition — durum deposu erişilemez", () => {
  it("SUSMAZ: eski (bellek-içi kısıtlı) alarm yoluna düşer ve durum satırı YAZMAZ", async () => {
    await resetDb();
    vi.spyOn(prisma.systemLock, "createMany").mockRejectedValueOnce(new Error("db down"));
    const r = await alertOnTransition("k6", "ctx", new IngestError("hospitable", "outage", "x", 503));
    expect(r).toBe("alerted");
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportError).mock.calls[0][0]).toBe("ctx");
  });
});
