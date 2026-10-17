import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  ipNetworkPrefix,
  hashSignupNetwork,
  signupNetworkFields,
  signupNetworkKeyFp,
  networkSignals,
  infrastructureIpHashes,
  __resetSignupNetworkKey,
  INFRA_MIN_SIGNUPS,
  type SignupTraceView,
} from "@/lib/billing/signup-network-core";

// ---------------------------------------------------------------------------
// K1 (kurucu 10-17: "B — otomatik kesme yok; risk puanı geliştirilsin, IP'lere bakılsın") — kayıt ağı izinin SAF çekirdeği.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-for-signup-network-0123456789");
  __resetSignupNetworkKey();
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetSignupNetworkKey();
});

describe("ipNetworkPrefix", () => {
  it.each([
    ["203.0.113.7", "v4_24", "203.0.113.0/24", "203.0.113.7"],
    ["::ffff:203.0.113.7", "v4_24", "203.0.113.0/24", "203.0.113.7"],
    ["2001:db8:abcd:12::1", "v6_48", "2001:db8:abcd::/48", "2001:db8:abcd:12:0:0:0:1"],
    ["2001:DB8:ABCD:12::1", "v6_48", "2001:db8:abcd::/48", "2001:db8:abcd:12:0:0:0:1"],
    ["fe80::1%eth0", "v6_48", "fe80:0:0::/48", "fe80:0:0:0:0:0:0:1"],
    [" 198.51.100.20 ", "v4_24", "198.51.100.0/24", "198.51.100.20"],
  ])("%s → %s %s", (ip, kind, prefix, address) => {
    expect(ipNetworkPrefix(ip)).toEqual({ kind, prefix, address });
  });
  it.each(["unknown", "", "999.1.1.1", "not-an-ip", "203.0.113.7:443"])("okunamayan %j → null", (ip) => {
    expect(ipNetworkPrefix(ip)).toBeNull();
  });
});

describe("özet — ham adres hiçbir alanda yok", () => {
  it("🚨 alanlar ham adresi / öneki TAŞIMAZ; aynı adres aynı özet; ip ile ağ özeti ayrı", () => {
    const f = signupNetworkFields("203.0.113.7");
    const all = JSON.stringify(f);
    for (const raw of ["203.0.113.7", "203.0.113", "203.0.113.0/24"]) expect(all).not.toContain(raw);
    expect(f.ipHash).toBe(signupNetworkFields("203.0.113.7").ipHash);
    expect(f.networkHash).toBe(signupNetworkFields("203.0.113.99").networkHash);
    expect(f.ipHash).not.toBe(signupNetworkFields("203.0.113.99").ipHash);
    expect(hashSignupNetwork("ip", "x")).not.toBe(hashSignupNetwork("net", "x"));
    expect(f.networkKind).toBe("v4_24");
    expect(f.keyFp).toBe(signupNetworkKeyFp());
  });
  it("okunamayan adres → iki özet null (satır yine yazılır)", () => {
    expect(signupNetworkFields("unknown")).toMatchObject({ ipHash: null, networkHash: null, networkKind: null });
  });
  it("anahtar değişirse parmak izi değişir", () => {
    const before = signupNetworkKeyFp();
    vi.stubEnv("ENCRYPTION_KEY", "another-key-0123456789-abcdefghijklmnop");
    __resetSignupNetworkKey();
    expect(signupNetworkKeyFp()).not.toBe(before);
  });
});

