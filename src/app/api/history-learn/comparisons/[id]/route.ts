import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isSuperAdmin } from "@/lib/admin-core";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyCompareAllowed, historyLearnEnabled, propertyInstructionsAllowed, reviewComparison } from "@/lib/history-learn/service";
import { INSTRUCTION_REJECT_TEXT } from "@/lib/history-learn/instruction-gate";

// ---------------------------------------------------------------------------
// KARŞILAŞTIRMA KARARI (F1): iyi / düzelt / kötü + not. "Böyle yapsın" (`apply`) notu kurucu kararıyla (10-15) HEM mülk talimatı HEM bilgi
// tabanı TASLAĞI olur — taslak A1 sözleşmesiyle ev sahibinin onayını bekler, talimat kapılardan geçer. Kiracı kapsamı servis sorgusunda.
// ---------------------------------------------------------------------------

const REASONS: Record<string, string> = {
  ...INSTRUCTION_REJECT_TEXT,
  invalid: "Geçersiz karar.",
  note_required: "\"Böyle yapsın\" için bir not yazın.",
  empty: "Not boş olamaz.",
  too_long: "Not en çok 500 karakter olabilir.",
  limit: "Bu daire için talimat sınırına ulaşıldı. Eskilerden birini kaldırın.",
  stale: "Bu cevap siz bakarken yenilendi. Yeni cevabı okuyup tekrar değerlendirin.",
};

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!historyLearnEnabled() || !historyCompareAllowed(session)) return notFound();
  const { id } = await params;
  const body = await readJsonCappedOrNull<{ verdict?: unknown; note?: unknown; apply?: unknown; seenAnswer?: unknown }>(req);
  // "Böyle yapsın" serbest metin TALİMAT yazar → serbest metin yetkisi şart (Opus 10-15 HL4 F3: müşteri karşılaştırma anahtarıyla
  // hazır-seçenek-yalnız kararını aşıp görünmeyen bir talimat yazabiliyordu). Karar + not müşteriye açık kalır.
  if (body?.apply === true && !propertyInstructionsAllowed(session)) return notFound();
  const r = await reviewComparison({
    organizationId: session.organizationId,
    comparisonId: id,
    userId: auditActor(session),
    // Gönderilmeyen alan KORUNUR (yalnız karar seçmek notu silmez); null = kaldır.
    verdict: body && "verdict" in body ? (typeof body.verdict === "string" ? body.verdict : null) : undefined,
    note: body && "note" in body ? (typeof body.note === "string" ? body.note : null) : undefined,
    apply: body?.apply === true,
    // Ekranda görülen cevap; arada yenilendiyse karar yazılmaz (409).
    seenAnswer: body && "seenAnswer" in body ? (typeof body.seenAnswer === "string" ? body.seenAnswer : null) : undefined,
    byOperator: isSuperAdmin(session),
  });
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "limit" || r.reason === "stale") return NextResponse.json({ error: REASONS[r.reason] }, { status: 409 });
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
