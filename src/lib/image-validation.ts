/**
 * Authoritative image-type check: inspect the real leading bytes rather than
 * trusting a client-supplied Content-Type (which is trivially forged). Returns
 * the canonical extension, or null if the bytes are not a JPEG/PNG/WebP. Callers
 * derive the stored file's extension from THIS, so attacker bytes can't be saved
 * under an image name in a public web root.
 */
export function sniffImageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  )
    return "png";
  // WebP: "RIFF"...."WEBP"
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return null;
}
