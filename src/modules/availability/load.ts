import "server-only";

import { prisma } from "@/lib/db";
import { orgTimezone } from "@/lib/timezone";
import { NON_MESSAGING_CHANNELS } from "@/lib/channels/capability";
import { listPropertyChannelLinks } from "@/lib/channels/property-links";
import { addNights, todayKey, type AvailabilityInput, type ClaimOrigin, type CoverageSource, type NightKey, type ReservationSnapshot } from "./core";

// ---------------------------------------------------------------------------
// MÜSAİTLİK MOTORU — YÜKLEYİCİ. Veritabanına dokunan TEK dosya; çekirdek (core.ts) saf kalır.
//
// 🚨 KİRACI SINIRI: her sorgu `organizationId` ile başlar; başka org'un mülkü istenirse o mülk
// sonuçta HİÇ yoktur (boş değil — yok). Çağıran "yok"u "müsait" diye okuyamaz.
// 🚨 SEÇİLMEYENLER (bilinçli): misafir adı/iletişimi, rezervasyon kodu, kanal kimliği,
// besleme URL'i (`url`/`urlEnc` bir SIRDIR). Motorun çıktısı kişisel veri taşıyamaz, çünkü
// girdisi taşımıyor.
// ---------------------------------------------------------------------------

/** Mülk başına satır tavanı; aşılırsa `loadTruncated` → boş görünen gece "bilinmiyor". */
export const RESERVATION_LOAD_CAP_PER_PROPERTY = 500;

/** Saklama biçimleri gece yarısı/öğlen UTC ya da gerçek an; ±2 gün genişletme hepsini kapsar. */
const WIDEN_MS = 2 * 86_400_000;

function keyStartUtc(key: NightKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** İddianın kökeni KANITLI alanlardan; kanal ETİKETİNDEN yetenek çıkarılmaz (değişmez 20).
 *  `ics`/`manual` OTA adı değil MEKANİZMA işaretçisidir (capability.ts). */
export function classifyClaimOrigin(r: { calendarSourceId: string | null; connectionId: string | null; channel: string }): ClaimOrigin {
  if (r.calendarSourceId !== null) return "calendar_feed";
  if (r.connectionId !== null) return "channel_connection";
  if ((NON_MESSAGING_CHANNELS as readonly string[]).includes(r.channel)) return "host_entered";
  return "channel_unattributed";
}

export interface LoadAvailabilityOptions {
  /** Boşsa org'un tüm mülkleri. */
  propertyIds?: readonly string[];
  /** Açık aralık ya da org'un KENDİ diliminde "bugünden itibaren N gece". */
  range: { from: NightKey; to: NightKey } | { nightsFromToday: number };
  now: Date;
}

export interface LoadedAvailability {
  timeZone: string;
  range: { from: NightKey; to: NightKey };
  /** Mülk kimliği → motor girdisi. Org'a ait olmayan kimlik haritada YOKTUR. */
  inputs: Map<string, AvailabilityInput>;
}

export async function loadAvailabilityInputs(organizationId: string, opts: LoadAvailabilityOptions): Promise<LoadedAvailability | null> {
  const [org, properties] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    prisma.property.findMany({
      where: { organizationId, ...(opts.propertyIds ? { id: { in: [...opts.propertyIds] } } : {}) },
      select: { id: true },
    }),
  ]);
  if (!org) return null;
  const timeZone = orgTimezone(org.timezone);
  const range =
    "nightsFromToday" in opts.range
      ? (() => {
          const from = todayKey(opts.now, timeZone);
          return { from, to: addNights(from, opts.range.nightsFromToday) };
        })()
      : opts.range;
  const out = new Map<string, AvailabilityInput>();
  if (properties.length === 0) return { timeZone, range, inputs: out };
  const ids = properties.map((p) => p.id);

  const [reservations, feeds, links] = await Promise.all([
    prisma.reservation.findMany({
      where: {
        propertyId: { in: ids },
        status: { not: "cancelled" },
        arrivalDate: { lt: new Date(keyStartUtc(range.to).getTime() + WIDEN_MS) },
        departureDate: { gt: new Date(keyStartUtc(range.from).getTime() - WIDEN_MS) },
      },
      orderBy: [{ arrivalDate: "asc" }, { id: "asc" }],
      take: RESERVATION_LOAD_CAP_PER_PROPERTY * ids.length + 1,
      select: {
        id: true,
        propertyId: true,
        arrivalDate: true,
        departureDate: true,
        status: true,
        channel: true,
        calendarSourceId: true,
        connectionId: true,
        feedLastSeenAt: true,
      },
    }),
    prisma.calendarSource.findMany({
      where: { propertyId: { in: ids } },
      select: { id: true, propertyId: true, label: true, lastStatus: true, lastSyncedAt: true },
    }),
    listPropertyChannelLinks(organizationId, ids),
  ]);

  const truncatedAll = reservations.length > RESERVATION_LOAD_CAP_PER_PROPERTY * ids.length;
  const byProperty = new Map<string, ReservationSnapshot[]>(ids.map((id) => [id, []]));
  for (const r of reservations) {
    byProperty.get(r.propertyId)?.push({
      id: r.id,
      arrival: r.arrivalDate,
      departure: r.departureDate,
      status: r.status,
      origin: classifyClaimOrigin(r),
      calendarSourceId: r.calendarSourceId,
      feedLastSeenAt: r.feedLastSeenAt,
    });
  }
  const sourcesByProperty = new Map<string, CoverageSource[]>(ids.map((id) => [id, []]));
  for (const f of feeds) {
    const lastStatus = f.lastStatus === "ok" || f.lastStatus === "error" ? f.lastStatus : null;
    sourcesByProperty.get(f.propertyId)?.push({
      id: f.id,
      kind: "calendar_feed",
      label: f.label,
      lastStatus,
      // `lastSyncedAt` son DENEMEDİR; yalnız son deneme başarılıysa başarı zamanıdır.
      lastSuccessAt: lastStatus === "ok" ? f.lastSyncedAt : null,
    });
  }
  for (const l of links) {
    sourcesByProperty.get(l.propertyId)?.push({ id: l.id, kind: "channel_link", label: l.label, lastStatus: null, lastSuccessAt: l.lastSuccessAt });
  }

  for (const id of ids) {
    const rows = byProperty.get(id) ?? [];
    out.set(id, {
      propertyId: id,
      timeZone,
      now: opts.now,
      reservations: rows,
      sources: sourcesByProperty.get(id) ?? [],
      loadTruncated: truncatedAll || rows.length > RESERVATION_LOAD_CAP_PER_PROPERTY,
    });
  }
  return { timeZone, range, inputs: out };
}
