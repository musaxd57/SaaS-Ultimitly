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
}
export interface PrepPlan {
  days: number;
  start: Date;
  end: Date;
  totalArrivals: number;
  /** Aggregated across the org, split by kind, qty>0, catalog order. */
  linen: PrepPlanItem[];
  consumables: PrepPlanItem[];
  /** Per-property breakdown (only properties with arrivals AND a profile). */
  perProperty: PrepPlanProperty[];
  /** Names of properties that have arrivals but NO profile yet (nudge the host). */
  missingProfile: string[];
}

/**
 * Build the prep/shopping plan for the next `days` days (default 7), starting at
 * Istanbul "today". Counts confirmed/completed arrivals per property in the window
 * and multiplies by that property's supply profile.
 */
export async function getPrepPlan(
  organizationId: string,
  opts: { days?: number; now?: Date } = {},
): Promise<PrepPlan> {
  const days = Math.max(1, Math.min(opts.days ?? 7, 60));
  const start = istanbulDayStart(opts.now ?? new Date());
  const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);

  const properties = await prisma.property.findMany({
    where: { organizationId },
    select: { id: true, name: true, supplyProfileJson: true },
  });
  if (properties.length === 0) {
    return { days, start, end, totalArrivals: 0, linen: [], consumables: [], perProperty: [], missingProfile: [] };
  }

  // Arrivals in the window, bucketed by property. Mirror the calendar's status
  // filter (confirmed/completed) so cancelled/pending bookings don't inflate needs.
  const arrivals = await prisma.reservation.groupBy({
    by: ["propertyId"],
    where: {
      propertyId: { in: properties.map((p) => p.id) },
      status: { in: ["confirmed", "completed"] },
      arrivalDate: { gte: start, lt: end },
    },
    _count: { id: true },
  });
  const arrivalsByProperty = new Map(arrivals.map((a) => [a.propertyId, a._count.id]));

  const totals = new Map<SupplyItemKey, number>();
  const perProperty: PrepPlanProperty[] = [];
  const missingProfile: string[] = [];
  let totalArrivals = 0;

  for (const p of properties) {
    const count = arrivalsByProperty.get(p.id) ?? 0;
    if (count === 0) continue;
    totalArrivals += count;
    const profile = parseSupplyProfile(p.supplyProfileJson);
    if (Object.keys(profile).length === 0) {
      missingProfile.push(p.name);
      continue;
    }
    const items: PrepPlanItem[] = [];
    for (const def of SUPPLY_ITEMS) {
      const per = profile[def.key];
      if (!per) continue;
      const qty = per * count;
      items.push({ ...def, qty });
      totals.set(def.key, (totals.get(def.key) ?? 0) + qty);
    }
    if (items.length > 0) {
      perProperty.push({ propertyId: p.id, propertyName: p.name, arrivals: count, items });
    }
  }

  const toList = (kind: "linen" | "consumable"): PrepPlanItem[] =>
    SUPPLY_ITEMS.filter((d) => d.kind === kind && (totals.get(d.key) ?? 0) > 0).map((d) => ({
      ...d,
      qty: totals.get(d.key) as number,
    }));

  return {
    days,
    start,
    end,
    totalArrivals,
    linen: toList("linen"),
    consumables: toList("consumable"),
    perProperty: perProperty.sort((a, b) => a.propertyName.localeCompare(b.propertyName, "tr")),
    missingProfile,
  };
}
