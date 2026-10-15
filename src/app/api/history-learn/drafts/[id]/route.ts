import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyLearnEnabled, reviewHistoryLearnDraft } from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — taslak onayı / reddi (anahtar KAPALI → 404). Kiracı kapsamı servis sorgusunda (taslak → mülk → işletme); başka
// işletmenin taslağı 404. Onay = A1 sözleşmesiyle ONAYLI bilgi tabanı kalemi; işaretli taslak `confirmFlags` olmadan 409.
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  invalid: "Başlık ve içerik dolu olmalı (başlık en çok 120, içerik en çok 2.000 karakter).",
  door_code: "Kapı ya da anahtar kutusu kodu bilgi tabanına eklenemez. Kodu çıkarıp yeniden deneyin.",
  hijack: "Bu metin yapay zekâya talimat veriyor gibi görünüyor. Bilgiyi düz cümleyle yazın.",
};

export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!historyLearnEnabled()) return notFound();
  const { id } = await params;
  const body = await readJsonCappedOrNull<Record<string, unknown>>(req);
  const action = body?.action;
  if (action !== "approve" && action !== "reject") return badRequest({ action: "Geçersiz işlem." });
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const r = await reviewHistoryLearnDraft({
    organizationId: session.organizationId,
    draftId: id,
    userId: auditActor(session),
    action,
    title: str(body?.title),
    content: str(body?.content),
    category: str(body?.category),
    confirmFlags: body?.confirmFlags === true,
  });
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "already_reviewed") return NextResponse.json({ error: "Bu taslak zaten işlendi." }, { status: 409 });
    if (r.reason === "needs_confirm")
      return NextResponse.json({ error: "Bu taslakta kontrol edilmesi gereken bir nokta var. Okuyup onaylayın.", needsConfirm: true }, { status: 409 });
    return badRequest({ _: MESSAGES[r.reason] ?? MESSAGES.invalid });
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: action === "approve" ? "history_learn.draft_approved" : "history_learn.draft_rejected",
    metadata: { draftId: id, kbItemId: r.kbItemId },
  });
  return jsonOk({ ok: true, kbItemId: r.kbItemId });
});
