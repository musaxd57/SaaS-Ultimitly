// ---------------------------------------------------------------------------
// KARTLA DENEME KAPISI (kurucu 10-17: "Kartla deneme kapısını yap; yüksek riskte öyle bir durum olsun"; migration 74). Deneme sürerken risk
// puanı YÜKSEK bantta (≥ 60) olan hesapta otomatik işler, kart Paddle'ın deneme süreli ödeme penceresinde eklenene kadar durur (sınırlı mod —
// deneme bitmiş hesapla aynı yol). Hesap kapanmaz, deneme süresi silinmez, panel + elle cevap açık.
//
// 🚨 AĞ / IP SİNYALLERİ BU KAPIDA SAYILMAZ (pinli): kurucunun onayladığı aydınlatma cümlesi (Q3, gizlilik §5) "IP özeti … otomatik karar
// verilmez" diyor. Kapı otomatik bir sonuç doğurur → yalnız ağ DIŞI sinyaller (ilan başka denemede · ortak posta kutusu · geçici e-posta ·
// doğrulanmamış e-posta). Ağ sinyalleri operatör listesinde kalır.
//
// Anahtar `TRIAL_CARD_GATE_ENABLED` KAPALI (yazıcı da okuyucu da); okuyucu ayrıca faturalandırma zorunluluğu ister (kill-switch aynı).
// Açmadan önce kurucu soruları KD1 (aydınlatma cümlesi), KD2 (kapsam), KD3 (kartlı deneme süresi):
// `docs/TASARIM-2026-10-17-paddle-devam-ettir-ve-kartla-deneme.md` §3.
// ---------------------------------------------------------------------------
import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { canonicalMailbox } from "@/lib/email-identity";
import { isDemoOrg } from "@/lib/demo-tenant/constants";
import { NETWORK_RISK_REASONS, trialRisk, trialRiskBand, trialRiskWeight, type TrialRisk, type TrialRiskReason } from "@/lib/billing/trial-risk";

/** Deneme süreli Paddle fiyatları (kart alınır, deneme bitince tahsil — P1). Plan kodu → fiyat kimliği; env yoksa boş. */
export function cardTrialPriceIds(): Record<string, string> {
  return {
    free: process.env.PADDLE_PRICE_BASLANGIC_DENEME?.trim() || "",
    pro: process.env.PADDLE_PRICE_PRO_DENEME?.trim() || "",
    business: process.env.PADDLE_PRICE_ISLETME_DENEME?.trim() || "",
  };
}

/**
 * Anahtar açık VE üç deneme süreli fiyat tanımlı. Fiyatlar yoksa kapı HİÇ çalışmaz: "deneme süresince ücret alınmaz" metninin altında
 * normal (anında tahsilli) ödeme ekranı açılmasın.
 */
export function trialCardGateEnabled(): boolean {
  return (
    process.env.TRIAL_CARD_GATE_ENABLED === "1" &&
    Object.values(cardTrialPriceIds()).every((id) => id !== "") &&
    // Ödeme penceresi istemci anahtarı yoksa "Kart ekle" düğmesi çizilemez → kart eklenemeyen kilit olmasın (Haiku 10-17).
    Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN?.trim())
  );
}

/** Kapının kullandığı sebepler: operatör puanının ağ DIŞI kısmı. */
export function cardGateReasons(risk: TrialRisk): TrialRiskReason[] {
  return risk.reasons.filter((r) => !NETWORK_RISK_REASONS.includes(r));
}

/** Kart istenir mi: ağ dışı sebeplerin puanı YÜKSEK bantta. Saf. */
export function cardGateRequired(risk: TrialRisk): boolean {
  const score = cardGateReasons(risk).reduce((n, r) => n + trialRiskWeight(r), 0);
  return trialRiskBand(score) === "high";
}

/** Kurucu onayı bekleyen müşteri metni (KD1/KD2 cevabına kadar anahtar kapalı) — bant ve faturalandırma kartında. */
export const TRIAL_CARD_REQUIRED_MESSAGE =
  "Denemenize devam etmek için kartınızı ekleyin. Deneme süresince ücret alınmaz; deneme bitmeden iptal ederseniz ücret ödemezsiniz.";

export type CardGateRun = { required: number; cleared: number };

/**
 * Saatlik iş: süren denemeleri değerlendirir; yüksek bantta olanı damgalar, bandan düşeni (ör. e-posta doğrulandı) ya da artık denemede
 * olmayanı (kart eklendi → Paddle aboneliği) temizler. Geçiş başına TEK denetim kaydı (yalnız sebep kodları — kişisel veri yok).
 */
