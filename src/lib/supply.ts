import "server-only";

import { prisma } from "@/lib/db";
import { foldTurkishLower } from "@/lib/ai/fallback";
import { orgTimezone, zonedDayRange, addZonedDays } from "@/lib/timezone";
import {
  SUPPLY_ITEMS,
  SUPPLY_ITEM_KEYS,
  type SupplyItemKey,
  type SupplyItemDef,
} from "@/lib/constants";

// Deterministic supply/linen prep planning. NO AI, NO guest-count guessing: a
// turnover strips every bed regardless of headcount, so the need is driven by the
// per-property profile (set once by the host) × the number of ARRIVALS in a date
// range (which we already know from the reservation sync — same data the calendar
// uses). plan = Σ_property (arrivals × profile).

const KEY_SET = new Set<string>(SUPPLY_ITEM_KEYS);

export type SupplyProfile = Partial<Record<SupplyItemKey, number>>;

/** Parse the stored JSON into a clean {key: qty>0} map; tolerant of bad data. */
export function parseSupplyProfile(json: string | null | undefined): SupplyProfile {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== "object") return {};
    const out: SupplyProfile = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!KEY_SET.has(k)) continue;
      const n = Math.floor(Number(v));
      if (Number.isFinite(n) && n > 0) out[k as SupplyItemKey] = Math.min(n, 999);
    }
    return out;
  } catch {
    return {};
  }
}

/** Serialize a profile for storage: drop zero/invalid entries; empty → null (clear). */
export function serializeSupplyProfile(
  profile: Record<string, number | undefined> | null | undefined,
): string | null {
  if (!profile) return null;
  const clean: SupplyProfile = {};
  for (const [k, v] of Object.entries(profile)) {
    if (!KEY_SET.has(k)) continue;
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0) clean[k as SupplyItemKey] = Math.min(n, 999);
  }
  return Object.keys(clean).length === 0 ? null : JSON.stringify(clean);
}

/**
 * Turn a supply profile into a task checklist (`{label, done}[]`, catalog order)
 * for ONE turnover — e.g. [{label:"Çarşaf takımı × 2", done:false}, …]. Empty
 * profile → empty array (no checklist added). Shared by the turnover-task builder.
 */
export function buildSupplyChecklist(profile: SupplyProfile): { label: string; done: boolean }[] {
  return SUPPLY_ITEMS.filter((d) => (profile[d.key] ?? 0) > 0).map((d) => ({
    label: `${d.label} × ${profile[d.key]}`,
    done: false,
  }));
}

// (Sabit istanbulDayStart kaldırıldı — gün başlangıcı artık org.timezone ile
//  zonedDayRange'den gelir; DST'li dilimlerde sabit-offset matematiği yanlıştı.)

export interface PrepPlanItem extends SupplyItemDef {
  qty: number;
}
export interface PrepPlanProperty {
  propertyId: string;
  propertyName: string;
  arrivals: number;
  items: PrepPlanItem[];
  /** Guest-requested extras folded into `items` above; listed for a "misafir talebi" note. */
  requests: { label: string; qty: number }[];
}
/** Aggregate line: gross need, on-hand stock, and the net amount to actually buy. */
export interface PrepPlanAggItem extends SupplyItemDef {
  need: number;
  onHand: number;
  toBuy: number;
}
export interface PrepPlan {
  days: number;
  start: Date;
  end: Date;
  totalArrivals: number;
  /** Aggregated across the org, split by kind, need>0, catalog order. */
  linen: PrepPlanAggItem[];
  consumables: PrepPlanAggItem[];
  /** Per-property breakdown (gross per-flat need incl. guest requests). */
  perProperty: PrepPlanProperty[];
  /** Names of properties that have arrivals but NO profile yet (nudge the host). */
  missingProfile: string[];
  /** True when any on-hand stock is set → the UI shows "net alınacak". */
  hasStock: boolean;
}

// Requests older than this are assumed already handled: the row STAYS in the DB,
// it is just no longer counted by the plan (falls outside this lookback window).
const REQUEST_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Build the prep/shopping plan for the next `days` days (default 7), starting at
 * Istanbul "today". need = confirmed/completed arrivals × the property's profile,
 * PLUS recent guest extra-supply requests; the aggregate subtracts on-hand org
 * stock to show the NET amount to buy.
 */
