import "server-only";

import { loadAvailabilityInputs } from "@/modules/availability/load";
import { parseNightKey } from "@/modules/availability/core";
import { AVAILABILITY_TOOL, AVAILABILITY_TOOL_VERSION, availabilityToolResult, type AvailabilityToolValue } from "./availability-tool";
import type { VerifiedToolResult } from "./contract";

// ---------------------------------------------------------------------------
// MÜSAİTLİK ARACI — veritabanı bacağı. Kiracı sınırı yükleyicide (`organizationId` ile başlar; başka org'un mülkü
// haritada YOKTUR → `not_found`). Asla fırlatmaz: yükleme hatası `error` döner ("müsait" ya da "dolu" değil).
// ---------------------------------------------------------------------------

export async function runAvailabilityTool(
  organizationId: string,
  request: { propertyId: string; from: string; to: string },
  now: Date = new Date(),
): Promise<VerifiedToolResult<AvailabilityToolValue>> {
  const errorResult = (reason: string): VerifiedToolResult<AvailabilityToolValue> => ({
    tool: AVAILABILITY_TOOL,
    toolVersion: AVAILABILITY_TOOL_VERSION,
    status: "error",
    asOf: now.toISOString(),
    scope: { organizationId, propertyId: request.propertyId },
    value: null,
    reasons: [reason],
  });
  const from = parseNightKey(request.from);
  const to = parseNightKey(request.to);
  if (!from || !to) {
    return { ...errorResult("bad_date"), status: "invalid_request" };
  }
  // Ucuz aralık kontrolü veritabanından ÖNCE (inceleme 10-09 P3); ayrıntılı doğrulama motorda (geçmiş / ufuk / gece tavanı).
  if (from >= to) return { ...errorResult("from_not_before_to"), status: "invalid_request" };
  try {
    const loaded = await loadAvailabilityInputs(organizationId, { propertyIds: [request.propertyId], range: { from, to }, now });
    if (!loaded) return availabilityToolResult(organizationId, request.propertyId, { kind: "property_not_found" }, request, now);
    const input = loaded.inputs.get(request.propertyId);
    if (!input) return availabilityToolResult(organizationId, request.propertyId, { kind: "property_not_found" }, request, now);
    return availabilityToolResult(organizationId, request.propertyId, { kind: "loaded", input }, request, now);
  } catch {
    return errorResult("load_failed");
  }
}
