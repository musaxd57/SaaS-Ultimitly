import { prisma } from "@/lib/db";
import { jsonOk, notFound } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyLearnEnabled, retirePropertyInstruction } from "@/lib/history-learn/service";

// Talimatı kaldırır (satır silinmez, `retired` olur — iz kalır; isteme yalnız `active` girer). Kiracı kapsamı: talimat işletmeye VE
// adresteki mülke ait olmalı; değilse 404.
export const DELETE = withManage<{ id: string; instructionId: string }>(async (session, _req, { params }) => {
  if (!historyLearnEnabled()) return notFound();
  const { id, instructionId } = await params;
  const row = await prisma.propertyInstruction.findFirst({
    where: { id: instructionId, propertyId: id, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!row || !(await retirePropertyInstruction(session.organizationId, row.id))) return notFound();
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.instruction_retired",
    metadata: { propertyId: id, instructionId: row.id },
  });
  return jsonOk({ ok: true });
});
