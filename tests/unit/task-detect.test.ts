import { describe, it, expect } from "vitest";
import {
  detectOperationalTask,
  buildOperationalTaskData,
} from "@/lib/tasks/detect";

describe("detectOperationalTask", () => {
  it("routes an explicit breakage to an urgent-SLA maintenance task", () => {
    const d = detectOperationalTask("Klima çalışmıyor, çok sıcak", { intent: "amenity" });
    expect(d?.type).toBe("maintenance");
    expect(d?.slaHours).toBe(24);
  });

  it("routes a safety emergency to urgent maintenance with a tight SLA", () => {
    const d = detectOperationalTask("Gaz kokusu var, acil!", { riskType: "safety_emergency" });
    expect(d?.type).toBe("maintenance");
    expect(d?.priority).toBe("urgent");
    expect(d?.slaHours).toBe(2);
  });

  it("routes leaking/clogged EN faults to maintenance", () => {
    expect(detectOperationalTask("the sink is clogged", {})?.type).toBe("maintenance");
    expect(detectOperationalTask("bathroom is leaking", {})?.type).toBe("maintenance");
    expect(detectOperationalTask("no hot water in the shower", {})?.type).toBe("maintenance");
  });

  it("routes an item + lack signal to restock", () => {
    expect(detectOperationalTask("Havlu eksik, alabilir miyiz?", {})?.type).toBe("restock");
    expect(detectOperationalTask("we are out of toilet paper", {})?.type).toBe("restock");
    expect(detectOperationalTask("şampuan bitmiş", {})?.type).toBe("restock");
  });

  it("does NOT fire restock on a bare item question with no lack signal", () => {
    // "where are the towels?" — an informational question, not a restock request.
    expect(detectOperationalTask("havlular nerede acaba?", {})).toBeNull();
  });

  it("routes a cleanliness complaint to a cleaning task", () => {
    const d = detectOperationalTask("Oda temiz değildi, temizlik kötü", { intent: "cleaning" });
    expect(d?.type).toBe("cleaning");
    expect(d?.slaHours).toBe(12);
  });

  it("returns null for non-operational risk (refund / review threat / cancellation)", () => {
    expect(detectOperationalTask("Paramı iade edin, tazminat istiyorum", { riskType: "money_refund" })).toBeNull();
    expect(detectOperationalTask("Kötü yorum yazacağım", { riskType: "review_threat" })).toBeNull();
    expect(detectOperationalTask("Rezervasyonu iptal ediyorum", { riskType: "cancellation" })).toBeNull();
    expect(detectOperationalTask("Gerçek biriyle görüşmek istiyorum", { riskType: "human_request" })).toBeNull();
  });

  it("returns null for a neutral informational message", () => {
    expect(detectOperationalTask("Wifi şifresi nedir?", { intent: "wifi" })).toBeNull();
    expect(detectOperationalTask("Otopark var mı?", { intent: "parking" })).toBeNull();
  });

  it("prefers an explicit fault over a non-operational riskType fallback only when operational", () => {
    // A breakage with no risk signal still routes to maintenance.
    expect(detectOperationalTask("musluk akıtıyor", {})?.type).toBe("maintenance");
  });
});

describe("buildOperationalTaskData", () => {
  const now = new Date("2026-07-10T09:00:00.000Z"); // 12:00 Istanbul

  it("builds a PII-lean title (label + topic, no guest name) and a deterministic dedupe key", () => {
    const d = detectOperationalTask("musluk akıtıyor", {})!;
    const data = buildOperationalTaskData(d, { propertyId: "prop-1", message: "Ben Ahmet, musluk akıtıyor", now });
    expect(data.type).toBe("maintenance");
    expect(data.title.startsWith("Bakım:")).toBe(true);
    expect(data.title).not.toContain("Ahmet"); // guest name stays out of the title
    expect(data.dedupeKey).toBe("prop-1:maintenance:akıtıyor:2026-07-10");
    // full text is preserved in the description for context
    expect(data.description).toContain("Ahmet");
  });

  it("sets dueAt = now + slaHours", () => {
    const d = detectOperationalTask("Gaz kokusu var", { riskType: "safety_emergency" })!;
    const data = buildOperationalTaskData(d, { propertyId: "p", message: "Gaz kokusu var", now });
    expect(data.dueAt.getTime()).toBe(now.getTime() + 2 * 3600_000);
  });

  it("keys the dedupe by Istanbul calendar day (late-UTC instant still same local day)", () => {
    const lateUtc = new Date("2026-07-10T22:30:00.000Z"); // 01:30 Istanbul next day
    const d = detectOperationalTask("havlu eksik", {})!;
    const data = buildOperationalTaskData(d, { propertyId: "p", message: "havlu eksik", now: lateUtc });
    expect(data.dedupeKey).toBe("p:restock:havlu:2026-07-11");
  });
});
