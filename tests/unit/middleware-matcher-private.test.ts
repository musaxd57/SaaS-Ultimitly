import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { config } from "@/middleware";
import { PRIVATE_APP_PREFIXES } from "@/lib/private-routes";

// ---------------------------------------------------------------------------
// Ara katman eşleyicisi (G2 11-19 T2-B7; açık iş 08-08 "ara katman noktalı yolu atlıyor"): panel önekleri altındaki NOKTALI yollar da ara
// katmandan geçer (NUL kapısı + oturum yönlendirmesi); statik dosyalar ve API yine geçmez. Eşleme Next'in KENDİ eşleyicisiyle sınanır.
// ---------------------------------------------------------------------------

const req = createRequire(import.meta.url);
const { getMiddlewareMatchers } = req("next/dist/build/analysis/get-page-static-info") as {
  getMiddlewareMatchers: (m: unknown, nextConfig: Record<string, unknown>) => { regexp: string }[];
};
const { getMiddlewareRouteMatcher } = req("next/dist/shared/lib/router/utils/middleware-route-matcher") as {
  getMiddlewareRouteMatcher: (m: { regexp: string }[]) => (pathname: string, request: unknown, query: unknown) => boolean;
};
const runs = (() => {
  const match = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  return (pathname: string) => match(pathname, {}, {});
})();

describe("ara katman eşleyicisi — panel yolları", () => {
  it("🚨 ikinci desenin önek listesi PRIVATE_APP_PREFIXES ile AYNI (yeni panel klasörü eklenince ikisi birlikte güncellenir)", () => {
    const second = String(config.matcher[1]);
    const group = /^\/\(([^)]+)\)\/:path\*$/.exec(second);
    expect(group, second).not.toBeNull();
    expect(group![1].split("|").sort()).toEqual(PRIVATE_APP_PREFIXES.map((p) => p.slice(1)).sort());
  });

  it("🚨 noktalı panel yolları ara katmandan geçer (NUL kapısı atlanamaz)", () => {
    for (const p of ["/inbox/%00.x", "/properties/%00.json", "/reservations/compare/a.b", "/tasks/x.y", "/inbox", "/inbox/abc"]) {
      expect(runs(p), p).toBe(true);
    }
  });

  it("KONTROL: statik dosyalar, Next iç yolları ve API ara katmana girmez; panel dışı noktalı yol da girmez", () => {
    for (const p of ["/favicon.ico", "/robots.txt", "/_next/static/chunks/a.js", "/api/health", "/api/inbox/x.y", "/landing/hero.png", "/c/abc.def"]) {
      expect(runs(p), p).toBe(false);
    }
  });
});
