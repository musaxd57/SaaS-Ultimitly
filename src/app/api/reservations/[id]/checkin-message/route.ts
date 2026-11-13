import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { rateLimit } from "@/lib/rate-limit";
import { withManage } from "@/lib/route-guard";
import { previewCheckinNow, sendCheckinNow } from "@/lib/automation";
import { CHECKIN_NOW_TEXT } from "@/lib/checkin-now-text";
import { zodFieldErrors } from "@/lib/validators";
import { auditActor } from "@/lib/audit";

// ---------------------------------------------------------------------------
// UX-10 D5 (kurucu 11-13): Girişler satırından "Giriş mesajını gönderin". GET = onay penceresinin içeriği (misafirin göreceği TAM metin +
// sürüm; kapı kodu taşıyabilir → önbelleğe alınmaz, liste HTML'ine gömülmez). POST = gönderim (önizlenen sürüm şart). Yalnız sahip /
// yönetici; bürünmede yazma sunucuda reddedilir (route-guard). Her şart sunucuda yeniden okunur (`prepareCheckinNow`); çift gönderim
// otomatik göndericiyle AYNI talep damgasıyla kapanır. Misafire giden ilk gerçek gönderim kurucuyla yapılır.
// ---------------------------------------------------------------------------

const NO_STORE = { "Cache-Control": "no-store" };
const REFUSAL_STATUS: Record<string, number> = { not_found: 404, already_sent: 409, changed: 409, queue_owns: 409, queue_failed: 409, held: 429, rate_limited: 429 };

export const GET = withManage<{ id: string }>(async (session, _req, ctx) => {
  const { id } = await ctx.params;
  const preview = await previewCheckinNow(session.organizationId, id);
  if (!preview.ok) {
    return NextResponse.json({ error: CHECKIN_NOW_TEXT[preview.kind], code: preview.kind }, { status: REFUSAL_STATUS[preview.kind] ?? 400, headers: NO_STORE });
  }
  return NextResponse.json(preview, { headers: NO_STORE });
});

const bodySchema = z.object({ revision: z.number().int().nonnegative() });

export const POST = withManage<{ id: string }>(async (session, req, ctx) => {
  const { id } = await ctx.params;
  // Ev sahibinin tek tek dokunuşu — işletme başına saatte 30 fazlasıyla yeter; betikle toplu gönderimi keser.
  const limited = await rateLimit(`checkin-now:${session.organizationId}`, 30, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);
  const parsed = bodySchema.safeParse(await readJsonCappedOrNull(req));
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const result = await sendCheckinNow({ organizationId: session.organizationId, reservationId: id, revision: parsed.data.revision, actorUserId: auditActor(session) });
  if (result.ok) return NextResponse.json({ ok: true, kind: result.kind, message: CHECKIN_NOW_TEXT[result.kind] }, { headers: NO_STORE });
  // Belirsiz teslim 202 değil 200 + açık uyarı: istemci "gönderildi" DEMEZ, "ulaşmış olabilir" der ve yeniden gönder sunmaz.
  const status = result.kind === "ambiguous" ? 200 : (REFUSAL_STATUS[result.kind] ?? (result.kind === "definitive" ? 502 : 400));
  return NextResponse.json({ ok: false, code: result.kind, error: CHECKIN_NOW_TEXT[result.kind] }, { status, headers: NO_STORE });
});
