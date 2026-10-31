import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { writeAudit, auditActor } from "@/lib/audit";
import { historyLearnEnabled, listPresetStates, presetsAvailable, setPresetInstruction } from "@/lib/history-learn/service";

// ---------------------------------------------------------------------------
// DAİRE TALİMATI — HAZIR SEÇENEK aç / kapat (kurucu 10-15: "Müşteri, hazır seçeneklerden seçsin"). Müşteri (yönetici) kullanır; metin
// koddaki kapalı kümeden (`instruction-presets.ts`). Anahtar `HISTORY_LEARN_ENABLED` KAPALI → 404. Cevaba etkisi ayrı anahtarla
// (`PROPERTY_INSTRUCTIONS_PROMPT_ENABLED`); o kapalıyken müşteriye 404 (etkisiz ayar yazdırılmaz), operatör dener (`presetsAvailable`).
// Kiracı kapsamı servis kilidinde (mülk işletmeye ait değilse 404). Denetim kaydı metinsiz. Cevap: güncel liste (ekran eşitlenir).
// ---------------------------------------------------------------------------

export const PUT = withManage<{ id: string }>(async (session, req, { params }) => {
  if (!historyLearnEnabled() || !presetsAvailable(session)) return notFound();
  const { id } = await params;
  const body = await readJsonCappedOrNull<{ key?: unknown; on?: unknown }>(req);
  if (typeof body?.key !== "string" || typeof body?.on !== "boolean") return badRequest({ key: "Geçersiz seçenek." });
  const r = await setPresetInstruction({ organizationId: session.organizationId, propertyId: id, userId: auditActor(session), key: body.key, on: body.on });
  if (!r.ok) return r.reason === "not_found" ? notFound() : badRequest({ key: "Geçersiz seçenek." });
  if (r.changed) {
    await writeAudit({
      organizationId: session.organizationId,
      actorUserId: auditActor(session),
      action: body.on ? "property.instruction_preset_on" : "property.instruction_preset_off",
      metadata: { propertyId: id, preset: body.key },
    });
  }
  return jsonOk({ ok: true, presets: await listPresetStates(id) });
});
