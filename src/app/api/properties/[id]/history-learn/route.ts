import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { jsonOk, notFound, readJsonCappedOrNull, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import {
  clampQuestions,
  executeHistoryLearnRun,
  historyLearnEnabled,
  parseFlags,
  startHistoryLearnRun,
  HISTORY_LEARN_MONTHLY_RUNS,
  COMPARE_MAX_QUESTIONS,
} from "@/lib/history-learn/service";

function idsOf(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GEÇMİŞTEN ÖĞREN — mülk başına çalıştırma (migration 65; anahtar `HISTORY_LEARN_ENABLED` KAPALI → 404). `withManage`: ev sahibinin
// misafir yazışmalarını okur (personel değil). Kiracı kapsamı: mülk işletmeye ait değilse 404 (varlık sızdırılmaz).
// GET: son çalıştırmalar + bekleyen taslaklar. POST: çalıştırmayı başlatır (arka planda yürür; ekran GET ile yoklar).
// ---------------------------------------------------------------------------

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  if (!historyLearnEnabled()) return notFound();
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: session.organizationId }, select: { id: true } });
  if (!property) return notFound();
  const [runs, drafts, comparisons] = await Promise.all([
    prisma.historyLearnRun.findMany({
      where: { propertyId: property.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, kind: true, status: true, errorCode: true, pairCount: true, draftCount: true, createdAt: true, finishedAt: true },
    }),
    prisma.historyLearnDraft.findMany({
      where: { propertyId: property.id, state: "pending" },
      orderBy: [{ supportConversations: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      take: 200,
      select: {
        id: true,
        category: true,
        title: true,
        content: true,
        supportConversations: true,
        newestMonth: true,
        oldestMonth: true,
        conflict: true,
        conflictNote: true,
        flagsJson: true,
      },
    }),
    prisma.historyLearnComparison.findMany({
      where: { propertyId: property.id },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: COMPARE_MAX_QUESTIONS,
      select: { id: true, questionMessageId: true, hostAnswerMessageIdsJson: true, aiAnswer: true, wouldAutoSend: true, verdict: true, note: true },
    }),
  ]);
  // Soru + ev sahibinin o zamanki cevabı CANLI satırdan (saklama süresi / misafir silme mesajla birlikte işler — kopya tutulmaz).
  // Kapsam: mülk (zaten işletmeye ait doğrulandı). Silinmiş mesaj → metin yok ("artık yok").
  const ids = comparisons.flatMap((c) => [c.questionMessageId, ...idsOf(c.hostAnswerMessageIdsJson)]);
  const texts = ids.length
    ? new Map(
        (
          await prisma.message.findMany({
            where: { id: { in: ids }, conversation: { propertyId: property.id } },
            select: { id: true, body: true },
          })
        ).map((m) => [m.id, m.body ?? ""]),
      )
    : new Map<string, string>();
  return jsonOk({
    runs,
    drafts: drafts.map(({ flagsJson, ...d }) => ({ ...d, flags: parseFlags(flagsJson) })),
    comparisons: comparisons.map((c) => ({
      id: c.id,
      question: texts.get(c.questionMessageId) ?? null,
      hostAnswer: idsOf(c.hostAnswerMessageIdsJson).map((i) => texts.get(i)).filter((t): t is string => Boolean(t)).join("\n") || null,
      aiAnswer: c.aiAnswer,
      wouldAutoSend: c.wouldAutoSend,
      verdict: c.verdict,
      note: c.note,
    })),
  });
});

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!historyLearnEnabled()) return notFound();
  const { id } = await params;
  const body = (await readJsonCappedOrNull<{ questions?: unknown }>(req)) ?? {};
  const started = await startHistoryLearnRun({ organizationId: session.organizationId, propertyId: id, userId: auditActor(session) });
  if (!started.ok) {
    if (started.reason === "not_found") return notFound();
    if (started.reason === "running") return NextResponse.json({ error: "Bu daire için okuma zaten sürüyor." }, { status: 409 });
    return tooManyRequests(3600, `Bu ay en çok ${HISTORY_LEARN_MONTHLY_RUNS} kez geçmiş okunabilir. Gelecek ay yeniden deneyin.`);
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "history_learn.started",
    metadata: { propertyId: id, runId: started.runId },
  });
  // Arka plan: misafir beklemiyor; ekran durumu GET ile okur. Yürütücü asla fırlatmaz.
  void executeHistoryLearnRun(started.runId, { questions: clampQuestions(body.questions) });
  return jsonOk({ runId: started.runId }, 202);
});
