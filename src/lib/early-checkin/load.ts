// ---------------------------------------------------------------------------
// DOĞRULANMIŞ ERKEN GİRİŞ — OLGU YÜKLEYİCİ (09-24). Tek DB dokunuşu burası; karar `core.ts`te (saf). Her sorgu
// org kapsamlı (mülk `organizationId` ile doğrulanır). Yalnız OKUR.
//
//  · Tarih kuralı tek kaynak: müsaitlik motorunun `calendarDateOf` / `todayKey` (org saat dilimi).
//  · Önceki misafirin çıkışı: mülkün varsayılanı ile misafirin BİLDİRDİĞİ saatten hangisi daha GEÇSE (temkin —
//    erken çıkacağını söyleyen misafir gerçekte geç çıkabilir).
//  · Hazır: son çıkışa bağlı temizlik görevi "bitti" ve bunu yazan KAYDIN sunucu zamanı çıkış ANINDAN sonra, en az
//    5 dk önce (yanlışlıkla dokunma geri alınabilsin). Görev yoksa "bilinmiyor", bitmemişse "hazır değil".
//  · Kanıt modeli (09-24): yalnız KİMLİKLİ kullanıcı kaydı "bitti" sayılır ve görevin EN SON durum kaydı "bitti"
//    olmalı (geri alınıp yeniden atılmış işaretin eskisi sayılmaz); ayrılan konaklamaya bağlı TARİHSİZ temizlik görevi
//    de kümeye girer (açıksa engeller); devirde AÇIK bakım/kontrol görevi "Daireniz hazır"ı durdurur.
//  · Aynı gün devir yoksa dün gece YALNIZ müsaitlik motoru taze kaynaklarla "boş" diyorsa boş sayılır.
// ---------------------------------------------------------------------------

