// ---------------------------------------------------------------------------
// EV KURALLARI — DEPO + DOĞRULAMA (#188 dilim 2, kurucu 09-26 "en mantıklı şekilde"). Migration YOK: erken giriş
// kuralıyla AYNI depo (`AutomationRule`, org kapsamlı, mülk başına TEK satır, konu listesi JSON'da). Satır yok ya da
// bozuksa kural YOK sayılır → her konu "bana sor" (fail-closed: bugünkü davranış, istek ev sahibine kalır).
//
// Ev sahibinin kendi seçimi ONAYDIR (`confirmed`). Yapay zekâ önerisi (`suggested`) ayrı dilimde gelir ve karar
// vermez (`core.ts` `effectivePolicy`). Kayıt rotası yönetici kapılı; mülk silinince kural aynı işlemde silinir.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import {
  HOUSE_RULE_POLICIES,
  HOUSE_RULE_STATUSES,
  HOUSE_RULE_TOPICS,
  type HouseRule,
  type HouseRulePolicy,
  type HouseRuleTopic,
} from "./core";

export const HOUSE_RULES_TRIGGER = "house_rules";

/** Müşteriye gösterilen kısa hata (sade dil — CLAUDE.md). */
export const HOUSE_RULES_INPUT_ERROR = "Kuralları kontrol edin: her konu için İzinli, Yasak ya da Bana sor seçin.";

function member<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/**
 * Kayıtlı satırı doğrular: `{ rules: [{ topic, policy, status }] }`. Kapalı küme dışı değer, aynı konu iki kez ya da
 * bozuk biçim → `null` (çağıran "kural yok" sayar). Ek alanlar yok sayılır.
 */
export function validateStoredHouseRules(raw: unknown): HouseRule[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(list) || list.length > HOUSE_RULE_TOPICS.length) return null;
  const seen = new Set<string>();
  const out: HouseRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { topic, policy, status } = item as Record<string, unknown>;
    if (!member(HOUSE_RULE_TOPICS, topic) || !member(HOUSE_RULE_POLICIES, policy) || !member(HOUSE_RULE_STATUSES, status)) return null;
    if (seen.has(topic)) return null;
    seen.add(topic);
    out.push({ topic, policy, status });
  }
  return out;
}

/**
 * Ev sahibinin formdan gönderdiği kurallar: `{ rules: [{ topic, policy }] }`. Ev sahibinin kendi seçimi ONAYDIR →
 * `confirmed`. Boş liste geçerlidir (= hepsi "bana sor"). Geçersizse `null`.
 */
export function validateHostHouseRulesInput(raw: unknown): HouseRule[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const list = (raw as { rules?: unknown }).rules;
  if (!Array.isArray(list) || list.length > HOUSE_RULE_TOPICS.length) return null;
  const seen = new Set<string>();
  const out: HouseRule[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const { topic, policy } = item as { topic?: unknown; policy?: unknown };
    if (!member(HOUSE_RULE_TOPICS, topic) || !member(HOUSE_RULE_POLICIES, policy)) return null;
    if (seen.has(topic)) return null;
    seen.add(topic);
    out.push({ topic, policy, status: "confirmed" });
  }
  return out;
}

const conditionFor = (propertyId: string) => JSON.stringify({ propertyId });

/** Mülkün kural satır(lar)ı — TEK tanım (okuma, yazma, mülk silme aynı koşulu kullanır). */
export function houseRulesWhere(organizationId: string, propertyId: string) {
  return { organizationId, triggerType: HOUSE_RULES_TRIGGER, conditionJson: conditionFor(propertyId) };
}

/** Mülkün kuralları (org kapsamlı). Yok / bozuk → boş liste (her konu "bana sor"). */
export async function loadHouseRules(organizationId: string, propertyId: string): Promise<HouseRule[]> {
  const row = await prisma.automationRule.findFirst({
    where: houseRulesWhere(organizationId, propertyId),
    orderBy: { updatedAt: "desc" },
    select: { actionJson: true },
  });
  if (!row) return [];
  try {
    return validateStoredHouseRules(JSON.parse(row.actionJson)) ?? [];
  } catch {
    return [];
  }
}

/**
 * Kuralları yaz (boş liste = kaldır). Mülkün sahipliğini ÇAĞIRAN doğrular (rota org kapsamlı 404 döner). Dönüş: yazıldı
 * mı — kilit alındığında mülk artık yoksa (eşzamanlı silme) HİÇBİR ŞEY yazılmaz, `false` (sahipsiz kural kalmasın).
 */
export async function saveHouseRules(organizationId: string, propertyId: string, rules: readonly HouseRule[]): Promise<boolean> {
  const where = houseRulesWhere(organizationId, propertyId);
  return prisma.$transaction(async (tx) => {
    // Erken giriş kuralıyla AYNI kilit sırası: önce mülk satırı (mülk silme de önce onu kilitler → kilitlenme yok);
    // eşzamanlı iki kayıt (iki sekme / çift tık) iki satır doğurmasın.
    const locked = await tx.$queryRaw<unknown[]>`SELECT 1 FROM "Property" WHERE "id" = ${propertyId} AND "organizationId" = ${organizationId} FOR UPDATE`;
    if (locked.length === 0) return false;
    const rows = await tx.automationRule.findMany({ where, orderBy: { updatedAt: "desc" }, select: { id: true } });
    if (rules.length === 0) {
      await tx.automationRule.deleteMany({ where });
      return true;
    }
    const data = { actionJson: JSON.stringify({ rules }), isEnabled: true, name: "Ev kuralları" };
    if (rows.length === 0) {
      await tx.automationRule.create({ data: { ...where, ...data } });
      return true;
    }
    await tx.automationRule.update({ where: { id: rows[0].id }, data });
    if (rows.length > 1) await tx.automationRule.deleteMany({ where: { id: { in: rows.slice(1).map((r) => r.id) } } });
    return true;
  });
}

/** Formun gösterdiği değer: konu başına ETKİN seçim (kayıt yoksa "bana sor"). */
export function houseRuleFormValues(rules: readonly HouseRule[]): Record<HouseRuleTopic, HouseRulePolicy> {
  const out = Object.fromEntries(HOUSE_RULE_TOPICS.map((t) => [t, "ask_host"])) as Record<HouseRuleTopic, HouseRulePolicy>;
  for (const r of rules) if (r.status === "confirmed") out[r.topic] = r.policy;
  return out;
}
