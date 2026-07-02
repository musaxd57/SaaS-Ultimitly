import { prisma } from "@/lib/db";
import { badRequest, jsonOk } from "@/lib/api";
import { withManage } from "@/lib/route-guard";

// Apply one check-in / check-out time to ALL of the org's properties at once.
// Useful when every apartment shares the same hours (and fixes the AI quoting a
// stale default time).
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/; // H:MM or HH:MM, 00:00–23:59

export const POST = withManage(async (session, req) => {
  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return badRequest({ _: "Geçerli bir gövde gerekli." });
  }

  const update: { checkInTime?: string; checkOutTime?: string } = {};
  const errors: Record<string, string> = {};

  for (const field of ["checkInTime", "checkOutTime"] as const) {
    if (field in data) {
      const v = String(data[field] ?? "").trim();
      if (!TIME_RE.test(v)) errors[field] = "Saat SS:DD biçiminde olmalı (örn. 14:00).";
      else update[field] = v;
    }
  }

  if (Object.keys(errors).length > 0) return badRequest(errors);
  if (Object.keys(update).length === 0) {
    return badRequest({ _: "En az bir saat alanı gerekli." });
  }

  const result = await prisma.property.updateMany({
    where: { organizationId: session.organizationId },
    data: update,
  });

  return jsonOk({ ok: true, updated: result.count, ...update });
});
