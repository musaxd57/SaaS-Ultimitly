import "server-only";

import { prisma } from "@/lib/db";
import { detectRiskType } from "@/lib/ai/fallback";
import { buildOperationalTaskData, detectOperationalTask } from "@/lib/tasks/detect";
import { TASK_TYPE } from "@/lib/constants";
import { isChannelAutomation, resolveMessageAuthor } from "@/lib/message-author";
import { addZonedDays, dateKeyInTimeZone, orgTimezone, zonedWallClockToUtc } from "@/lib/timezone";
import {
  COMMITMENT_TOPIC_LABELS,
  commitmentLabel,
  commitmentSlotAbsorbs,
  commitmentTopicsCompatible,
  isCommitmentTopic,
  type CommitmentKind,
  type CommitmentTopic,
} from "@/lib/guest-commitments-core";
import {
  applyWifiValue,
  detectHostPromises,
  extractWifiValues,
  kbContainsValue,
  maskSecret,
  promiseDue,
  wifiTargetAmbiguous,
  SUGGESTION_WINDOW_DAYS,
  suggestionKey,
  type HostPromise,
  type SuggestionDecision,
  type SuggestionKind,
} from "./core";

// ---------------------------------------------------------------------------
// YAPAY ZEKÂ EYLEM ÖNERİLERİ — OKUMA (⑤ ilk dilim, kurucu 10-12). Kiracı + kaynak kapsamlı; salt-okuma. Karar (onay / yok say) kaydı
// `AuditLog`ta (`ai_suggestion.approved` / `ai_suggestion.dismissed`, metadata yalnız anahtar + tür — metin YOK) → migration yok.
// Anahtar `AI_ACTION_SUGGESTIONS_ENABLED` (yalnız "1"; varsayılan KAPALI).
// ---------------------------------------------------------------------------

export function aiActionSuggestionsEnabled(): boolean {
  return process.env.AI_ACTION_SUGGESTIONS_ENABLED === "1";
}

export const SUGGESTION_APPROVED = "ai_suggestion.approved";
export const SUGGESTION_DISMISSED = "ai_suggestion.dismissed";
/** Öneri listesi tavanı (konuşma / mülk başına). */
const MAX_SUGGESTIONS = 5;

export type SuggestionView =
  | {
      key: string;
      kind: "task";
      title: string;
      detail: string;
      evidenceAt: string;
      proposal: { messageId: string; taskTitle: string; priority: "urgent" | "standard" };
    }
  | {
      key: string;
      kind: "commitment";
      title: string;
      detail: string;
      evidenceAt: string;
      /**
       * `topic`: sözün konusu (I1; ev sahibinin mesajından kodla) — onay aynı konuyu yazar. `attachTopics` (Q1-b): konusuz öneri aynı saatte
       * birden çok farklı konulu açık söze uyuyor — onayda biri (ya da "yeni söz") seçilir.
       */
      proposal: {
        messageId: string;
        commitmentKind: CommitmentKind;
        topic: CommitmentTopic | null;
        day: "today" | "tomorrow";
        time: string;
        attachTopics?: CommitmentTopic[];
      };
    }
  | {
      key: string;
      kind: "kb_wifi";
      title: string;
      detail: string;
      evidenceAt: string;
      proposal: { kbItemId: string; messageId: string; field: "password" | "network"; masked: string };
    };

/** Bu kiracının karar verilmiş öneri anahtarları (pencere içinde). */
export async function decidedSuggestionKeys(organizationId: string, since: Date): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, action: { in: [SUGGESTION_APPROVED, SUGGESTION_DISMISSED] }, createdAt: { gte: since } },
    select: { metadataJson: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    try {
      const k = (JSON.parse(r.metadataJson ?? "{}") as { key?: unknown }).key;
      if (typeof k === "string") keys.add(k);
    } catch {
      /* bozuk satır karar sayılmaz */
    }
  }
  return keys;
}

