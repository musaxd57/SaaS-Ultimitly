import "server-only";

import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { addNights, calendarDateOf, todayKey } from "@/modules/availability/core";
import { reservationDayRangeWhere } from "@/lib/day-where";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { wallClockMoment } from "@/lib/early-checkin/readiness";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import { commitmentLabel, isCommitmentKind } from "@/lib/guest-commitments-core";
import { isItemKind } from "@/lib/conversation-items/core";
import { itemKindLabel } from "@/lib/conversation-items/view";
import { reportError } from "@/lib/report-error";
import { evaluateStay, type CleaningInput, type StayReadiness } from "./evaluate";

// ---------------------------------------------------------------------------
// GİRİŞ HAZIRLIĞI LİSTESİ — YÜKLEYİCİ (salt-okuma; org kapsamlı; model çağrısı ve yazma YOK).
//
// 🚨 Temizlik hükmü konaklama başına BUGÜNKÜ tek-konaklama yükleyicisinden (`loadEarlyCheckinFacts`) gelir — misafire giden
// "Daireniz hazır" kararıyla AYNI kanıt yolu; devir seçimi, görev kümesi ve "bitti" kanıtı burada YENİDEN YAZILMAZ (ikinci bir kopya
// zamanla ayrışırdı). Burada yalnız GÖSTERİM ayrıntısı (kim atandı / başladı, kimin "bitti" dediği) ve hükme girmeyen ek faktörler
// (söz, ihtiyaç, giriş talimatı) toplu sorgularla eklenir. Ölçü: konaklama başına ~6-8 sorgu; eşzamanlılık sınırlı.
// ---------------------------------------------------------------------------

/** Liste penceresi: bugün + sonraki iki gün (işletme saat dilimiyle). */
export const READINESS_LIST_DAYS = 3;
/** Bir sayfada en çok bu kadar giriş (aşan kısım listenin altında söylenir — sessiz kesme yok). */
export const READINESS_LIST_MAX = 120;
const CONCURRENCY = 4;

/** Onaylı / gönderilmiş erken giriş kararı (geç çıkış yükleyicisiyle aynı durum kümesi). */
const DECIDED_STATUSES = ["approved", "resolved_by_policy", "send_unverified", "sending"];

export interface ArrivalRow {
  reservationId: string;
  propertyId: string;
  propertyName: string;
  guestName: string | null;
  dayKey: string;
  checkInTime: string | null;
  conversationId: string | null;
  readiness: StayReadiness;
}

export interface ArrivalReadinessList {
  timeZone: string;
  fromKey: string;
  toKey: string;
  rows: ArrivalRow[];
  /** Pencerede olup listeye sığmayan giriş sayısı (0 = hepsi listede). */
  truncated: number;
}

