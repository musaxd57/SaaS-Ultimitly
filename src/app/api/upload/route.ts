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

    // Determine extension from MIME type
    const extMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const ext = extMap[file.type] ?? "jpg";

    // Build safe directory path using orgId
    const orgSlug = session.organizationId.replace(/[^a-zA-Z0-9-]/g, "");
    const timestamp = Date.now();
    const random = randomHex(6);
    const filename = `${timestamp}-${random}.${ext}`;

    const uploadsDir = join(process.cwd(), "public", "uploads", orgSlug);
    await mkdir(uploadsDir, { recursive: true });

    const filePath = join(uploadsDir, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(filePath, buffer);

    const url = `/uploads/${orgSlug}/${filename}`;
    return jsonOk({ url });
  } catch {
    return serverError();
  }
}
