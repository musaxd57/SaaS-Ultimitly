import "server-only";

import { prisma } from "@/lib/db";
import { loadEarlyCheckinFacts } from "@/lib/early-checkin/load";
import { decideEarlyCheckin, agreeRequestedTime } from "@/lib/early-checkin/core";
import { earlyCheckinPanelLines } from "@/lib/early-checkin/panel";
import { calendarDateOf } from "@/modules/availability/core";
import { formatDateTime } from "@/lib/utils";
import type { DecisionCardData, DecisionLine, ResolvedDecisionRow } from "./view-types";
import { normalizeHhmm } from "@/lib/ai/semantic/stay-change";
import {
  DECISION_STATUS_LABELS_TR,
  decisionLang,
  decisionTitle,
  formatDecisionDay,
  isOpenDecision,
  type DecisionKind,
} from "./core";
import { decisionsForReservations, type DecisionView } from "./store";

// ---------------------------------------------------------------------------
// HOST KARAR MOTORU — KONUŞMA SAYFASI KART VERİSİ (sunucu). Kontrol listesi CANLI olgulardan (sayfa her açılışta yeniden kurar):
// erken girişte kanıt modeli (`early-checkin/load` + `core` + `panel` — "AI öner"in gösterdiği listenin AYNISI, karar kartı
// görünümüyle: otomatik onaya özgü satırlar düşer, varıştan önceki günlerde hazırlık bilgidir; model çağrısı YOK); geç çıkış /
// uzatmada aynı gün devir ve önceki / sonraki geceler. Aynı gün devirde KOMŞU konaklamanın kararı da görünür: önceki misafirin
// geç çıkışı ↔ sonraki misafirin erken girişi (kurucu: "çıkış yapacak kişinin, girecek kişinin saatine bakacak") — ikisi
// birbirinden habersiz onaylanmasın.
// ---------------------------------------------------------------------------

const DAY_SUFFIX: Readonly<Record<DecisionKind, string>> = {
  early_checkin: "varış günü",
  late_checkout: "çıkış günü",
  extend_stay: "çıkış günü",
  date_change: "",
};

/** Kartın misafir alıntısı: tek satır, en fazla bu kadar kod noktası. */
const QUOTE_MAX = 220;

/** Komşu (aynı gün devir) konaklama adayları — `getAdjacency` ile aynı durum kümesi. */
const ACTIVE_STAY_STATUSES = ["confirmed", "completed"];
const NEIGHBOR_WIDEN_MS = 36 * 3_600_000;

/** Komşu kararın "verildi" sayıldığı durumlar (gönderimi doğrulanamayan da: misafire ulaşmış olabilir — temkin). */
const DECIDED: ReadonlySet<string> = new Set(["approved", "resolved_by_policy", "send_unverified"]);

/** Panelde tek satırlık kayıt olarak gösterilen sonuçlanmış kararlar (en yeni önce, tavan). */
const RESOLVED_SHOWN: ReadonlySet<string> = new Set(["approved", "declined", "resolved_by_policy", "dismissed"]);
const RESOLVED_MAX = 3;

export interface DecisionCardContext {
  organizationId: string;
  property: { id: string; checkInTime: string; checkOutTime: string };
  reservationId: string | null;
  /** Konaklamanın tarihleri (komşu konaklamaların kararları için; yoksa komşu satırı yok). */
  stay: { arrivalDate: Date; departureDate: Date } | null;
  /** Konuşmanın mesajları (kronolojik): talepten sonra misafir yazdı mı + talebin alıntısı. */
  messages: readonly { id: string; direction: string; createdAt: Date; body?: string | null }[];
  timeZone: string;
  now: Date;
  /** Komşu konaklamalar (sayfanın zaten yüklediği `getAdjacency`). */
  adjacency: { previousSameDay?: boolean; nextSameDay?: boolean } | null;
  /** Önceki / sonraki geceler (sayfanın zaten yüklediği müsaitlik özeti). */
  stayEdgeLines: readonly { text: string; tone: string }[];
  /** Erken giriş kuralı (ücret / not) — yalnız erken giriş kartında. */
  earlyRule: { fee: { amount: number; currency: string } | null; note: string | null; noteRejected?: true } | null;
}

/** Kartta görünen kartlar: karar bekleyen, gönderimi doğrulanamayan ve "yanıtladınız" (sönük; eylemler açık). */
export function visibleDecisions(views: readonly DecisionView[]): DecisionView[] {
  return views
    .filter((v) => isOpenDecision(v.effective) || v.effective === "host_replied")
    .sort((a, b) => Number(isOpenDecision(b.effective)) - Number(isOpenDecision(a.effective)) || b.messageAt.getTime() - a.messageAt.getTime());
}

