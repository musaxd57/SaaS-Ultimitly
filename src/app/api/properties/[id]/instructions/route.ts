import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import {
  addPropertyInstruction,
  historyLearnEnabled,
  listPresetStates,
  presetsAvailable,
  propertyInstructionsAllowed,
  INSTRUCTION_MAX_CHARS,
  INSTRUCTIONS_MAX_ACTIVE,
} from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// MÜLKE ÖZGÜ TALİMAT ("böyle yapsın" notu; kurucu 10-15: not HEM bilgi tabanına HEM talimata). Anahtar `HISTORY_LEARN_ENABLED`
// KAPALI → 404. Metin kapıları servis `checkInstruction` (kapı kodu · ele geçirme · ödeme yöntemi · uzunluk). Denetim kaydı metinsiz.
// ---------------------------------------------------------------------------

const REASONS: Record<string, string> = {
  empty: "Talimat boş olamaz.",
  too_long: `Talimat en çok ${INSTRUCTION_MAX_CHARS} karakter olabilir.`,
  door_code: "Kapı ya da anahtar kutusu kodu talimata yazılamaz.",
  hijack: "Bu metin yapay zekânın kurallarını değiştirmeye çalışıyor gibi görünüyor. Misafire nasıl davranılmasını istediğinizi düz cümleyle yazın.",
  secret: "Şifre ya da kod talimata yazılamaz. Bu bilgiyi bilgi tabanına ekleyin.",
  safety_topic:
    "Acil durum, şikâyet, ücret, indirim ve iade konularında talimat yazılamaz. Bu konularda yapay zekâ her zaman size bırakır.",
  payment: "Ödeme yöntemi ya da ödeme yeri talimata yazılamaz. Ödeme bilgisini rezervasyon platformu üzerinden paylaşın.",
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
  });
  if (!r.ok) {
    if (r.reason === "not_found") return notFound();
    if (r.reason === "limit") return NextResponse.json({ error: REASONS.limit }, { status: 409 });
    return badRequest({ content: REASONS[r.reason] });
  }
  await writeAudit({
    organizationId: session.organizationId,
    actorUserId: auditActor(session),
    action: "property.instruction_added",
    metadata: { propertyId: id, instructionId: r.id },
  });
  return jsonOk({ id: r.id }, 201);
});
