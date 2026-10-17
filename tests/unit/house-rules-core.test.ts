import { describe, it, expect } from "vitest";
import {
  decideHouseRule,
  effectivePolicy,
  houseRuleLang,
  houseRuleText,
  HOUSE_RULE_LANGS,
  HOUSE_RULE_TOPICS,
  RULE_STANCES,
  type HouseRule,
  type HouseRuleTopic,
} from "@/lib/house-rules/core";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { confidentLanguage } from "@/lib/ai/language-signal";

// ---------------------------------------------------------------------------
// #188 EV KURALLARI — saf çekirdek (tasarım docs/TASARIM-2026-09-26-ev-kurallari-politikasi.md §2.C). Karar tablosu,
// "yalnız onaylı kural karar verir", koddan kurulan metnin tonu ve güvenlik kapılarıyla uyumu.
// ---------------------------------------------------------------------------

const rule = (topic: HouseRuleTopic, policy: HouseRule["policy"], status: HouseRule["status"] = "confirmed"): HouseRule => ({ topic, policy, status });

describe("effectivePolicy — yalnız ONAYLI kural karar verir", () => {
  it("kural yok → bana sor", () => {
    expect(effectivePolicy([], "smoking")).toBe("ask_host");
  });
  it("öneri ve reddedilen kural → bana sor", () => {
    expect(effectivePolicy([rule("smoking", "forbidden", "suggested")], "smoking")).toBe("ask_host");
    expect(effectivePolicy([rule("smoking", "forbidden", "rejected")], "smoking")).toBe("ask_host");
  });
  it("onaylı kural kendi konusunda geçerli, başka konuya taşmaz", () => {
    expect(effectivePolicy([rule("smoking", "forbidden")], "smoking")).toBe("forbidden");
    expect(effectivePolicy([rule("smoking", "forbidden")], "pets")).toBe("ask_host");
  });
  it("aynı konuda çelişen iki onaylı kural → bana sor; aynı politika iki kez → o politika", () => {
    expect(effectivePolicy([rule("pets", "allowed"), rule("pets", "forbidden")], "pets")).toBe("ask_host");
    expect(effectivePolicy([rule("pets", "allowed"), rule("pets", "allowed")], "pets")).toBe("allowed");
  });
  it("kapalı küme dışı politika (bozuk kayıt) yok sayılır", () => {
    expect(effectivePolicy([{ topic: "pets", policy: "yes" as never, status: "confirmed" }], "pets")).toBe("ask_host");
    expect(effectivePolicy([{ topic: "pets", policy: "yes" as never, status: "confirmed" }, rule("pets", "forbidden")], "pets")).toBe("forbidden");
  });
});

