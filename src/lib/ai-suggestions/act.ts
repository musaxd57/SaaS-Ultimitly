import "server-only";

import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { commitmentDueAt, createGuestCommitment, isCommitmentKind } from "@/lib/guest-commitments";
import { orgTimezone } from "@/lib/timezone";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { applyWifiValue, extractWifiValues, parseSuggestionKey } from "./core";
import {
  getConversationSuggestions,
  getPropertyWifiSuggestions,
  SUGGESTION_APPROVED,
  SUGGESTION_DISMISSED,
  type SuggestionView,
} from "./load";

// ---------------------------------------------------------------------------
// YAPAY ZEKÂ EYLEM ÖNERİSİ — KARAR (⑤ ilk dilim, kurucu 10-12: "öner + tek tıkla onay"). Öneri İSTEMCİDEN ALINMAZ: anahtardan sunucuda
// veriden YENİDEN üretilir (kiracı + kaynak kapsamlı); yoksa / karar verilmişse "gone". Anahtar başına danışma kilidi → eşzamanlı iki
// onay iki görev açmaz. Eylem + karar kaydı (`AuditLog`) AYNI işlemde: eylem başarısızsa karar da yazılmaz (öneri yeniden görünür).
// Misafire hiçbir şey GÖNDERİLMEZ.
// ---------------------------------------------------------------------------

export type DecisionResult =
  | { status: "done"; decision: "approved" | "dismissed"; created?: { taskId?: string; commitmentId?: string; kbItemId?: string } }
  | { status: "gone" }
  | { status: "invalid"; field: string; message: string };

/** Söz önerisinde ev sahibinin onaydan önce değiştirebileceği alanlar. */
export interface DecisionEdits {
  day?: unknown;
  time?: unknown;
}

const PAST_TOLERANCE_MS = 5 * 60_000;

/** Yalnız test: karar denetiminden SONRA bekleme (eşzamanlı onayda kilidin ikinci isteği gerçekten beklettiğini kanıtlamak için). */
export const __aiSuggestionHooks: { afterDecisionCheck: null | (() => Promise<void>) } = { afterDecisionCheck: null };

async function rederive(organizationId: string, key: string, now: Date): Promise<{ view: SuggestionView; propertyId: string; conversationId?: string } | null> {
  const parsed = parseSuggestionKey(key);
  if (!parsed) return null;
  if (parsed.kind === "task" || parsed.kind === "commitment") {
    const msg = await prisma.message.findFirst({
      where: { id: parsed.source, conversation: { property: { organizationId } } },
      select: { conversationId: true, conversation: { select: { propertyId: true } } },
    });
    if (!msg) return null;
    const view = (await getConversationSuggestions(organizationId, msg.conversationId, now)).find((s) => s.key === key);
    return view ? { view, propertyId: msg.conversation.propertyId, conversationId: msg.conversationId } : null;
  }
  const [messageId] = parsed.source.split(":");
  const msg = await prisma.message.findFirst({
    where: { id: messageId, conversation: { property: { organizationId } } },
    select: { conversation: { select: { propertyId: true } } },
  });
  if (!msg) return null;
  const view = (await getPropertyWifiSuggestions(organizationId, msg.conversation.propertyId, now)).find((s) => s.key === key);
  return view ? { view, propertyId: msg.conversation.propertyId } : null;
}

