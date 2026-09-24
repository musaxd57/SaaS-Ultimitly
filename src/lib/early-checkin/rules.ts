// ---------------------------------------------------------------------------
// ERKEN GİRİŞ KURALI — DEPO + DOĞRULAMA (09-24). Migration YOK: kullanılmayan `AutomationRule` tablosu
// (org kapsamlı, `triggerType` + JSON koşul/eylem) mülk başına bir satırla kullanılır. Kural yoksa ya da satır
// bozuksa KAPALI sayılır (fail-closed → bugünkü davranış: insan). Ücreti yapay zekâ yalnız OKUR; temizlik
// rolü ne görür ne değiştirir (kayıt rotası yönetici kapılı).
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { OFFER_PAYMENT_METHOD_RX } from "@/lib/validators";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { EARLY_CHECKIN_CURRENCIES, EARLY_CHECKIN_MODES, type EarlyCheckinRule } from "./core";

export const EARLY_CHECKIN_TRIGGER = "early_checkin_request";
export const EARLY_CHECKIN_NOTE_MAX = 200;
const FEE_MAX = 10_000;

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
    const n = r.note.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
    if (n) {
      // Misafire OLDUĞU GİBİ gider: platform dışı ödeme yöntemi, bağlantı ve istem ayraçları yasak. Otomatik cevabın
      // çıktı vetosuna takılacak not ("taksinizi ayarladım") kayıtta reddedilir — yoksa kural hiç otomatik gönderemez
      // ve host nedenini göremezdi (kapı gönderimde yine AYNI vetoyu koşar).
      if (
        n.length > EARLY_CHECKIN_NOTE_MAX ||
        OFFER_PAYMENT_METHOD_RX.test(n) ||
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
  return { mode: r.mode, earliest, fee, note };
}

const conditionFor = (propertyId: string) => JSON.stringify({ propertyId });

/**
 * Mülkün kuralı (org kapsamlı). Yok / bozuk → `null` (fail-closed). "Kapalı" kural da döner (form değerlerini
 * korusun); karar çekirdeği `mode: "off"`u kural yokmuş gibi ele alır. `isEnabled` yalnız listeleme aynasıdır.
 */
export async function loadEarlyCheckinRule(organizationId: string, propertyId: string): Promise<EarlyCheckinRule | null> {
  const row = await prisma.automationRule.findFirst({
    where: { organizationId, triggerType: EARLY_CHECKIN_TRIGGER, conditionJson: conditionFor(propertyId) },
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

/** Kuralı yaz (`null` = kaldır). Mülkün sahipliğini ÇAĞIRAN doğrular (rota org kapsamlı 404 döner). */
export async function saveEarlyCheckinRule(organizationId: string, propertyId: string, rule: EarlyCheckinRule | null): Promise<void> {
  const where = { organizationId, triggerType: EARLY_CHECKIN_TRIGGER, conditionJson: conditionFor(propertyId) };
  await prisma.$transaction(async (tx) => {
    const rows = await tx.automationRule.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (!rule) {
      await tx.automationRule.deleteMany({ where });
      return;
    }
    const data = { actionJson: JSON.stringify(rule), isEnabled: rule.mode !== "off", name: "Erken giriş kuralı" };
    if (rows.length === 0) {
      await tx.automationRule.create({ data: { ...where, ...data } });
      return;
    }
    await tx.automationRule.update({ where: { id: rows[0].id }, data });
    if (rows.length > 1) await tx.automationRule.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
  });
}
