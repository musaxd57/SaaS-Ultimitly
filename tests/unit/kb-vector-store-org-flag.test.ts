import { describe, it, expect, afterEach, vi } from "vitest";
import { vectorStoreEnabledFor } from "@/lib/ai/embeddings/vector-store";

// ---------------------------------------------------------------------------
// Kalıcı vektör deposu pilot listesi (kurucu 11-20 sabah, E-4) — `DURABLE_OUTBOX_ORG_IDS` deseninin aynısı: ana anahtar
// `KB_VECTOR_STORE_ENABLED=1` + `KB_VECTOR_STORE_ORG_IDS` (virgüllü tam kimlikler ya da `*`). Liste yoksa / boşsa KİMSE.
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("vectorStoreEnabledFor", () => {
  it("ana anahtar kapalı → liste dolu olsa da kapalı", () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "org_a,*");
    expect(vectorStoreEnabledFor("org_a")).toBe(false);
  });

  it("🚨 ana anahtar açık + liste YOK / boş / yalnız virgül → KİMSE (listeyi silmek depoyu herkese açmaz)", () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "");
    expect(vectorStoreEnabledFor("org_a")).toBe(false);
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", " , ");
    expect(vectorStoreEnabledFor("org_a")).toBe(false);
    delete process.env.KB_VECTOR_STORE_ORG_IDS;
    expect(vectorStoreEnabledFor("org_a")).toBe(false);
  });

  it("'*' → bütün işletmeler (işletme bilinmese de)", () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "org_a, *");
    expect(vectorStoreEnabledFor("org_z")).toBe(true);
    expect(vectorStoreEnabledFor(undefined)).toBe(true);
  });

  it("liste → YALNIZ listedekiler, tam kimlik (önek / parça yok); işletme bilinmiyorsa kapalı", () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "1");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", " org_a , ,org_c ");
    expect(vectorStoreEnabledFor("org_a")).toBe(true);
    expect(vectorStoreEnabledFor("org_c")).toBe(true);
    expect(vectorStoreEnabledFor("org_b")).toBe(false);
    expect(vectorStoreEnabledFor("org")).toBe(false);
    expect(vectorStoreEnabledFor("org_a2")).toBe(false);
    expect(vectorStoreEnabledFor(undefined)).toBe(false);
    expect(vectorStoreEnabledFor(null)).toBe(false);
  });

  it("ana anahtar yalnız tam '1'", () => {
    vi.stubEnv("KB_VECTOR_STORE_ENABLED", "true");
    vi.stubEnv("KB_VECTOR_STORE_ORG_IDS", "*");
    expect(vectorStoreEnabledFor("org_a")).toBe(false);
  });
});