/** Otomatiğe geçiş ölçütü için kararlar (pencere içinde; metin yok). */
export async function suggestionDecisions(organizationId: string, since: Date): Promise<SuggestionDecision[]> {
  const rows = await prisma.auditLog.findMany({
    where: { organizationId, action: { in: [SUGGESTION_APPROVED, SUGGESTION_DISMISSED] }, createdAt: { gte: since } },
    select: { action: true, metadataJson: true, createdAt: true },
  });
  const out: SuggestionDecision[] = [];
  for (const r of rows) {
    try {
      const m = JSON.parse(r.metadataJson ?? "{}") as { kind?: unknown; edited?: unknown };
      if (m.kind !== "task" && m.kind !== "kb_wifi" && m.kind !== "commitment") continue;
      out.push({ kind: m.kind as SuggestionKind, decision: r.action === SUGGESTION_APPROVED ? "approved" : "dismissed", edited: m.edited === true, at: r.createdAt });
    } catch {
      /* atla */
    }
  }
  return out;
}

const fmtAt = (d: Date) => d.toISOString();

/** İşletme diliminde günün dakikası (QR'daki `nowMinutesInTz` ile aynı hesap). */
function nowMinutesInTz(now: Date, tz: string): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now)
    .split(":")
    .map(Number);
  return ((h % 24) * 60 + m) % (24 * 60);
}

/**
 * Sözün MUTLAK son anı — mesajın YAZILDIĞI ana göre ("30 dakika içinde" = mesaj + 30 dk; "yarın" = mesajın ertesi günü). Onayda yeniden
 * üretilen öneri aynı ânı verir (Haiku 10-12: "şimdi"ye göre hesap onayda kayıyor, onay "düzenlendi" sayılıyordu).
 */
function absolutePromiseDue(p: HostPromise, messageAt: Date, tz: string): Date | null {
  const due = promiseDue(p, nowMinutesInTz(messageAt, tz));
  const base = due.day === "tomorrow" ? addZonedDays(messageAt, 1, tz) : messageAt;
  const [y, mo, d] = dateKeyInTimeZone(base, tz).split("-").map(Number);
  const [hh, mm] = due.time.split(":").map(Number);
  return zonedWallClockToUtc(y, mo, d, hh, mm, 0, tz);
}

