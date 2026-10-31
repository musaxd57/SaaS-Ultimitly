import { describe, it, expect } from "vitest";
import * as templatesModule from "@/lib/templates";
import { DEFAULT_TEMPLATES } from "@/lib/templates";
import { applyTemplateBody } from "@/lib/template-apply";
import { TEMPLATE_CATEGORY } from "@/lib/constants";

// 15 ajan A07 (10-01): eski `applyTemplate` (sıralı `replace` zinciri + bilinmeyen ad için "Misafir") üretimde çağrılmıyordu ve
// kaldırıldı; değişken ikamesinin TEK kaynağı `applyTemplateBody` (tek geçiş). Bu dosya ikinci bir ikame yolunun geri gelmesini pinler.
describe("şablon ikamesi tek kaynak", () => {
  it("@/lib/templates ikame fonksiyonu dışa AKTARMAZ (tek kaynak @/lib/template-apply)", () => {
    expect(Object.keys(templatesModule)).not.toContain("applyTemplate");
    for (const [name, value] of Object.entries(templatesModule)) {
      expect(typeof value === "function" && /apply|fill|substitut/i.test(name), name).toBe(false);
    }
  });

  it("tek geçiş: değerin İÇİNDEKİ değişken yeniden doldurulmaz; ad yoksa 'Misafir' UYDURULMAZ", () => {
    // Misafirin kontrolündeki görünen ad "{{wifiInfo}}" — wifi yer tutucusu GEÇMEYEN şablon kapı kodunu basmamalı.
    const out = applyTemplateBody("Merhaba {{guestName}}, hoş geldiniz.", { guestName: "{{wifiInfo}}", wifiInfo: "Şifre: 1234" });
    expect(out).not.toContain("1234");
    expect(applyTemplateBody("Merhaba {{guestName}},", { propertyName: "X" })).not.toContain("Misafir");
  });

  it("Opus 10-22: '_' ile başlayan iç değer (iç mülk adı) {{…}} olarak yazılmaz; {daire} numarası ondan okunur", () => {
    const vars = { guestName: "Ayşe Yılmaz", propertyName: "Kat 2 Daire 3", _apartmentSource: "Lale Daire 5" };
    expect(applyTemplateBody("Konaklayacağınız daire: {{propertyName}}.", vars)).toBe("Konaklayacağınız daire: Kat 2 Daire 3.");
    expect(applyTemplateBody("İç: {{_apartmentSource}}", vars)).not.toContain("Lale");
    expect(applyTemplateBody("Daire no: {daire}", vars)).toBe("Daire no: 5");
  });
});

describe("gelen kutusu şablon değişkenleri — iç ad misafire gitmez (Opus 10-22)", () => {
  it("sayfa {{propertyName}}'i misafire görünen adla doldurur, iç adı yalnız _apartmentSource'a koyar", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(app)/inbox/[id]/page.tsx", "utf8");
    expect(src).toMatch(/propertyName: normalizeGuestDisplayName\(conversation\.property\.guestDisplayName\) \?\? ""/);
    expect(src).toMatch(/_apartmentSource: conversation\.property\.name/);
    expect(src).not.toMatch(/propertyName: conversation\.property\.name/);
  });
});

describe("DEFAULT_TEMPLATES", () => {
  it("ships a meaningful library (15+)", () => {
    expect(DEFAULT_TEMPLATES.length).toBeGreaterThanOrEqual(15);
  });

  it("every template has the required fields and a known category", () => {
    const valid = new Set(TEMPLATE_CATEGORY.values);
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.title.length).toBeGreaterThan(1);
      expect(t.body.length).toBeGreaterThan(1);
      expect(t.isDefault).toBe(true);
      expect(valid.has(t.category)).toBe(true);
    }
  });

  it("uses only the documented placeholder tokens", () => {
    const allowed = new Set(["guestName", "checkInTime", "checkOutTime", "propertyName", "wifiInfo"]);
    for (const t of DEFAULT_TEMPLATES) {
      const tokens = [...t.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
      for (const token of tokens) {
        expect(allowed.has(token)).toBe(true);
      }
    }
  });

  it("has unique template ids", () => {
    const ids = DEFAULT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains no filler-question closings (user rule: never extend the conversation)", () => {
    const banned =
      /başka bir sorunuz|başka nasıl yardımcı|çekinmeden yazabilirsiniz|herhangi bir sorunuz olursa|feel free to reach out|anything else we can do|any other questions/i;
    for (const t of DEFAULT_TEMPLATES) {
      expect(t.body).not.toMatch(banned);
    }
  });
});
