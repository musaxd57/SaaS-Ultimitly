// ---------------------------------------------------------------------------
// DENEME RİSK PUANI (kurucu onayı 10-10: "geçici e-posta + doğrulanmamış e-posta", "önce yalnız liste"). Amaç: ücretsiz denemeyi kötüye
// kullanma ihtimali olan hesapları operatöre BİR LİSTEDE göstermek. Müşteriye hiçbir şey gösterilmez, hiçbir hesap otomatik etkilenmez;
// yeni veri SAKLANMAZ (puan her açılışta eldeki e-posta + doğrulama durumundan hesaplanır). Kartla doğrulama ayrı tasarım (Paddle).
// Saf modül (DB yok) — operatör sayfası girdiyi verir.
// ---------------------------------------------------------------------------

import { needsEmailVerification } from "@/lib/auth/email-verify";

export type TrialRiskReason = "identity_reused" | "mailbox_shared" | "disposable_email" | "ip_shared" | "network_burst" | "email_unverified";

export interface TrialRisk {
  score: number;
  reasons: TrialRiskReason[];
}

/** Operatör paneli etiketleri (sade). */
export const TRIAL_RISK_LABELS: Record<TrialRiskReason, string> = {
  identity_reused: "ilan daha önce kullanıldı",
  mailbox_shared: "aynı posta kutusu başka hesapta",
  disposable_email: "geçici e-posta",
  ip_shared: "aynı adresten başka kayıt (30 gün)",
  network_burst: "aynı ağdan kısa sürede çok kayıt (7 gün)",
  email_unverified: "e-posta doğrulanmadı (24 sa+)",
};

/**
 * `mailbox_shared` (deneme araştırması 10-15, dilim 1): sahibin KANONİK posta kutusu (`canonicalMailbox` — Gmail noktası, `+etiket`,
 * googlemail) başka bir işletmenin sahibinde de var ("ali+2@gmail.com" ile "a.li@gmail.com" iki ayrı deneme). Yalnız puan sinyali — kimlik
 * kararı, engel YOK; aynı Gmail'le iki gerçek işletme açan kişi nadir ama olabilir (operatör bakışla karar verir).
 */
/**
 * K1 (kurucu 10-17, "IP'lere bakılsın; otomatik kesme yok"): kayıt ağı sinyalleri BİLİNÇLİ ZAYIF — Türkiye'de mobil hatlar ortak adres (CGNAT),
 * otel / ofis Wi-Fi'si ve VPN yaygın. 🚨 Değişmez (pinli): ağ sinyallerinin toplamı tek başına "yüksek" banda (≥ 60) ULAŞAMAZ.
 */
const WEIGHTS: Record<TrialRiskReason, number> = {
  identity_reused: 60,
  mailbox_shared: 40,
  disposable_email: 30,
  ip_shared: 20,
  network_burst: 15,
  email_unverified: 10,
};
export const NETWORK_RISK_REASONS: readonly TrialRiskReason[] = ["ip_shared", "network_burst"];
export function trialRiskWeight(reason: TrialRiskReason): number {
  return WEIGHTS[reason];
}

/** Yalnız GÖSTERİM bandı — otomatik işlem YOK. */
export type TrialRiskBand = "high" | "medium" | "low";
export function trialRiskBand(score: number): TrialRiskBand | null {
  if (score >= 60) return "high";
  if (score >= 30) return "medium";
  return score > 0 ? "low" : null;
}

/**
 * Doğrulanmamış e-posta bu süreden sonra sinyal sayılır (kayıttan hemen sonra herkes doğrulanmamıştır). Doğrulama zorunluluğundan
 * (`EMAIL_VERIFY_REQUIRED_FROM`) ÖNCE açılmış hesaptan doğrulama hiç istenmedi → sinyal değil (Haiku: yanlış pozitif).
 */
export const UNVERIFIED_GRACE_MS = 24 * 60 * 60_000;

/**
 * Tek kullanımlık (geçici) e-posta servisleri — bilinen yaygın alan adları; alt alan adları da sayılır (`x.mailinator.com`). Eksik alan adı
 * yalnız sinyali kaçırır (kimse yanlış işaretlenmez); liste bilinçli kısa ve elle bakımlı.
 */
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com", "sharklasers.com", "grr.la",
  "10minutemail.com", "10minutemail.net", "temp-mail.org", "temp-mail.io", "tempmail.com", "tempmail.net", "tempmail.plus", "tempmailo.com",
  "tempail.com", "tempr.email", "yopmail.com", "yopmail.fr", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email",
  "dispostable.com", "maildrop.cc", "mintemail.com", "fakeinbox.com", "throwawaymail.com", "emailondeck.com", "mohmal.com", "mailnesia.com",
  "mailcatch.com", "moakt.com", "discard.email", "spamgourmet.com", "burnermail.io", "mail.tm", "emailfake.com", "1secmail.com", "1secmail.net",
  "inboxkitten.com", "mytemp.email", "minuteinbox.com", "mailpoof.com", "spambox.us", "dropmail.me", "emltmp.com", "linshiyouxiang.net",
]);