/** Mutlak an → ev sahibine gösterilen "bugün / yarın + SS:DD" (şimdiye göre); geçmiş ya da yarından sonra → null (öneri yok). */
function relativeDay(dueAt: Date, now: Date, tz: string): { day: "today" | "tomorrow"; time: string } | null {
  if (dueAt.getTime() < now.getTime() - 5 * 60_000) return null;
  const key = dateKeyInTimeZone(dueAt, tz);
  const day = key === dateKeyInTimeZone(now, tz) ? "today" : key === dateKeyInTimeZone(addZonedDays(now, 1, tz), tz) ? "tomorrow" : null;
  if (!day) return null;
  const m = nowMinutesInTz(dueAt, tz);
  return { day, time: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
}

/**
 * Bir konuşmanın A (görev) + C (söz) önerileri. A yalnız işletmenin otomatik görev anahtarı KAPALIYKEN (açıksa görev zaten kendiliğinden
 * açılıyor — öneri gereksiz); kaynak mesaja bağlı görev ya da aynı konuda (aynı gün anahtarı) AÇIK görev varsa öneri yok. C: aynı türde,
 * mesajdan sonra işaretlenmiş söz varsa; son an geçmişse ya da yarından sonraysa öneri yok. Sorgular toplu (mesaj başına sorgu yok).
 */
export async function getConversationSuggestions(organizationId: string, conversationId: string, now: Date = new Date()): Promise<SuggestionView[]> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, property: { organizationId } },
    select: {
      id: true,
      propertyId: true,
      property: { select: { organization: { select: { timezone: true, autoTaskFromMessageEnabled: true } } } },
    },
  });
  if (!conversation) return [];
  const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 86_400_000);
  const [messages, decided, commitments] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId: conversation.id, createdAt: { gte: since, lte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, body: true, direction: true, authorType: true, senderName: true, systemEventType: true, createdAt: true, channelSenderRole: true },
    }),
    decidedSuggestionKeys(organizationId, since),
    prisma.guestCommitment.findMany({
      where: { conversationId: conversation.id, organizationId },
      select: { kind: true, topic: true, createdAt: true, dueAt: true, status: true, taskId: true },
    }),
  ]);
  const tz = orgTimezone(conversation.property.organization.timezone);
  const autoTask = conversation.property.organization.autoTaskFromMessageEnabled;

  // A adayları + toplu görev denetimi (kaynağa bağlı görev · aynı gün anahtarlı açık görev).
  const taskCandidates = autoTask
    ? []
    : messages
        .filter((m) => resolveMessageAuthor(m).authorType === "guest" && !decided.has(suggestionKey("task", m.id)))
        .flatMap((m) => {
          const detected = detectOperationalTask(m.body ?? "", { riskType: detectRiskType(m.body ?? "") });
          if (!detected) return [];
          const data = buildOperationalTaskData(detected, { propertyId: conversation.propertyId, message: m.body ?? "", now, timezone: tz });
          return [{ m, detected, dedupeKey: data.dedupeKey }];
        });
  const [linked, openSame] = taskCandidates.length
    ? await Promise.all([
        prisma.task.findMany({ where: { sourceMessageId: { in: taskCandidates.map((c) => c.m.id) }, property: { organizationId } }, select: { sourceMessageId: true } }),
        prisma.task.findMany({
          where: { dedupeKey: { in: taskCandidates.map((c) => c.dedupeKey) }, status: { not: "done" }, property: { organizationId } },
          select: { dedupeKey: true },
        }),
      ])
    : [[], []];
  const linkedIds = new Set(linked.map((t) => t.sourceMessageId));
  const openKeys = new Set(openSame.map((t) => t.dedupeKey));
  const taskByMessage = new Map(taskCandidates.filter((c) => !linkedIds.has(c.m.id) && !openKeys.has(c.dedupeKey)).map((c) => [c.m.id, c]));

  const out: SuggestionView[] = [];
  const seenTaskKeys = new Set<string>();
  for (const m of messages) {
    if (out.length >= MAX_SUGGESTIONS) break;
    const author = resolveMessageAuthor(m).authorType;
    const cand = taskByMessage.get(m.id);
    if (cand) {
      if (seenTaskKeys.has(cand.dedupeKey)) continue; // aynı konuda iki mesaj → tek öneri (en yenisi)
      seenTaskKeys.add(cand.dedupeKey);
      const taskTitle = `${TASK_TYPE.label(cand.detected.type)}: ${cand.detected.topic}`.slice(0, 200);
      out.push({
        key: suggestionKey("task", m.id),
        kind: "task",
        title: `Görev aç: ${taskTitle}`,
        detail: cand.detected.priority === "urgent" ? "Misafirin mesajından — ACİL öncelik" : "Misafirin mesajından",
        evidenceAt: fmtAt(m.createdAt),
        proposal: { messageId: m.id, taskTitle, priority: cand.detected.priority },
      });
    } else if (author === "host" && !isChannelAutomation(m)) {
      // L5 (10-17): kanalın KENDİ otomatik mesajı ("Housekeeping will come tomorrow at 10" şablonu) ev sahibinin sözü DEĞİL.
      // Q1-b (kurucu 10-17, "ikisini de öner"): mesajdaki HER söz ayrı öneri. İlk sözün anahtarı mesaj kimliği (geriye uyumlu), sonrakiler
      // `<mesaj>:<sıra>` — sıra mesajın metninden (değişmez) gelir, süzgeçlerden önce verilir → listede ve onayda aynı anahtar.
      for (const [idx, promise] of detectHostPromises(m.body).entries()) {
        if (out.length >= MAX_SUGGESTIONS) break;
        const key = suggestionKey("commitment", idx === 0 ? m.id : `${m.id}:${idx}`);
        if (decided.has(key)) continue;
        // Mesajdan SONRA aynı türde ve UYUMLU konuda söz kaydedilmiş → öneri yok (I1: klima sözü musluk önerisini gizlemez). Saate BAKILMAZ
        // (bilinçli, Haiku 10-17 tartışıldı): ev sahibi mesajdan sonra sözü elle FARKLI saatle kaydettiyse (ya da saati sonraki öneriyle
        // değiştirdiyse) öneri onayı İKİNCİ söz + görev açardı. Bedeli: mesajdan sonra elle kaydedilen KONUSUZ söze konu yazılmaz (Q1 "a"
        // yalnız mesajdan ÖNCE kaydedilmiş söz için — kurucunun örneğindeki sıra).
        if (
          commitments.some(
            (c) => c.kind === promise.kind && commitmentTopicsCompatible(c.topic, promise.topic) && c.createdAt.getTime() >= m.createdAt.getTime(),
          )
        ) {
          continue;
        }
        const dueAt = absolutePromiseDue(promise, m.createdAt, tz);
        if (!dueAt) continue;
        // Aynı tür + aynı an için öneriyi TAMAMEN karşılayan AÇIK söz zaten varsa (mesajdan ÖNCE elle açılmış ya da ev sahibi aynı sözü sonraki
        // mesajda tekrarlamış) öneri gösterilmez — onay hiçbir şey değiştirmezdi ve öneri yenilemede geri gelirdi: ölü "Onayla" düğmesi (Opus
        // 10-15 B1). Konusuz elle söz + KONULU öneri gösterilir: onay söze konu yazar (kurucu Q1 "a", `commitmentSlotAbsorbs`).
        // `taskId` dolu: onayın bağlanabildiği küme ile BİREBİR (`createGuestCommitment` görevsiz söze bağlanmaz — Haiku 10-17).
        const absorbing = commitments.filter(
          (c) => c.status === "open" && c.taskId !== null && commitmentSlotAbsorbs(c, { kind: promise.kind, dueAt, topic: promise.topic }),
        );
        // Q1-b (kurucu 10-17): KONUSUZ öneri aynı saatte İKİ ya da daha çok FARKLI konulu söze uyuyorsa hangisi olduğu belli değil → öneri
        // gösterilir, onayda "hangi söze bağlansın?" sorulur (ya da yeni söz). Tek söze uyuyorsa bugünkü gibi gizlenir.
        const attachTopics = promise.topic === null ? [...new Set(absorbing.map((c) => c.topic).filter(isCommitmentTopic))].sort() : [];
        if (absorbing.length > 0 && attachTopics.length < 2) continue;
        const due = relativeDay(dueAt, now, tz);
        if (!due) continue;
        const when = `${due.day === "tomorrow" ? "yarın" : "bugün"} ${due.time}`;
        out.push({
          key,
          kind: "commitment",
          title: `Söz kaydet: ${commitmentLabel(promise.kind, promise.topic)} — ${when}`,
          detail:
            attachTopics.length >= 2
              ? `Aynı saatte kayıtlı sözler var (${attachTopics.map((t) => COMMITMENT_TOPIC_LABELS[t]).join(", ")}) — hangisine bağlanacağını seçin`
              : "Misafire yazdığınız mesajdan — açık söz + görev açılır",
          evidenceAt: fmtAt(m.createdAt),
          proposal: {
            messageId: m.id,
            commitmentKind: promise.kind,
            topic: promise.topic,
            day: due.day,
            time: due.time,
            ...(attachTopics.length >= 2 ? { attachTopics } : {}),
          },
        });
      }
    }
  }
  return out;
}

