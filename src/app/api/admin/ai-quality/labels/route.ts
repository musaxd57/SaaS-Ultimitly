import { type NextRequest, NextResponse } from "next/server";
import { requireSession, unauthorized, badRequest, forbidden, parseJsonBody, payloadTooLarge, notFound } from "@/lib/api";
import { isSuperAdmin } from "@/lib/admin";
import { auditActor, writeAuditInTx } from "@/lib/audit";
import { isImpersonating } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db";
import { reportError } from "@/lib/report-error";
import { createAiReviewLabel, parseAiReviewLabelBody } from "@/lib/ai-quality/console";
import { aiQualityCrossSite, recordAiQualityDenied } from "@/lib/ai-quality/gate";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Kurucu kalite konsolu — ETİKET YAZMA (tek yazma ucu). Yalnız `AiReviewLabel` satırı oluşturur; mesaj, konuşma, rezervasyon,
// gönderim ya da ayar DEĞİŞMEZ. İz satırı istekteki org'a ait olmalı (gövdeye başka kiracının iz kimliğini yazmak 404).
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();
  if (!isSuperAdmin(session)) await recordAiQualityDenied(session, "not_operator", "label");
  if (!isSuperAdmin(session)) return unauthorized();
  if (isImpersonating(session)) {
    await recordAiQualityDenied(session, "impersonating", "label");
    return forbidden("Kalite konsolu operatörün kendi hesabından açılır — önce destek görünümünden çıkın.");
  }
  if (aiQualityCrossSite(req.headers.get("sec-fetch-site"))) {
    await recordAiQualityDenied(session, "cross_site", "label");
    return forbidden("Kalite konsolu yalnız operatör panelinden açılır.");
  }

  const body = await parseJsonBody<unknown>(req);
  if (!body.ok) return body.tooLarge ? payloadTooLarge() : badRequest({ body: "İstek gövdesi okunamadı (JSON bekleniyor)." });
  const parsed = parseAiReviewLabelBody(body.data);
  if (!parsed.ok) return badRequest(parsed.errors);
  const { orgId, generationId, label, note, purpose, ticket } = parsed;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const row = await createAiReviewLabel({ orgId, generationId, label, note, reviewerUserId: session.userId }, tx);
      if (!row) return null;
      // Not METNİ kayda girmez (kişisel veri taşıyabilir; kayıt müşterinin ihracına girer) — yalnız etiket kodu ve notun varlığı.
      await writeAuditInTx(tx, {
        organizationId: orgId,
        actorUserId: auditActor(session),
        action: "ai_quality.label",
        metadata: { purpose, ...(ticket ? { ticket } : {}), generationId, label, hasNote: note !== null },
      });
      return row;
    });
    if (!created) return notFound("İz bulunamadı.");
    return NextResponse.json({ label: created }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    void reportError("admin.ai-quality-label", err);
    return NextResponse.json({ ok: false, error: "Etiket kaydedilemedi. Biraz sonra yeniden deneyin." }, { status: 503 });
  }
}