const NOW = new Date("2026-10-17T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
let seq = 0;
function trace(org: string | null, ip: string, at: Date, keyFp = signupNetworkKeyFp()): SignupTraceView {
  const f = signupNetworkFields(ip);
  return { id: `t${++seq}`, organizationId: org, ipHash: f.ipHash, networkHash: f.networkHash, keyFp, createdAt: at };
}

describe("networkSignals", () => {
  it("🚨 aynı TAM adres başka kayıtta 30 gün içinde → ip_shared (silinmiş hesap dahil); 31. gün → yok", () => {
    const me = trace("org-me", "203.0.113.7", daysAgo(0));
    const deleted = trace(null, "203.0.113.7", daysAgo(29));
    const s = networkSignals([me], [me, deleted], signupNetworkKeyFp());
    expect(s.ipShared).toBe(true);
    expect(s.related).toEqual([{ organizationId: null, createdAt: deleted.createdAt, same: "ip" }]);
    const old = trace("org-old", "203.0.113.7", daysAgo(31));
    expect(networkSignals([me], [me, old], signupNetworkKeyFp()).ipShared).toBe(false);
  });

  it("aynı /24'te 7 gün içinde ≥2 BAŞKA kayıt → network_burst; 1 başka kayıt → yok", () => {
    const me = trace("org-me", "198.51.100.10", daysAgo(0));
    const a = trace("org-a", "198.51.100.11", daysAgo(3));
    const b = trace("org-b", "198.51.100.12", daysAgo(6));
    expect(networkSignals([me], [me, a], signupNetworkKeyFp()).networkBurst).toBe(false);
    const s = networkSignals([me], [me, a, b], signupNetworkKeyFp());
    expect(s).toMatchObject({ ipShared: false, networkBurst: true });
    expect(s.related.map((r) => r.same)).toEqual(["network", "network"]);
    const far = trace("org-c", "198.51.100.13", daysAgo(8));
    expect(networkSignals([me], [me, a, far], signupNetworkKeyFp()).networkBurst).toBe(false);
  });

  it("aynı işletmenin kendi satırları ve farklı anahtarlı eski satırlar sayılmaz", () => {
    const me = trace("org-me", "203.0.113.7", daysAgo(0));
    const meAgain = trace("org-me", "203.0.113.7", daysAgo(1));
    const otherKey = trace("org-x", "203.0.113.7", daysAgo(1), "0000000000000000");
    expect(networkSignals([me], [me, meAgain, otherKey], signupNetworkKeyFp())).toMatchObject({ ipShared: false, networkBurst: false, related: [] });
  });

  it("🚨 ALTYAPI ŞÜPHESİ (Haiku 10-17): son 24 saatte kayıtların yarısı aynı adresten → şüphe TESPİT edilir ama sinyal SUSTURULMAZ (toplu kayıt görünür kalır)", () => {
    const edge = "10.0.0.1";
    const traces = Array.from({ length: INFRA_MIN_SIGNUPS }, (_, i) => trace(`org-${i}`, i < INFRA_MIN_SIGNUPS / 2 ? edge : `192.0.2.${i}`, daysAgo(0.5)));
    expect(infrastructureIpHashes(traces, NOW, signupNetworkKeyFp()).size).toBe(1);
    expect(networkSignals([traces[0]!], traces, signupNetworkKeyFp())).toMatchObject({ ipShared: true, networkBurst: true });
    // KONTROL: eşiğin altında şüphe yok.
    expect(infrastructureIpHashes(traces.slice(0, 3), NOW, signupNetworkKeyFp()).size).toBe(0);
    // KONTROL (mutasyon K14): kayıtların YARISINDAN azı (10'da 3) aynı adresten → şüphe yok.
    const mixed = Array.from({ length: INFRA_MIN_SIGNUPS }, (_, i) => trace(`m-${i}`, i < 3 ? "10.0.0.9" : `192.0.2.${i + 100}`, daysAgo(0.5)));
    expect(infrastructureIpHashes(mixed, NOW, signupNetworkKeyFp()).size).toBe(0);
  });

  it("Haiku 10-17: bağlam yalnız sinyal varken — tek başka kayıt (eşik altı) başka işletmenin adını göstermez", () => {
    const me = trace("org-me", "198.51.100.10", daysAgo(0));
    const one = trace("org-a", "198.51.100.11", daysAgo(1));
    expect(networkSignals([me], [me, one], signupNetworkKeyFp())).toEqual({ ipShared: false, networkBurst: false, related: [] });
  });
});

describe("aydınlatma metni (kurucu Q3, 10-17: cümle + 90 gün onaylı)", () => {
  it("🚨 gizlilik metni onaylı cümleyi AYNEN taşır ve saklama süresi kodla aynı", async () => {
    const { SECTIONS } = await import("@/app/(legal)/gizlilik/content");
    const { SIGNUP_NETWORK_RETENTION_DAYS } = await import("@/lib/billing/signup-network-core");
    const all = JSON.stringify(SECTIONS);
    expect(all).toContain(
      "Ücretsiz denemenin kötüye kullanılmasını önlemek için kayıt sırasında IP adresinizden geri döndürülemez bir özet ve bağlandığınız ağın özeti oluşturulur; ham IP adresi bu amaçla saklanmaz. Bu bilgi yalnız ekibimizin incelemesinde kullanılır, otomatik karar verilmez ve 90 gün sonra silinir.",
    );
    expect(SIGNUP_NETWORK_RETENTION_DAYS).toBe(90);
  });
});

describe("yapısal pin", () => {
  it("🚨 onay kanıtı IP'si (User.acceptedIp) risk / iz kodunda OKUNMAZ (amaç değişikliği yok — KVKK md. 4)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["src/lib/billing/trial-risk.ts", "src/lib/billing/signup-network.ts", "src/lib/billing/signup-network-core.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src.length, f).toBeGreaterThan(500); // anti-vakum
      expect(src, f).not.toMatch(/acceptedIp/);
    }
  });
});