export async function evaluateTrialCardGates(now: Date = new Date()): Promise<CardGateRun> {
  if (!trialCardGateEnabled()) return { required: 0, cleared: 0 };
  // Artık süren denemede olmayan damgalar (kart eklendi / deneme bitti / plan alındı) → temizlenir.
  const stale = await prisma.organization.findMany({
    where: {
      trialCardRequiredAt: { not: null },
      NOT: { subscription: { is: { provider: "trial", trialEndsAt: { gt: now } } } },
    },
    select: { id: true },
  });
  const trials = await prisma.organization.findMany({
    where: { subscription: { is: { provider: "trial", trialEndsAt: { gt: now } } } },
    select: {
      id: true,
      trialIdentityReusedAt: true,
      trialCardRequiredAt: true,
      trialCardExemptAt: true,
      subscription: { select: { trialEndReason: true } },
    },
  });
  const candidates = trials.filter((o) => !isDemoOrg(o.id) && o.id !== process.env.PRIMARY_ORG_ID);
  const ids = candidates.map((o) => o.id);
  const owners = await prisma.user.findMany({
    where: { role: "owner", organizationId: { in: ids } },
    select: { email: true, organizationId: true, emailVerifiedAt: true, createdAt: true },
  });
  const ownersByOrg = new Map<string, typeof owners>();
  for (const u of owners) ownersByOrg.set(u.organizationId, [...(ownersByOrg.get(u.organizationId) ?? []), u]);
  // Ortak posta kutusu: operatör listesiyle aynı kural (bütün işletme sahiplerinin kanonik kutusu).
  const allOwners = await prisma.user.findMany({ where: { role: "owner" }, select: { email: true, organizationId: true } });
  const groups = new Map<string, Set<string>>();
  for (const u of allOwners) {
    const box = canonicalMailbox(u.email);
    const set = groups.get(box) ?? new Set<string>();
    set.add(u.organizationId);
    groups.set(box, set);
  }
  const shared = new Set<string>();
  for (const set of groups.values()) if (set.size > 1) for (const id of set) shared.add(id);

  const toRequire: { id: string; reasons: TrialRiskReason[] }[] = [];
  const toClear: string[] = stale.map((o) => o.id);
  for (const o of candidates) {
    const risk = trialRisk({
      owners: ownersByOrg.get(o.id) ?? [],
      identityReused: Boolean(o.trialIdentityReusedAt) || o.subscription?.trialEndReason === "identity_reused",
      mailboxShared: shared.has(o.id),
      // Ağ sinyalleri BİLİNÇLİ verilmez (↑ aydınlatma cümlesi).
      now,
    });
    // Operatör muafiyeti ("Kart şartını kaldır") kalıcı: damga yazılmaz, varsa silinir.
    const required = !o.trialCardExemptAt && cardGateRequired(risk);
    if (required && !o.trialCardRequiredAt) toRequire.push({ id: o.id, reasons: cardGateReasons(risk) });
    if (!required && o.trialCardRequiredAt) toClear.push(o.id);
  }

  // Damga + denetim TEK işlemde; yazım KOŞULLU (okuma ile yazma arasında operatör denemeyi bitirdiyse / muaf tuttuysa / kart eklendiyse
  // damga yazılmaz — Haiku 10-17).
  let required = 0;
  for (const r of toRequire) {
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.organization.updateMany({
        where: {
          id: r.id,
          trialCardRequiredAt: null,
          trialCardExemptAt: null,
          subscription: { is: { provider: "trial", trialEndsAt: { gt: now } } },
        },
        data: { trialCardRequiredAt: now },
      });
      if (res.count !== 1) return false;
      await writeAuditInTx(tx, { organizationId: r.id, actorUserId: null, action: "trial.card_required", metadata: { reasons: r.reasons } });
      return true;
    });
    if (done) required++;
  }
  let cleared = 0;
  for (const id of toClear) {
    const done = await prisma.$transaction(async (tx) => {
      const res = await tx.organization.updateMany({ where: { id, trialCardRequiredAt: { not: null } }, data: { trialCardRequiredAt: null } });
      if (res.count !== 1) return false;
      await writeAuditInTx(tx, { organizationId: id, actorUserId: null, action: "trial.card_requirement_cleared", metadata: {} });
      return true;
    });
    if (done) cleared++;
  }
  return { required, cleared };
}

/** Okuyucu: bu işletmede kart isteniyor mu (anahtar açık + kartsız deneme + damga). `getEntitlement` çağırır. */
export async function trialCardRequired(organizationId: string): Promise<boolean> {
  if (!trialCardGateEnabled()) return false;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { trialCardRequiredAt: true } });
  return Boolean(org?.trialCardRequiredAt);
}
