import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
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
