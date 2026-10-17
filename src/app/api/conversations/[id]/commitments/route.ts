import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, tooManyRequests, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { rateLimit } from "@/lib/rate-limit";
import { orgTimezone } from "@/lib/timezone";
import {
  COMMITMENT_CONFLICT_MESSAGE,
  COMMITMENT_TASK_DELETED_MESSAGE,
  CommitmentRequestConflictError,
  commitmentDueAt,
  createGuestCommitment,
  isCommitmentKind,
} from "@/lib/guest-commitments";
import { KB_IDEMPOTENCY_CONFLICT } from "@/lib/kb/request-id";
import { KB_REQUEST_ID_RE } from "@/lib/validators";

// ---------------------------------------------------------------------------
// Misafire SÖZ işaretle (açık taahhüt hafızası A, kurucu kararı 10-10; migration 62). Ev sahibi gelen kutusunda "Misafire söz ver"
// kartından tür + bugün / yarın + saat seçer → söz + bağlı görev TEK işlemde. Metin YOK; misafire hiçbir şey GÖNDERİLMEZ.
// Yalnız yönetici (sahip / müdür) — personel söz vermez.
// ---------------------------------------------------------------------------

/** Geçmiş saate söz verilmez (biraz pay: formu dolduran dakikalar). */
const PAST_TOLERANCE_MS = 5 * 60_000;

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;
  const limited = await rateLimit(`commitment:${session.organizationId}`, 60, 60 * 60_000);
  if (!limited.ok) return tooManyRequests(limited.retryAfter);

  const conversation = await prisma.conversation.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: { id: true, propertyId: true, reservationId: true, property: { select: { organization: { select: { timezone: true } } } } },
  });
  if (!conversation) return notFound();

  const body = (await readJsonCappedOrNull(req)) as { kind?: unknown; day?: unknown; time?: unknown; requestId?: unknown } | null;
  // İstek kimliği (kurucu D3, 10-15): formun işlem kimliği; biçimsizse 400 (yoksa — eski istemci — her istek yeni söz).
  const requestId = body?.requestId === undefined || body?.requestId === null ? null : body.requestId;
  if (requestId !== null && (typeof requestId !== "string" || !KB_REQUEST_ID_RE.test(requestId))) {
    return badRequest({ requestId: "Geçersiz istek kimliği" });
  }
  if (!isCommitmentKind(body?.kind)) return badRequest({ kind: "Söz türünü seçin." });
  const day = body?.day === "tomorrow" ? "tomorrow" : body?.day === "today" ? "today" : null;
  if (!day) return badRequest({ day: "Günü seçin." });
  const time = typeof body?.time === "string" ? body.time : "";
  const now = new Date();
  const dueAt = commitmentDueAt({ day, time }, orgTimezone(conversation.property.organization.timezone), now);
  if (!dueAt) return badRequest({ time: "Saati seçin." });
  if (dueAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) return badRequest({ time: "Geçmiş bir saat seçilemez." });

  let created: Awaited<ReturnType<typeof createGuestCommitment>>;
  try {
    created = await createGuestCommitment({
      organizationId: session.organizationId,
      conversationId: conversation.id,
      propertyId: conversation.propertyId,
      reservationId: conversation.reservationId,
      kind: body.kind,
      dueAt,
      actorUserId: session.actorUserId ?? session.userId,
      clientRequestId: requestId,
    });
  } catch (err) {
    if (err instanceof CommitmentRequestConflictError) {
      const error = err.reason === "task_deleted" ? COMMITMENT_TASK_DELETED_MESSAGE : COMMITMENT_CONFLICT_MESSAGE;
      return Response.json({ error, code: KB_IDEMPOTENCY_CONFLICT }, { status: 409 });
    }
    throw err;
  }
  // Aynı işlemin tekrarı (çift tık / kopan bağlantı sonrası yeniden deneme): söz zaten kayıtlı → 200 + `reused`; ekran "Bu söz zaten kayıtlı."
  // der (kurucu 10-16, Opus B15). Söz ile görev AYNI işlemde yazılır: yeni söz = yeni görev; görevi sonradan silinmiş söz ↑409 kendi metniyle.
  return jsonOk({ id: created.id, taskId: created.taskId, dueAt: dueAt.toISOString(), reused: created.reused }, created.reused ? 200 : 201);
});