export async function decideSuggestion(input: {
  organizationId: string;
  actorUserId: string;
  key: string;
  decision: "approve" | "dismiss";
  edits?: DecisionEdits;
  now?: Date;
}): Promise<DecisionResult> {
  const now = input.now ?? new Date();
  const found = await rederive(input.organizationId, input.key, now);
  if (!found) return { status: "gone" };
  const { view, propertyId } = found;

  // Söz düzenlemesi işlemden ÖNCE doğrulanır (geçersiz saat karar yazdırmasın).
  let commitmentDue: Date | null = null;
  let edited = false;
  if (input.decision === "approve" && view.kind === "commitment") {
    const day = input.edits?.day === "today" || input.edits?.day === "tomorrow" ? input.edits.day : view.proposal.day;
    const time = typeof input.edits?.time === "string" && input.edits.time.trim() !== "" ? input.edits.time.trim() : view.proposal.time;
    edited = day !== view.proposal.day || time !== view.proposal.time;
    const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { timezone: true } });
    commitmentDue = commitmentDueAt({ day, time }, orgTimezone(org?.timezone), now);
    if (!commitmentDue) return { status: "invalid", field: "time", message: "Saati seçin." };
    if (commitmentDue.getTime() < now.getTime() - PAST_TOLERANCE_MS) return { status: "invalid", field: "time", message: "Geçmiş bir saat seçilemez." };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Anahtar başına kilit: eşzamanlı iki karar sırayla — ikincisi kararı görür ve "gone" döner.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-suggestion:${input.organizationId}:${input.key}`}))`;
    const already = await tx.auditLog.findFirst({
      where: {
        organizationId: input.organizationId,
        action: { in: [SUGGESTION_APPROVED, SUGGESTION_DISMISSED] },
        // Öneri penceresi + pay: daha eski karar aranmaz (dizinsiz tam tarama olmasın — Haiku 10-12).
        createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
        metadataJson: { contains: JSON.stringify(input.key) },
      },
      select: { id: true },
    });
    if (already) return { status: "gone" } as const;
    if (__aiSuggestionHooks.afterDecisionCheck) await __aiSuggestionHooks.afterDecisionCheck();

    const created: { taskId?: string; commitmentId?: string; kbItemId?: string } = {};
    if (input.decision === "approve") {
      if (view.kind === "task") {
        const msg = await tx.message.findFirst({
          where: { id: view.proposal.messageId },
          select: { body: true, conversation: { select: { reservationId: true } } },
        });
        if (!msg) return { status: "gone" } as const;
        const r = await createOperationalTaskFromMessage({
          propertyId,
          message: msg.body ?? "",
          sourceMessageId: view.proposal.messageId,
          reservationId: msg.conversation.reservationId,
          db: tx,
        });
        // "duplicate" (aynı gün aynı konuda açık görev arada açıldı) ya da tespit artık yok → karar YAZILMAZ (ölçüt şişmesin — Haiku 10-12).
        if (r.status !== "created") return { status: "gone" } as const;
        created.taskId = r.taskId;
      } else if (view.kind === "commitment") {
        if (!isCommitmentKind(view.proposal.commitmentKind) || !commitmentDue || !found.conversationId) return { status: "gone" } as const;
        const conv = await tx.conversation.findFirst({ where: { id: found.conversationId }, select: { reservationId: true } });
        const c = await createGuestCommitment(
          {
            organizationId: input.organizationId,
            conversationId: found.conversationId,
            propertyId,
            reservationId: conv?.reservationId ?? null,
            kind: view.proposal.commitmentKind,
            dueAt: commitmentDue,
            actorUserId: input.actorUserId,
            // Öneri anahtarı işlem kimliğidir (kurucu D3, 10-15): aynı önerinin ikinci onayı aynı sözü döndürür (karar kaydı zaten
            // engelliyor; tekil dizin son savunma). Anlam birleştirmesi yok — başka bir sözle birleşmez.
            clientRequestId: `sugg:${input.key}`,
            mergeSameSlot: true,
          },
          tx,
        );
        // Bu önerinin sözü zaten yazılmıştı (aynı öneri anahtarı = aynı işlem kimliği) → görev dalıyla AYNI: karar YAZILMAZ (ölçüt şişmesin).
        if (c.reused) return { status: "gone" } as const;
        created.commitmentId = c.id;
        created.taskId = c.taskId;
      } else {
        const [kb, msg] = await Promise.all([
          tx.knowledgeBaseItem.findFirst({ where: { id: view.proposal.kbItemId, propertyId }, select: { id: true, content: true, updatedAt: true } }),
          tx.message.findFirst({ where: { id: view.proposal.messageId }, select: { body: true, createdAt: true } }),
        ]);
        const value = msg ? extractWifiValues(msg.body)[view.proposal.field] : null;
        if (!kb || !msg || !value) return { status: "gone" } as const;
        // Önerinin yeniden üretilmesiyle bu okuma arasında kalem düzenlendiyse (her içerik değişikliği `updatedAt`ı mesajın ötesine
        // taşır) → karar YAZILMAZ (bayat değer elle yazılan yeni bilginin üstüne yazılmasın). Değer / değer sayısı denetimi yeniden üretimde.
        if (kb.updatedAt.getTime() >= msg.createdAt.getTime()) return { status: "gone" } as const;
        const content = applyWifiValue(kb.content, view.proposal.field, value);
        if (content === null) return { status: "gone" } as const; // hedef belirsizleşti → yazılmaz
        await tx.knowledgeBaseItem.update({ where: { id: kb.id }, data: { content } });
        created.kbItemId = kb.id;
      }
    }
    await writeAuditInTx(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.decision === "approve" ? SUGGESTION_APPROVED : SUGGESTION_DISMISSED,
      // Yalnız anahtar + tür + düzenleme işareti — metin / PII YOK.
      metadata: { key: input.key, kind: view.kind, edited, ...created },
    });
    return { status: "done", decision: input.decision === "approve" ? "approved" : "dismissed", created } as const;
  });

  // Bilgi tabanı değişti → Mülk Hafızası eşitlensin (çelişki uyarısı yeniden değerlendirilir). İşlem dışında, en iyi çaba.
  if (result.status === "done" && result.decision === "approved" && view.kind === "kb_wifi") {
    await refreshPropertyMemoryBestEffort(input.organizationId, propertyId);
  }
  return result;
}
