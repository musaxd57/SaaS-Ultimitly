import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { badRequest, jsonOk, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { withAuth } from "@/lib/route-guard";
import { sniffImageExt } from "@/lib/image-validation";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

function randomHex(n: number): string {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const POST = withAuth(async (session, req) => {
  // Per-user throttle: uploads write to disk; staff keep access (task photos are
  // their core flow) but a stuck client / abuse can't fill the volume.
  const limited = rateLimit(`upload:${session.userId}`, 30, 60 * 60 * 1000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

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
});
