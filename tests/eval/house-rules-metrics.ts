// ---------------------------------------------------------------------------
// EV KURALLARI EVAL'İ — KARAR ÖLÇÜLERİ (saf; #188, 09-26). Anlama katmanının konu + tutum çıktısı ile ETİKET aynı karar
// tablosundan (`core.ts decideHouseRule`) geçirilir ve SONUÇLAR kıyaslanır — etiket eşleşmesi tek başına yetmez: "konu yok"
// ile "misafirin eylemi değil" aynı sonuca varır (kural devreye girmez), "izin istiyor" ile "kuralı soruyor" yasak kuralda aynı
// cümleyi doğurur. Üç kural ızgarası: hepsi YASAK (kural cümlesi / ev sahibine haber) · kural YOK (bugünkü gibi "bana sor").
//
// Hata sınıfları (yasak ızgarası):
//  · YANLIŞ KURAL CÜMLESİ — model bir konuda kural cümlesi doğururdu, etiket o konuda doğurmaz (misafire gereksiz / yanlış
//    "izin verilmiyor");
//  · HABER EKSİK — misafir yasak şeyi YAPACAĞINI söyledi (ev sahibine haber), model "soruyor" dedi → haber gitmezdi;
//  · "MİSAFİR DEĞİL" DİYE ATLANDI — etiket kural cümlesi doğurur, model "misafirin eylemi değil" dedi → kelime
//    listesinin tutuşunu EZEBİLECEK tek hata (karara bağlanırsa gerçek isteğin cevabı modele kalır) — TEHLİKELİ sınıf;
//  · KONU KAÇTI — etiket kural cümlesi doğurur, model konuyu hiç görmedi → bugünkü davranış (kelime listesi) sürer; güvenli yön.
// Kural yok ızgarası: GEREKSİZ TUTMA — model ev sahibine bırakırdı, etiket bırakmaz (bilgi sorusu / konu değil).
// Kelime listesi (bugünkü `rule_violation` ağı) ayrı satır: gerçek kural konusunu yakalıyor mu, konu olmayanı tutuyor mu.
// Metin taşımaz (kimlikler sentetik set satırları).
// ---------------------------------------------------------------------------

import {
  decideHouseRule,
  HOUSE_RULE_TOPICS,
  type HouseRule,
  type HouseRuleTopic,
  type RuleUnderstanding,
} from "@/lib/house-rules/core";

export interface HouseRuleEvalRow {
  id: string;
  lang: string;
  /** Etiket: misafirin mesajındaki kural konuları (boş = kural konusu yok). */
  expect: readonly RuleUnderstanding[];
  /** Bugünkü kelime listesi (`rule_violation` ağı) mesajı tuttu mu. */
  keyword: boolean;
  /** Anlama katmanının istek başına konu + tutumu; `null` = model düştü (hüküm yok, sayıma girmez). */
  predicted: readonly RuleUnderstanding[] | null;
}

export const FORBIDDEN_ALL: readonly HouseRule[] = HOUSE_RULE_TOPICS.map((topic) => ({ topic, policy: "forbidden", status: "confirmed" }));
export const NO_RULES: readonly HouseRule[] = [];

/** Konu başına en güçlü sonuç (aynı konu iki istekte geçerse): haberli kural > kural > tutma > normal > uygulanmaz. */
type Effect = "not_applicable" | "normal" | "hold" | "state_rule" | "state_rule_notify";
const RANK: Record<Effect, number> = { not_applicable: 1, normal: 2, hold: 3, state_rule: 4, state_rule_notify: 5 };

export function effectsByTopic(list: readonly RuleUnderstanding[], rules: readonly HouseRule[]): Map<HouseRuleTopic, Effect> {
  const out = new Map<HouseRuleTopic, Effect>();
  for (const u of list) {
    const o = decideHouseRule(u, rules);
    if (o.kind === "fallback") continue;
    const e: Effect = o.kind === "state_rule" ? (o.notifyHost ? "state_rule_notify" : "state_rule") : o.kind;
    const prev = out.get(u.topic);
    if (!prev || RANK[e] > RANK[prev]) out.set(u.topic, e);
  }
  return out;
}

const isPositive = (u: RuleUnderstanding) => u.stance !== "not_about_guest";
// Yasak ızgarasında olumlu her tutum kural cümlesi doğurur (tutma çıkmaz): "kural uygulanır" = cümle.
const states = (e: Effect | undefined) => e === "state_rule" || e === "state_rule_notify";

export interface HouseRuleMetrics {
  cases: number;
  unknown: number;
  /** Etiketteki olumlu kayıtlar (tutum ≠ misafir değil) ve modelin aynı konuyu olumlu tutumla bulduğu. */
  positives: number;
  topicHit: number;
  /** Konu bulunanlardan tutumu birebir aynı olan. */
  stanceExact: number;
  /** Olumlu kaydı olmayan satırlar ve modelin bunlarda olumlu konu ürettiği. */
  negatives: number;
  negativeFalse: number;
  keyword: { positives: number; hit: number; negatives: number; falseHold: number };
  wrongRuleStated: string[];
  missedNotify: string[];
  notGuestOverride: string[];
  missedTopic: string[];
  needlessHold: string[];
  byLang: Record<string, { positives: number; topicHit: number; negatives: number; negativeFalse: number }>;
}

