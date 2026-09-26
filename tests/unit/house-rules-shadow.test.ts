import { describe, it, expect } from "vitest";
import { evaluateHouseRulesShadow, HOUSE_RULE_SHADOW_MAX } from "@/lib/house-rules/shadow";
import { parseUnderstanding } from "@/lib/ai/semantic/understanding-schema";
import { buildKbEvidence } from "@/lib/ai/grounding";
import type { HouseRule } from "@/lib/house-rules/core";

// ---------------------------------------------------------------------------
// EV KURALI GÖLGE ÖLÇÜMÜ — SAF DEĞERLENDİRİCİ (#188 dilim 3). Anlama katmanının konu + tutumu ile mülkün kuralından
// "kural açık olsaydı ne olurdu" hesaplanır ve yalnız KARAR KAYDINA yazılır (`hr`, kapalı küme; metin yok). Hiçbir kapı
// okumaz. Katman sonuç vermediyse kayıt YOK (null) — "ölçülmedi" ile "konu yoktu" ([]) ayrı.
// ---------------------------------------------------------------------------

const STAY_NONE = { requested: false, kind: "none", checkin_time: null, checkout_time: null };
function understood(requests: { intent: string; rule_topic?: string; rule_stance?: string }[]) {
  const u = parseUnderstanding(
    { language: "tr", requests: requests.map((r) => ({ query_tr: "q", query_original: "q", ...r })), stay_change: STAY_NONE },
    { rules: true },
  );
  if (!u) throw new Error("fixture");
  return u;
}
const confirmed = (topic: HouseRule["topic"], policy: HouseRule["policy"]): HouseRule => ({ topic, policy, status: "confirmed" });

describe("evaluateHouseRulesShadow", () => {
  it("katman sonuç vermediyse null (ölçülmedi); konu yoksa boş liste (ölçüldü, konu yok)", () => {
    expect(evaluateHouseRulesShadow(undefined, [])).toBeNull();
    expect(evaluateHouseRulesShadow(null, [])).toBeNull();
    expect(evaluateHouseRulesShadow(understood([{ intent: "wifi", rule_topic: "none", rule_stance: "none" }]), [])).toEqual([]);
  });

  it("'Our party of 4 will arrive' → konu parti ama misafirin eylemi değil: kural devreye girmez", () => {
    const u = understood([{ intent: "checkin_time", rule_topic: "party_event", rule_stance: "not_about_guest" }]);
    expect(evaluateHouseRulesShadow(u, [confirmed("party_event", "forbidden")])).toEqual([
      { t: "party_event", s: "not_about_guest", p: "forbidden", k: "not_applicable" },
    ]);
  });

  it("sigara izni + onaylı YASAK → kural nazikçe söylenirdi; yapacağını söyleyen parti → hatırlatma + ev sahibine haber", () => {
    const u = understood([
      { intent: "house_rules", rule_topic: "smoking", rule_stance: "asks_permission" },
      { intent: "house_rules", rule_topic: "party_event", rule_stance: "announces" },
    ]);
    expect(evaluateHouseRulesShadow(u, [confirmed("smoking", "forbidden"), confirmed("party_event", "forbidden")])).toEqual([
      { t: "smoking", s: "asks_permission", p: "forbidden", k: "state_rule" },
      { t: "party_event", s: "announces", p: "forbidden", k: "state_rule", n: 1 },
    ]);
  });

  it("kural yok / yalnız öneri → ev sahibinde (bugünkü gibi); izinli fazla misafir de ev sahibinde", () => {
    const u = understood([
      { intent: "pets", rule_topic: "pets", rule_stance: "asks_permission" },
      { intent: "other", rule_topic: "extra_guests", rule_stance: "asks_permission" },
    ]);
    expect(evaluateHouseRulesShadow(u, [{ topic: "pets", policy: "allowed", status: "suggested" }, confirmed("extra_guests", "allowed")])).toEqual([
      { t: "pets", s: "asks_permission", p: "ask_host", k: "hold" },
      { t: "extra_guests", s: "asks_permission", p: "allowed", k: "hold" },
    ]);
  });

  it("en fazla HOUSE_RULE_SHADOW_MAX kayıt", () => {
    const u = understood(Array.from({ length: 5 }, () => ({ intent: "pets", rule_topic: "pets", rule_stance: "asks_info" })));
    expect(HOUSE_RULE_SHADOW_MAX).toBe(5);
    expect(evaluateHouseRulesShadow(u, [])).toHaveLength(5);
  });
});

describe("karar kaydı — `hr` yalnız kapalı küme", () => {
  const parse = (houseRules: unknown) =>
    JSON.parse(buildKbEvidence({ retrieved: [], usedLabels: [], houseRules: houseRules as never }) ?? "{}");

  it("geçerli kayıtlar aynen; boş liste de yazılır (ölçüldü, konu yok); verilmezse alan YOK", () => {
    expect(parse([{ t: "smoking", s: "asks_permission", p: "forbidden", k: "state_rule" }]).hr).toEqual([
      { t: "smoking", s: "asks_permission", p: "forbidden", k: "state_rule" },
    ]);
    expect(parse([{ t: "party_event", s: "announces", p: "forbidden", k: "state_rule", n: 1 }]).hr[0].n).toBe(1);
    expect(parse([]).hr).toEqual([]);
    expect(buildKbEvidence({ retrieved: [], usedLabels: [] })).toBeNull();
  });

  it("kapalı küme dışı kayıt DÜŞER; ek alan / metin taşınmaz; en fazla 5", () => {
    const hr = parse([
      { t: "drugs", s: "asks_permission", p: "forbidden", k: "state_rule" },
      { t: "smoking", s: "maybe", p: "forbidden", k: "state_rule" },
      { t: "smoking", s: "asks_permission", p: "sometimes", k: "state_rule" },
      { t: "smoking", s: "asks_permission", p: "forbidden", k: "send" },
      { t: "pets", s: "asks_info", p: "ask_host", k: "normal", text: "Köpeğimiz Max" , n: 2 },
      ...Array.from({ length: 6 }, () => ({ t: "visitors", s: "asks_info", p: "ask_host", k: "normal" })),
    ]).hr;
    expect(hr[0]).toEqual({ t: "pets", s: "asks_info", p: "ask_host", k: "normal" });
    expect(hr).toHaveLength(5);
    expect(JSON.stringify(hr)).not.toMatch(/Max|drugs|maybe|sometimes|send/);
  });
});