describe("decideHouseRule — karar tablosu (tasarım §2.C)", () => {
  it("anlama katmanı sonuç vermedi / bozuk girdi → fallback (bugünkü kelime listesi tutar)", () => {
    expect(decideHouseRule(null, [rule("smoking", "forbidden")])).toEqual({ kind: "fallback" });
    expect(decideHouseRule({ topic: "alcohol" as never, stance: "asks_permission" }, [])).toEqual({ kind: "fallback" });
    expect(decideHouseRule({ topic: "smoking", stance: "maybe" as never }, [])).toEqual({ kind: "fallback" });
  });

  it("misafirin kendi eylemi değil → kural devreye girmez (her politikada)", () => {
    for (const policy of ["allowed", "forbidden", "ask_host"] as const) {
      expect(decideHouseRule({ topic: "party_event", stance: "not_about_guest" }, [rule("party_event", policy)])).toEqual({ kind: "not_applicable" });
    }
  });

  it("YASAK: izin isteyene / soran kişiye kural söylenir; yapacağını söyleyende ayrıca ev sahibine haber", () => {
    const rules = [rule("smoking", "forbidden")];
    expect(decideHouseRule({ topic: "smoking", stance: "asks_permission" }, rules)).toEqual({ kind: "state_rule", policy: "forbidden", notifyHost: false });
    expect(decideHouseRule({ topic: "smoking", stance: "asks_info" }, rules)).toEqual({ kind: "state_rule", policy: "forbidden", notifyHost: false });
    expect(decideHouseRule({ topic: "smoking", stance: "announces" }, rules)).toEqual({ kind: "state_rule", policy: "forbidden", notifyHost: true });
  });

  it("İZİNLİ: izin isteyene / sorana izin söylenir; yapacağını söyleyen normal cevap alır", () => {
    const rules = [rule("pets", "allowed")];
    expect(decideHouseRule({ topic: "pets", stance: "asks_permission" }, rules)).toEqual({ kind: "state_rule", policy: "allowed", notifyHost: false });
    expect(decideHouseRule({ topic: "pets", stance: "asks_info" }, rules)).toEqual({ kind: "state_rule", policy: "allowed", notifyHost: false });
    expect(decideHouseRule({ topic: "pets", stance: "announces" }, rules)).toEqual({ kind: "normal" });
  });

  it("KURAL YOK / bana sor / yalnız öneri: izin isteği ve duyuru ev sahibinde; bilgi sorusu normal akış", () => {
    for (const rules of [[], [rule("pets", "ask_host")], [rule("pets", "forbidden", "suggested")]]) {
      expect(decideHouseRule({ topic: "pets", stance: "asks_permission" }, rules)).toEqual({ kind: "hold" });
      expect(decideHouseRule({ topic: "pets", stance: "announces" }, rules)).toEqual({ kind: "hold" });
      expect(decideHouseRule({ topic: "pets", stance: "asks_info" }, rules)).toEqual({ kind: "normal" });
    }
  });

  it("izin cümlesi olmayan konuda (parti / ek misafir / sessiz saatler) onaylı İZİNLİ kural otomatik izne dönüşmez", () => {
    for (const topic of ["party_event", "extra_guests", "quiet_hours"] as const) {
      expect(decideHouseRule({ topic, stance: "asks_permission" }, [rule(topic, "allowed")])).toEqual({ kind: "hold" });
      expect(decideHouseRule({ topic, stance: "asks_info" }, [rule(topic, "allowed")])).toEqual({ kind: "normal" });
      // Yasak ise yine söylenir.
      expect(decideHouseRule({ topic, stance: "asks_permission" }, [rule(topic, "forbidden")]).kind).toBe("state_rule");
    }
  });

  it("tablo TAM: her konu × tutum × politika bir sonuç verir, state_rule her zaman metne sahiptir", () => {
    for (const topic of HOUSE_RULE_TOPICS)
      for (const stance of RULE_STANCES)
        for (const policy of ["allowed", "forbidden", "ask_host"] as const) {
          const out = decideHouseRule({ topic, stance }, [rule(topic, policy)]);
          expect(["not_applicable", "state_rule", "hold", "normal"]).toContain(out.kind);
          if (out.kind === "state_rule") for (const lang of HOUSE_RULE_LANGS) expect(houseRuleText(topic, out, lang)).toBeTruthy();
        }
  });
});

