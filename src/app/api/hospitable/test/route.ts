import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/api";
import { isHospitableConfigured, listProperties, HospitableError } from "@/lib/hospitable";

// ---------------------------------------------------------------------------
// Hospitable connection test
//
// GET → verifies the configured Personal Access Token by listing the
// properties it can access. Returns 200 with { ok: false, ... } for expected
// failures (missing token, bad token) so the UI can render a friendly message
// instead of treating it as an HTTP error.
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await requireSession();
  if (!session) return unauthorized();

  if (!isHospitableConfigured()) {
    return NextResponse.json({
      ok: false,
      configured: false,
      error: "HOSPITABLE_API_TOKEN .env dosyasında tanımlı değil.",
    });
  }

  try {
    const properties = await listProperties();
    return NextResponse.json({
      ok: true,
      configured: true,
      count: properties.length,
      properties: properties.slice(0, 10).map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err) {
    const message =
      err instanceof HospitableError ? err.message : "Bilinmeyen bir hata oluştu.";
    const status = err instanceof HospitableError ? err.status : undefined;
    return NextResponse.json({ ok: false, configured: true, error: message, status });
  }
}
