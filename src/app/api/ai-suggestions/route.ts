import { NextResponse } from "next/server";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { auditActor } from "@/lib/audit";
import { aiActionSuggestionsEnabled } from "@/lib/ai-suggestions/load";
import { decideSuggestion } from "@/lib/ai-suggestions/act";

// ---------------------------------------------------------------------------
// Yapay zekâ eylem önerisine karar (⑤ ilk dilim, kurucu 10-12: "öner + tek tıkla onay"; onay "sahip + yönetici"). Gövde: anahtar +
// karar (+ söz önerisinde gün / saat düzenlemesi). Öneri sunucuda veriden yeniden üretilir (istemcinin içeriğine güvenilmez); kiracı
// dışı / karar verilmiş / artık geçerli olmayan öneri → 409. Destek görünümünde (bürünme) yazma kapalı (rota bekçisi, K8).
// Anahtar `AI_ACTION_SUGGESTIONS_ENABLED` kapalıyken 404.
// ---------------------------------------------------------------------------

export const POST = withManage(async (session, req) => {
  if (!aiActionSuggestionsEnabled()) return notFound();
  const limited = await rateLimit(`ai-suggestion:${session.organizationId}`, 120, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const body = (await readJsonCappedOrNull(req)) as { key?: unknown; decision?: unknown; day?: unknown; time?: unknown } | null;
  const key = typeof body?.key === "string" ? body.key : "";
  if (!key) return badRequest({ key: "Öneri bulunamadı." });
  const decision = body?.decision === "approve" ? "approve" : body?.decision === "dismiss" ? "dismiss" : null;
  if (!decision) return badRequest({ decision: "Kararı seçin." });

  const r = await decideSuggestion({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    key,
    decision,
    edits: { day: body?.day, time: body?.time },
  });
  if (r.status === "invalid") return badRequest({ [r.field]: r.message });
  if (r.status === "gone") return NextResponse.json({ gone: true }, { status: 409 });
  return jsonOk(r);
});
