import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, badRequest, forbidden } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { auditActor, writeAuditInTx } from "@/lib/audit";
import { isImpersonating } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { listAiGenerations, parseAiQualityQuery } from "@/lib/ai-quality/console";
import { aiQualityCrossSite, recordAiQualityDenied } from "@/lib/ai-quality/gate";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Kurucu kalite konsolu — ÜRETİM İZİ OKUMA (salt-okuma). Sözleşme `src/lib/ai-quality/console.ts`.
// Yalnız 2FA'lı operatör, kendi hesabından, amaçla; görüntüleme kaydı YAZILAMAZSA veri DÖNMEZ.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) await recordAiQualityDenied(session, "not_operator", "view");
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) {
    await recordAiQualityDenied(session, "impersonating", "view");
    return forbidden("Kalite konsolu operatörün kendi hesabından açılır — önce destek görünümünden çıkın.");
  }
  if (aiQualityCrossSite(req.headers.get("sec-fetch-site"))) {
    await recordAiQualityDenied(session, "cross_site", "view");
    return forbidden("Kalite konsolu yalnız operatör panelinden açılır.");
  }

  const parsed = parseAiQualityQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return badRequest(parsed.errors);
  const { orgId, purpose, ticket, decision, before } = parsed;

  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true } });
  if (!org) return badRequest({ orgId: "İşletme bulunamadı." });

  const page = await listAiGenerations(orgId, { decision, before });
  if (page.invalidCursor) return badRequest({ before: "Sayfa imleci bu işletmede yok; listeyi baştan yükleyin." });

  // ZORUNLU kayıt VERİ DÖNMEDEN ÖNCE: yazılamazsa (veritabanı arızası) hiçbir iz gösterilmez.
  try {
    await writeAuditInTx(prisma, {
      organizationId: orgId,
      actorUserId: auditActor(session),
      action: "ai_quality.view",
      // Görüntülenen KONUŞMALAR da kayıtlı (kurucu talimatı: "every conversation view … audited with … conversation") — yalnız opak
      // kimlik (denetim kaydı müşterinin KVKK dökümüne girer; metin / ad YOK).
      metadata: {
        purpose,
        ...(ticket ? { ticket } : {}),
        count: page.rows.length,
        ...(decision ? { decision } : {}),
        conversationIds: [...new Set(page.rows.map((r) => r.conversationId))],
      },
    });
  } catch (err) {
    void reportError("admin.ai-quality-audit", err);
    return NextResponse.json({ ok: false, error: "Kayıt yazılamadı; izler gösterilmedi. Biraz sonra yeniden deneyin." }, { status: 503 });
  }

  return NextResponse.json(
    { organization: org, generations: page.rows, nextBefore: page.nextBefore },
    { headers: { "Cache-Control": "no-store" } },
  );
}