/** Sonuçlanmış kararların satırları (onaylandı / reddedildi / otomatik onaylandı / kapatıldı; en yeni önce, en çok 3). */
export function resolvedDecisionRows(views: readonly DecisionView[], timeZone: string): ResolvedDecisionRow[] {
  return views
    .filter((v) => RESOLVED_SHOWN.has(v.effective))
    .sort((a, b) => (b.decidedAt ?? b.createdAt).getTime() - (a.decidedAt ?? a.createdAt).getTime())
    .slice(0, RESOLVED_MAX)
    .map((v) => {
      const t = normalizeHhmm(v.decidedTime);
      const label = DECISION_STATUS_LABELS_TR[v.effective];
      const approvedLike = v.effective === "approved" || v.effective === "resolved_by_policy";
      return {
        id: v.id,
        title: decisionTitle(v.kind, v.requestedTime),
        outcome: approvedLike && t ? `${label} · ${t}` : label,
        tone: approvedLike ? "success" : "muted",
        at: formatDateTime(v.decidedAt ?? v.createdAt, timeZone),
      };
    });
}

/**
 * Sayfada bir kartla (açık / yanıtladınız) ya da sonuç satırıyla gösterilen kararların bağlı olduğu konuşma öğeleri — "Açık
 * işler" kartı aynı talebi ikinci kez göstermesin.
 */
export function decisionLinkedItemIds(views: readonly DecisionView[]): Set<string> {
  const shown = new Set([...visibleDecisions(views), ...views.filter((v) => RESOLVED_SHOWN.has(v.effective))].map((v) => v.id));
  return new Set(views.filter((v) => shown.has(v.id) && v.itemId).map((v) => v.itemId as string));
}

