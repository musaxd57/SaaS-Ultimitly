import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// RiskEvent (Codex #32) — append-only decision history. Contracts under test:
// retry dedupe at the DB level, tenant isolation, KVKK cascade on account
// deletion, PII-free sanitization, never-throw persist, and the 30-day report
// aggregation reading HISTORY (not the mutable snapshot).

vi.mock("@/lib/report-error", () => ({ reportError: vi.fn(async () => {}) }));

import { recordRiskEvent } from "@/lib/risk-events";
import { reportError } from "@/lib/report-error";
import { deleteAccountData } from "@/lib/data-retention";

describe("recordRiskEvent", () => {
  let orgId: string;
  let propertyId: string;

  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    const made = await makeOrgWithProperty();
    orgId = made.orgId;
    propertyId = made.propertyId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  function base(over: Partial<Parameters<typeof recordRiskEvent>[0]> = {}) {
    return {
      organizationId: orgId,
      propertyId,
      surface: "auto_reply" as const,
      triggerId: "msg-1",
      finalDecision: "human_review" as const,
      riskLevel: "high",
      riskType: "complaint",
      reason: "escalated_to_human",
      confidence: 0.91,
      ...over,
    };
  }

  it("RETRY DEDUPE: the same decision for the same trigger writes exactly one row", async () => {
    await recordRiskEvent(base());
    await recordRiskEvent(base()); // retried pass — must be absorbed silently
    expect(await prisma.riskEvent.count()).toBe(1);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled(); // dedupe is not an error
  });

  it("TENANT-SCOPED KEY: two orgs with the IDENTICAL surface/triggerId/decision both record", async () => {
    // triggerId is a cuid today, but a future surface may carry provider message
    // ids — two tenants can legitimately share the same trigger string, and one
    // must never mask the other's event (the report would undercount).
    const b = await prisma.organization.create({ data: { name: "B" } });
    await recordRiskEvent(base({ triggerId: "provider-msg-777" }));
    await recordRiskEvent(base({ organizationId: b.id, triggerId: "provider-msg-777" }));
    expect(await prisma.riskEvent.count()).toBe(2);
    expect(vi.mocked(reportError)).not.toHaveBeenCalled();
  });

  it("CONFIDENCE: in-range kept exactly; NaN/Infinity/out-of-range become NULL (never clamped)", async () => {
    const cases: Array<[string, number, number | null]> = [
      ["c1", 0.91, 0.91],
      ["c2", 0, 0],
      ["c3", 1, 1],
      ["c4", NaN, null],
      ["c5", Infinity, null],
      ["c6", 1.7, null],
      ["c7", -0.2, null],
    ];
    for (const [t, input] of cases) await recordRiskEvent(base({ triggerId: t, confidence: input }));
    for (const [t, , expected] of cases) {
      const row = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: t } });
      expect(row.confidence).toBe(expected);
    }
  });

  it("a LEGITIMATE transition (held → sent) still records its own row", async () => {
    await recordRiskEvent(base());
    await recordRiskEvent(base({ finalDecision: "auto_sent", riskLevel: "low", reason: "gate_passed" }));
    expect(await prisma.riskEvent.count()).toBe(2);
  });

  it("PII can never round-trip: values outside the CLOSED SETS become null", async () => {
    await recordRiskEvent(
      base({
        riskType: "Complaint: Ada Lovelace +90 555 111 22 33 <ada@x.com>",
        reason: "Kapı kodu 4821 çalışmıyor!!",
      }),
    );
    const row = await prisma.riskEvent.findFirstOrThrow();
    // Not sanitized-but-kept — free text is simply NOT a known code → null.
    expect(row.riskType).toBeNull();
    expect(row.reason).toBeNull();
    // Known codes pass through untouched.
    await recordRiskEvent(base({ triggerId: "msg-2", riskType: "complaint", reason: "gate_passed" }));
    const ok = await prisma.riskEvent.findFirstOrThrow({ where: { triggerId: "msg-2" } });
    expect(ok.riskType).toBe("complaint");
    expect(ok.reason).toBe("gate_passed");
  });

  it("NEVER-THROW + visible failure: a DB error is reported, not raised (delivery semantics safe)", async () => {
    // Org deleted under our feet → FK violation on create — NOT the dedupe constraint.
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await expect(recordRiskEvent(base())).resolves.toBeUndefined();
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
  });

  it("TENANT ISOLATION + KVKK cascade: org B never sees org A; account deletion erases history", async () => {
    const b = await prisma.organization.create({ data: { name: "B" } });
    await recordRiskEvent(base());
    await recordRiskEvent(base({ organizationId: b.id, triggerId: "msg-b" }));

    expect(await prisma.riskEvent.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.riskEvent.count({ where: { organizationId: b.id } })).toBe(1);

    await deleteAccountData(orgId); // KVKK erasure → cascade
    expect(await prisma.riskEvent.count({ where: { organizationId: orgId } })).toBe(0);
    expect(await prisma.riskEvent.count({ where: { organizationId: b.id } })).toBe(1); // untouched
  });

  it("REPORT AGGREGATION: 30-day window over history, per tenant, old events excluded", async () => {
    const b = await prisma.organization.create({ data: { name: "B" } });
    await recordRiskEvent(base({ triggerId: "m1", riskLevel: "high" }));
    await recordRiskEvent(base({ triggerId: "m2", riskLevel: "medium", reason: "low_confidence_or_risky" }));
    await recordRiskEvent(base({ triggerId: "m3", surface: "alerts", riskLevel: null, reason: "keyword_escalated" }));
    await recordRiskEvent(base({ organizationId: b.id, triggerId: "m4", riskLevel: "high" })); // foreign tenant
    // A 40-day-old event — must fall outside the window (raw SQL: occurredAt has a default).
    await recordRiskEvent(base({ triggerId: "m-old" }));
    await prisma.$executeRaw`UPDATE "RiskEvent" SET "occurredAt" = now() - interval '40 days' WHERE "triggerId" = 'm-old'`;

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const levels = await prisma.riskEvent.groupBy({
      by: ["riskLevel"],
      where: { organizationId: orgId, occurredAt: { gte: since }, riskLevel: { not: null } },
      _count: { _all: true },
    });
    const count = (l: string) => levels.find((r) => r.riskLevel === l)?._count._all ?? 0;
    expect(count("high")).toBe(1); // m1 only — m-old aged out, m4 is org B
    expect(count("medium")).toBe(1);

    const held = await prisma.riskEvent.count({
      where: { organizationId: orgId, occurredAt: { gte: since }, finalDecision: "human_review" },
    });
    expect(held).toBe(3); // m1 + m2 + m3 (keyword event counted WITHOUT a fabricated level)
  });
});
