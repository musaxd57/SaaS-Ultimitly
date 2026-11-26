import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { isSuperAdmin } from "@/lib/admin-core";
import { writeAudit, auditActor } from "@/lib/audit";
import {
  addPropertyInstruction,
  historyLearnEnabled,
  listPresetStates,
  presetsAvailable,
  propertyInstructionsAllowed,
  INSTRUCTIONS_MAX_ACTIVE,
} from "@/lib/history-learn/service";
import { INSTRUCTION_REJECT_TEXT } from "@/lib/history-learn/instruction-gate";

// ---------------------------------------------------------------------------
// MÜLKE ÖZGÜ TALİMAT ("böyle yapsın" notu; kurucu 10-15: not HEM bilgi tabanına HEM talimata). Anahtar `HISTORY_LEARN_ENABLED`
// KAPALI → 404. Metin kapıları servis `checkInstruction` (kapı kodu · ele geçirme · ödeme yöntemi · uzunluk). Denetim kaydı metinsiz.
// ---------------------------------------------------------------------------

const REASONS: Record<string, string> = {
  ...INSTRUCTION_REJECT_TEXT,
  limit: `Bir daire için en çok ${INSTRUCTIONS_MAX_ACTIVE} talimat olabilir. Eskilerden birini kaldırın.`,
};

export const GET = withManage<{ id: string }>(async (session, _req, { params }) => {
  // Hazır seçenekler müşteriye (yönetici) YALNIZ cevaba uygulanırken (`presetsAvailable`); serbest metin listesi şimdilik yalnız
  // operatöre (kurucu 10-15). Müşteriye giden veride serbest metin ALANI hiç yok (boş liste).
  if (!historyLearnEnabled()) return notFound();
  const { id } = await params;
  const property = await prisma.property.findFirst({ where: { id, organizationId: session.organizationId }, select: { id: true } });
  if (!property) return notFound();
  const instructions = propertyInstructionsAllowed(session)
    ? await prisma.propertyInstruction.findMany({
        where: { propertyId: property.id, status: "active", presetKey: null },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true, content: true, source: true, createdAt: true },
      })
    : [];
  return jsonOk({ presets: presetsAvailable(session) ? await listPresetStates(property.id) : [], instructions });
});

export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  // Şimdilik yalnız operatör (kurucu 10-15); müşteriye açmak `HISTORY_LEARN_CUSTOMER_INSTRUCTIONS_ENABLED`.
  if (!historyLearnEnabled() || !propertyInstructionsAllowed(session)) return notFound();
  const { id } = await params;
  const body = await readJsonCappedOrNull<{ content?: unknown }>(req);
  if (typeof body?.content !== "string") return badRequest({ content: REASONS.empty });
  const r = await addPropertyInstruction({
    organizationId: session.organizationId,
    propertyId: id,
    userId: auditActor(session),
    content: body.content,
    byOperator: isSuperAdmin(session),
  });
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "limit") return NextResponse.json({ error: REASONS.limit }, { status: 409 });
    return badRequest({ content: REASONS[r.reason] });
  }
  // Aynı talimat yeniden gönderildiyse (çift tık) yeni ekleme YOK → ikinci "eklendi" denetim kaydı da yok (Opus 10-15 B7).
  if (!r.reused) {
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: "property.instruction_added",
      metadata: { propertyId: id, instructionId: r.id },
    });
  }
  return jsonOk({ id: r.id }, 201);
});
