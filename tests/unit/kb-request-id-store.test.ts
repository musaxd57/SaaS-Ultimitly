import { describe, it, expect } from "vitest";
import { createKbRequestIdStore, newKbRequestId } from "@/lib/kb/request-id";
import { kbSchema } from "@/lib/validators";

// Bilgi tabanı ekleme istek kimliği deposu (idempotency denetimi 10-15). Biçim sunucu şemasının KENDİSİYLE sınanır (Haiku 10-15: elle
// yazılmış düzenli ifade başka şemanın kuralını pinliyordu).
describe("createKbRequestIdStore", () => {
  const item = { propertyId: "p1", category: "wifi", title: "Wi-Fi", content: "Ağ adı Lale" };

  it("aynı kalem → aynı kimlik; unutulunca yeni kimlik", () => {
    const s = createKbRequestIdStore();
    const a = s.idFor(item);
    expect(s.idFor({ ...item })).toBe(a);
    s.forget(item);
    expect(s.idFor(item)).not.toBe(a);
  });

  it.each([
    ["mülk", { ...item, propertyId: "p2" }],
    ["kategori", { ...item, category: "rules" }],
    ["başlık", { ...item, title: "Wi-Fi şifresi" }],
    ["içerik", { ...item, content: "Ağ adı Lale-2" }],
    ["dil", { ...item, language: "en" }],
  ])("%s farklı → farklı kimlik", (_n, other) => {
    const s = createKbRequestIdStore();
    expect(s.idFor(other)).not.toBe(s.idFor(item));
  });

  it("alan sınırı kaymaz: ['a|b','c'] ile ['a','b|c'] aynı anahtar değildir", () => {
    const s = createKbRequestIdStore();
    const x = s.idFor({ propertyId: "p", category: "c", title: "a|b", content: "c" });
    const y = s.idFor({ propertyId: "p", category: "c", title: "a", content: "b|c" });
    expect(x).not.toBe(y);
  });

  it("başlık yok / boş aynı kalemdir; bir kalemi unutmak ötekini etkilemez", () => {
    const s = createKbRequestIdStore();
    const a = s.idFor({ propertyId: "p", category: "c", content: "x" });
    expect(s.idFor({ propertyId: "p", category: "c", title: "", content: "x" })).toBe(a);
    const b = s.idFor(item);
    s.forget({ propertyId: "p", category: "c", content: "x" });
    expect(s.idFor(item)).toBe(b);
  });

  it("biçim sunucu şemasından geçer ve tahmin edilemez", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newKbRequestId()));
    expect(ids.size).toBe(200);
    const base = { propertyId: "p1", category: "wifi", title: "Wi-Fi", content: "Ağ adı Lale" };
    for (const id of ids) expect(kbSchema.safeParse({ ...base, requestId: id }).success).toBe(true);
    // Anti-vakum: şema gerçekten kimliği denetliyor.
    expect(kbSchema.safeParse({ ...base, requestId: "kısa" }).success).toBe(false);
  });
});
