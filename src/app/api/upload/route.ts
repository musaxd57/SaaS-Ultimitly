import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, forbidden, serverError, canManage, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { withAuth } from "@/lib/route-guard";
import { sniffImageExt } from "@/lib/image-validation";
import { storageUploadsEnabled } from "@/lib/storage/config";
import { getStorageAdapter } from "@/lib/storage/adapter";
import { buildTaskPhotoKey, photoUrlForKey } from "@/lib/storage/keys";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const CONTENT_TYPE_BY_EXT = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

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

  // PRIVATE OBJECT STORAGE (flag ON — DEFAULT OFF). Unlike the legacy path the
  // upload is BOUND to a task: the object key embeds (org, task), so ownership
  // is proven before a single byte reaches the provider — same task rules as
  // the PATCH route (org-scoped; staff only their assigned task). The stored
  // photoUrl is a same-origin serve path (/api/storage/photo/<key>), so it
  // passes the existing taskUpdateSchema validator and renders unchanged; the
  // serve route resolves it to a SHORT-LIVED signed URL — never a public one.
  if (storageUploadsEnabled()) {
    const taskId = formData.get("taskId");
    if (typeof taskId !== "string" || taskId.length === 0) {
      return badRequest({ file: "Görev kimliği gerekli (fotoğraf bir göreve bağlanır)." });
    }
    const task = await prisma.task.findFirst({
      where: { id: taskId, property: { organizationId: session.organizationId } },
      select: { id: true, assignedToId: true },
    });
    if (!task) return notFound();
    if (!canManage(session) && task.assignedToId !== session.userId) {
      return forbidden("Bu görev size atanmamış.");
    }
    const adapter = getStorageAdapter();
    // uploadsEnabled implies configured — this is a belt-and-braces fail-closed.
    if (!adapter) return serverError(undefined, new Error("storage: adapter unavailable"));
    const key = buildTaskPhotoKey(session.organizationId, task.id, ext);
    await adapter.put(key, buffer, CONTENT_TYPE_BY_EXT[ext]);
    return jsonOk({ url: photoUrlForKey(key) });
  }

  // LEGACY LOCAL-DISK PATH (flag OFF) — byte-identical to the pre-storage
  // behavior. Existing /uploads files are never migrated or deleted; see
  // DEPLOYMENT.md for the fallback strategy.
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
