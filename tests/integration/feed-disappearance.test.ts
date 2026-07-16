import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import { reconcileFeedDisappearance, feedReconcileEnabled } from "@/lib/import/sync";

// FAZ 2 (#23) — feed-disappearance reconciliation. Tests drive reconcileFeedDisappearance
// directly with an injected `seenRefs` / `runStartedAt` / `now`, so every safety gate
// (threshold, min-duration, empty/suspicious-drop skip, source binding, stale-run ordering)
// is deterministic without a real network fetch.

const FUTURE_A = () => new Date(Date.now() + 10 * 86_400_000);
const FUTURE_D = () => new Date(Date.now() + 12 * 86_400_000);

async function seedSource() {
  const { orgId, propertyId } = await makeOrgWithProperty();
  const source = await prisma.calendarSource.create({
    data: { propertyId, label: "Airbnb", url: "https://example.test/cal.ics" },
  });
  return { orgId, propertyId, sourceId: source.id };
}

async function mkRes(
  propertyId: string,
  sourceId: string | null,
  ref: string,
  over: Record<string, unknown> = {},
) {
  return prisma.reservation.create({
    data: {
      propertyId, guestName: "G", channel: "airbnb", status: "confirmed",
      arrivalDate: FUTURE_A(), departureDate: FUTURE_D(),
      sourceReference: ref, calendarSourceId: sourceId, ...over,
    },
  });
}

const reconcile = (sourceId: string, propertyId: string, seen: string[], runStartedAt: Date, now = runStartedAt) =>
  reconcileFeedDisappearance({ source: { id: sourceId, propertyId }, channel: "airbnb", seenRefs: new Set(seen), runStartedAt, now });

