import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyLearnEnabled, reviewHistoryLearnDraft } from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — taslak onayı / reddi (anahtar KAPALI → 404). Kiracı kapsamı servis sorgusunda (taslak → mülk → işletme); başka
// işletmenin taslağı 404. Onay = A1 sözleşmesiyle ONAYLI bilgi tabanı kalemi; işaretli taslak `confirmFlags` olmadan 409.
// L2 (kurucu 10-17): bilgi tabanında aynı konuda etkin kalem varsa `resolution` ("replace" + `replaceKbItemId` / "separate") olmadan 409
// `needsResolution` + eşleşmeler; yer değiştirme sırasında eski kalem değiştiyse 409 `kbChanged` (hiçbir şey yazılmaz).
// ---------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  invalid: "Başlık ve içerik dolu olmalı (başlık en çok 120, içerik en çok 2.000 karakter).",
  door_code: "Kapı ya da anahtar kutusu kodu bilgi tabanına eklenemez. Kodu çıkarıp yeniden deneyin.",
  hijack: "Bu metin yapay zekâya talimat veriyor gibi görünüyor. Bilgiyi düz cümleyle yazın.",
  plan_items: "Planınızın izin verdiği bilgi tabanı sınırına ulaştınız. Kullanmadığınız kayıtları pasife alın ya da planınızı yükseltin.",
  plan_chars: "Bu bilgi planınızın izin verdiğinden uzun. Metni kısaltın ya da ikiye bölün.",
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
    resolution: body?.resolution === "replace" || body?.resolution === "separate" ? body.resolution : undefined,
    replaceKbItemId: str(body?.replaceKbItemId),
    replaceKbItemUpdatedAt: str(body?.replaceKbItemUpdatedAt),
  });
  const resolution = body?.resolution === "replace" || body?.resolution === "separate" ? body.resolution : null;
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "already_reviewed") return NextResponse.json({ error: "Bu taslak zaten işlendi." }, { status: 409 });
    if (r.reason === "needs_confirm")
      return NextResponse.json(
        { error: "Bu taslakta kontrol edilmesi gereken bir nokta var. Okuyup onaylayın.", needsConfirm: true, flags: r.flags, conflict: r.conflict },
        { status: 409 },
      );
    if (r.reason === "needs_resolution" || r.reason === "kb_changed")
      return NextResponse.json(
        {
          error:
            r.reason === "kb_changed"
              ? "Seçtiğiniz kayıt siz bakarken değişti. Güncel hâlini aşağıda görüyorsunuz; yeniden seçin."
              : "Bilgi tabanınızda bu konuda bir kayıt var. Eskisinin yerine mi koyalım, ayrı mı ekleyelim?",
          needsResolution: true,
          ...(r.reason === "kb_changed" ? { kbChanged: true } : {}),
          matches: r.matches.map((m) => ({ id: m.id, title: m.title, preview: m.preview, kind: m.kind, updatedAt: m.updatedAt.toISOString() })),
        },
        { status: 409 },
      );
    return badRequest({ _: MESSAGES[r.reason] ?? MESSAGES.invalid });
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: action === "approve" ? "history_learn.draft_approved" : "history_learn.draft_rejected",
    // Seçim izi (L2): yalnız kimlikler + seçim — metin / değer TAŞIMAZ.
    metadata: {
      draftId: id,
      kbItemId: r.kbItemId,
      ...(action === "approve" && resolution ? { resolution, replacedKbItemId: r.replacedKbItemId ?? null } : {}),
    },
  });
  return jsonOk({ ok: true, kbItemId: r.kbItemId, replacedKbItemId: r.replacedKbItemId ?? null });
});
