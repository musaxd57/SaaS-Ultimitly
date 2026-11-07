// ---------------------------------------------------------------------------
// EV KURALI GÖLGE ÖLÇÜMÜ (#188 dilim 3, kurucu 09-26 "yap hemen"; bayrak `AI_HOUSE_RULES_SHADOW`).
//
// Anlama katmanının istek başına KONU + TUTUM çıktısı ve mülkün ONAYLI kuralından "kural açık olsaydı ne olurdu"yu
// hesaplar (karar tablosu `core.ts decideHouseRule`) ve YALNIZ karar kaydına yazar (kanıtta `hr`). KARAR DEĞİL: hiçbir
// kapı okumaz, misafire giden cevap değişmez. Amaç: kelime listesinin yanlış tuttuğu ("Our party of 4…") ve kaçırdığı
// mesajları gerçek trafikte ölçmek; açma kararı ücretli kör ölçüm + kurucu onayıyla.
//
// Sözleşme: bayrak kapalı → hiç çağrı / sorgu yok · anlama katmanı sonuç vermedi → kayıt YOK (ölçülmedi) · konu yok →
// depo OKUNMAZ, kayıt boş liste (ölçüldü) · depo okunamadı → kayıt yazılmaz, akış sürer (ASLA fırlatmaz).
// ---------------------------------------------------------------------------

import type { MessageUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { decideHouseRule, effectivePolicy, type HouseRule, type HouseRuleOutcome, type HouseRulePolicy, type HouseRuleTopic, type RuleStance } from "./core";
import { houseRulesShadowEnabled } from "./flag";
import { loadHouseRules } from "./store";

/** Karar kaydındaki tek satır: konu · tutum · etkin politika · "olsaydı" sonucu · ev sahibine haber (yalnız 1). Metin YOK. */
export interface HouseRuleShadowEntry {
  t: HouseRuleTopic;
  s: RuleStance;
  p: HouseRulePolicy;
  k: HouseRuleOutcome["kind"];
  n?: 1;
}

/** Bir turda kayda giren en fazla satır (anlama katmanının istek tavanıyla aynı). */
export const HOUSE_RULE_SHADOW_MAX = 5;

/** Saf: katman sonuç vermediyse `null`; konu taşıyan istek yoksa boş liste. */
export function evaluateHouseRulesShadow(
  understood: MessageUnderstanding | null | undefined,
  rules: readonly HouseRule[],
): HouseRuleShadowEntry[] | null {
  if (!understood) return null;
  const out: HouseRuleShadowEntry[] = [];
  for (const r of understood.requests) {
    if (!r.rule) continue;
    const outcome = decideHouseRule(r.rule, rules);
    out.push({
      t: r.rule.topic,
      s: r.rule.stance,
      p: effectivePolicy(rules, r.rule.topic),
      k: outcome.kind,
      ...(outcome.kind === "state_rule" && outcome.notifyHost ? { n: 1 as const } : {}),
    });
    if (out.length >= HOUSE_RULE_SHADOW_MAX) break;
  }
  return out;
}

/**
 * Yüzeylerin TEK girişi (kanal oto-yanıtı + QR): bayrak kapalıysa `undefined` (sorgu yok). Kural deposu yalnız konu taşıyan
 * istek varken okunur; her arıza `undefined` (kayıt yazılmaz).
 */
export async function houseRulesShadowFor(input: {
  organizationId: string;
  propertyId: string;
  understood: MessageUnderstanding | null | undefined;
}): Promise<HouseRuleShadowEntry[] | undefined> {
  if (!houseRulesShadowEnabled() || !input.understood) return undefined;
  try {
    const rules = input.understood.requests.some((r) => r.rule) ? await loadHouseRules(input.organizationId, input.propertyId) : [];
    return evaluateHouseRulesShadow(input.understood, rules) ?? undefined;
  } catch {
    return undefined;
  }
}