describe("feed-disappearance reconciliation (#23, FAZ 2)", () => {
  beforeEach(resetDb);

  it("flag is DEFAULT OFF", () => {
    expect(feedReconcileEnabled()).toBe(false);
    vi.stubEnv("ICAL_DISAPPEARANCE_RECONCILE_ENABLED", "1");
    expect(feedReconcileEnabled()).toBe(true);
    vi.unstubAllEnvs();
  });

  it("a single miss (< threshold) does NOT cancel — records missingCount=1 + firstMissingAt; present rows stay 0", async () => {
    const { propertyId, sourceId } = await seedSource();
    const present = await mkRes(propertyId, sourceId, "uid-present");
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    const rec = await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect(rec.cancelled).toBe(0);
    const m = await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } });
    expect(m.feedMissingCount).toBe(1);
    expect(m.feedFirstMissingAt).toBeInstanceOf(Date);
    expect(m.status).toBe("confirmed"); // NOT cancelled on one miss
    const p = await prisma.reservation.findUniqueOrThrow({ where: { id: present.id } });
    expect(p.feedMissingCount).toBe(0);
    expect(p.feedLastSeenAt).toBeInstanceOf(Date);
  });

  it("cancels ONLY after >= threshold consecutive misses AND >= min wall-clock duration", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    // Run 1, 25h ago → miss count 1, firstMissing anchored 25h ago (below the count threshold).
    const t0 = new Date(Date.now() - 25 * 3_600_000);
    await reconcile(sourceId, propertyId, ["uid-present"], t0);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe("confirmed");
    // Run 2, now → count 2 AND gone 25h (>= 24h) → both thresholds crossed → cancel.
    const rec = await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect(rec.cancelled).toBe(1);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe("cancelled");
  });

  it("threshold reached but MIN DURATION not yet → still no cancel", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    // Two misses a minute apart — count hits 2 but the streak is only ~1 minute old.
    const t0 = new Date(Date.now() - 60_000);
    await reconcile(sourceId, propertyId, ["uid-present"], t0);
    const rec = await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect(rec.cancelled).toBe(0); // duration guard holds
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe("confirmed");
  });

  it("reappearance atomically RESETS the missing streak", async () => {
    const { propertyId, sourceId } = await seedSource();
    const missing = await mkRes(propertyId, sourceId, "uid-x", {
      feedMissingCount: 1, feedFirstMissingAt: new Date(Date.now() - 3_600_000),
    });
    await mkRes(propertyId, sourceId, "uid-present");
    await reconcile(sourceId, propertyId, ["uid-x", "uid-present"], new Date());
    const m = await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } });
    expect(m.feedMissingCount).toBe(0);
    expect(m.feedFirstMissingAt).toBeNull();
  });

  it("an EMPTY feed never increments a miss (mass-cancel guard) — warns instead", async () => {
    const { propertyId, sourceId } = await seedSource();
    const r = await mkRes(propertyId, sourceId, "uid-1");
    const rec = await reconcile(sourceId, propertyId, [], new Date());
    expect(rec.cancelled).toBe(0);
    expect(rec.warning).toMatch(/boş|okunamadı/i);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } })).feedMissingCount).toBeNull();
  });

  it("a SUSPICIOUS sudden drop is treated as partial — no miss counted, baseline KORUNUR (Codex), warns", async () => {
    const { propertyId, sourceId } = await seedSource();
    await prisma.calendarSource.update({ where: { id: sourceId }, data: { lastFeedEventCount: 10 } });
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    const rec = await reconcile(sourceId, propertyId, ["uid-other"], new Date()); // 1 event vs baseline 10
    expect(rec.warning).toMatch(/düşüş/i);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).feedMissingCount).toBeNull();
    // Baz DÜŞÜK değere ÇEKİLMEZ: aksi hâlde aynı kısmi feed sonraki turda "güvenilir"
    // sayılıp kaybolan 90 rezervasyonu iptal edebilirdi (Codex karantine-defeat).
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } })).lastFeedEventCount).toBe(10);
  });

  it("KARANTİNE KALICI (Codex): tekrarlanan aynı kısmi feed (100→10, 10, 10) 24s+2-miss sonrası bile iptal ETMEZ", async () => {
    const { propertyId, sourceId } = await seedSource();
    await prisma.calendarSource.update({ where: { id: sourceId }, data: { lastFeedEventCount: 100 } });
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    const present = Array.from({ length: 10 }, (_, i) => `uid-p${i}`);
    // 3 ardışık kısmi tur, aralarında 12'şer saat (toplam >24s, ≥2 miss penceresi).
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const rec = await reconcile(sourceId, propertyId, present, new Date(t0 + i * 12 * 3_600_000));
      expect(rec.cancelled).toBe(0); // HİÇBİR turda iptal yok — baz 100'de kalıyor, hep şüpheli
    }
    // Kayıp rezervasyon hâlâ canlı ve miss saymadı (karantina bozulmadı).
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } });
    expect(r.status).toBe("confirmed");
    expect(r.feedMissingCount).toBeNull();
    expect((await prisma.calendarSource.findUniqueOrThrow({ where: { id: sourceId } })).lastFeedEventCount).toBe(100);
  });

  it("SOURCE BINDING: a stay bound to ANOTHER source is never touched (two feeds, same UID)", async () => {
    const { propertyId } = await makeOrgWithProperty();
    const a = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://a.test/c.ics" } });
    const b = await prisma.calendarSource.create({ data: { propertyId, label: "Airbnb", url: "https://b.test/c.ics" } });
    const resB = await mkRes(propertyId, b.id, "uid-shared");
    await mkRes(propertyId, a.id, "uid-a"); // present in feed A
    await reconcile(a.id, propertyId, ["uid-a"], new Date()); // A's feed lacks uid-shared
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: resB.id } })).feedMissingCount).toBeNull();
  });

  it("legacy calendarSourceId=NULL rows are never touched", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const legacy = await mkRes(propertyId, null, "uid-legacy");
    await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: legacy.id } })).feedMissingCount).toBeNull();
  });

  it("a manual/Hospitable reservation (different channel) is not a candidate", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const manual = await mkRes(propertyId, sourceId, "uid-manual", { channel: "manual" });
    await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: manual.id } })).feedMissingCount).toBeNull();
  });

  it("a past/current stay is never a candidate (future arrivals only)", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const past = await mkRes(propertyId, sourceId, "uid-past", {
      arrivalDate: new Date(Date.now() - 5 * 86_400_000), departureDate: new Date(Date.now() - 3 * 86_400_000),
    });
    await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: past.id } })).feedMissingCount).toBeNull();
  });

  it("stale-run ordering: an OLDER run never re-increments after a NEWER run reconciled", async () => {
    const { propertyId, sourceId } = await seedSource();
    const missing = await mkRes(propertyId, sourceId, "uid-gone");
    await mkRes(propertyId, sourceId, "uid-present");
    const tNew = new Date();
    await reconcile(sourceId, propertyId, ["uid-present"], tNew);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).feedMissingCount).toBe(1);
    // A slower/older run arrives afterwards — must be ignored (else double-count).
    await reconcile(sourceId, propertyId, ["uid-present"], new Date(tNew.getTime() - 60_000));
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: missing.id } })).feedMissingCount).toBe(1);
  });

  it("on cancel, system auto-tasks are cleared but manual/ai tasks are preserved", async () => {
    const { propertyId, sourceId } = await seedSource();
    await mkRes(propertyId, sourceId, "uid-present");
    const missing = await mkRes(propertyId, sourceId, "uid-gone", {
      feedMissingCount: 1, feedFirstMissingAt: new Date(Date.now() - 25 * 3_600_000),
    });
    const sys = await prisma.task.create({
      data: { propertyId, reservationId: missing.id, type: "cleaning", title: "sys", status: "todo", origin: "system" },
    });
    const man = await prisma.task.create({
      data: { propertyId, reservationId: missing.id, type: "cleaning", title: "man", status: "todo", origin: "manual" },
    });
    const rec = await reconcile(sourceId, propertyId, ["uid-present"], new Date());
    expect(rec.cancelled).toBe(1);
    expect(await prisma.task.findUnique({ where: { id: sys.id } })).toBeNull(); // system cleared
    expect(await prisma.task.findUnique({ where: { id: man.id } })).not.toBeNull(); // manual preserved
  });
});