export async function getPrepPlan(
  organizationId: string,
  opts: { days?: number; now?: Date } = {},
): Promise<PrepPlan> {
  const days = Math.max(1, Math.min(opts.days ?? 7, 60));
  const now = opts.now ?? new Date();

  const [org, properties] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: organizationId },
      select: { supplyStockJson: true, timezone: true },
    }),
    prisma.property.findMany({
      where: { organizationId },
      select: { id: true, name: true, supplyProfileJson: true },
    }),
  ]);
  // "Today" starts at the HOST'S local midnight (org.timezone), matching the
  // dashboard/calendar day bucketing. Horizon end = +days CALENDAR days (not
  // fixed 24h steps — DST'li dilimlerde geçiş günü sınırı kaydırırdı; Istanbul'da birebir aynı).
  const supplyTz = orgTimezone(org?.timezone);
  const start = zonedDayRange(now, supplyTz).start;
  const end = addZonedDays(start, days, supplyTz);
  const stock = parseSupplyProfile(org?.supplyStockJson); // same { key: qty } shape
  const hasStock = Object.keys(stock).length > 0;
  const empty: PrepPlan = { days, start, end, totalArrivals: 0, linen: [], consumables: [], perProperty: [], missingProfile: [], hasStock };
  if (properties.length === 0) return empty;

  const ids = properties.map((p) => p.id);
  // Arrivals in the window, bucketed by property. Mirror the calendar's status
  // filter (confirmed/completed) so cancelled/pending bookings don't inflate needs.
  const [arrivals, requestsRaw] = await Promise.all([
    prisma.reservation.groupBy({
      by: ["propertyId"],
      where: { propertyId: { in: ids }, status: { in: ["confirmed", "completed"] }, arrivalDate: { gte: start, lt: end } },
      _count: { id: true },
    }),
    prisma.supplyRequest.findMany({
      where: { propertyId: { in: ids }, createdAt: { gte: new Date(now.getTime() - REQUEST_LOOKBACK_MS) } },
      select: { propertyId: true, itemKey: true, qty: true },
    }),
  ]);
  const arrivalsByProperty = new Map(arrivals.map((a) => [a.propertyId, a._count.id]));
  // property → itemKey → summed requested qty (only known catalog keys)
  const reqByProperty = new Map<string, Map<SupplyItemKey, number>>();
  for (const r of requestsRaw) {
    if (!KEY_SET.has(r.itemKey)) continue;
    const m = reqByProperty.get(r.propertyId) ?? new Map<SupplyItemKey, number>();
    m.set(r.itemKey as SupplyItemKey, (m.get(r.itemKey as SupplyItemKey) ?? 0) + r.qty);
    reqByProperty.set(r.propertyId, m);
  }

  const totals = new Map<SupplyItemKey, number>();
  const perProperty: PrepPlanProperty[] = [];
  const missingProfile: string[] = [];
  let totalArrivals = 0;

  for (const p of properties) {
    const count = arrivalsByProperty.get(p.id) ?? 0;
    totalArrivals += count;
    const profile = parseSupplyProfile(p.supplyProfileJson);
    const reqMap = reqByProperty.get(p.id);
    const itemQty = new Map<SupplyItemKey, number>();

    if (count > 0 && Object.keys(profile).length > 0) {
      for (const def of SUPPLY_ITEMS) {
        const per = profile[def.key];
        if (per) itemQty.set(def.key, per * count);
      }
    }
    const reqList: { label: string; qty: number }[] = [];
    if (reqMap) {
      for (const def of SUPPLY_ITEMS) {
        const q = reqMap.get(def.key);
        if (!q) continue;
        itemQty.set(def.key, (itemQty.get(def.key) ?? 0) + q);
        reqList.push({ label: def.label, qty: q });
      }
    }

    if (itemQty.size === 0) {
      // Arrivals but no profile (and no request) → nudge the host to set a profile.
      if (count > 0 && Object.keys(profile).length === 0) missingProfile.push(p.name);
      continue;
    }
    const items = SUPPLY_ITEMS.filter((d) => itemQty.has(d.key)).map((d) => ({ ...d, qty: itemQty.get(d.key) as number }));
    for (const [k, q] of itemQty) totals.set(k, (totals.get(k) ?? 0) + q);
    perProperty.push({ propertyId: p.id, propertyName: p.name, arrivals: count, items, requests: reqList });
  }

  const toAgg = (kind: "linen" | "consumable"): PrepPlanAggItem[] =>
    SUPPLY_ITEMS.filter((d) => d.kind === kind && (totals.get(d.key) ?? 0) > 0).map((d) => {
      const need = totals.get(d.key) as number;
      const onHand = stock[d.key] ?? 0;
      return { ...d, need, onHand, toBuy: Math.max(0, need - onHand) };
    });

  return {
    days,
    start,
    end,
    totalArrivals,
    linen: toAgg("linen"),
    consumables: toAgg("consumable"),
    perProperty: perProperty.sort((a, b) => a.propertyName.localeCompare(b.propertyName, "tr")),
    missingProfile,
    hasStock,
  };
}

