// ---------------------------------------------------------------------------
// KAYIT AĞI İZİ — SAF ÇEKİRDEK (K1, kurucu 10-17: "B — otomatik kesme yok; risk puanı geliştirilsin, IP'lere bakılsın, kötüye kullanım
// engellensin"; tasarım `docs/TASARIM-2026-10-17-s2-migration-paketi.md` §3). DB yok, ağ yok.
//
// HAM IP SAKLANMAZ: tam adres ve ağ öneki (IPv4 /24, IPv6 /48) ayrı ayrı anahtarlı özet (HMAC-SHA256; anahtar ENCRYPTION_KEY || AUTH_SECRET'ten
// AYRI tuzla türetilir — deneme kimliği emsali). Takma adlı kişisel veridir ("anonim" DENMEZ: IPv4 uzayı küçük, anahtar sızarsa geri döner).
// Amaç YALNIZ operatörün deneme kötüye kullanımı incelemesi; otomatik karar YOK. Kayıt onayı kanıtındaki ham IP (User tablosu) bu amaçla OKUNMAZ (yapısal pin).
// ---------------------------------------------------------------------------

import { createHash, createHmac, scryptSync } from "node:crypto";
import { isIP } from "node:net";
import { expandIpv6 } from "@/lib/rate-limit";

/** İz saklama süresi (gün). ⚠️ Kurucu sorusu Q3 (90 mı 30 mu) — cevap gelene kadar tasarım önerisi; aydınlatma metni bu sayıyı söyler. */
export const SIGNUP_NETWORK_RETENTION_DAYS = 90;
/** Aynı TAM adres başka kayıtta bu pencerede → `ip_shared`. */
export const IP_SHARED_WINDOW_DAYS = 30;
/** Aynı ağda bu pencerede ≥ `NETWORK_BURST_MIN_OTHERS` BAŞKA kayıt → `network_burst`. */
export const NETWORK_BURST_WINDOW_DAYS = 7;
export const NETWORK_BURST_MIN_OTHERS = 2;
/**
 * ALTYAPI KORUMASI: son 24 saatte en az `INFRA_MIN_SIGNUPS` kaydın en az yarısı AYNI tam adres özetini taşıyorsa o özet bir vekil / kenar
 * adresidir (ör. `TRUSTED_PROXY_HOPS` yanlış → herkes aynı adres) — sinyal ÜRETMEZ (herkesi işaretlemesin).
 */
export const INFRA_WINDOW_MS = 24 * 60 * 60_000;
export const INFRA_MIN_SIGNUPS = 10;

export type NetworkKind = "v4_24" | "v6_48";
export const NETWORK_KINDS: readonly NetworkKind[] = ["v4_24", "v6_48"];

/**
 * Saf: adres → ağ öneki. IPv4 → a.b.c.0/24 · IPv4-eşlemeli IPv6 → IPv4 kuralı · IPv6 → ilk üç grup /48 · "unknown" / IP değil → null.
 * Bölge eki (fe80::1%eth0) atılır. (Hız sınırı kovası IPv6'da /64 alır; burada /48 — bir ev / ofis hattının tamamı tek ağ sayılır.)
 */
export function ipNetworkPrefix(ip: string): { kind: NetworkKind; prefix: string; address: string } | null {
  const base = ip.trim().split("%")[0]!;
  const kind = isIP(base);
  if (kind === 4) {
    const o = base.split(".");
    return { kind: "v4_24", prefix: `${o[0]}.${o[1]}.${o[2]}.0/24`, address: base };
  }
  if (kind !== 6) return null;
  const g = expandIpv6(base.toLowerCase());
  if (!g) return null;
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
    return { kind: "v4_24", prefix: `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.0/24`, address: v4 };
  }
  return { kind: "v6_48", prefix: `${g.slice(0, 3).map((n) => n.toString(16)).join(":")}::/48`, address: g.map((n) => n.toString(16)).join(":") };
}

let derivedKey: Buffer | null = null;
function networkKey(): Buffer {
  if (derivedKey) return derivedKey;
  const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) throw new Error("ENCRYPTION_KEY (veya AUTH_SECRET) tanımlı değil — kayıt ağı izi özetlenemiyor.");
  // Şifreleme ve deneme kimliği anahtarlarından AYRI türetilir (farklı tuz).
  derivedKey = scryptSync(secret, "lixus-signup-network-v1", 32);
  return derivedKey;
}

/** Geri döndürülemez özet; tür alanı içine katılır ("ip" ile "net" aynı metinde farklı özet). */
export function hashSignupNetwork(kind: "ip" | "net", value: string): string {
  return `v1:${createHmac("sha256", networkKey()).update(`${kind}|${value}`).digest("hex")}`;
}

