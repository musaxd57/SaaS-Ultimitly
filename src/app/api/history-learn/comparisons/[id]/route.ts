import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyLearnEnabled, reviewComparison } from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// KARŞILAŞTIRMA KARARI (F1): iyi / düzelt / kötü + not. "Böyle yapsın" (`apply`) notu kurucu kararıyla (10-15) HEM mülk talimatı HEM bilgi
// tabanı TASLAĞI olur — taslak A1 sözleşmesiyle ev sahibinin onayını bekler, talimat kapılardan geçer. Kiracı kapsamı servis sorgusunda.
// ---------------------------------------------------------------------------

const REASONS: Record<string, string> = {
  invalid: "Geçersiz karar.",
  note_required: "\"Böyle yapsın\" için bir not yazın.",
  empty: "Not boş olamaz.",
  too_long: "Not en çok 500 karakter olabilir.",
  door_code: "Kapı ya da anahtar kutusu kodu nota yazılamaz.",
  hijack: "Bu not yapay zekânın kurallarını değiştirmeye çalışıyor gibi görünüyor. Misafire nasıl davranılmasını istediğinizi düz cümleyle yazın.",
  payment: "Ödeme yöntemi ya da ödeme yeri nota yazılamaz.",
  limit: "Bu daire için talimat sınırına ulaşıldı. Eskilerden birini kaldırın.",
};

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!historyLearnEnabled()) return notFound();
  const { id } = await params;
  const body = await readJsonCappedOrNull<{ verdict?: unknown; note?: unknown; apply?: unknown }>(req);
  const r = await reviewComparison({
    organizationId: session.organizationId,
    comparisonId: id,
    userId: auditActor(session),
    verdict: typeof body?.verdict === "string" ? body.verdict : null,
    note: typeof body?.note === "string" ? body.note : null,
    apply: body?.apply === true,
  });
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "limit") return NextResponse.json({ error: REASONS.limit }, { status: 409 });
    return badRequest({ _: REASONS[r.reason] ?? REASONS.invalid });
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "history_learn.comparison_reviewed",
    metadata: { comparisonId: id, instructionId: r.instructionId, draftId: r.draftId },
  });
  return jsonOk({ ok: true, instructionId: r.instructionId, draftId: r.draftId });
});
