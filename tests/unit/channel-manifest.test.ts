import { describe, it, expect } from "vitest";
import { getOutboundAdapter, getIngestAdapter } from "@/lib/channels";
import { CHANNEL_PROVIDER_IDS } from "@/lib/channels/providers";
import {
  CHANNEL_CAPABILITIES,
  DATA_CLASSES,
  REQUIRES_TERMS_REVIEW,
  type ChannelManifest,
} from "@/lib/channels/capabilities";
import {
  AIRBNB_DIRECT_MANIFEST,
  CHANNEL_MANIFESTS,
  HOSPITABLE_MANIFEST,
  ICAL_MANIFEST,
  capabilitiesWithStatus,
} from "@/lib/channels/manifests";
import { airbnbDirectIngestAdapter, airbnbDirectOutboundAdapter } from "@/lib/channels/airbnb-direct/adapter";

// ---------------------------------------------------------------------------
// KANAL YETENEK MANİFESTOSU — değişmez 4 (yetenekler AYRI ilan edilir), 5 (iCal yalnız
// rezervasyon), 14 (sağlayıcı verisi politikası), 18 (Airbnb sözleşme aşamasında) ve 19
// (rollout aşaması). Manifesto çalışma zamanı kapısı DEĞİLDİR (dispatch adaptörün kendi
// kümesine bakar) — bu yüzden iki kaynağın AYRIŞMAMASI burada pinlenir.
// ---------------------------------------------------------------------------

const ALL_MANIFESTS: ChannelManifest[] = [...Object.values(CHANNEL_MANIFESTS), ICAL_MANIFEST];
const OUTBOUND_KEYS = new Set(["messages.send"]);
const INGEST_KEYS = new Set(["properties.read", "reservations.read", "messages.read"]);

describe("manifestolar eksiksiz ve dürüst", () => {
  it("her sağlayıcı kimliğinin manifestosu var ve kaynağı kendisi", () => {
    for (const id of CHANNEL_PROVIDER_IDS) {
      expect(CHANNEL_MANIFESTS[id], id).toBeDefined();
      expect(CHANNEL_MANIFESTS[id].source).toBe(id);
    }
  });

  it("her manifesto HER yeteneği ve HER veri sınıfını ilan eder (sessiz boşluk yok)", () => {
    for (const m of ALL_MANIFESTS) {
      expect(Object.keys(m.capabilities).sort(), m.source).toEqual([...CHANNEL_CAPABILITIES].sort());
      expect(Object.keys(m.dataPolicy).sort(), m.source).toEqual([...DATA_CLASSES].sort());
    }
  });

  it("`supported` yeteneğin çalışan kodu bir yerde yaşar (sınır `none` olamaz)", () => {
    for (const m of ALL_MANIFESTS) {
      for (const id of capabilitiesWithStatus(m, "supported")) {
        expect(m.capabilities[id].boundary, `${m.source}:${id}`).not.toBe("none");
      }
    }
  });

  it("kiracılar arası kullanım HER kaynakta ve HER sınıfta yasak", () => {
    for (const m of ALL_MANIFESTS) {
      for (const c of DATA_CLASSES) expect(m.dataPolicy[c].crossTenantUse, `${m.source}:${c}`).toBe("forbidden");
    }
  });
});

