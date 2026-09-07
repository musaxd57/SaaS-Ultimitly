import { prisma } from "@/lib/db";
import { conversationUpdateSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { ERASABLE_STATUSES } from "@/lib/outbox/state";

// Guest conversations are owner/manager-only (staff must not read guest messages or
// re-triage threads): both PATCH (status/priority) and DELETE are withManage.
export const PATCH = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const existing = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!existing) return notFound();

  const data = await readJsonCappedOrNull(req);
  const parsed = conversationUpdateSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));

  const conversation = await prisma.conversation.update({
    where: { id },
    data: parsed.data,
  });
  return jsonOk(conversation);
});

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const existing = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true },
  });
  if (!existing) return notFound();

  // Remove the messages first, then the conversation (no DB-level cascade).
  await prisma.$transaction([
    // 🚨 KUYRUK AYNI TX'TE İPTAL (Codex F03, P1). MessageOutbox konuşmaya FK ile
    // bağlı DEĞİL (kendi hedef/gövde snapshot'ını taşır) → cascade yok. Eskiden
    // silinen konuşmanın bekleyen satırı worker'da "Message yok = manuel, geçsin"
    // dalına düşüp sağlayıcıya GİDİYORDU. Kapsam KVKK süpürgeleriyle AYNI TEK
    // KAYNAK (`ERASABLE_STATUSES`: teslim EDİLMEMİŞ ve pending'e dönüş yolu olan
    // her durum) + `claimedBy: null` — CLAIM ALINMIŞ satıra dokunulmaz: claim'i
    // ezmek worker'ın settle'ını bozar ve satır "canceled" görünürken mesaj
    // gitmiş olurdu. O pencereyi worker'ın kendi varlık vetosu kapatır (POST'tan
    // hemen önce); veto→POST arası ms'lik kalıntı belgeli sınırdır.
    prisma.messageOutbox.updateMany({
      where: {
        organizationId: session.organizationId,
        conversationId: id,
        status: { in: [...ERASABLE_STATUSES] },
        claimedBy: null,
      },
      data: { status: "canceled", lastErrorKind: "canceled", lastErrorCode: "conversation_deleted" },
    }),
    prisma.message.deleteMany({ where: { conversationId: id } }),
    prisma.conversation.delete({ where: { id } }),
  ]);
  return jsonOk({ deleted: true });
});
