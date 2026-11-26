import { describe, it, expect } from "vitest";
import { describeProvenance, hasProvenConnection } from "@/lib/channels/provenance";

// V0.4 — bağlantı hikâyesi `connectionEvidence`'tan, ilk alınma `ingestedAt`'ten okunur.
// İki kolon (connectionId + ingestedAt) tek başına "ilk alınma bu bağlantıdan yapıldı"
// iddiasını TAŞIYAMAZ: env fallback ile alınıp sonradan gözlemlenen satır da ikisini
// dolu taşır. Bu yüzden kanıt türü satırda açıkça yazılır ve sınıflandırıcı tahmin etmez.
describe("describeProvenance", () => {
  const T = new Date("2026-09-07T00:00:00Z");
  it("beş sınıf: ingest / observed / outbound / unbound / legacy", () => {
    expect(describeProvenance({ connectionId: "c1", connectionEvidence: "ingest", ingestedAt: T })).toBe("ingest");
    expect(describeProvenance({ connectionId: "c1", connectionEvidence: "observed", ingestedAt: null })).toBe("observed");
    expect(describeProvenance({ connectionId: "c1", connectionEvidence: "outbound", ingestedAt: null })).toBe("outbound");
    expect(describeProvenance({ connectionId: null, connectionEvidence: null, ingestedAt: T })).toBe("unbound");
    expect(describeProvenance({ connectionId: null, connectionEvidence: null, ingestedAt: null })).toBe("legacy");
  });
  it("KURUCU SENARYOSU: env fallback ile alınmış (ingestedAt dolu) satır sonradan gerçek bağlantıdan gözlemlenince 'observed' kalır — 'ingest' iddiası ÇIKMAZ", () => {
    expect(describeProvenance({ connectionId: "c1", connectionEvidence: "observed", ingestedAt: T })).toBe("observed");
  });
  it("kanıt türü yokken dolu connectionId (olmaması gereken durum) 'ingest' diye ETİKETLENMEZ — en az iddialı sınıf", () => {
    expect(describeProvenance({ connectionId: "c1", connectionEvidence: null, ingestedAt: T })).toBe("observed");
  });
  it("kanıtlı bağlantı yalnız connectionId doluyken; ingestedAt tek başına bağlantı kanıtı DEĞİL", () => {
    expect(hasProvenConnection({ connectionId: "c1", connectionEvidence: "observed", ingestedAt: null })).toBe(true);
    expect(hasProvenConnection({ connectionId: null, connectionEvidence: null, ingestedAt: T })).toBe(false);
  });
});
