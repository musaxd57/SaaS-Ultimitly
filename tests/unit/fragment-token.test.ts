import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fragmentToken } from "@/lib/fragment-token";

// Claude 2. dalga arayüz #7 / #21 (10-21): bozuk yüzde kodlamalı e-posta bağlantısı sayfayı sonsuz "okunuyor"da bırakıyordu.
describe("fragmentToken — e-posta bağlantısı parça anahtarı", () => {
  it("geçerli anahtar çözülür", () => {
    expect(fragmentToken("#t=abc.DEF_12-~")).toBe("abc.DEF_12-~");
    expect(fragmentToken("#x=1&t=a%2Eb")).toBe("a.b");
  });
  it.each(["#t=%", "#t=%E0%A4%A", "#t=abc%G1"])("bozuk yüzde kodlaması fırlatmaz, 'yok' sayılır: %s", (h) => {
    expect(fragmentToken(h)).toBeNull();
  });
  it("anahtarsız parça → yok", () => {
    expect(fragmentToken("")).toBeNull();
    expect(fragmentToken("#token=abc")).toBeNull();
  });
  it("iki form da ortak okuyucuyu kullanır (çıplak decodeURIComponent kalmadı)", () => {
    for (const f of ["src/components/auth/verify-email-form.tsx", "src/components/auth/alert-email-verify-form.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src).toContain("fragmentToken(window.location.hash)");
      expect(src).not.toContain("decodeURIComponent(");
    }
  });
});

// Arayüz P1-b: sunucu kilidi kalkınca "Ödemeniz işleniyor" kartı da açılır (durum yalnız ilk değerle kuruluyordu).
describe("ödeme kartı — sunucu kilidi durumu izlenir", () => {
  it("checkoutPending false olunca yerel işleniyor durumu kapanır", () => {
    const src = readFileSync(join(process.cwd(), "src/components/settings/paddle-plans.tsx"), "utf8");
    expect(src).toMatch(/useEffect\(\(\) => \{\s*if \(!checkoutPending\) setProcessing\(false\);\s*\}, \[checkoutPending\]\);/);
  });
});
