import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

// Codex #38 pins. The sitemap must not advertise auth forms or fake freshness;
// robots must cover every private (app) route group — verified against the
// actual filesystem so a newly added app section can't silently go crawlable.

describe("sitemap", () => {
  it("does not list /login and uses FIXED lastModified dates (no new Date() per request)", () => {
    const entries = sitemap();
    expect(entries.some((e) => e.url.includes("/login"))).toBe(false);

    // Fixed constants, not request time: landing pinned to its last real
    // content change; legal pages derive from LEGAL_VERSION ("2026-06").
    const legal = entries.find((e) => e.url.endsWith("/gizlilik"));
    expect((legal?.lastModified as Date).getTime()).toBe(new Date("2026-06-01").getTime());
    for (const e of entries) {
      // A per-request timestamp would be within milliseconds of now.
      expect(Math.abs(Date.now() - (e.lastModified as Date).getTime())).toBeGreaterThan(60_000);
    }
  });
});

describe("sayfa başlıkları", () => {
  it("auth sayfaları markayı TEKRAR eklemez (kök şablon zaten ekliyor)", () => {
    // Kök metadata `template: "%s · Lixus AI"` uyguluyor. Sayfa başlığına markayı
    // bir kez daha yazmak sekmede "Giriş — Lixus AI · Lixus AI" üretiyordu.
    // Kaynak dosyadan okunur (modül import'u yan etki çalıştırır); şablonun kendisi
    // de pinli, yoksa "düzeltme" şablon değişince sessizce yanlışa döner.
    const root = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
    expect(root).toContain('template: "%s · Lixus AI"');

    const authDir = join(process.cwd(), "src", "app", "(auth)");
    const pages = readdirSync(authDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(authDir, d.name, "page.tsx"));
    expect(pages.length).toBeGreaterThan(0);
    for (const file of pages) {
      const src = readFileSync(file, "utf8");
      const title = /title:\s*"([^"]+)"/.exec(src)?.[1];
      expect(title, `${file} başlıksız`).toBeTruthy();
      expect(title, `${file} markayı tekrarlıyor`).not.toMatch(/Lixus/i);
    }
  });
});

describe("robots", () => {
  it("disallows EVERY (app) route group directory (drift-proof against the filesystem)", () => {
    const rules = robots().rules as { disallow: string[] };
    const appDirs = readdirSync(join(process.cwd(), "src", "app", "(app)"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(appDirs.length).toBeGreaterThan(5); // sanity: the group exists
    for (const dir of appDirs) {
      expect(rules.disallow, `robots.ts must disallow /${dir}`).toContain(`/${dir}`);
    }
    // The public guest QR chat (bearer-token URLs) must never be crawlable.
    expect(rules.disallow).toContain("/c/");
    expect(rules.disallow).toContain("/api/");
  });
});