describe("houseRuleText — koddan kurulan metin", () => {
  const forbidden = { kind: "state_rule", policy: "forbidden", notifyHost: false } as const;
  const allowed = { kind: "state_rule", policy: "allowed", notifyHost: false } as const;

  it("kurucunun örneği birebir (sigara, yasak, Türkçe)", () => {
    expect(houseRuleText("smoking", forbidden, "tr")).toBe("Evin içinde sigara içilmesine izin verilmiyor, anlayışınız için teşekkür ederiz.");
    expect(houseRuleText("pets", allowed, "tr")).toBe("Evcil hayvan kabul ediyoruz.");
  });

  it("state_rule dışında metin YOK", () => {
    expect(houseRuleText("smoking", { kind: "hold" }, "tr")).toBeNull();
    expect(houseRuleText("smoking", { kind: "normal" }, "tr")).toBeNull();
    expect(houseRuleText("smoking", { kind: "not_applicable" }, "tr")).toBeNull();
    expect(houseRuleText("smoking", { kind: "fallback" }, "tr")).toBeNull();
    expect(houseRuleText("party_event", allowed, "tr")).toBeNull();
  });

  const allTexts: { topic: HouseRuleTopic; policy: string; lang: string; text: string }[] = [];
  for (const topic of HOUSE_RULE_TOPICS)
    for (const out of [forbidden, allowed])
      for (const lang of HOUSE_RULE_LANGS) {
        const text = houseRuleText(topic, out, lang);
        if (text) allTexts.push({ topic, policy: out.policy, lang, text });
      }

  it("her yasak metni NAZİK: teşekkür eder, azarlama / yaptırım sözcüğü taşımaz (kurucu 09-26)", () => {
    const thanks: Record<string, RegExp> = {
      tr: /anlayışınız için teşekkür ederiz/,
      en: /thank you for your understanding/,
      de: /vielen Dank für Ihr Verständnis/,
      fr: /merci de votre compréhension/,
      ar: /شكرًا لتفهمكم/,
      ru: /спасибо за понимание/,
    };
    const harsh = /yasaktır|kesinlikle|ceza|uyarı|strictly|prohibited|penalt|fine[sd]?\b|warning|streng|verboten|Strafe|interdit|amende|strictement|штраф|строго|запрещ|غرامة|ممنوع/i;
    const forb = allTexts.filter((t) => t.policy === "forbidden");
    expect(forb.length).toBe(HOUSE_RULE_TOPICS.length * HOUSE_RULE_LANGS.length);
    for (const t of forb) {
      expect(t.text, `${t.topic}/${t.lang}`).toMatch(thanks[t.lang]);
      expect(t.text, `${t.topic}/${t.lang}`).not.toMatch(harsh);
    }
  });

  it("hiçbir metin selam, yer tutucu, makbuzsuz söz ya da 'bilgim yok' taşımaz (çıktı kapıları aynı yüklemle)", () => {
    for (const t of allTexts) {
      expect(vetoOutgoingReply(t.text), `${t.topic}/${t.policy}/${t.lang}`).toBeNull();
      expect(admitsMissingKnowledge(t.text), `${t.topic}/${t.policy}/${t.lang}`).toBe(false);
      expect(t.text).not.toMatch(/merhaba|hello|\bhi\b|hallo|bonjour|مرحب|здравств/i);
      expect(t.text).not.toMatch(/[[\]{}<>]|___/);
    }
  });

  it("dil kapısı: metin emince BAŞKA bir dil sayılmaz (yanlış dilde gönderim kontrolüne takılmaz)", () => {
    for (const t of allTexts) {
      const got = confidentLanguage(t.text);
      expect(got === null || got === t.lang, `${t.topic}/${t.policy}/${t.lang} → ${got}`).toBe(true);
    }
  });

  it("her konu/politika için altı dilin metni birbirinden FARKLI (kısa metinde dil tespiti hüküm vermez; kopyala-yapıştır hatası)", () => {
    for (const topic of HOUSE_RULE_TOPICS)
      for (const policy of ["forbidden", "allowed"]) {
        const texts = allTexts.filter((t) => t.topic === topic && t.policy === policy).map((t) => t.text);
        expect(new Set(texts).size, `${topic}/${policy}`).toBe(texts.length);
      }
  });

  it("dil seçimi: tanınan altı dil, başka her şey İngilizce", () => {
    expect(houseRuleLang("tr")).toBe("tr");
    expect(houseRuleLang("DE-de")).toBe("de");
    expect(houseRuleLang("es")).toBe("en");
    expect(houseRuleLang(null)).toBe("en");
    expect(houseRuleLang("")).toBe("en");
  });
});
