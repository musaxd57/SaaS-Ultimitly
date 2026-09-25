// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KURALI — DEPO + DOĞRULAMA (09-24). Migration YOK: kullanılmayan `AutomationRule` tablosu
// (org kapsamlı, `triggerType` + JSON koşul/eylem) mülk başına bir satırla kullanılır. Kural yoksa ya da satır
// bozuksa KAPALI sayılır (fail-closed → bugünkü davranış: insan). Ücreti yapay zekâ yalnız OKUR; temizlik
// rolü ne görür ne değiştirir (kayıt rotası yönetici kapılı).
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { namesPaymentMethod } from "@/lib/payment-method-guard";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { EARLY_CHECKIN_CURRENCIES, EARLY_CHECKIN_MODES, type EarlyCheckinRule } from "./core";

export const EARLY_CHECKIN_TRIGGER = "early_checkin_request";
export const EARLY_CHECKIN_NOTE_MAX = 200;
const FEE_MAX = 10_000;

/** Not ödeme yöntemi/yeri anlatıyorsa gösterilen hata (sade dil — CLAUDE.md). */
export const EARLY_CHECKIN_NOTE_PAYMENT_ERROR =
  "Not, ödemenin nasıl ya da nerede yapılacağını (kapıda, elden, nakit, IBAN gibi) içeremez. Bu kısmı nottan çıkarın.";

/** Notun misafire giden biçimi (kontrol karakterleri ve fazla boşluk temizlenmiş). */
function cleanNote(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

/** Kural neden geçersiz: not ödeme anlatıyorsa ÖZEL metin (ev sahibi neyi düzelteceğini bilsin), değilse genel metin. */
export function earlyCheckinRuleErrorMessage(raw: unknown): string {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const hasFee = r.fee !== null && r.fee !== undefined;
    if (typeof r.note === "string" && namesPaymentMethod(cleanNote(r.note), { paymentContext: hasFee })) {
      return EARLY_CHECKIN_NOTE_PAYMENT_ERROR;
    }
  }
  return EARLY_CHECKIN_RULE_ERROR;
}

/** Müşteriye gösterilen kısa hata (sade dil — CLAUDE.md). */
export const EARLY_CHECKIN_RULE_ERROR =
  "Kuralı kontrol edin: saat SS:DD biçiminde olmalı; ücret 0'dan büyük olmalı; not en fazla 200 karakter olmalı; bağlantı, ödeme yöntemi ya da \"göndereceğiz, ayarladım\" gibi söz veren ifadeler içermemeli.";

function member<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/** Saf doğrulama: geçerliyse temizlenmiş kural, değilse `null`. Ek alanlar yok sayılır. */
export function validateEarlyCheckinRuleInput(raw: unknown): EarlyCheckinRule | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!member(EARLY_CHECKIN_MODES, r.mode)) return null;
  const earliest = normalizeHhmm(r.earliest);
  if (!earliest) return null;

  let fee: EarlyCheckinRule["fee"] = null;
  if (r.fee !== null && r.fee !== undefined) {
    if (typeof r.fee !== "object" || Array.isArray(r.fee)) return null;
    const f = r.fee as Record<string, unknown>;
    const amount = f.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0 || amount > FEE_MAX) return null;
    // En fazla iki ondalık hane. `amount * 100` kayan nokta hatası taşır (19.99 × 100 = 1998.999…) → yuvarla-geri kıyasla.
    if (Math.round(amount * 100) / 100 !== amount) return null;
    if (!member(EARLY_CHECKIN_CURRENCIES, f.currency)) return null;
    fee = { amount, currency: f.currency };
  }

  let note: string | null = null;
  if (typeof r.note === "string") {
    const n = cleanNote(r.note);
    if (n) {
      // Misafire OLDUĞU GİBİ gider: platform dışı ödeme yöntemi, bağlantı ve istem ayraçları yasak. Otomatik cevabın
      // çıktı vetosuna takılacak not ("taksinizi ayarladım") kayıtta reddedilir — yoksa kural hiç otomatik gönderemez
      // ve host nedenini göremezdi (kapı gönderimde yine AYNI vetoyu koşar).
      if (
        n.length > EARLY_CHECKIN_NOTE_MAX ||
        // Ücret kuralın ayrı alanında ve onay metnine kodla yazılır: not onun yanına eklenir → ücret varsa bağlam var.
        namesPaymentMethod(n, { paymentContext: fee !== null }) ||
        /https?:\/\/|www\./i.test(n) ||
        /[<>{}[\]]/.test(n) ||
        vetoOutgoingReply(n) !== null
      ) {
        return null;
      }
      note = n;
    }
  } else if (r.note !== null && r.note !== undefined) {
    return null;
  }
  // Host rızası (kanıt modeli): yalnız açık `true` evet; yok / `null` / `false` HAYIR. Başka tip = bozuk kural → tüm kural
  // reddedilir (öteki alanlarla aynı: fail-closed, kural kapalı sayılır).
  if (r.readyBeforeCheckout !== undefined && r.readyBeforeCheckout !== null && typeof r.readyBeforeCheckout !== "boolean") return null;
  return { mode: r.mode, earliest, fee, note, ...(r.readyBeforeCheckout === true ? { readyBeforeCheckout: true } : {}) };
}