// --- Guest extra-supply requests (message → +1 in the plan) ------------------
// Task-triage-only, opt-in (Organization.autoSupplyRequestEnabled). Detection is
// deliberately CONSERVATIVE — an over-count is a wrong shopping number, so we'd
// rather miss a real ask than invent one. A message must, together:
//   • carry an "extra/more" signal (wants ADDITIONAL, not the standard set), AND
//   • carry a real REQUEST verb (asking for it, not discussing it), AND
//   • name a linen item, AND
//   • NOT contain a negation ("istemiyorum", "getirmeyin"), AND
//   • NOT be an availability/price QUESTION ("var mı?", "ücretli mi?").
const EXTRA_SIGNALS = [
  "ekstra", "fazladan", "yedek", "ilave", "daha", "extra", "additional", "one more",
  "another", "more",
];
// A genuine ask (vs. praise / complaint / statement). Without one of these we skip.
const REQUEST_VERBS = [
  "alabilir mi", "alabilirmiyim", "alabilir miyiz", "getirir mi", "getirebilir",
  "getirir misiniz", "verir mi", "verebilir", "rica ", "istiyorum", "istiyoruz",
  "isteriz", "isterim", "lütfen", "lutfen", "mümkün mü", "mumkun mu", "gönderir mi",
  "could we get", "could i get", "can we get", "can i get", "can we have", "can i have",
  "may we", "may i", "please bring", "please send", "we need", "i need", "would like",
  "we'd like", "we would like",
];
// Explicit refusals → never a request (the guest is declining).
const REQUEST_NEGATIONS = [
  "istemiyor", "istemem", "istemeyiz", "istemedik", "istemez", "getirmeyin", "getirme",
  "gerek yok", "gerekmiyor", "lazım değil", "lazim degil", "no need", "don't need",
  "do not need", "no towel", "without",
];
// Availability / price questions → an inquiry, not a request.
const REQUEST_QUESTIONS = [
  "var mı", "var mi", "ücretli mi", "ucretli mi", "ne kadar", "kaç para", "kac para",
  "kaç tl", "kac tl", "fiyat", "how much", "is there", "are there", "do you have",
  "extra charge", "any charge", "cost",
];
const REQUEST_ITEMS: { key: SupplyItemKey; words: string[] }[] = [
  { key: "banyo_havlusu", words: ["havlu", "towel"] },
  { key: "carsaf_takimi", words: ["çarşaf", "carsaf", "sheet", "bed linen", "yatak takım"] },
  { key: "nevresim", words: ["nevresim", "duvet", "yorgan"] },
];

/** Detect explicit extra-linen requests in a guest message. Empty when none. */
export function detectSupplyRequest(message: string): { itemKey: SupplyItemKey; qty: number }[] {
  // foldTurkishLower: a sentence-initial İ ("İki havlu daha…") must still match.
  const m = foldTurkishLower(message);
  // Guards first (order-independent): refusal or an availability/price question
  // means it is NOT a request, even if extra/item words are present.
  if (REQUEST_NEGATIONS.some((w) => m.includes(w))) return [];
  if (REQUEST_QUESTIONS.some((w) => m.includes(w))) return [];
  if (!EXTRA_SIGNALS.some((s) => m.includes(s))) return [];
  if (!REQUEST_VERBS.some((v) => m.includes(v))) return [];
  const out: { itemKey: SupplyItemKey; qty: number }[] = [];
  for (const it of REQUEST_ITEMS) {
    if (it.words.some((w) => m.includes(w))) out.push({ itemKey: it.key, qty: 1 });
  }
  return out;
}

/**
 * Record any extra-supply requests found in an inbound guest message, deduped by
 * the triggering message so a re-sync can't double-count. Best-effort; never throws.
 * Returns how many request rows were created.
 */
export async function recordSupplyRequestFromMessage(ctx: {
  propertyId: string;
  message: string;
  sourceMessageId: string;
  reservationId?: string | null;
}): Promise<number> {
  // Cheap keyword pass first; only hit the DB when it looks like a request.
  const detected = detectSupplyRequest(ctx.message);
  if (detected.length === 0) return 0;
  // Opt-in per org (default OFF) — the host chooses to trust message parsing.
  const prop = await prisma.property.findUnique({
    where: { id: ctx.propertyId },
    select: { organization: { select: { autoSupplyRequestEnabled: true } } },
  });
  if (!prop?.organization?.autoSupplyRequestEnabled) return 0;

  const existing = await prisma.supplyRequest.findFirst({
    where: { sourceMessageId: ctx.sourceMessageId },
    select: { id: true },
  });
  if (existing) return 0;
  // skipDuplicates makes the @@unique([sourceMessageId,itemKey]) a race-proof
  // backstop: a concurrent second sync silently no-ops instead of throwing.
  const res = await prisma.supplyRequest.createMany({
    data: detected.map((d) => ({
      propertyId: ctx.propertyId,
      reservationId: ctx.reservationId ?? null,
      itemKey: d.itemKey,
      qty: d.qty,
      sourceMessageId: ctx.sourceMessageId,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