describe("Hospitable manifestosu çalışma zamanıyla PARİTE (canlı yol ilanla ayrışamaz)", () => {
  const supported = new Set(capabilitiesWithStatus(HOSPITABLE_MANIFEST, "supported"));

  it("gönderim yeteneği = kayıtlı giden adaptörün kümesi", () => {
    const adapter = getOutboundAdapter("hospitable");
    expect(adapter).not.toBeNull();
    const declared = [...supported].filter((c) => OUTBOUND_KEYS.has(c)).sort();
    expect(declared.length).toBeGreaterThan(0); // anti-vakum
    expect([...adapter!.capabilities].sort()).toEqual(declared);
  });

  it("okuma yetenekleri = kayıtlı ingest adaptörünün kümesi", () => {
    const adapter = getIngestAdapter("hospitable");
    expect(adapter).toBeDefined();
    const declared = [...supported].filter((c) => INGEST_KEYS.has(c)).sort();
    expect(declared.length).toBe(3); // anti-vakum
    expect([...adapter!.capabilities].sort()).toEqual(declared);
  });

  it("köprü aşaması ve bugünkü borç dürüstçe ilan edilir (bağlantı yaşam döngüsü kanal katmanı DIŞINDA)", () => {
    expect(HOSPITABLE_MANIFEST.stage).toBe("live_bridge");
    expect(HOSPITABLE_MANIFEST.capabilities["connection.lifecycle"].boundary).toBe("legacy_provider_module");
    expect(HOSPITABLE_MANIFEST.capabilities["webhooks.receive"].status).toBe("unavailable");
  });
});

describe("Airbnb Direct — yalnız sözleşme", () => {
  it("hiçbir yetenek `supported` değil; hepsi `planned` (Lixus'un beklentisi)", () => {
    expect(capabilitiesWithStatus(AIRBNB_DIRECT_MANIFEST, "supported")).toEqual([]);
    expect(capabilitiesWithStatus(AIRBNB_DIRECT_MANIFEST, "planned").sort()).toEqual([...CHANNEL_CAPABILITIES].sort());
    expect(AIRBNB_DIRECT_MANIFEST.stage).toBe("contract_only");
  });

  it("adaptörlerin çalışma zamanı yetenek kümesi BOŞ", () => {
    expect(airbnbDirectOutboundAdapter.capabilities.size).toBe(0);
    expect(airbnbDirectIngestAdapter.capabilities.size).toBe(0);
  });

  it("sözleşme aşamasındaki sağlayıcı kayıt defterinde YOK", () => {
    for (const id of CHANNEL_PROVIDER_IDS) {
      if (CHANNEL_MANIFESTS[id].stage !== "contract_only") continue;
      expect(getOutboundAdapter(id as never), id).toBeNull();
      expect(getIngestAdapter(id as never), id).toBeUndefined();
    }
    // Anti-vakum: döngü gerçekten en az bir sağlayıcıyı denetledi.
    expect(CHANNEL_PROVIDER_IDS.filter((id) => CHANNEL_MANIFESTS[id].stage === "contract_only")).toContain("airbnb_direct");
  });
});

describe("canlıya alma kapısı — değişmez 14", () => {
  it("`supported` yeteneği olan HİÇBİR kaynakta veri politikası `requires_terms_review` kalamaz", () => {
    for (const m of ALL_MANIFESTS) {
      if (capabilitiesWithStatus(m, "supported").length === 0) continue;
      for (const c of DATA_CLASSES) {
        const p = m.dataPolicy[c];
        for (const v of [p.retention, p.onDisconnect, p.derivation, p.export]) {
          expect(v, `${m.source}:${c}`).not.toBe(REQUIRES_TERMS_REVIEW);
        }
      }
    }
  });

  it("KONTROL: Airbnb politikası bugün gerçekten karar-bekliyor (kapı vakumlu değil)", () => {
    expect(AIRBNB_DIRECT_MANIFEST.dataPolicy.message_body.retention).toBe(REQUIRES_TERMS_REVIEW);
  });
});

describe("iCal — yalnız rezervasyon (değişmez 5)", () => {
  it("tek `supported` yetenek rezervasyon okuma; mesaj/webhook/yazma yok", () => {
    expect(capabilitiesWithStatus(ICAL_MANIFEST, "supported")).toEqual(["reservations.read"]);
    for (const id of ["messages.read", "messages.send", "webhooks.receive", "availability.write"] as const) {
      expect(ICAL_MANIFEST.capabilities[id].status, id).toBe("unavailable");
    }
  });
});
