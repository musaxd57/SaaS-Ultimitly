// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import KosullarPage from "@/app/(legal)/kosullar/page";
import GizlilikPage from "@/app/(legal)/gizlilik/page";
import MesafeliSatisPage from "@/app/(legal)/mesafeli-satis/page";
import OnBilgilendirmePage from "@/app/(legal)/on-bilgilendirme/page";
import GuvenlikPage from "@/app/(legal)/guvenlik/page";

// Kurucu 11-13 ("en yasal şekilde"): Mesafeli Sözleşmeler Yönetmeliği md. 6/1 ön bilgilerin "en az on iki punto" ile verilmesini ister.
// Ekranda temkinli karşılık 16 piksel (= 12 pt); eskiden gövde 14 piksel (`text-sm` ≈ 10,5 pt) idi. Bütün yasal sayfalar aynı boyda.
afterEach(() => cleanup());

describe("Yasal sayfalar — gövde metni en az 16 piksel", () => {
  it.each([
    ["kullanım koşulları", KosullarPage],
    ["gizlilik", GizlilikPage],
    ["mesafeli satış", MesafeliSatisPage],
    ["ön bilgilendirme", OnBilgilendirmePage],
    ["güvenlik", GuvenlikPage],
  ])("%s: bölüm paragrafları ve maddeleri text-base; küçük yazı yok", (_n, Page) => {
    const { container } = render(<Page />);
    const blocks = Array.from(container.querySelectorAll("section p, section ul"));
    expect(blocks.length).toBeGreaterThan(3);
    for (const el of blocks) {
      expect(el.className, el.textContent?.slice(0, 40)).toContain("text-base");
      expect(el.className).not.toMatch(/\btext-(xs|sm)\b/);
    }
  });
});