const conditionFor = (propertyId: string) => JSON.stringify({ propertyId });

/** Mülkün kural satır(lar)ı — TEK tanım (okuma, yazma, mülk silme aynı koşulu kullanır). */
export function earlyCheckinRuleWhere(organizationId: string, propertyId: string) {
  return { organizationId, triggerType: EARLY_CHECKIN_TRIGGER, conditionJson: conditionFor(propertyId) };
}

/**
 * Org'un kuralı OTOMATİK olan mülkleri (yeniden değerlendirme taraması). Okuma bu depodan geçer: satırı doğrulamadan
 * JSON'u kendisi çözen ikinci bir okuyucu olmasın. Bozuk satır = kapalı.
 */
export async function autoEarlyCheckinPropertyIds(organizationId: string): Promise<string[]> {
  const rows = await prisma.automationRule.findMany({
    where: { organizationId, triggerType: EARLY_CHECKIN_TRIGGER, isEnabled: true },
    select: { conditionJson: true, actionJson: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    try {
      const rule = validateEarlyCheckinRuleInput(JSON.parse(r.actionJson));
      const cond = r.conditionJson ? (JSON.parse(r.conditionJson) as { propertyId?: unknown } | null) : null;
      if (rule?.mode === "auto" && typeof cond?.propertyId === "string" && r.conditionJson === conditionFor(cond.propertyId)) {
        ids.add(cond.propertyId);
      }
    } catch {
      // bozuk satır = kapalı
    }
  }
  return [...ids];
}

/**
 * Mülkün kuralı (org kapsamlı). Yok / bozuk → `null` (fail-closed). "Kapalı" kural da döner (form değerlerini
 * korusun); karar çekirdeği `mode: "off"`u kural yokmuş gibi ele alır. `isEnabled` yalnız listeleme aynasıdır.
 */
export async function loadEarlyCheckinRule(organizationId: string, propertyId: string): Promise<EarlyCheckinRule | null> {
  const row = await prisma.automationRule.findFirst({
    where: earlyCheckinRuleWhere(organizationId, propertyId),
    orderBy: { updatedAt: "desc" },
    select: { actionJson: true },
  });
  if (!row) return null;
  try {
    return validateEarlyCheckinRuleInput(JSON.parse(row.actionJson));
  } catch {
    return null;
  }
}

/**
 * Kuralı yaz (`null` = kaldır). Mülkün sahipliğini ÇAĞIRAN doğrular (rota org kapsamlı 404 döner). Dönüş: yazıldı mı —
 * kilit alındığında mülk artık yoksa (eşzamanlı silme) HİÇBİR ŞEY yazılmaz, `false` (sahipsiz kural kalmasın).
 */
export async function saveEarlyCheckinRule(organizationId: string, propertyId: string, rule: EarlyCheckinRule | null): Promise<boolean> {
  const where = earlyCheckinRuleWhere(organizationId, propertyId);
  return prisma.$transaction(async (tx) => {
    // Eşzamanlı iki kayıt (iki sekme / çift tık) iki satır doğurmasın: mülk satırı kilitlenir, yazımlar sıralanır.
    // Mülk silme de ÖNCE bu satırı kilitler (aynı sıra → kilitlenme yok).
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Property" WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (locked.length === 0) return false;
    const rows = await tx.automationRule.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (!rule) {
      await tx.automationRule.deleteMany({ where });
      return true;
    }
    const data = { actionJson: JSON.stringify(rule), isEnabled: rule.mode !== "off", name: "Erken giriş kuralı" };
    if (rows.length === 0) {
      await tx.automationRule.create({ data: { ...where, ...data } });
      return true;
    }
    await tx.automationRule.update({ where: { id: rows[0].id }, data });
    if (rows.length > 1) await tx.automationRule.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
    return true;
  });
}
