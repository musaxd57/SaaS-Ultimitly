import { describe, it, expect, vi } from "vitest";

// G10 (kurucu kararı 10-13): adaptörün sağlayıcı arızası işareti (`providerOutage`) çağıranın gördüğü `SendOutcome`a TAŞINIR —
// otomatik yanıt yolu (`automation.ts`) sebebi buna göre yazar. Tür `ambiguous` kalır (tekrar davranışı aynı).
const dispatch = vi.fn();
vi.mock("@/lib/channels", () => ({
  resolveOutboundRoute: () => ({ kind: "provider", destination: { provider: "hospitable", externalReservationId: "res-1" } }),
  dispatchOutbound: (...a: unknown[]) => dispatch(...a),
}));

import { sendOnChannel } from "@/lib/messaging";

const target = { channel: "airbnb", guestIdentifier: "G", externalReservationId: "res-1" };

describe("sendOnChannel — sağlayıcı arızası işareti", () => {
  it("adaptör 5xx işaretini verdiyse sonuç da taşır; tür ambiguous kalır", async () => {
    dispatch.mockResolvedValueOnce({ ok: false, kind: "ambiguous", error: "HTTP 503", providerMessageId: null, providerOutage: true });
    expect(await sendOnChannel(target, "x", "tok")).toMatchObject({ ok: false, kind: "ambiguous", providerOutage: true });
  });
  it("KONTROL: işaret yoksa sonuçta da yok (ağ hatası / 408)", async () => {
    dispatch.mockResolvedValueOnce({ ok: false, kind: "ambiguous", error: "timeout", providerMessageId: null });
    const r = await sendOnChannel(target, "x", "tok");
    expect(r.kind).toBe("ambiguous");
    expect(r.providerOutage).toBeUndefined();
  });
});