/** Özet anahtarının parmak izi — anahtar değişirse eski satırlar karşılaştırmaya GİRMEZ (sessiz yanlış eşleşme yok). */
export function signupNetworkKeyFp(): string {
  return createHash("sha256").update(networkKey()).digest("hex").slice(0, 16);
}

/** TEST KANCASI. */
export function __resetSignupNetworkKey(): void {
  derivedKey = null;
}

/** Bir kaydın yazılacak iz alanları (ham adres DÖNMEZ). Adres okunamazsa iki özet de null (satır yine yazılır: "kayıt oldu, adres yok"). */
export function signupNetworkFields(ip: string): { ipHash: string | null; networkHash: string | null; networkKind: NetworkKind | null; keyFp: string } {
  const p = ipNetworkPrefix(ip);
  return {
    ipHash: p ? hashSignupNetwork("ip", p.address) : null,
    networkHash: p ? hashSignupNetwork("net", p.prefix) : null,
    networkKind: p?.kind ?? null,
    keyFp: signupNetworkKeyFp(),
  };
}

export interface SignupTraceView {
  id: string;
  organizationId: string | null;
  ipHash: string | null;
  networkHash: string | null;
  keyFp: string;
  createdAt: Date;
}

/**
 * Altyapı özetleri (saf): son 24 saatte ≥ `INFRA_MIN_SIGNUPS` kayıttan en az yarısını tek başına taşıyan TAM adres özeti. Girdi bütün güncel
 * anahtarlı izler (pencere çağıranda süzülmüş olabilir; burada yeniden süzülür).
 */
export function infrastructureIpHashes(traces: readonly SignupTraceView[], now: Date, keyFp: string): Set<string> {
  const recent = traces.filter((t) => t.keyFp === keyFp && now.getTime() - t.createdAt.getTime() <= INFRA_WINDOW_MS && t.createdAt <= now);
  const out = new Set<string>();
  if (recent.length < INFRA_MIN_SIGNUPS) return out;
  const counts = new Map<string, number>();
  for (const t of recent) if (t.ipHash) counts.set(t.ipHash, (counts.get(t.ipHash) ?? 0) + 1);
  for (const [h, n] of counts) if (n * 2 >= recent.length) out.add(h);
  return out;
}

export interface NetworkSignals {
  ipShared: boolean;
  networkBurst: boolean;
  /** Operatöre bağlam: aynı adres / ağdaki BAŞKA kayıtlar (işletme kimliği; silinmiş hesap → null). Özet / IP DÖNMEZ. */
  related: { organizationId: string | null; createdAt: Date; same: "ip" | "network" }[];
}

const DAY_MS = 86_400_000;

/**
 * Saf: bir işletmenin kayıt izleri (`own`) ile bütün güncel izler (`all`) → sinyaller. Yalnız GÜNCEL anahtarlı satırlar (`keyFp`) karşılaştırılır;
 * kendi satırları "başka kayıt" sayılmaz; altyapı özetleri hiç sinyal üretmez. Pencereler kayıt anına göre ±.
 */
export function networkSignals(own: readonly SignupTraceView[], all: readonly SignupTraceView[], now: Date, keyFp: string): NetworkSignals {
  const mine = own.filter((t) => t.keyFp === keyFp);
  const ownIds = new Set(own.map((t) => t.id));
  const infra = infrastructureIpHashes(all, now, keyFp);
  const related = new Map<string, NetworkSignals["related"][number]>();
  let ipShared = false;
  const burstOthers = new Set<string>();
  for (const m of mine) {
    for (const o of all) {
      if (ownIds.has(o.id) || o.keyFp !== keyFp) continue;
      // Aynı işletmenin başka satırı (ör. ikinci sahip) "başka kayıt" değildir.
      if (m.organizationId !== null && o.organizationId === m.organizationId) continue;
      const gap = Math.abs(o.createdAt.getTime() - m.createdAt.getTime());
      // Altyapı adresinden (vekil / kenar) gelen kayıt hiçbir ağ sinyali üretmez — ne tam adres ne ağ (herkes aynı ağda görünürdü).
      if (m.ipHash && infra.has(m.ipHash)) continue;
      if (m.ipHash && o.ipHash === m.ipHash && gap <= IP_SHARED_WINDOW_DAYS * DAY_MS) {
        ipShared = true;
        related.set(o.id, { organizationId: o.organizationId, createdAt: o.createdAt, same: "ip" });
      }
      if (m.networkHash && o.networkHash === m.networkHash && gap <= NETWORK_BURST_WINDOW_DAYS * DAY_MS) {
        burstOthers.add(o.id);
        if (!related.has(o.id)) related.set(o.id, { organizationId: o.organizationId, createdAt: o.createdAt, same: "network" });
      }
    }
  }
  return {
    ipShared,
    networkBurst: burstOthers.size >= NETWORK_BURST_MIN_OTHERS,
    related: [...related.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  };
}