export function summarizeHouseRules(rows: readonly HouseRuleEvalRow[]): HouseRuleMetrics {
  const m: HouseRuleMetrics = {
    cases: rows.length,
    unknown: 0,
    positives: 0,
    topicHit: 0,
    stanceExact: 0,
    negatives: 0,
    negativeFalse: 0,
    keyword: { positives: 0, hit: 0, negatives: 0, falseHold: 0 },
    wrongRuleStated: [],
    missedNotify: [],
    notGuestOverride: [],
    missedTopic: [],
    needlessHold: [],
    byLang: {},
  };
  for (const r of rows) {
    const truthPositive = r.expect.filter(isPositive);
    // Kelime listesi modelden bağımsız: model düşen satırda da sayılır.
    if (truthPositive.length > 0) {
      m.keyword.positives++;
      if (r.keyword) m.keyword.hit++;
    } else {
      m.keyword.negatives++;
      if (r.keyword) m.keyword.falseHold++;
    }
    if (r.predicted === null) {
      m.unknown++;
      continue;
    }
    const lang = (m.byLang[r.lang] ??= { positives: 0, topicHit: 0, negatives: 0, negativeFalse: 0 });
    const predPositive = r.predicted.filter(isPositive);
    for (const t of truthPositive) {
      m.positives++;
      lang.positives++;
      const found = predPositive.filter((p) => p.topic === t.topic);
      if (found.length > 0) {
        m.topicHit++;
        lang.topicHit++;
        if (found.some((p) => p.stance === t.stance)) m.stanceExact++;
      }
    }
    if (truthPositive.length === 0) {
      m.negatives++;
      lang.negatives++;
      if (predPositive.length > 0) {
        m.negativeFalse++;
        lang.negativeFalse++;
      }
    }

    const truthF = effectsByTopic(r.expect, FORBIDDEN_ALL);
    const predF = effectsByTopic(r.predicted, FORBIDDEN_ALL);
    let wrong = false;
    let notify = false;
    let override = false;
    let missed = false;
    for (const t of HOUSE_RULE_TOPICS) {
      const te = truthF.get(t);
      const pe = predF.get(t);
      if (states(pe) && !states(te)) wrong = true;
      if (te === "state_rule_notify" && pe !== "state_rule_notify") notify = true;
      if (states(te) && pe === "not_applicable") override = true;
      else if (states(te) && pe === undefined) missed = true;
    }
    if (wrong) m.wrongRuleStated.push(r.id);
    if (notify) m.missedNotify.push(r.id);
    if (override) m.notGuestOverride.push(r.id);
    if (missed) m.missedTopic.push(r.id);

    const truthH = effectsByTopic(r.expect, NO_RULES);
    const predH = effectsByTopic(r.predicted, NO_RULES);
    if (HOUSE_RULE_TOPICS.some((t) => predH.get(t) === "hold" && truthH.get(t) !== "hold")) m.needlessHold.push(r.id);
  }
  return m;
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${n}/${d} (%${Math.round((100 * n) / d)})`);
const ids = (xs: readonly string[]) => (xs.length ? `${xs.length} — ${xs.join(", ")}` : "0");

/** Rapor satırları (markdown). */
export function houseRuleMetricsLines(m: HouseRuleMetrics): string[] {
  return [
    "| ölçü | değer |",
    "|---|---|",
    `| Konu bulundu (etiketteki olumlu kayıtlar) | ${pct(m.topicHit, m.positives)} |`,
    `| — tutum da birebir | ${pct(m.stanceExact, m.topicHit)} |`,
    `| Konu olmayan mesajda olumlu konu üretti | ${pct(m.negativeFalse, m.negatives)} |`,
    `| **Yasak kuralda: "misafir değil" diye ATLANDI (tehlikeli sınıf)** | ${ids(m.notGuestOverride)} |`,
    `| Yasak kuralda: yanlış / gereksiz kural cümlesi | ${ids(m.wrongRuleStated)} |`,
    `| Yasak kuralda: ev sahibine haber eksik ("yapacağız" → "soruyor") | ${ids(m.missedNotify)} |`,
    `| Yasak kuralda: konu kaçtı (bugünkü kelime listesi sürer) | ${ids(m.missedTopic)} |`,
    `| Kural yokken: gereksiz tutma | ${ids(m.needlessHold)} |`,
    `| Bilinmiyor (model düştü; satır sayılmadı) | ${m.unknown} |`,
    `| Kelime listesi (bugün): gerçek kural konusunu tuttu | ${pct(m.keyword.hit, m.keyword.positives)} |`,
    `| Kelime listesi (bugün): kural konusu olmayanı tuttu | ${pct(m.keyword.falseHold, m.keyword.negatives)} |`,
  ];
}
