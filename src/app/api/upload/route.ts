import { type NextRequest } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function randomHex(n: number): string {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Authoritative image-type check: inspect the real leading bytes rather than
 * trusting the client-supplied Content-Type (which is trivially forged). Returns
 * the canonical extension, or null if the bytes are not a JPEG/PNG/WebP. The
 * stored file's extension is derived from THIS, so attacker bytes can't be saved
 * under an image name in the public web root.
 */
function sniffImageExt(buf: Buffer): "jpg" | "png" | "webp" | null {
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

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) return badRequest({ file: "Dosya gerekli" });

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return badRequest({ file: "Yalnızca JPG, PNG veya WebP dosyaları yüklenebilir" });
    }

    // Validate size
    if (file.size > MAX_SIZE_BYTES) {
      return badRequest({ file: "Dosya boyutu 5 MB'ı aşamaz" });
    }

    // Authoritative check: sniff the REAL bytes (not the spoofable MIME) and
    // derive the extension from them. Reject anything that isn't a real image.
    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = sniffImageExt(buffer);
    if (!ext) {
      return badRequest({ file: "Geçerli bir görsel değil (yalnızca JPG, PNG veya WebP)" });
    }

    // Build safe directory path using orgId
    const orgSlug = session.organizationId.replace(/[^a-zA-Z0-9-]/g, "");
    const timestamp = Date.now();
    const random = randomHex(6);
    const filename = `${timestamp}-${random}.${ext}`;

    const uploadsDir = join(process.cwd(), "public", "uploads", orgSlug);
    await mkdir(uploadsDir, { recursive: true });

    const filePath = join(uploadsDir, filename);
    await writeFile(filePath, buffer);

    const url = `/uploads/${orgSlug}/${filename}`;
    return jsonOk({ url });
  } catch {
    return serverError();
  }
}
