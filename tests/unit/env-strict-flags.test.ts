import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { checkProductionEnv, STRICT_ONE_FLAGS } from "../../scripts/env-check.mjs";

// ---------------------------------------------------------------------------
// A7 #1 (09-27, çalıştırılarak doğrulandı): AI_* ve diğer birçok bayrak çalışma anında `=== "1"` ile okunur — "true" / "yes" /
// "on" KAPALI demektir. KB_* bayrakları "true"yu da kabul ettiği için operatör aynı alışkanlıkla AI_UNDERSTANDING_ENABLED=true yazıp
// katmanı SESSİZCE kapalı bırakabiliyordu. Davranış DEĞİŞMEZ; açılışta UYARI verilir. Liste kaynakla pinlidir: kodda
// `env.X === "1"` okunan her bayrak listede (yeni bayrak eklenirse uyarı kendiliğinden kapsar ya da bu test kırmızı olur).
// ---------------------------------------------------------------------------

const offWarning = (warnings: string[], name: string) => warnings.find((w) => w.startsWith(`${name} is set to`) && /read as OFF/.test(w));

describe("yalnız '1' ile açılan bayrak başka yazımla verilince açılışta uyarı", () => {
  for (const value of ["true", "TRUE", "yes", "on", "enabled", " 1", "1 "]) {
    it(`AI_UNDERSTANDING_ENABLED=${JSON.stringify(value)} → uyarı`, () => {
      expect(offWarning(checkProductionEnv({ AI_UNDERSTANDING_ENABLED: value }).warnings, "AI_UNDERSTANDING_ENABLED")).toBeTruthy();
    });
  }

  for (const value of ["1", "0", ""]) {
    it(`KONTROL — ${JSON.stringify(value)} uyarı üretmez`, () => {
      expect(offWarning(checkProductionEnv({ AI_UNDERSTANDING_ENABLED: value }).warnings, "AI_UNDERSTANDING_ENABLED")).toBeUndefined();
    });
  }

  it("KONTROL — tanımsız bayrak uyarı üretmez; uyarı hata DEĞİLDİR (açılışı durdurmaz)", () => {
    const r = checkProductionEnv({});
    expect(r.warnings.filter((w) => /read as OFF/.test(w))).toEqual([]);
    const bad = checkProductionEnv({ GUEST_CHAT_ENABLED: "true" });
    expect(bad.errors.some((e) => e.includes("GUEST_CHAT_ENABLED"))).toBe(false);
  });

  it("kırpan okuyucu (HOUSE_RULES_CARD_ENABLED) ' 1'i açık okur → uyarı YOK; 'true' → uyarı", () => {
    expect(offWarning(checkProductionEnv({ HOUSE_RULES_CARD_ENABLED: " 1" }).warnings, "HOUSE_RULES_CARD_ENABLED")).toBeUndefined();
    expect(offWarning(checkProductionEnv({ HOUSE_RULES_CARD_ENABLED: "true" }).warnings, "HOUSE_RULES_CARD_ENABLED")).toBeTruthy();
  });

  it("tuhaf / uzun değer uyarıda AYNEN basılmaz", () => {
    const w = offWarning(checkProductionEnv({ AUTO_REPLY_ENABLED: "yes; $(rm -rf /) <script>" }).warnings, "AUTO_REPLY_ENABLED");
    expect(w).toContain("an unrecognized value");
    expect(w).not.toContain("script");
  });
});

describe("liste kaynakla pinli", () => {
  const SRC = path.resolve(__dirname, "../../src");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(e) ? [full] : [];
    });
  /** Yalnız sunucunun AÇILIŞINDAN geçmeyen komut satırı betiklerinin bayrakları (demo hesabı betiği kendi ortamını okur). */
  const CLI_ONLY = new Set(["DEMO_TENANT_RESET_SECURITY", "DEMO_TENANT_ROTATE_PASSWORD", "DEMO_TENANT_APPLY"]);

  // Gece-4 S10-05: `!== "1"` ile okunan (REGISTRATION_OPEN, TRIAL_EMAILS_ENABLED …) da yalnız "1" ile açılır — eskiden tarama görmüyordu.
  it("kodda `env.X === \"1\"` / `!== \"1\"` (ya da `?.trim()`) okunan her bayrak listede; listedeki her bayrak kodda böyle okunuyor", () => {
    const found = new Set<string>();
    for (const f of walk(SRC)) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\benv\.([A-Z][A-Z0-9_]+)(?:\?\.trim\(\))?\s*[!=]==\s*"1"/g)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(20);
    const expected = [...found].filter((n) => !CLI_ONLY.has(n)).sort();
    expect([...STRICT_ONE_FLAGS].sort()).toEqual(expected);
  });
});