/** E-posta adresinin alan adı (ya da üst alan adlarından biri) geçici e-posta listesinde mi. */
export function isDisposableEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const labels = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i + 1 < labels.length; i++) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(labels.slice(i).join("."))) return true;
  }
  return false;
}

/**
 * Bir deneme hesabının risk puanı. Girdi: hesabın sahip kullanıcıları (e-posta + doğrulama + kayıt anı) ve deneme kimliği kuralının
 * sonucu. Sahiplerden BİRİ sinyal verirse sayılır; her sebep bir kez. Puan sıralama içindir, eşik / otomatik işlem YOK.
 */
export function trialRisk(input: {
  owners: readonly { email: string; emailVerifiedAt: Date | null; createdAt: Date }[];
  identityReused: boolean;
  /** Sahiplerden birinin kanonik posta kutusu başka bir işletmenin sahibinde de var (çağıran hesaplar). */
  mailboxShared?: boolean;
  /** Kayıt ağı sinyalleri (K1; `signup-network-core.ts networkSignals`). Anahtar kapalıyken çağıran vermez. */
  network?: { ipShared: boolean; networkBurst: boolean };
  now: Date;
}): TrialRisk {
  const reasons: TrialRiskReason[] = [];
  if (input.identityReused) reasons.push("identity_reused");
  if (input.mailboxShared) reasons.push("mailbox_shared");
  if (input.owners.some((o) => isDisposableEmail(o.email))) reasons.push("disposable_email");
  if (input.network?.ipShared) reasons.push("ip_shared");
  if (input.network?.networkBurst) reasons.push("network_burst");
  if (input.owners.some((o) => needsEmailVerification(o) && input.now.getTime() - o.createdAt.getTime() >= UNVERIFIED_GRACE_MS)) {
    reasons.push("email_unverified");
  }
  return { score: reasons.reduce((n, r) => n + WEIGHTS[r], 0), reasons };
}

/** Liste yalnız SÜREN ya da bu süre içinde BİTMİŞ denemeleri gösterir (yıllar önce bitmiş ücretsiz hesap gürültüsü yok). */
export const RISK_LIST_RECENT_MS = 30 * 24 * 60 * 60_000;

/**
 * Operatör listesi: deneme hesapları (sağlayıcı "trial") içinden, denemesi sürüyor ya da son 30 günde bitmiş, puanı > 0 olanlar; puana göre
 * azalan, eşitlikte en yeni hesap önce. Demo hesabını çağıran ayıklar.
 */
export function riskyTrials<
  T extends {
    id: string;
    createdAt: Date;
    /** K1-B (10-17): deneme kimliği başka hesapta görüldü (işaret; deneme sürer). */
    trialIdentityReusedAt?: Date | null;
    subscription: { provider: string; trialEndsAt: Date | null; trialEndReason: string | null } | null;
  },
>(
  orgs: readonly T[],
  ownersByOrg: ReadonlyMap<string, readonly { email: string; emailVerifiedAt: Date | null; createdAt: Date }[]>,
  now: Date,
  /** Kanonik posta kutusu başka işletmeyle ORTAK olan işletmeler (operatör sayfası kanaryadan hesaplar). */
  sharedMailboxOrgIds: ReadonlySet<string> = new Set(),
  /** Kayıt ağı sinyalleri (K1; anahtar kapalıyken boş). */
  networkByOrg: ReadonlyMap<string, { ipShared: boolean; networkBurst: boolean }> = new Map(),
): { org: T; risk: TrialRisk }[] {
  return orgs
    .filter((o) => o.subscription?.provider === "trial")
    .filter((o) => !o.subscription?.trialEndsAt || o.subscription.trialEndsAt.getTime() >= now.getTime() - RISK_LIST_RECENT_MS)
    .map((org) => ({
      org,
      risk: trialRisk({
        owners: ownersByOrg.get(org.id) ?? [],
        // Yeni işaret (K1-B) ya da ESKİ kuralla bitmiş deneme (10-10 satırları).
        identityReused: Boolean(org.trialIdentityReusedAt) || org.subscription?.trialEndReason === "identity_reused",
        mailboxShared: sharedMailboxOrgIds.has(org.id),
        network: networkByOrg.get(org.id),
        now,
      }),
    }))
    .filter((r) => r.risk.score > 0)
    .sort((a, b) => b.risk.score - a.risk.score || b.org.createdAt.getTime() - a.org.createdAt.getTime());
}
