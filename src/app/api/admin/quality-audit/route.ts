import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  requireSession,
  unauthorized,
  badRequest,
  jsonOk,
  serverError,
  parseJsonBody,
  payloadTooLarge,
} from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { writeAudit } from "@/lib/audit";
import { QualityAuditError, qualityAuditConfigured, runQualityAudit } from "@/lib/quality-audit";

// ---------------------------------------------------------------------------
// Operatör paneli: Claude kalite ÜST-DENETÇİSİNİ isteğe bağlı çalıştır.
// SUPER-ADMIN ONLY + SALT-OKUMA: gönderilmiş AI yanıtlarını (redakte edilmiş)
// Claude'a değerlendirtir ve raporu DÖNDÜRÜR — hiçbir mesaj/ayar/prompt yazılmaz.
// ANTHROPIC_API_KEY yoksa net bir 400 ile pasif kalır (boot etkilenmez).
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) return unauthorized();

  try {
    if (!qualityAuditConfigured()) {
      return badRequest({
        apiKey: "ANTHROPIC_API_KEY tanımlı değil — Claude denetçisi yapılandırılmamış.",
      });
    }

    // ⚠️ GÖVDE AYRIŞTIRILAMAZSA SESSİZCE VARSAYILANA DÜŞÜLMEZ (denetim, 08-05).
    // Eskiden `?? {}` vardı ve `organizationId` `PRIMARY_ORG_ID`'ye düşüyordu:
    // yanlış `Content-Type` gönderen bir istemci (ya da bozuk JSON), operatörün
    // SEÇTİĞİ işletme yerine BAŞKA bir kiracının misafir mesajlarını okutur,
    // Anthropic bütçesini harcar ve denetim kaydını yanlış org'a yazardı —
    // sessiz bir çapraz-kiracı okuma. Gövde varsa ve ayrıştırılamıyorsa artık
    // GÜRÜLTÜLÜ 400 dönüyor.
    // `PRIMARY_ORG_ID` yedeği KALIYOR: gövde AYRIŞTI ama `organizationId`
    // taşımıyorsa (operatörün `{}` göndermesi) eski kolaylık korunur.
    const parsed = await parseJsonBody<Record<string, unknown>>(req);
    if (!parsed.ok) {
      return parsed.tooLarge
        ? payloadTooLarge()
        : badRequest({ organizationId: "İstek gövdesi okunamadı (JSON bekleniyor)." });
    }
    const data = parsed.data ?? {};
    const organizationId =
      (typeof data?.organizationId === "string" && data.organizationId.trim()) ||
      process.env.PRIMARY_ORG_ID ||
      "";
    if (!organizationId) return badRequest({ organizationId: "Denetlenecek işletme seçilmedi." });

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    if (!org) return badRequest({ organizationId: "İşletme bulunamadı." });

    const days = typeof data?.days === "number" ? data.days : undefined;
    const result = await runQualityAudit(org.id, { days });

    await writeAudit({
      organizationId: org.id,
      actorUserId: session.actorUserId ?? session.userId,
      action: "admin.quality_audit",
      metadata: {
        sampleSize: result.sampleSize,
        days: result.days,
        model: result.model,
        findings: result.findings.length,
      },
    });

    return jsonOk({ ...result, organizationName: org.name });
  } catch (err) {
    if (err instanceof QualityAuditError) {
      if (err.code === "not_configured") return badRequest({ apiKey: err.message });
      // API/parse hatası = upstream sorunu; operatöre dürüst 502 metni.
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return serverError(undefined, err);
  }
}
