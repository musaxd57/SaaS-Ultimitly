import { NextResponse } from "next/server";
import { jsonOk, notFound, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import {
  executeHistoryLearnRun,
  historyCompareAllowed,
  historyLearnEnabled,
  startHistoryLearnRun,
  HISTORY_LEARN_MONTHLY_RUNS,
} from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// CEVAP KARŞILAŞTIRMA BAŞLAT (F1; anahtar `HISTORY_LEARN_ENABLED` KAPALI → 404). Geçmiş sorulara bugünkü ürünün ne cevap vereceği —
// canlı cevap modeli (kurucu 10-15), HİÇBİR ŞEY GÖNDERİLMEZ. Aynı kuyruk / kilit / aylık tavan (öğrenme çalıştırmasıyla ortak sayaç).
// ---------------------------------------------------------------------------

export const POST = withManage<{ id: string }>(async (session, _req, { params }) => {
  // Şimdilik yalnız operatör (kurucu 10-15); müşteriye açmak `HISTORY_LEARN_CUSTOMER_COMPARE_ENABLED`.
  if (!historyLearnEnabled() || !historyCompareAllowed(session)) return notFound();
  const { id } = await params;
  const started = await startHistoryLearnRun({ organizationId: session.organizationId, propertyId: id, userId: auditActor(session), kind: "compare" });
  if (!started.ok) {
    if (started.reason === "not_found") return notFound();
    if (started.reason === "running") return NextResponse.json({ error: "Bu daire için bir okuma zaten sürüyor." }, { status: 409 });
    return tooManyRequests(3600, `Bu ay en çok ${HISTORY_LEARN_MONTHLY_RUNS} kez çalıştırılabilir. Gelecek ay yeniden deneyin.`);
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "history_learn.compare_started",
    metadata: { propertyId: id, runId: started.runId },
  });
  void executeHistoryLearnRun(started.runId);
  return jsonOk({ runId: started.runId }, 202);
});
