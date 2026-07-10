import "server-only";

import { prisma } from "@/lib/db";
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
// Istanbul is UTC+3 year-round (no DST since 2016) — a fixed offset is safe and
// matches the calendar/reports day bucketing.
const IST_OFFSET_MS = 3 * 60 * 60 * 1000;

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

/** Istanbul-local midnight (as a UTC instant) of the day containing `now`. */
function istanbulDayStart(now: Date): Date {
  const key = now.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" }); // YYYY-MM-DD
  return new Date(Date.parse(`${key}T00:00:00Z`) - IST_OFFSET_MS);
}

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

// Guest requests older than this are assumed already handled (self-expiring v1).
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
  const start = istanbulDayStart(now);
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const [org, properties] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { supplyStockJson: true } }),
    prisma.property.findMany({
      where: { organizationId },
      select: { id: true, name: true, supplyProfileJson: true },
    }),
  ]);
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
// Task-triage-only: detect "extra towel/sheet" asks. Requires an EXPLICIT extra
// signal AND a linen item so "havlular çok güzel" never triggers. +1 per item.
const EXTRA_SIGNALS = [
  "ekstra", "fazladan", "yedek", "ilave", "bir tane daha", "bir daha", "daha alabilir",
  "daha rica", "daha istiyor", "daha verir", "daha getir", "extra", "additional",
  "one more", "some more", "more towel", "more sheet", "another towel", "another sheet",
];
const REQUEST_ITEMS: { key: SupplyItemKey; words: string[] }[] = [
  { key: "banyo_havlusu", words: ["havlu", "towel"] },
  { key: "carsaf_takimi", words: ["çarşaf", "carsaf", "sheet", "bed linen", "yatak takım"] },
  { key: "nevresim", words: ["nevresim", "duvet", "yorgan"] },
];

/** Detect explicit extra-linen requests in a guest message. Empty when none. */
export function detectSupplyRequest(message: string): { itemKey: SupplyItemKey; qty: number }[] {
  const m = message.toLowerCase();
  if (!EXTRA_SIGNALS.some((s) => m.includes(s))) return [];
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
  const detected = detectSupplyRequest(ctx.message);
  if (detected.length === 0) return 0;
  const existing = await prisma.supplyRequest.findFirst({
    where: { sourceMessageId: ctx.sourceMessageId },
    select: { id: true },
  });
  if (existing) return 0;
  await prisma.supplyRequest.createMany({
    data: detected.map((d) => ({
      propertyId: ctx.propertyId,
      reservationId: ctx.reservationId ?? null,
      itemKey: d.itemKey,
      qty: d.qty,
      sourceMessageId: ctx.sourceMessageId,
    })),
  });
  return detected.length;
}
