import "server-only";

import { prisma } from "@/lib/db";
import { writeAuditInTx } from "@/lib/audit";
import { createOperationalTaskFromMessage } from "@/lib/tasks/create";
import { commitmentDueAt, createGuestCommitment, isCommitmentKind, isCommitmentTopic, lockCommitmentConversation } from "@/lib/guest-commitments";
import { commitmentTaskDueAt, commitmentTaskTitle } from "@/lib/guest-commitments-core";
import type { CommitmentTopic, DayPartCode, DuePrecision } from "@/lib/guest-commitments-core";
import { addZonedDays } from "@/lib/timezone";
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
  | {
      status: "done";
      decision: "approved" | "dismissed";
      created?: {
        taskId?: string;
        commitmentId?: string;
        kbItemId?: string;
        merged?: boolean;
        topicAttached?: boolean;
        attachedTopic?: CommitmentTopic;
        rescheduled?: boolean;
      };
    }
  | { status: "gone" }
  | { status: "invalid"; field: string; message: string };

/** Söz önerisinde ev sahibinin onaydan önce değiştirebileceği alanlar. */
export interface DecisionEdits {
  day?: unknown;
  time?: unknown;
  /** Q1-b: konusuz öneri aynı saatte birden çok söze uyuyorsa seçim — o sözün konusu ya da "new" (yeni söz). */
  attach?: unknown;
}

/** Q1-b seçim metinleri (ev sahibi ekranı). */
export const ATTACH_CHOICE_REQUIRED = "Hangi söze bağlanacağını seçin.";
export const ATTACH_TIME_EDITED = "Saati değiştirdiyseniz 'Yeni söz olarak kaydet'i seçin.";
export const MOVE_CHOICE_REQUIRED = "Bu saat hangi söze ait? Birini seçin ya da ayrı söz olarak kaydedin.";
export const DAY_CHOICE_REQUIRED = "Sözün gününü seçin.";

const PAST_TOLERANCE_MS = 5 * 60_000;

/** Yalnız test: karar denetiminden SONRA bekleme (eşzamanlı onayda kilidin ikinci isteği gerçekten beklettiğini kanıtlamak için). */
export const __aiSuggestionHooks: { afterDecisionCheck: null | (() => Promise<void>) } = { afterDecisionCheck: null };

/** "YYYY-MM-DD" + n gün (saat dilimsiz takvim aritmetiği). */
function shiftDayKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

