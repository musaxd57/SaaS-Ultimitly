import { describe, it, expect } from "vitest";
import { describeProvenance, hasProvenConnection } from "@/lib/channels/provenance";

// V0.4 — iki provenance kolonunun dört bileşimi dört AYRI sınıftır; "observed"
// (bağlantı kanıtlı, ilk alınma bilinmiyor) "ingest" ile KARIŞTIRILMAZ. Bu pin,
// çıkarım backfill'inin geri gelmesini de zorlaştırır: backfill bir satırı ancak
// "observed" gibi gösterebilirdi, o da yalnız gerçek gözlemle yazılır.
describe("describeProvenance", () => {
  const T = new Date("2026-09-07T00:00:00Z");
  it("dört bileşim → dört sınıf", () => {
    expect(describeProvenance({ connectionId: "c1", ingestedAt: T })).toBe("ingest");
    expect(describeProvenance({ connectionId: "c1", ingestedAt: null })).toBe("observed");
    expect(describeProvenance({ connectionId: null, ingestedAt: T })).toBe("unbound");
    expect(describeProvenance({ connectionId: null, ingestedAt: null })).toBe("legacy");
  });
  it("kanıtlı bağlantı yalnız connectionId doluyken; ingestedAt tek başına bağlantı kanıtı DEĞİL", () => {
    expect(hasProvenConnection({ connectionId: "c1", ingestedAt: null })).toBe(true);
    expect(hasProvenConnection({ connectionId: null, ingestedAt: T })).toBe(false);
  });
});