/** Talebin mesajından kısa, tek satırlık alıntı (boşluklar teke iner; uzunsa kod noktası sınırında kırpılır). */
export function requestQuoteOf(body: string | null | undefined): string | null {
  const flat = (body ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const points = Array.from(flat);
  return points.length <= QUOTE_MAX ? flat : `${points.slice(0, QUOTE_MAX).join("").trimEnd()}…`;
}

interface Neighbors {
  /** Bu konaklamanın varış günü çıkan konaklamaların kararları (geç çıkış). */
  previous: DecisionView[];
  /** Bu konaklamanın çıkış günü giren konaklamaların kararları (erken giriş). */
  next: DecisionView[];
}

/** Komşu karar araması için gereken bağlam (kart bağlamının alt kümesi; sağ kutu da kullanır). */
type NeighborInput = Pick<DecisionCardContext, "organizationId" | "reservationId" | "stay" | "timeZone" | "now"> & { propertyId: string };

async function sameDayNeighborDecisions(ctx: NeighborInput, kinds: readonly DecisionKind[]): Promise<Neighbors> {
  const empty: Neighbors = { previous: [], next: [] };
  if (!ctx.stay || !ctx.reservationId) return empty;
  const wantPrev = kinds.includes("early_checkin");
  const wantNext = kinds.includes("late_checkout") || kinds.includes("extend_stay");
  if (!wantPrev && !wantNext) return empty;
  const arrKey = calendarDateOf(ctx.stay.arrivalDate, ctx.timeZone).key;
  const depKey = calendarDateOf(ctx.stay.departureDate, ctx.timeZone).key;
  const base = { propertyId: ctx.propertyId, status: { in: ACTIVE_STAY_STATUSES }, id: { not: ctx.reservationId } };
  const [prevRows, nextRows] = await Promise.all([
    wantPrev
      ? prisma.reservation.findMany({
          where: {
            ...base,
            departureDate: {
              gte: new Date(ctx.stay.arrivalDate.getTime() - NEIGHBOR_WIDEN_MS),
              lte: new Date(ctx.stay.arrivalDate.getTime() + NEIGHBOR_WIDEN_MS),
            },
          },
          select: { id: true, departureDate: true },
          take: 10,
        })
      : Promise.resolve([] as { id: string; departureDate: Date }[]),
    wantNext
      ? prisma.reservation.findMany({
          where: {
            ...base,
            arrivalDate: {
              gte: new Date(ctx.stay.departureDate.getTime() - NEIGHBOR_WIDEN_MS),
              lte: new Date(ctx.stay.departureDate.getTime() + NEIGHBOR_WIDEN_MS),
            },
          },
          select: { id: true, arrivalDate: true },
          take: 10,
        })
      : Promise.resolve([] as { id: string; arrivalDate: Date }[]),
  ]);
  const prevIds = prevRows.filter((r) => calendarDateOf(r.departureDate, ctx.timeZone).key === arrKey).map((r) => r.id);
  const nextIds = nextRows.filter((r) => calendarDateOf(r.arrivalDate, ctx.timeZone).key === depKey).map((r) => r.id);
  const [previous, next] = await Promise.all([
    decisionsForReservations(prisma, {
      organizationId: ctx.organizationId,
      reservationIds: prevIds,
      kinds: ["late_checkout"],
      timeZone: ctx.timeZone,
      now: ctx.now,
    }),
    decisionsForReservations(prisma, {
      organizationId: ctx.organizationId,
      reservationIds: nextIds,
      kinds: ["early_checkin"],
      timeZone: ctx.timeZone,
      now: ctx.now,
    }),
  ]);
  return { previous, next };
}

/** Komşunun KARARLAŞMIŞ saati (geç çıkışta en geç, erken girişte en erken) ve bekleyen talebi. */
function neighborState(views: readonly DecisionView[], pick: "latest" | "earliest") {
  let decided: string | null = null;
  for (const v of views) {
    const t = normalizeHhmm(v.decidedTime);
    if (!DECIDED.has(v.effective) || !t) continue;
    if (!decided || (pick === "latest" ? t > decided : t < decided)) decided = t;
  }
  const pending = views.find((v) => v.effective === "pending") ?? null;
  return { decided, pending, pendingTime: normalizeHhmm(pending?.requestedTime ?? null) };
}

/**
 * Aynı gün devirde komşunun KARARLAŞMIŞ saatleri — konuşma sayfasının sağ kutusu ("önceki misafir … çıkıyor") onaylı geç çıkışı /
 * erken girişi yansıtsın, kartla çelişmesin. Komşu ya da karar yoksa `null`. Okuma hatası `null` (kutu standart saati gösterir).
 */
export async function neighborDecidedTimes(input: NeighborInput): Promise<{ previousLateCheckout: string | null; nextEarlyCheckin: string | null }> {
  const n = await sameDayNeighborDecisions(input, ["early_checkin", "late_checkout"]).catch((): Neighbors => ({ previous: [], next: [] }));
  return { previousLateCheckout: neighborState(n.previous, "latest").decided, nextEarlyCheckin: neighborState(n.next, "earliest").decided };
}

function previousGuestLines(n: Neighbors): DecisionLine[] {
  const s = neighborState(n.previous, "latest");
  const lines: DecisionLine[] = [];
  if (s.decided) lines.push({ ok: true, info: true, text: `Önceki misafirin geç çıkışı onaylandı: ${s.decided}` });
  if (s.pending) {
    lines.push({
      ok: false,
      text: s.pendingTime
        ? `Önceki misafirin ${s.pendingTime} geç çıkış talebi de karar bekliyor — ikisini birlikte değerlendirin.`
        : "Önceki misafirin geç çıkış talebi de karar bekliyor — ikisini birlikte değerlendirin.",
    });
  }
  return lines;
}

function nextGuestLines(n: Neighbors, requestedTime: string | null): DecisionLine[] {
  const s = neighborState(n.next, "earliest");
  const lines: DecisionLine[] = [];
  const req = normalizeHhmm(requestedTime);
  if (s.decided) {
    lines.push({
      ok: false,
      text:
        req && req >= s.decided
          ? `İstenen çıkış (${req}), aynı gün gelen misafire onaylanan erken girişten (${s.decided}) sonra.`
          : `Aynı gün gelen misafire ${s.decided} erken giriş onaylandı — çıkış ve temizlik bu saatten önce bitmeli.`,
    });
  }
  if (s.pending) {
    lines.push({
      ok: false,
      text: s.pendingTime
        ? `Aynı gün gelen misafirin ${s.pendingTime} erken giriş talebi de karar bekliyor — ikisini birlikte değerlendirin.`
        : "Aynı gün gelen misafirin erken giriş talebi de karar bekliyor — ikisini birlikte değerlendirin.",
    });
  }
  return lines;
}

async function earlyLines(v: DecisionView, ctx: DecisionCardContext, n: Neighbors): Promise<DecisionLine[]> {
  const loaded = await loadEarlyCheckinFacts({
    organizationId: ctx.organizationId,
    propertyId: ctx.property.id,
    reservationId: ctx.reservationId,
    now: ctx.now,
    requested: agreeRequestedTime([v.requestedTime]),
    singleIntent: true,
  }).catch(() => null);
  const lines: DecisionLine[] = [];
  if (loaded) {
    const decision = decideEarlyCheckin(loaded.facts, loaded.rule);
    const panel = earlyCheckinPanelLines(
      {
        status: decision.status,
        failed: decision.failed,
        mode: loaded.rule?.mode ?? "off",
        fee: decision.fee,
        facts: {
          arrivalToday: loaded.facts.reservation?.arrivalKey === loaded.facts.todayKey,
          requestedTime: loaded.facts.requested.time,
          previousCheckout: loaded.facts.previousSameDay?.checkoutTime ?? null,
          readiness: loaded.facts.readiness,
          readinessNote: loaded.facts.readinessNote ?? "none",
          otherOverlaps: loaded.facts.otherOverlaps,
          previousNightVerifiedVacant: loaded.facts.previousNightVerifiedVacant,
          departureConfirmed: loaded.facts.departureConfirmed === true,
          openIssue: loaded.facts.openIssue === true,
          previousDeclaredCheckout: loaded.facts.previousDeclaredCheckout ?? null,
          cleaningStarted: loaded.facts.cleaningStarted === true,
        },
      },
      "decision",
    );
    for (const l of panel) lines.push({ ok: l.ok, text: l.text, ...(l.info ? { info: true } : {}) });
  }
  // Önceki misafirin kararı "beklenen çıkış" satırının HEMEN altında (o saatin nedeni); satır yoksa sona.
  const prev = previousGuestLines(n);
  const at = lines.findIndex((l) => l.text.startsWith("Önceki misafirin beklenen çıkışı"));
  lines.splice(at === -1 ? lines.length : at + 1, 0, ...prev);
  return lines;
}

function lateLines(v: DecisionView, ctx: DecisionCardContext, n: Neighbors): DecisionLine[] {
  const lines: DecisionLine[] = [{ ok: true, info: true, text: `Standart çıkış saatiniz: ${ctx.property.checkOutTime}` }];
  if (ctx.adjacency?.nextSameDay) {
    lines.push({ ok: false, text: `Aynı gün yeni misafir giriş yapıyor (standart giriş ${ctx.property.checkInTime}); temizlik süresini hesaba katın.` });
  } else if (ctx.adjacency) {
    lines.push({ ok: true, text: "Çıkış günü giriş yapan başka misafir görünmüyor." });
  }
  lines.push(...nextGuestLines(n, v.requestedTime));
  for (const l of ctx.stayEdgeLines) lines.push({ ok: l.tone !== "warn", text: l.text, ...(l.tone === "info" ? { info: true } : {}) });
  return lines;
}

export async function buildDecisionCards(views: readonly DecisionView[], ctx: DecisionCardContext): Promise<DecisionCardData[]> {
  const shown = visibleDecisions(views);
  if (shown.length === 0) return [];
  const neighbors = await sameDayNeighborDecisions(
    { ...ctx, propertyId: ctx.property.id },
    shown.map((v) => v.kind),
  ).catch((): Neighbors => ({ previous: [], next: [] }));
  const out: DecisionCardData[] = [];
  for (const v of shown) {
    const lines =
      v.kind === "early_checkin"
        ? await earlyLines(v, ctx, neighbors)
        : v.kind === "late_checkout" || v.kind === "extend_stay"
          ? lateLines(v, ctx, neighbors)
          : [];
    const later = [...ctx.messages].reverse().find((m) => m.direction === "inbound" && m.createdAt > v.messageAt) ?? null;
    const request = ctx.messages.find((m) => m.id === v.messageId) ?? null;
    const suffix = DAY_SUFFIX[v.kind];
    out.push({
      id: v.id,
      kind: v.kind,
      title: decisionTitle(v.kind, v.requestedTime),
      statusLabel: DECISION_STATUS_LABELS_TR[v.effective],
      open: isOpenDecision(v.effective),
      unverified: v.effective === "send_unverified",
      version: v.version,
      requestedTime: v.requestedTime,
      dayKey: v.dayKey,
      dayLabel: v.dayKey ? `${formatDecisionDay(v.dayKey, "tr")}${suffix ? ` (${suffix})` : ""}` : null,
      askedAt: formatDateTime(v.messageAt, ctx.timeZone),
      requestQuote: request?.direction === "inbound" ? requestQuoteOf(request.body) : null,
      standardTime: v.kind === "early_checkin" ? ctx.property.checkInTime : ctx.property.checkOutTime,
      lang: decisionLang(v.lang),
      fee: v.kind === "early_checkin" ? (ctx.earlyRule?.fee ?? null) : null,
      note: v.kind === "early_checkin" && !ctx.earlyRule?.noteRejected ? (ctx.earlyRule?.note ?? null) : null,
      lines,
      laterGuestMessageId: later?.id ?? null,
    });
  }
  return out;
}