async function rederive(organizationId: string, key: string, now: Date): Promise<{ view: SuggestionView; propertyId: string; conversationId?: string } | null> {
  const parsed = parseSuggestionKey(key);
  if (!parsed) return null;
  if (parsed.kind === "task" || parsed.kind === "commitment") {
    // Söz anahtarı `<mesaj>` ya da `<mesaj>:<sıra>` (Q1-b: bir mesajda birden çok söz) — kimlik ilk parça; öneri yine veriden yeniden üretilir.
    const [messageId] = parsed.source.split(":");
    const msg = await prisma.message.findFirst({
      where: { id: messageId, conversation: { property: { organizationId } } },
      select: { conversationId: true, conversation: { select: { propertyId: true } } },
    });
    if (!msg) return null;
    // Yalnız anahtarın türü üretilir (Opus O7): öteki türün önerileri 5 yerlik tavanı doldurup bu öneriyi "gone" yapmasın.
    const view = (await getConversationSuggestions(organizationId, msg.conversationId, now, { only: parsed.kind })).find((s) => s.key === key);
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
  /** Kararı veren kişi; sistemin onaysız uyguladığı söz (kurucu 10-17 gece) için null. */
  actorUserId: string | null;
  /** Ev sahibinin mesajındaki söz ONAYSIZ uygulanıyor (`guest-commitments-auto.ts`) — karar kaydı ve söz kaynağı "auto". */
  auto?: boolean;
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
  let commitmentPrecision: { duePrecision: DuePrecision; dayPart: DayPartCode | null; dayKey: string | null } = {
    duePrecision: "time",
    dayPart: null,
    dayKey: null,
  };
  let edited = false;
  if (input.decision === "approve" && view.kind === "commitment") {
    // Taşıma seçeneği seçildiyse (F11) an o seçeneğin kendi anıdır — gün seçimi KULLANILMAZ (yalnız saat düzenlenebilir).
    const a = input.edits?.attach;
    const moveOption =
      typeof a === "string" && a.startsWith("move:") ? view.proposal.moveOptions?.find((o) => `move:${o.commitmentId}` === a) : undefined;
    const base = moveOption ?? view.proposal;
    const chosenDay = input.edits?.day === "today" || input.edits?.day === "tomorrow" ? input.edits.day : null;
    // Gün mesajdan okunamadıysa (D3) varsayılan "bugün" YOK — ev sahibi seçmeden onaylanmaz (otomatik kip de seçemez → kart kalır).
    if (view.proposal.dayUnclear && !moveOption && chosenDay === null) return { status: "invalid", field: "day", message: DAY_CHOICE_REQUIRED };
    const day = moveOption ? moveOption.day : (chosenDay ?? base.day);
    // Taşımada saat yalnız ev sahibi GERÇEKTEN değiştirdiyse (önerinin saatinden farklı) düzenlemedir — panel taşıma seçilirken sözün kendi
    // saatini gönderirse seçeneğin saati ezilmez (Opus gece-4 F9).
    const typed = typeof input.edits?.time === "string" && input.edits.time.trim() !== "" ? input.edits.time.trim() : null;
    const time = typed !== null && !(moveOption && typed === view.proposal.time) ? typed : base.time;
    edited = day !== base.day || time !== base.time;
    const org = await prisma.organization.findUnique({ where: { id: input.organizationId }, select: { timezone: true } });
    const tz = orgTimezone(org?.timezone);
    if (time !== "") {
      // Açık saat (mesajdaki ya da ev sahibinin yazdığı) → saat kesinliği.
      commitmentDue = commitmentDueAt({ day, time }, tz, now);
      commitmentPrecision = { duePrecision: "time", dayPart: null, dayKey: null };
    } else {
      // Gün dilimi / gün sözü (kurucu 10-17: saat uydurulmaz) → sunucunun yeniden ürettiği pencere sonu; ev sahibi günü değiştirdiyse
      // pencere o güne kayar.
      const baseDue = new Date(base.dueAt);
      const shift = day === base.day ? 0 : day === "tomorrow" ? 1 : -1;
      commitmentDue = Number.isNaN(baseDue.getTime()) ? null : shift === 0 ? baseDue : addZonedDays(baseDue, shift, tz);
      // Gün anahtarı TAKVİM aritmetiğiyle (Opus O13: UTC+12…+14 dilimlerinde "öğlen UTC" çapası günü kaydırıyordu).
      const dayKey = shift === 0 ? base.dayKey : shiftDayKey(base.dayKey, shift);
      commitmentPrecision = { duePrecision: base.precision, dayPart: base.dayPart ?? null, dayKey };
    }
    if (!commitmentDue) return { status: "invalid", field: "time", message: "Saati seçin." };
    if (commitmentDue.getTime() < now.getTime() - PAST_TOLERANCE_MS) return { status: "invalid", field: "time", message: "Geçmiş bir saat seçilemez." };
  }
  // Q1-b: seçim gereken öneride seçim ZORUNLU; mevcut söze bağlanırken saat düzenlemesi anlamsız (o sözün saati değişmez) → açık uyarı.
  let attachTo: CommitmentTopic | "new" | null = null;
  if (input.decision === "approve" && view.kind === "commitment" && view.proposal.attachTopics) {
    const a = input.edits?.attach;
    if (a === "new") attachTo = "new";
    else if (isCommitmentTopic(a) && view.proposal.attachTopics.includes(a)) attachTo = a;
    else return { status: "invalid", field: "attach", message: ATTACH_CHOICE_REQUIRED };
    if (attachTo !== "new" && edited) return { status: "invalid", field: "attach", message: ATTACH_TIME_EDITED };
  }
  // Bağlamla saat güncellemesi (kurucu 10-17 gece): KESİN eşleşme → o söz; BELİRSİZ → seçim ZORUNLU ("move:<kimlik>" ya da "new"). Seçenekler
  // sunucunun yeniden ürettiği öneriden — istemcinin yolladığı kimlik listede yoksa geçersiz.
  let moveTarget: string | null = null;
  if (input.decision === "approve" && view.kind === "commitment") {
    if (view.proposal.reschedule) moveTarget = view.proposal.reschedule.commitmentId;
    else if (view.proposal.moveOptions) {
      const a = input.edits?.attach;
      if (a === "new") moveTarget = null;
      else if (typeof a === "string" && a.startsWith("move:") && view.proposal.moveOptions.some((o) => `move:${o.commitmentId}` === a)) {
        moveTarget = a.slice("move:".length);
      } else return { status: "invalid", field: "attach", message: MOVE_CHOICE_REQUIRED };
    }
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

    const created: {
      taskId?: string;
      commitmentId?: string;
      kbItemId?: string;
      merged?: boolean;
      topicAttached?: boolean;
      attachedTopic?: CommitmentTopic;
      rescheduled?: boolean;
    } = {};
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
      } else if (view.kind === "commitment" && moveTarget !== null) {
        // Aynı sözün YENİ saati: söz + görev taşınır, yeni söz / görev açılmaz; önceki son an iz olarak kalır ("10:00 → 11:00").
        if (!commitmentDue || !found.conversationId) return { status: "gone" } as const;
        // Konuşma kilidi (yazma katmanıyla AYNI): eşzamanlı yeni söz onayı bu taşımayı görmeden aynı saate ikinci söz açmasın (Opus gece-4 F19a).
        await lockCommitmentConversation(tx, found.conversationId);
        const target = await tx.guestCommitment.findFirst({
          where: { id: moveTarget, organizationId: input.organizationId, conversationId: found.conversationId, status: "open", taskId: { not: null } },
          select: { id: true, taskId: true, kind: true, topic: true, dueAt: true, dayPart: true },
        });
        if (!target || !target.taskId) return { status: "gone" } as const;
        const moved = await tx.guestCommitment.updateMany({
          where: { id: target.id, status: "open", dueAt: target.dueAt },
          data: {
            previousDueAt: target.dueAt,
            dueAt: commitmentDue,
            duePrecision: commitmentPrecision.duePrecision,
            dayPart: commitmentPrecision.duePrecision === "part" ? commitmentPrecision.dayPart : null,
          },
        });
        if (moved.count !== 1) return { status: "gone" } as const;
        const kind = isCommitmentKind(target.kind) ? target.kind : view.proposal.commitmentKind;
        const newPart = commitmentPrecision.duePrecision === "part" ? commitmentPrecision.dayPart : null;
        await tx.task.updateMany({
          where: { id: target.taskId },
          data: { dueAt: commitmentTaskDueAt(commitmentDue, commitmentPrecision.duePrecision, commitmentPrecision.dayKey) },
        });
        // Görev başlığı yalnız otomatik başlık duruyorsa (dilim eki değişir); ev sahibinin değiştirdiği başlığa dokunulmaz.
        await tx.task.updateMany({
          where: { id: target.taskId, title: commitmentTaskTitle(kind, target.topic, target.dayPart) },
          data: { title: commitmentTaskTitle(kind, target.topic, newPart) },
        });
        await writeAuditInTx(tx, {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "commitment.rescheduled",
          metadata: { commitmentId: target.id, taskId: target.taskId, kind, ...(input.auto ? { auto: true } : {}) },
        });
        created.merged = true;
        created.rescheduled = true;
        created.commitmentId = target.id;
        created.taskId = target.taskId;
      } else if (view.kind === "commitment" && attachTo !== null && attachTo !== "new") {
        // Q1-b: ev sahibi mevcut sözü seçti → yeni söz / görev AÇILMAZ; karar o söze bağlanır. Söz arada kapandıysa / saati değiştiyse "gone".
        if (!commitmentDue || !found.conversationId) return { status: "gone" } as const;
        await lockCommitmentConversation(tx, found.conversationId);
        const target = await tx.guestCommitment.findFirst({
          where: {
            organizationId: input.organizationId,
            conversationId: found.conversationId,
            kind: view.proposal.commitmentKind,
            topic: attachTo,
            dueAt: commitmentDue,
            status: "open",
            taskId: { not: null },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, taskId: true },
        });
        if (!target) return { status: "gone" } as const;
        created.merged = true;
        created.attachedTopic = attachTo;
        created.commitmentId = target.id;
        created.taskId = target.taskId ?? undefined;
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
            topic: isCommitmentTopic(view.proposal.topic) ? view.proposal.topic : null,
            dueAt: commitmentDue,
            actorUserId: input.actorUserId,
            // Öneri anahtarı işlem kimliğidir (kurucu D3, 10-15): aynı önerinin ikinci onayı aynı sözü döndürür (karar kaydı zaten
            // engelliyor; tekil dizin son savunma). AYRICA `mergeSameSlot`: aynı tür + aynı saatte açık söz varsa (ev sahibi aynı sözü elle
            // kaydetmiş) yeni söz açılmaz — öneri listesi de aynı kuralla gizler. I1 (10-17, migration 73): birleştirme KONU uyumuna da bakar
            // (klima 18:00 ile musluk 18:00 iki söz); konusuz elle söz + konulu öneri birleşir ve söze konu YAZILIR (kurucu Q1 "a").
            duePrecision: commitmentPrecision.duePrecision,
            dayPart: commitmentPrecision.dayPart,
            dayKey: commitmentPrecision.dayKey,
            source: input.auto ? "auto" : "suggestion",
            sourceMessageId: view.proposal.messageId,
            clientRequestId: `sugg:${input.key}`,
            // Q1-b: ev sahibi "yeni söz" seçtiyse aynı saatteki sözlere BAĞLANMAZ (kendi kararı). Aynı andaki söz başka YAPANINSA
            // (teknisyen ↔ ben getireceğim — yapan kayıtta, migration 76) de bağlanmaz — ayrı sözdür (Haiku 10-17 gece 2. tur; Opus gece-3 F4).
            mergeSameSlot: attachTo !== "new",
            actor: view.proposal.actor,
          },
          tx,
        );
        // Bu önerinin sözü zaten yazılmıştı (aynı öneri anahtarı = aynı işlem kimliği) ya da onay sırasında aynı söz (elle / başka öneri)
        // açıldı → görev dalıyla AYNI: karar YAZILMAZ (ölçüt şişmesin; öneri listede de gizlenir — aynı yüklem).
        // İKİ İSTİSNA — mevcut söze bağlandı ama onayın bir ETKİSİ var, karar YAZILIR (`merged`; yeni söz / görev açılmaz):
        //  · ev sahibi saati DÜZENLEYİP mevcut uyumlu söze denk getirdi (Haiku 10-17: öneri kendi saatiyle listede kalırdı → ölü düğme);
        //  · konusuz söze bu önerinin konusu YAZILDI (kurucu Q1 "a": "Aynı saatte kaydettiğiniz söze bağlandı (klima)").
        if (c.reused && !(c.via === "slot" && (edited || c.topicAttached))) return { status: "gone" } as const;
        if (c.reused) created.merged = true;
        if (c.topicAttached) created.topicAttached = true;
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
      metadata: { key: input.key, kind: view.kind, edited, ...(input.auto ? { auto: true } : {}), ...created },
    });
    return { status: "done", decision: input.decision === "approve" ? "approved" : "dismissed", created } as const;
  });

  // Bilgi tabanı değişti → Mülk Hafızası eşitlensin (çelişki uyarısı yeniden değerlendirilir). İşlem dışında, en iyi çaba.
  if (result.status === "done" && result.decision === "approved" && view.kind === "kb_wifi") {
    await refreshPropertyMemoryBestEffort(input.organizationId, propertyId);
  }
  return result;
}
