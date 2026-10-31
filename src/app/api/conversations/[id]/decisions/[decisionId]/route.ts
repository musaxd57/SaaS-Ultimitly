import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { auditActor, auditImpersonation } from "@/lib/audit";
import { hostDecisionsEnabled } from "@/lib/decisions/flag";
import { DECISION_LANGS } from "@/lib/decisions/core";
import { decideHostDecision } from "@/lib/decisions/decide";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KARAR (Faz 1, kurucu 10-02 akşam). Ev sahibi kartta Onayla / Reddet / Kapat der. Kararın kendisi (kilit, misafir
// yeniden yazdı mı, iptal / geçmiş gün, olgu izi, metin denetimi, gönderim, doğrulanamadı / yeniden açma, denetim kaydı) çekirdekte:
// `lib/decisions/decide.ts` — WhatsApp düğmesi de aynı çekirdeği çağırır (tasarım §3.10). Bu rota yalnız anahtar + yetki (sahip /
// yönetici, bürünmede yazma yok — `withManage` boğazı) + hız sınırı + gövde ve sonucu HTTP'ye çevirir (yanıtlar çıkarmadan önceyle BİREBİR).
// ---------------------------------------------------------------------------

const bodySchema = z.object({
  action: z.enum(["approve", "decline", "dismiss"]),
  version: z.number().int().min(0),
  time: z.string().max(5).optional(),
  body: z.string().max(10000).optional(),
  seenMessageId: z.string().max(64).optional(),
  /** Ev sahibinin gördüğü kartın olgu parmak izi (`decisionFactsHash`). */
  factsHash: z.string().max(64).optional(),
  /** Ev sahibi hazır metni değiştirdi mi (değiştirdiyse mesaj onun yazdığıdır — "yapay zekâ destekli" sayılmaz). */
  edited: z.boolean().optional(),
  /** Ev sahibi metin denetiminin uyarısını gördü ve "Yine de gönder" dedi (Sabah Kararları 62 h, kurucu seçimi). */
  force: z.boolean().optional(),
  /** Panelde seçilen mesaj dili ve ücret / not seçimi — YALNIZ metin denetiminin dayanağı (gönderilen metin `body`). */
  lang: z.enum(DECISION_LANGS).optional(),
  includeFee: z.boolean().optional(),
  includeNote: z.boolean().optional(),
});

function conflict(code: string, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, error, ...extra }, { status: 409 });
}

export const POST = withManage<{ id: string; decisionId: string }>(async (session, req, { params }) => {
  if (!hostDecisionsEnabled()) return notFound();
  const { id, decisionId } = await params;
  // Kota org kapsamlı (cevap rotasıyla aynı ilke, 09-23): başka kiracının kullanıcısı bu kimlikle sahibin kotasını yakamaz.
  const limited = await rateLimit(`decision:${session.organizationId}:${id}`, 20, 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const parsed = bodySchema.safeParse(await readJsonCappedOrNull(req));
  if (!parsed.success) return badRequest({ action: "Geçersiz işlem." });

  const out = await decideHostDecision({
    organizationId: session.organizationId,
    conversationId: id,
    decisionId,
    actor: { userId: session.userId, name: session.name, auditActorId: auditActor(session), auditExtra: auditImpersonation(session) },
    input: parsed.data,
  });
  switch (out.kind) {
    case "not_found":
      return notFound();
    case "bad_request":
      return badRequest({ [out.field]: out.error });
    case "conflict":
      return conflict(out.code, out.error, out.extra);
    case "dismissed":
      return jsonOk({ status: "dismissed" });
    case "done":
      return jsonOk({ status: out.status, resultMessageId: out.resultMessageId, queued: out.queued });
    case "unverified":
      return NextResponse.json({ code: "send_unverified", error: out.error }, { status: 502 });
    case "failed":
      return NextResponse.json({ error: out.error, version: out.version }, { status: out.httpStatus });
  }
});