import { prisma } from "@/lib/db";
import { minutesOfDayInTimeZone, orgTimezone } from "@/lib/timezone";
import { addNights, calendarDateOf, describeNights, statusClassOf, todayKey } from "@/modules/availability/core";
import { loadAvailabilityInputs } from "@/modules/availability/load";
import { hhmmToMinutes, normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import type { EarlyCheckinFacts, EarlyCheckinRule } from "./core";
import { laterTime, readinessDetailOf, readyAtOf, wallClockMoment, type ReadinessMark } from "./readiness";
import { loadEarlyCheckinRule } from "./rules";

// Saf kurallar `readiness.ts`te (geçmiş mesaj taraması da aynı kuralı kullanır); eski içe aktarımlar bozulmasın.
export { laterTime, READY_SETTLE_MS, readinessDetailOf, readinessOf, readyAtOf, wallClockMoment } from "./readiness";

const DAY_MS = 86_400_000;
/** Devirde "Daireniz hazır"ı durduran açık görev türleri (temizlikçinin sorun bildirimi bakım görevi olarak açılır). */
export const EARLY_CHECKIN_ISSUE_TASK_TYPES = ["maintenance", "checkout_review"] as const;

type TaskWithUpdates = {
  status: string;
  reservationId: string | null;
  dueAt: Date | null;
  updates: { status: string | null; userId: string | null; createdAt: Date }[];
};

/**
 * Görevin hazırlık işareti: EN SON durum kaydı "bitti" VE kimlikli kullanıcıdan ise onun anı; aynı kullanıcının ondan
 * önceki EN SON "başladım" kaydı. Sistem kaydı (kullanıcısız) ya da sonradan geri alınmış "bitti" sayılmaz.
 */
export function markOfTask(t: TaskWithUpdates, departingReservationId: string): ReadinessMark {
  const statusUpdates = t.updates.filter((u) => u.status !== null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = statusUpdates[0];
  const done = latest && latest.status === "done" && latest.userId ? latest : null;
  const started = done
    ? statusUpdates.find((u) => u.status === "in_progress" && u.userId === done.userId && u.createdAt < done.createdAt)
    : undefined;
  return {
    status: t.status,
    doneAt: done ? done.createdAt : null,
    startedAt: started ? started.createdAt : null,
    linked: t.reservationId === departingReservationId,
  };
}

export async function loadEarlyCheckinFacts(args: {
  organizationId: string;
  propertyId: string;
  reservationId: string | null;
  now: Date;
  requested: EarlyCheckinFacts["requested"];
  singleIntent: boolean;
}): Promise<{ facts: EarlyCheckinFacts; rule: EarlyCheckinRule | null; readyAt: Date | null; timeZone: string } | null> {
  const property = await prisma.property.findFirst({
    where: { id: args.propertyId, organizationId: args.organizationId },
    select: { checkInTime: true, checkOutTime: true, organization: { select: { timezone: true } } },
  });
  if (!property) return null;
  const tz = orgTimezone(property.organization.timezone);
  const rule = await loadEarlyCheckinRule(args.organizationId, args.propertyId);
  const facts: EarlyCheckinFacts = {
    standardCheckIn: property.checkInTime,
    reservation: null,
    todayKey: todayKey(args.now, tz),
    nowMinutes: minutesOfDayInTimeZone(tz, args.now),
    previousSameDay: null,
    otherOverlaps: 0,
    readiness: "unknown",
    previousNightVerifiedVacant: false,
    requested: args.requested,
    singleIntent: args.singleIntent,
  };
  const own = args.reservationId
    ? await prisma.reservation.findFirst({
        where: { id: args.reservationId, propertyId: args.propertyId },
        select: { id: true, status: true, arrivalDate: true },
      })
    : null;
  if (!own) return { facts, rule, readyAt: null, timeZone: tz };
  const arrivalKey = calendarDateOf(own.arrivalDate, tz).key;
  facts.reservation = { status: own.status, arrivalKey };

  // Varış günü çevresindeki komşular (geniş pencere; günler KODDA tek tarih kuralıyla karşılaştırılır).
  const neighbours = await prisma.reservation.findMany({
    where: {
      propertyId: args.propertyId,
      id: { not: own.id },
      departureDate: { gte: new Date(own.arrivalDate.getTime() - 3 * DAY_MS) },
      arrivalDate: { lte: new Date(own.arrivalDate.getTime() + 2 * DAY_MS) },
    },
    select: { id: true, status: true, arrivalDate: true, departureDate: true, guestCheckoutTime: true },
  });
  const keyed = neighbours
    .filter((r) => statusClassOf(r.status) !== "ignored")
    .map((r) => ({ r, a: calendarDateOf(r.arrivalDate, tz).key, d: calendarDateOf(r.departureDate, tz).key }));
  const sameDay = keyed.filter((x) => x.d === arrivalKey && x.a < arrivalKey);
  const occupying = keyed.filter((x) => x.a <= arrivalKey && arrivalKey < x.d);
  // Gecesiz ya da ters kayıt varış gününe dokunuyorsa hüküm verilemez (motor da "boş" demez) → çakışma sayılır.
  const malformed = keyed.filter((x) => x.a >= x.d && (x.a === arrivalKey || x.d === arrivalKey));
  // Aynı gün iki ayrılan = biri ötekiyle çakışmış (çift rezervasyon) → çakışma sayılır.
  facts.otherOverlaps = occupying.length + Math.max(0, sameDay.length - 1) + malformed.length;
  const previous = sameDay
    .map((x) => ({ ...x, checkout: laterTime(x.r.guestCheckoutTime, property.checkOutTime) }))
    .sort((p, q) => (hhmmToMinutes(q.checkout) ?? 0) - (hhmmToMinutes(p.checkout) ?? 0))[0];
  if (previous) {
    facts.previousSameDay = { checkoutTime: previous.checkout };
    // Misafirin beklenenden ERKEN beyanı karara girmez (G2 yalnız sıkılaştırır); host bilgisi olarak taşınır.
    const declared = normalizeHhmm(previous.r.guestCheckoutTime);
    if (declared && declared !== previous.checkout) facts.previousDeclaredCheckout = declared;
  }

  // Hazırlık: referans çıkış = aynı gün ayrılan; yoksa varıştan önceki EN SON çıkış.
  let readyAt: Date | null = null;
  const reference = previous
    ? { id: previous.r.id, dayKey: previous.d, checkout: previous.checkout }
    : await (async () => {
        const last = await prisma.reservation.findFirst({
          where: { propertyId: args.propertyId, id: { not: own.id }, status: { not: "cancelled" }, departureDate: { lte: own.arrivalDate } },
          orderBy: { departureDate: "desc" },
          select: { id: true, departureDate: true, guestCheckoutTime: true },
        });
        return last
          ? { id: last.id, dayKey: calendarDateOf(last.departureDate, tz).key, checkout: laterTime(last.guestCheckoutTime, property.checkOutTime) }
          : null;
      })();
  if (reference) {
    // BU DEVRİN temizliği = çıkış GÜNÜNE bağlı temizlik görevleri (önceki rezervasyona bağlı ya da bağsız). Konaklama
    // sırasında açılmış başka bir temizlik görevi (şikâyet) kümeye girmez; çıkış günündeki her görev kapanmış olmalı.
    const dayStart = wallClockMoment(reference.dayKey, "00:00", tz);
    const dayWindow = dayStart ? { gte: new Date(dayStart.getTime() - DAY_MS), lt: new Date(dayStart.getTime() + 2 * DAY_MS) } : null;
    const tasks = await prisma.task.findMany({
      where: {
        propertyId: args.propertyId,
        type: { in: ["cleaning", ...EARLY_CHECKIN_ISSUE_TASK_TYPES] },
        OR: [{ reservationId: reference.id }, ...(dayWindow ? [{ reservationId: null, dueAt: dayWindow }] : [])],
      },
      select: {
        type: true,
        status: true,
        reservationId: true,
        dueAt: true,
        updates: { where: { status: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { status: true, userId: true, createdAt: true } },
      },
    });
    const onTurnoverDay = (t: { dueAt: Date | null }) => t.dueAt !== null && calendarDateOf(t.dueAt, tz).key === reference.dayKey;
    // BU DEVRİN temizliği: devir gününe tarihli (bağlı ya da bağsız) + ayrılan konaklamaya bağlı TARİHSİZ görev.
    const cleaning = tasks.filter((t) => t.type === "cleaning" && (onTurnoverDay(t) || (t.dueAt === null && t.reservationId === reference.id)));
    const marks = cleaning.map((t) => markOfTask(t, reference.id));
    const checkoutAt = wallClockMoment(reference.dayKey, reference.checkout, tz);
    const opts = { dayStart, allowBeforeCheckout: rule?.readyBeforeCheckout === true };
    const detail = readinessDetailOf(marks, checkoutAt, args.now, opts);
    facts.readiness = detail.status;
    facts.readinessNote = detail.note;
    facts.departureConfirmed = detail.departureConfirmed;
    readyAt = readyAtOf(marks, checkoutAt, args.now, opts);
    // G4 (bilgi): açık bir devir temizliğinin EN SON durum kaydı bugün kimlikli "başladım" → temizlikçi içeride. (Açık
    // görev varken hazırlık zaten "hazır" olamaz; ayrıca koşul gerekmez.)
    facts.cleaningStarted = cleaning.some((t) => {
      const latest = t.updates.filter((u) => u.status !== null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      return t.status === "in_progress" && latest?.status === "in_progress" && latest.userId !== null && (!dayStart || latest.createdAt >= dayStart);
    });
    // AÇIK sorun / bakım / kontrol görevi (ayrılan konaklamaya bağlı ya da devir gününe tarihli) → "hazır" denemez.
    facts.openIssue = tasks.some(
      (t) => t.type !== "cleaning" && t.status !== "done" && (t.reservationId === reference.id || (t.reservationId === null && onTurnoverDay(t))),
    );
  }

  if (!previous) {
    // Dün gece boş mu — YALNIZ motorun kanıtlı "boş" hükmü (taze kaynaklar). Köprü mülklerinde bugün "bilinmiyor".
    const range = { from: addNights(arrivalKey, -1), to: arrivalKey };
    const loaded = await loadAvailabilityInputs(args.organizationId, { propertyIds: [args.propertyId], range, now: args.now });
    const input = loaded?.inputs.get(args.propertyId);
    if (input) {
      const report = describeNights(input, range, { allowPast: true });
      facts.previousNightVerifiedVacant = report.ok && report.value.nights.length === 1 && report.value.nights[0].state === "free";
    }
  }
  return { facts, rule, readyAt, timeZone: tz };
}
