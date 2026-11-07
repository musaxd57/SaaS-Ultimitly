import { describe, it, expect, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { houseRuleFormValues, validateHostHouseRulesInput, validateStoredHouseRules } from "@/lib/house-rules/store";
import { houseRulesCardEnabled } from "@/lib/house-rules/flag";
import { HOUSE_RULE_TOPICS } from "@/lib/house-rules/core";

// ---------------------------------------------------------------------------
// EV KURALLARI — SAF DOĞRULAMA (#188 dilim 2). Kayıtlı satır ve ev sahibi girdisi AYRI doğrulanır: girdide durum alanı
// yok sayılır (ev sahibinin seçimi ONAYDIR), kayıtta kapalı küme dışı her değer satırı düşürür (kural yok = "bana sor").
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllEnvs());

describe("ev sahibi girdisi", () => {
  it("seçim ONAY olarak kaydedilir; girdideki `status` YOK SAYILIR; ek alanlar düşer", () => {
    expect(
      validateHostHouseRulesInput({
        rules: [
          { topic: "smoking", policy: "forbidden", status: "suggested", note: "x" },
          { topic: "pets", policy: "ask_host" },
        ],
      }),
    ).toEqual([
      { topic: "smoking", policy: "forbidden", status: "confirmed" },
      { topic: "pets", policy: "ask_host", status: "confirmed" },
    ]);
  });

  it("boş liste geçerli (= hepsi bana sor); altı konunun tamamı geçerli", () => {
    expect(validateHostHouseRulesInput({ rules: [] })).toEqual([]);
    expect(validateHostHouseRulesInput({ rules: HOUSE_RULE_TOPICS.map((topic) => ({ topic, policy: "allowed" })) })).toHaveLength(6);
  });

  it("geçersiz: bilinmeyen konu / politika, aynı konu iki kez, altıdan fazla, dizi olmayan, nesne olmayan", () => {
    for (const bad of [
      { rules: [{ topic: "drugs", policy: "forbidden" }] },
      { rules: [{ topic: "pets", policy: "maybe" }] },
      { rules: [{ topic: "pets", policy: "allowed" }, { topic: "pets", policy: "forbidden" }] },
      { rules: [...HOUSE_RULE_TOPICS, "pets"].map((topic) => ({ topic, policy: "allowed" })) },
      { rules: "pets" },
      { rules: [null] },
      { rules: [["pets", "allowed"]] },
      [],
      null,
      "x",
    ]) {
      expect(validateHostHouseRulesInput(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("kayıtlı satır", () => {
  it("geçerli satır aynen döner (durum KORUNUR: öneri öneri kalır)", () => {
    const rules = [
      { topic: "smoking", policy: "forbidden", status: "confirmed" },
      { topic: "pets", policy: "allowed", status: "suggested" },
      { topic: "visitors", policy: "allowed", status: "rejected" },
    ];
    expect(validateStoredHouseRules({ rules })).toEqual(rules);
  });

  it("durum alanı eksik / bilinmeyen, aynı konu iki kez → satır DÜŞER (null)", () => {
    expect(validateStoredHouseRules({ rules: [{ topic: "pets", policy: "allowed" }] })).toBeNull();
    expect(validateStoredHouseRules({ rules: [{ topic: "pets", policy: "allowed", status: "approved" }] })).toBeNull();
    expect(
      validateStoredHouseRules({
        rules: [
          { topic: "pets", policy: "allowed", status: "confirmed" },
          { topic: "pets", policy: "forbidden", status: "confirmed" },
        ],
      }),
    ).toBeNull();
    expect(validateStoredHouseRules({ rules: [{ topic: "pets", policy: "allowed", status: "confirmed" }], extra: 1 })).toHaveLength(1);
  });
});

describe("form değerleri", () => {
  it("yalnız ONAYLI kural formu doldurur; öneri / red / kayıt yok → bana sor", () => {
    const v = houseRuleFormValues([
      { topic: "smoking", policy: "forbidden", status: "confirmed" },
      { topic: "pets", policy: "allowed", status: "suggested" },
      { topic: "visitors", policy: "allowed", status: "rejected" },
    ]);
    expect(v).toEqual({
      party_event: "ask_host",
      smoking: "forbidden",
      pets: "ask_host",
      extra_guests: "ask_host",
      quiet_hours: "ask_host",
      visitors: "ask_host",
    });
  });
});

describe("kart bayrağı", () => {
  it("varsayılan KAPALI; yalnız '1' açar", () => {
    vi.stubEnv("HOUSE_RULES_CARD_ENABLED", "");
    expect(houseRulesCardEnabled()).toBe(false);
    vi.stubEnv("HOUSE_RULES_CARD_ENABLED", "true");
    expect(houseRulesCardEnabled()).toBe(false);
    vi.stubEnv("HOUSE_RULES_CARD_ENABLED", " 1 ");
    expect(houseRulesCardEnabled()).toBe(true);
  });

  it("bayrağı YALNIZ flag.ts okur", () => {
    const root = path.resolve(__dirname, "../../");
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(e.name) && readFileSync(path.join(root, rel), "utf8").includes("process.env.HOUSE_RULES_CARD_ENABLED")) readers.push(rel);
      }
    };
    walk("src");
    expect(readers).toEqual(["src/lib/house-rules/flag.ts"]);
  });
});
