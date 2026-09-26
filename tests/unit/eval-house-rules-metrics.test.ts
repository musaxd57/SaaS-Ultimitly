import { describe, it, expect } from "vitest";
import { summarizeHouseRules, houseRuleMetricsLines, effectsByTopic, FORBIDDEN_ALL, NO_RULES, type HouseRuleEvalRow } from "../eval/house-rules-metrics";
import type { RuleUnderstanding } from "@/lib/house-rules/core";

// Ev kuralları eval'inin karar ölçüleri (#188) SAF bir özetleyiciden gelir — gerçek model koşusu yokken doğruluğu buradan
// pinlenir. Etiket ile modelin çıktısı AYNI karar tablosundan geçer; sınıflar sonuç farkıdır, etiket farkı değil.

const u = (topic: RuleUnderstanding["topic"], stance: RuleUnderstanding["stance"]): RuleUnderstanding => ({ topic, stance });
const row = (over: Partial<HouseRuleEvalRow>): HouseRuleEvalRow => ({ id: "x", lang: "tr", expect: [], keyword: false, predicted: [], ...over });

describe("ev kuralları eval — karar ölçüleri", () => {
  it("'konu yok' ile 'misafir değil' aynı sonuç: konu olmayan mesajda ikisi de hata değil", () => {
    const m = summarizeHouseRules([
      row({ id: "a", expect: [u("party_event", "not_about_guest")], predicted: [] }),
      row({ id: "b", expect: [], predicted: [u("party_event", "not_about_guest")] }),
    ]);
    expect(m.negatives).toBe(2);
    expect(m.negativeFalse).toBe(0);
    expect(m.wrongRuleStated).toEqual([]);
    expect(m.needlessHold).toEqual([]);
  });

  it("'Our party of 4' → model 'izin istiyor' derse yasak kuralda gereksiz kural cümlesi + kural yokken gereksiz tutma", () => {
    const m = summarizeHouseRules([row({ id: "p4", expect: [u("party_event", "not_about_guest")], predicted: [u("party_event", "asks_permission")] })]);
    expect(m.negativeFalse).toBe(1);
    expect(m.wrongRuleStated).toEqual(["p4"]);
    expect(m.needlessHold).toEqual(["p4"]);
  });

  it("gerçek istek 'misafir değil' diye atlanırsa TEHLİKELİ sınıf; hiç görülmezse 'konu kaçtı' (ayrı)", () => {
    const m = summarizeHouseRules([
      row({ id: "o", expect: [u("smoking", "asks_permission")], predicted: [u("smoking", "not_about_guest")] }),
      row({ id: "k", expect: [u("smoking", "asks_permission")], predicted: [] }),
    ]);
    expect(m.notGuestOverride).toEqual(["o"]);
    expect(m.missedTopic).toEqual(["k"]);
    expect(m.topicHit).toBe(0);
    expect(m.positives).toBe(2);
  });

  it("'yapacağız' (haber) → model 'soruyor' derse haber eksik; tutum farkı yasak kuralda aynı cümleyse yanlış kural DEĞİL", () => {
    const m = summarizeHouseRules([row({ id: "n", expect: [u("party_event", "announces")], predicted: [u("party_event", "asks_permission")] })]);
    expect(m.missedNotify).toEqual(["n"]);
    expect(m.wrongRuleStated).toEqual([]);
    expect(m.topicHit).toBe(1);
    expect(m.stanceExact).toBe(0);
  });

  it("kural yokken bilgi sorusu (normal) → model 'izin istiyor' (tutma) derse gereksiz tutma; tersi ve ikisi de tutma değil", () => {
    const m = summarizeHouseRules([
      row({ id: "i", expect: [u("pets", "asks_info")], predicted: [u("pets", "asks_permission")] }),
      row({ id: "j", expect: [u("pets", "asks_permission")], predicted: [u("pets", "asks_info")] }),
      row({ id: "h", expect: [u("pets", "asks_permission")], predicted: [u("pets", "announces")] }),
    ]);
    expect(m.needlessHold).toEqual(["i"]);
  });

  it("kapalı küme dışı model çıktısı (karar tablosu 'fallback') sonuç sayılmaz", () => {
    expect(effectsByTopic([{ topic: "drugs", stance: "asks_permission" } as never], FORBIDDEN_ALL).size).toBe(0);
  });

  it("yanlış konu: sigara sorusuna evcil hayvan kuralı → yanlış kural cümlesi + konu kaçtı", () => {
    const m = summarizeHouseRules([row({ id: "w", expect: [u("smoking", "asks_permission")], predicted: [u("pets", "asks_permission")] })]);
    expect(m.wrongRuleStated).toEqual(["w"]);
    expect(m.missedTopic).toEqual(["w"]);
  });

  it("model düşen satır bilinmiyor: model ölçülerine girmez, kelime listesi yine sayılır", () => {
    const m = summarizeHouseRules([row({ id: "f", expect: [u("pets", "asks_permission")], keyword: true, predicted: null })]);
    expect(m.unknown).toBe(1);
    expect(m.positives).toBe(0);
    expect(m.keyword).toEqual({ positives: 1, hit: 1, negatives: 0, falseHold: 0 });
  });

  it("kelime listesi: kural konusu olmayanı tutması ayrı sayılır ('partial refund')", () => {
    const m = summarizeHouseRules([row({ id: "r", expect: [], keyword: true, predicted: [] })]);
    expect(m.keyword).toEqual({ positives: 0, hit: 0, negatives: 1, falseHold: 1 });
  });

  it("aynı konu iki istekte: en güçlü sonuç (haberli kural) kıyaslanır", () => {
    const e = effectsByTopic([u("party_event", "asks_info"), u("party_event", "announces")], FORBIDDEN_ALL);
    expect(e.get("party_event")).toBe("state_rule_notify");
    // Sıra önemsiz: haberli kural önde gelse de sonraki zayıf sonuç onu ezmez.
    expect(effectsByTopic([u("party_event", "announces"), u("party_event", "asks_info")], FORBIDDEN_ALL).get("party_event")).toBe("state_rule_notify");
    expect(effectsByTopic([u("party_event", "asks_info")], NO_RULES).get("party_event")).toBe("normal");
  });

  it("dil kırılımı ve rapor satırları", () => {
    const m = summarizeHouseRules([
      row({ id: "e1", lang: "en", expect: [u("visitors", "asks_permission")], predicted: [u("visitors", "asks_permission")] }),
      row({ id: "e2", lang: "en", expect: [], predicted: [u("quiet_hours", "announces")] }),
    ]);
    expect(m.byLang.en).toEqual({ positives: 1, topicHit: 1, negatives: 1, negativeFalse: 1 });
    const lines = houseRuleMetricsLines(m).join("\n");
    expect(lines).toContain("1/1 (%100)");
    expect(lines).toMatch(/misafir değil.*\| 0 \|/);
  });
});
