import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Gece-4 S3-06: Hospitable gönderim adaptörünün kimlik bilgisi doğrulaması (tek sayfa okuma). 401 / 403 → `false` (belirteç ölü);
// başarılı okuma → `true` (gönderimdeki ret mesaja özgü); başka hata / belirteç yok → `null` (bilinmiyor → kuyruk eski kararı verir).
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
const probe = vi.fn();
vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return { ...actual, probeToken: (token: string) => probe(token) };
});

import { HospitableError } from "@/lib/hospitable";
import { hospitableOutboundAdapter } from "@/lib/channels/hospitable-outbound";

const verify = (token: string | undefined) => hospitableOutboundAdapter.verifyCredential!({ provider: "hospitable", token });

describe("Hospitable verifyCredential (gece-4 S3-06)", () => {
  beforeEach(() => probe.mockReset());

  it("okuma başarılı → true (belirteç geçerli)", async () => {
    probe.mockResolvedValue(undefined);
    expect(await verify("PAT-1")).toBe(true);
    expect(probe).toHaveBeenCalledWith("PAT-1");
  });

  it("okuma 401 / 403 → false (belirteç gerçekten reddediliyor)", async () => {
    for (const status of [401, 403]) {
      probe.mockRejectedValueOnce(new HospitableError(`HTTP ${status}`, status));
      expect(await verify("PAT-1"), String(status)).toBe(false);
    }
  });

  it("başka hata (500, ağ, 429) ya da belirteç yok → null (bilinmiyor; ağa çıkılmaz)", async () => {
    probe.mockRejectedValueOnce(new HospitableError("HTTP 500", 500));
    expect(await verify("PAT-1")).toBeNull();
    probe.mockRejectedValueOnce(new HospitableError("HTTP 429", 429));
    expect(await verify("PAT-1")).toBeNull();
    probe.mockRejectedValueOnce(new Error("fetch failed"));
    expect(await verify("PAT-1")).toBeNull();
    probe.mockClear();
    expect(await verify(undefined)).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });
});
