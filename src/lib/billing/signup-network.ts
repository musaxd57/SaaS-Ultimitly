import "server-only";

import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { alertOnTransition, clearAlertState } from "@/lib/alert-state";
import {
  infrastructureIpHashes,
  INFRA_WINDOW_MS,
  networkSignals,
  signupNetworkFields,
  signupNetworkKeyFp,
  IP_SHARED_WINDOW_DAYS,
  SIGNUP_NETWORK_RETENTION_DAYS,
  type NetworkSignals,
  type SignupTraceView,
} from "./signup-network-core";

// ---------------------------------------------------------------------------
// KAYIT AĞI İZİ — veritabanı tarafı (K1, kurucu 10-17 "B + IP"; saf çekirdek `signup-network-core.ts`, tablo migration 72).
// 🚨 Varsayılan KAPALI (`SIGNUP_NETWORK_TRACE_ENABLED` tam "1"): yeni bir veri işleme — aydınlatma metni güncellenmeden açılmaz (kurucu
// sorusu Q3). Kapalıyken satır YAZILMAZ ve puan ağ sinyali üretmez; süpürge yine koşar (eski iz kalmasın). Her hata fail-OPEN: kayıt akışı
// asla düşmez. Kayıt onayı kanıtındaki ham IP (User tablosu) bu amaçla OKUNMAZ (yapısal pin).
// ---------------------------------------------------------------------------

export function signupNetworkTraceEnabled(): boolean {
  return process.env.SIGNUP_NETWORK_TRACE_ENABLED === "1";
}

const DAY_MS = 86_400_000;

/** Yeni hesap kaydında BİR iz satırı (ham adres yok). Asla fırlatmaz; yazıldıysa true. */
export async function recordSignupNetwork(organizationId: string, ip: string, now: Date = new Date()): Promise<boolean> {
  if (!signupNetworkTraceEnabled()) return false;
  try {
    const f = signupNetworkFields(ip);
    await prisma.signupNetworkTrace.create({
      data: {
        organizationId,
        ipHash: f.ipHash,
        networkHash: f.networkHash,
        networkKind: f.networkKind,
        keyFp: f.keyFp,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SIGNUP_NETWORK_RETENTION_DAYS * DAY_MS),
      },
    });
    return true;
  } catch (err) {
    void reportError(`signup-network org=${organizationId}`, err);
    return false;
  }
}

/** Süpürge: süresi dolan izler silinir (anahtar kapalıyken de). */
export async function purgeSignupNetworkTraces(now: Date = new Date()): Promise<number> {
  const res = await prisma.signupNetworkTrace.deleteMany({ where: { expiresAt: { lt: now } } });
  return res.count;
}

/**
 * Operatör listesi için: verilen deneme işletmelerinin ağ sinyalleri. TEK okuma: işletmelerin kendi izleri + aynı özetli bütün güncel izler
 * (silinmiş hesaplarınki dahil) + altyapı koruması için son 24 saatin izleri. Anahtar kapalıyken boş harita (puan bugünkü gibi).
 */
export async function loadSignupNetworkSignals(organizationIds: readonly string[], now: Date = new Date()): Promise<Map<string, NetworkSignals>> {
  const out = new Map<string, NetworkSignals>();
  if (!signupNetworkTraceEnabled() || organizationIds.length === 0) return out;
  try {
    const keyFp = signupNetworkKeyFp();
    const select = { id: true, organizationId: true, ipHash: true, networkHash: true, keyFp: true, createdAt: true } as const;
    const own = await prisma.signupNetworkTrace.findMany({ where: { organizationId: { in: [...organizationIds] }, keyFp }, select });
    if (own.length === 0) return out;
    const ipHashes = [...new Set(own.map((t) => t.ipHash).filter((h): h is string => h !== null))];
    const netHashes = [...new Set(own.map((t) => t.networkHash).filter((h): h is string => h !== null))];
    // Pencere: en eski kendi izinden 30 gün öncesi (sinyal penceresi kayıt anına göre ±; liste son 30 günde biten denemeleri de gösterir).
    const oldest = Math.min(...own.map((t) => t.createdAt.getTime()));
    const since = new Date(Math.min(oldest, now.getTime()) - (IP_SHARED_WINDOW_DAYS + 1) * DAY_MS);
    // Yalnız AYNI özetli izler (dizinli iki sütun) — altyapı şüphesi ayrı saatlik işte (`checkSignupNetworkInfra`), sayfa açılışında değil.
    const related: SignupTraceView[] = await prisma.signupNetworkTrace.findMany({
      where: { keyFp, createdAt: { gte: since }, OR: [{ ipHash: { in: ipHashes } }, { networkHash: { in: netHashes } }] },
      select,
    });
    const all = [...new Map([...own, ...related].map((t) => [t.id, t])).values()];
    for (const orgId of organizationIds) {
      const mine = own.filter((t) => t.organizationId === orgId);
      if (mine.length) out.set(orgId, networkSignals(mine, all, keyFp));
    }
  } catch (err) {
    // Fail-open: sinyal yok (liste bugünkü puanla görünür).
    void reportError("signup-network signals", err);
  }
  return out;
}

/**
 * Saatlik: son 24 saatte kayıtların yarısı TEK adresten mi (vekil ayarı bozuk mu, toplu kayıt mı)? Varsa operatöre TEK alarm (geçiş tabanlı,
 * 24 saatte bir hatırlatma); geçince alarm durumu temizlenir. Sinyaller susturulmaz (Haiku 10-17). Adres / özet alarm metnine GİRMEZ.
 */
export async function checkSignupNetworkInfra(now: Date = new Date()): Promise<boolean> {
  if (!signupNetworkTraceEnabled()) return false;
  const keyFp = signupNetworkKeyFp();
  const recent = await prisma.signupNetworkTrace.findMany({
    where: { keyFp, createdAt: { gte: new Date(now.getTime() - INFRA_WINDOW_MS) } },
    select: { id: true, organizationId: true, ipHash: true, networkHash: true, keyFp: true, createdAt: true },
  });
  const suspected = infrastructureIpHashes(recent, now, keyFp).size > 0;
  if (suspected) {
    await alertOnTransition(
      "signup-network-infra",
      "signup-network",
      new Error("Son 24 saatteki kayıtların yarısı tek adresten geldi — vekil ayarı (TRUSTED_PROXY_HOPS) ya da toplu kayıt; operatör listesine bakın."),
    );
  } else {
    await clearAlertState("signup-network-infra");
  }
  return suspected;
}
