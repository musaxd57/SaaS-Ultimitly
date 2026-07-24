import { describe, it, expect } from "vitest";
import { sniffImageExt } from "@/lib/image-validation";

// The upload route trusts THIS (real magic bytes), not the client Content-Type,
// to decide an upload is a genuine image and what extension to store it under.
describe("sniffImageExt", () => {
  it("accepts a real JPEG signature (FF D8 FF)", () => {
    expect(sniffImageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe("jpg");
  });

  it("accepts a real PNG signature (89 50 4E 47 0D 0A 1A 0A)", () => {
    expect(
      sniffImageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe("png");
  });

  it("accepts a real WebP signature (RIFF....WEBP)", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // file size field
      Buffer.from("WEBP", "ascii"),
    ]);
    expect(sniffImageExt(webp)).toBe("webp");
  });

  it("rejects forged content (image MIME but non-image bytes)", () => {
    // e.g. an HTML/script payload renamed to .jpg — the bytes betray it.
    expect(sniffImageExt(Buffer.from("<html><script>alert(1)</script>", "utf8"))).toBeNull();
    expect(sniffImageExt(Buffer.from("GIF89a", "ascii"))).toBeNull(); // GIF not allowed
  });

  it("rejects a too-short buffer", () => {
    expect(sniffImageExt(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageExt(Buffer.alloc(0))).toBeNull();
  });

  it("rejects a RIFF container that is not WEBP (e.g. WAV audio)", () => {
    const wav = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from("WAVE", "ascii"),
    ]);
    expect(sniffImageExt(wav)).toBeNull();
  });
});
