import { forbidden, jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { deleteInternalNote } from "@/lib/internal-notes/service";

// ---------------------------------------------------------------------------
// İÇ NOT — sil. Yazan kişi ya da sahip (Y1-d önerisi); yönetici başkasının notunu silemez (403). Başka işletmenin notu 404 (varlık
// sızdırılmaz). Düzeltme ucu YOK (yeni not yazılır). Bürünme yazamaz (`withAuth`).
// ---------------------------------------------------------------------------

export const DELETE = withManage<{ id: string }>(async (session, _req, { params }) => {
  const { id } = await params;
  const result = await deleteInternalNote({
    organizationId: session.organizationId,
    viewer: { userId: session.userId, role: session.role },
    noteId: id,
  });
  if (result.kind === "not_found") return notFound();
  if (result.kind === "forbidden") return forbidden();
  return jsonOk({ ok: true });
});
