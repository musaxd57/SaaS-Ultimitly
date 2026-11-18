import { describe, it, expect } from "vitest";
import { DELIVERY_OUTCOMES, isDeliveryOutcome, type DeliveryOutcome } from "@/lib/delivery-outcome";
import {
  OUTBOX_STATUSES,
  NOT_DELIVERED_STATUSES,
  UNRESOLVED_DELIVERY_STATUSES,
  deliveryOutcomeOfOutboxStatus,
  type OutboxStatus,
} from "@/lib/outbox/state";
import { deliveryOutcomeOfRoute, resolveOutboundRoute } from "@/lib/channels/outbound";

// Codex 11-17 C1 — gönderim sonucu kapalı kümesi ve iki saf eşleyicisi (kuyruk durumu · giden rota).

describe("deliveryOutcomeOfOutboxStatus — kuyruk durumu → sonuç", () => {
  // `Record` her durumu ister: kuyruğa yeni bir durum eklenirse bu tablo derlenmez (eşleyicinin "kalan = queued" dalı sessiz kalmasın).
  const EXPECTED: Record<OutboxStatus, DeliveryOutcome> = {
    pending: "queued",
    sending: "queued",
    sent: "channel_accepted",
    failed: "not_delivered",
    canceled: "not_delivered",
    blocked: "not_delivered",
    ambiguous: "unverified",
    reconciling: "unverified",
    review: "unverified",
  };

  it.each(OUTBOX_STATUSES.map((s) => [s, EXPECTED[s]] as const))("%s → %s", (status, outcome) => {
    expect(deliveryOutcomeOfOutboxStatus(status)).toBe(outcome);
  });

  it("tek kaynak: 'kesinlikle gitmedi' = NOT_DELIVERED_STATUSES, 'belirsiz' = UNRESOLVED_DELIVERY_STATUSES", () => {
    const notDelivered = OUTBOX_STATUSES.filter((s) => deliveryOutcomeOfOutboxStatus(s) === "not_delivered");
    expect([...notDelivered].sort()).toEqual([...NOT_DELIVERED_STATUSES].sort());
    const unverified = OUTBOX_STATUSES.filter((s) => deliveryOutcomeOfOutboxStatus(s) === "unverified");
    expect([...unverified].sort()).toEqual([...UNRESOLVED_DELIVERY_STATUSES].sort());
  });

  it("bilinmeyen dize 'belirsiz' sayılır (ne 'gitti' ne 'gitmedi')", () => {
    expect(deliveryOutcomeOfOutboxStatus("delivered")).toBe("unverified");
    expect(deliveryOutcomeOfOutboxStatus("")).toBe("unverified");
  });
});

describe("deliveryOutcomeOfRoute — giden rota → yerel sonuç", () => {
  it("hedef yok → local_only; iç QR → qr_visible; dış hedef → null (sonuç gönderime bağlı)", () => {
    expect(deliveryOutcomeOfRoute(resolveOutboundRoute({ externalReservationId: null }))).toBe("local_only");
    expect(deliveryOutcomeOfRoute(resolveOutboundRoute({ externalReservationId: "" }))).toBe("local_only");
    expect(deliveryOutcomeOfRoute(resolveOutboundRoute({ externalReservationId: "qr-chat:abc" }))).toBe("qr_visible");
    expect(deliveryOutcomeOfRoute(resolveOutboundRoute({ externalReservationId: "res-1" }))).toBeNull();
  });
});

describe("isDeliveryOutcome", () => {
  it("yalnız kapalı kümenin üyeleri", () => {
    for (const o of DELIVERY_OUTCOMES) expect(isDeliveryOutcome(o)).toBe(true);
    expect(isDeliveryOutcome("sent")).toBe(false);
    expect(isDeliveryOutcome(undefined)).toBe(false);
    expect(isDeliveryOutcome(1)).toBe(false);
  });
});