/** Wi-Fi düzeltme penceresi (gün) — ev sahibinin yeni şifreyi yazdığı mesaj bundan eski olmamalı. */
const WIFI_WINDOW_DAYS = 14;

/**
 * Bir mülkün B (Wi-Fi) önerileri: ev sahibinin misafire yazdığı şifre / ağ adı bilgi tabanının Wi-Fi kaleminde GEÇMİYORSA → "bilgi
 * tabanını güncelle". Alan başına yalnız EN YENİ değer. HEDEF BELİRSİZSE öneri YOK (Haiku 10-12): birden çok Wi-Fi kalemi (ana / misafir
 * ağı) ya da kalemde o alan için birden çok değer. Kalemin son düzenlemesinden ÖNCEKİ mesaj öneri üretmez. Anahtar mesaja bağlı (`kb_wifi:<mesaj>:<alan>`) — hedef kalem değişse de "yok say" kalır.
 */
export async function getPropertyWifiSuggestions(organizationId: string, propertyId: string, now: Date = new Date()): Promise<SuggestionView[]> {
  const kbItems = await prisma.knowledgeBaseItem.findMany({
    where: { propertyId, property: { organizationId }, category: "wifi", isActive: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, content: true, updatedAt: true },
  });
  if (kbItems.length !== 1) return [];
  const target = kbItems[0];
  const since = new Date(now.getTime() - WIFI_WINDOW_DAYS * 86_400_000);
  // Kalem mesajdan SONRA düzenlendiyse mesajdaki değer bayat sayılır (ev sahibi kalemi o mesajı gördükten sonra elle güncellemiş olabilir —
  // eski şifre yenisinin üstüne yazılmasın; Haiku 10-12 2. tur). Yalnız kalemin son düzenlemesinden SONRAKİ mesajlar.
  const after = target.updatedAt.getTime() > since.getTime() ? target.updatedAt : since;
  const [messages, decided] = await Promise.all([
    prisma.message.findMany({
      where: { conversation: { propertyId, property: { organizationId } }, direction: "outbound", createdAt: { gt: after, lte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: { id: true, body: true, direction: true, authorType: true, senderName: true, systemEventType: true, createdAt: true, channelSenderRole: true },
    }),
    decidedSuggestionKeys(organizationId, since),
  ]);
  const out: SuggestionView[] = [];
  const seenField = new Set<string>();
  for (const m of messages) {
    // L5 (10-17): kanalın KENDİ şablonundaki Wi-Fi değeri ev sahibinin yeni yazdığı değer değildir (şablon eski şifreyi taşıyabilir).
    if (resolveMessageAuthor(m).authorType !== "host" || isChannelAutomation(m)) continue;
    const values = extractWifiValues(m.body);
    for (const field of ["password", "network"] as const) {
      const value = values[field];
      if (!value || seenField.has(field)) continue;
      seenField.add(field); // alan başına en yeni değer (daha eskisi önerilmez)
      if (kbContainsValue(target.content, value, field === "password")) continue;
      // Kalemde hedef belirsiz (iki değer / okunamayan etiket) ya da eski değer metinde birden çok yerde → hangisi? öneri yok.
      if (wifiTargetAmbiguous(target.content, field) || applyWifiValue(target.content, field, value) === null) continue;
      const key = suggestionKey("kb_wifi", `${m.id}:${field}`);
      if (decided.has(key)) continue;
      out.push({
        key,
        kind: "kb_wifi",
        title: field === "password" ? "Bilgi tabanındaki Wi-Fi şifresini güncelle" : "Bilgi tabanındaki Wi-Fi ağ adını güncelle",
        detail: `Misafire yazdığınız değer (${field === "password" ? maskSecret(value) : value}) bilgi tabanında yok`,
        evidenceAt: fmtAt(m.createdAt),
        proposal: { kbItemId: target.id, messageId: m.id, field, masked: field === "password" ? maskSecret(value) : value },
      });
    }
    if (seenField.size === 2 || out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