async function pool<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function loadArrivalReadiness(
  organizationId: string,
  now: Date,
  opts: { days?: number; max?: number } = {},
): Promise<ArrivalReadinessList> {
  const days = opts.days ?? READINESS_LIST_DAYS;
  const max = opts.max ?? READINESS_LIST_MAX;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const tz = orgTimezone(org?.timezone);
  const fromKey = todayKey(now, tz);
  const toKey = addNights(fromKey, Math.max(1, days) - 1);
  const where = {
    property: { organizationId },
    status: { in: ["confirmed", "completed"] },
    AND: [reservationDayRangeWhere("arrivalDate", { from: fromKey, to: toKey }, tz)],
  };
  const [arrivals, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      select: { id: true, propertyId: true, guestName: true, arrivalDate: true, property: { select: { name: true, checkInTime: true } } },
      orderBy: [{ arrivalDate: "asc" }, { id: "asc" }],
      take: max,
    }),
    prisma.reservation.count({ where }),
  ]);
  if (arrivals.length === 0) return { timeZone: tz, fromKey, toKey, rows: [], truncated: 0 };

  const arrivalIds = arrivals.map((a) => a.id);
  const propertyIds = [...new Set(arrivals.map((a) => a.propertyId))];

  // Temizlik hükmü: konaklama başına BUGÜNKÜ yükleyici (aynı kanıt yolu). Bir konaklamanın hatası sayfayı düşürmez: o satır "okunamadı"
  // (bilinmiyor — asla yeşil değil) olur, hata raporlanır.
  const failed = new Set<number>();
  const facts = await pool(arrivals.map((a, i) => ({ a, i })), CONCURRENCY, async ({ a, i }) => {
    try {
      return await loadEarlyCheckinFacts({
        organizationId,
        propertyId: a.propertyId,
        reservationId: a.id,
        now,
        requested: { time: null, sources: 0, conflict: false },
        singleIntent: true,
      });
    } catch (err) {
      failed.add(i);
      void reportError("readiness-list.stay", err);
      return null;
    }
  });

  // Gösterilen görevler = hükmün okuduğu görevler (çekirdeğin kümesi; bağsız devir günü görevi dahil — Haiku 11-05).
  const cleaningIds = [...new Set(facts.flatMap((f) => f?.cleaningTaskIds ?? []))];
  const readyMarkIds = facts.map((f) => f?.readyMark?.id).filter((x): x is string => !!x);

  const [conversations, cleaningTasks, readyUpdates, earlyDecisions, kbItems] = await Promise.all([
    prisma.conversation.findMany({
      where: { reservationId: { in: arrivalIds }, property: { organizationId } },
      select: { id: true, reservationId: true },
      orderBy: { createdAt: "asc" },
    }),
    cleaningIds.length
      ? prisma.task.findMany({
          where: { id: { in: cleaningIds }, property: { organizationId } },
          select: {
            id: true,
            reservationId: true,
            status: true,
            assignedTo: { select: { name: true } },
            updates: { where: { status: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { status: true, userId: true, createdAt: true } },
          },
        })
      : Promise.resolve([]),
    readyMarkIds.length
      ? prisma.taskUpdate.findMany({ where: { id: { in: readyMarkIds }, task: { property: { organizationId } } }, select: { id: true, userId: true } })
      : Promise.resolve([]),
    prisma.decisionRequest.findMany({
      where: { organizationId, reservationId: { in: arrivalIds }, kind: "early_checkin", status: { in: DECIDED_STATUSES }, decidedTime: { not: null } },
      select: { reservationId: true, decidedTime: true },
    }),
    prisma.knowledgeBaseItem.findMany({
      where: { propertyId: { in: propertyIds }, category: "checkin", isActive: true, property: { organizationId } },
      select: { id: true, propertyId: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const convByReservation = new Map<string, string[]>();
  for (const c of conversations) {
    if (!c.reservationId) continue;
    convByReservation.set(c.reservationId, [...(convByReservation.get(c.reservationId) ?? []), c.id]);
  }
  const convIds = conversations.map((c) => c.id);

  const [commitments, items] = await Promise.all([
    convIds.length
      ? prisma.guestCommitment.findMany({
          where: { organizationId, conversationId: { in: convIds }, status: "open" },
          select: { id: true, conversationId: true, kind: true, topic: true, dueAt: true, task: { select: { assignedTo: { select: { name: true } } } } },
          orderBy: { dueAt: "asc" },
        })
      : Promise.resolve([]),
    convIds.length
      ? prisma.conversationItem.findMany({
          where: { conversationId: { in: convIds }, status: { in: ["open", "pending_host"] } },
          select: { id: true, conversationId: true, kind: true, status: true, createdAt: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  // Kişi adları (org kapsamlı): başlayan / bitiren kullanıcı.
  const userIds = new Set<string>();
  for (const t of cleaningTasks) for (const u of t.updates) if (u.userId) userIds.add(u.userId);
  for (const u of readyUpdates) if (u.userId) userIds.add(u.userId);
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] }, organizationId }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const readyUserOf = new Map(readyUpdates.map((u) => [u.id, u.userId ? (nameOf.get(u.userId) ?? null) : null]));
  const earlyOf = new Map<string, string>();
  for (const d of earlyDecisions) {
    const t = normalizeHhmm(d.decidedTime);
    if (!d.reservationId || !t) continue;
    const prev = earlyOf.get(d.reservationId);
    if (!prev || t < prev) earlyOf.set(d.reservationId, t);
  }
  const accessOf = new Map<string, { id: string; at: Date }>();
  for (const k of kbItems) if (!accessOf.has(k.propertyId)) accessOf.set(k.propertyId, { id: k.id, at: k.updatedAt });

  const rows: ArrivalRow[] = arrivals.map((a, i) => {
    const loaded = facts[i];
    const dayKey = calendarDateOf(a.arrivalDate, tz).key;
    const dayEnd = wallClockMoment(addNights(dayKey, 1), "00:00", tz);
    const convs = convByReservation.get(a.id) ?? [];
    const f = loaded?.facts;
    const referenceId = loaded?.referenceId ?? null;
    const ownTaskIds = new Set(loaded?.cleaningTaskIds ?? []);
    const tasks = cleaningTasks
      .filter((t) => ownTaskIds.has(t.id))
      .map((t) => {
        const latest = t.updates[0];
        const started = latest && latest.status === "in_progress" && latest.userId ? latest : null;
        const done = t.updates.find((u) => u.status === "done") ?? null;
        return {
          id: t.id,
          open: t.status !== "done",
          assignee: t.assignedTo?.name ?? null,
          startedAt: started?.createdAt ?? null,
          startedBy: started?.userId ? (nameOf.get(started.userId) ?? null) : null,
          lastDoneAt: done?.createdAt ?? null,
        };
      })
      // Açık görev önce (engelleyen o).
      .sort((x, y) => Number(y.open) - Number(x.open));
    const cleaning: CleaningInput = {
      unavailable: failed.has(i),
      status: f?.readiness ?? "unknown",
      note: f?.readinessNote ?? null,
      previousKnown: referenceId !== null,
      previousCheckout: f?.previousSameDay?.checkoutTime ?? null,
      readyMark: loaded?.readyMark ? { id: loaded.readyMark.id, at: loaded.readyMark.at, by: loaded.readyMark.id ? (readyUserOf.get(loaded.readyMark.id) ?? null) : null } : null,
      tasks: tasks.map(({ open: _open, ...t }) => t),
    };
    const readiness = evaluateStay({
      timeZone: tz,
      now,
      cleaning,
      cleaningNote: f?.cleaningNote === true,
      openIssue: f?.openIssue === true,
      maintenanceOpen: f?.maintenanceOpen === true,
      overlaps: f?.otherOverlaps ?? 0,
      commitments: commitments
        .filter((c) => convs.includes(c.conversationId) && (dayEnd === null || c.dueAt < dayEnd))
        .map((c) => ({
          id: c.id,
          label: isCommitmentKind(c.kind) ? commitmentLabel(c.kind, c.topic) : c.kind,
          dueAt: c.dueAt,
          assignee: c.task?.assignedTo?.name ?? null,
        })),
      needs: items
        .filter((it) => convs.includes(it.conversationId))
        .map((it) => ({
          id: it.id,
          label: isItemKind(it.kind) ? itemKindLabel(it.kind) : "diğer",
          status: it.status === "pending_host" ? ("pending_host" as const) : ("open" as const),
          at: it.createdAt,
        })),
      accessInstructions: accessOf.get(a.propertyId) ?? null,
      checkInTime: earlyOf.get(a.id) ?? normalizeHhmm(a.property.checkInTime),
    });
    return {
      reservationId: a.id,
      propertyId: a.propertyId,
      propertyName: a.property.name,
      guestName: a.guestName,
      dayKey,
      checkInTime: earlyOf.get(a.id) ?? normalizeHhmm(a.property.checkInTime),
      conversationId: convs[0] ?? null,
      readiness,
    };
  });
  return { timeZone: tz, fromKey, toKey, rows, truncated: Math.max(0, total - arrivals.length) };
}
