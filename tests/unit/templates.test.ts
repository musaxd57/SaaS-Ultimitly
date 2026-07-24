import { describe, it, expect } from "vitest";
import { applyTemplate, DEFAULT_TEMPLATES, type MessageTemplate } from "@/lib/templates";
import { TEMPLATE_CATEGORY } from "@/lib/constants";

const base: MessageTemplate = {
  id: "t1",
  category: "checkin",
  title: "Test",
  language: "tr",
  isDefault: true,
  body: "Merhaba {{guestName}}, {{propertyName}} için giriş saati {{checkInTime}}, çıkış {{checkOutTime}}. {{wifiInfo}}",
};

describe("applyTemplate", () => {
  it("substitutes every supported placeholder", () => {
    const out = applyTemplate(base, {
      guestName: "Ayşe",
      propertyName: "Galata Loft",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      wifiInfo: "Ağ: Loft / Şifre: 1234",
    });
    expect(out).toContain("Ayşe");
    expect(out).toContain("Galata Loft");
    expect(out).toContain("15:00");
    expect(out).toContain("11:00");
    expect(out).toContain("Şifre: 1234");
    expect(out).not.toContain("{{");
  });

  it("falls back to 'Misafir' when guestName is missing", () => {
    const out = applyTemplate(base, { propertyName: "X", checkInTime: "14:00", checkOutTime: "10:00" });
    expect(out).toContain("Misafir");
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
