import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import OpengraphImage, { alt, size, contentType } from "@/app/opengraph-image";
import TwitterImage, {
  alt as twAlt,
  size as twSize,
  contentType as twContentType,
} from "@/app/twitter-image";

// Codex #39 — the social-share card must be a REAL 1200x630 asset. These pins
// render the actual route module (same code `next build` prerenders) and check
// the emitted PNG header, so a broken font path / satori regression fails CI
// instead of shipping a blank card.

describe("opengraph-image (Codex #39)", () => {
  it("declares the standard OG size and PNG content type", () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe("image/png");
    expect(alt).toContain("Lixus AI");
  });

  it("renders a real 1200x630 PNG (fonts load, satori succeeds)", async () => {
    const res = await OpengraphImage();
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG signature \x89PNG …
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // IHDR width/height (big-endian at offsets 16/20)
    expect(buf.readUInt32BE(16)).toBe(1200);
    expect(buf.readUInt32BE(20)).toBe(630);
    expect(buf.length).toBeGreaterThan(20_000); // a designed card, not a near-empty fill
  }, 30_000);

  it("twitter-image is the SAME card (re-export), so twitter:image is explicit", async () => {
    expect(TwitterImage).toBe(OpengraphImage);
    expect(twAlt).toBe(alt);
    expect(twSize).toEqual(size);
    expect(twContentType).toBe(contentType);
  });

  it("the Inter font files + OFL license are committed (build-time dependency)", () => {
    const dir = join(process.cwd(), "assets", "og");
    for (const f of ["Inter-Regular.woff", "Inter-SemiBold.woff", "LICENSE-Inter.txt"]) {
      expect(existsSync(join(dir, f)), `${f} missing`).toBe(true);
    }
    // WOFF magic "wOFF" — satori supports woff (NOT woff2)
    expect(readFileSync(join(dir, "Inter-Regular.woff")).subarray(0, 4).toString()).toBe("wOFF");
  });

  it("layout.tsx declares twitter card summary_large_image (asset now exists)", () => {
    // fs-source pin (robots-test style): importing layout would drag in
    // next/font + CSS, so assert on the source text instead.
    const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf-8");
    expect(layout).toContain('card: "summary_large_image"');
    expect(layout).not.toContain('card: "summary",');
  });
});
