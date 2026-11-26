// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// Dikkat kartı telefonda (kurucu 11-20: "telefonda kesinlikle panelleri kontrol et"; FB gezisi 11-20 akşam, gerçek uygulama 390 px):
// başlık "Çıkışı yaklaşan misafir 7 saattir cevap b…" diye, ikinci satır da SONUNDAKİ yapılacak işten ("· onaylayın ya da reddedin",
// "· takvimi kontrol edin", "· 2 sa gecikti") kesiliyordu. Satırın hiçbir metni kesilmez, alt satıra iner — tür ayrımı yok.
// jsdom yerleşim ölçmez; pin sınıf düzeyindedir (kesme `truncate` sınıfıyla yapılıyordu), gerçek ekran ölçümü gezi raporunda.

afterEach(cleanup);

const base = { propertyId: "p1", propertyName: "Lale 3", occurredAt: new Date("2026-09-09T00:00:00Z"), certainty: "observed" as const, severity: 50 };

const ITEMS: AttentionItem[] = [
  { ...base, kind: "departing_unanswered", href: "/inbox/c1", hoursWaiting: 7 },
  { ...base, kind: "unanswered_aging", href: "/inbox/c2", hoursWaiting: 8 },
  { ...base, kind: "decision_pending", href: "/inbox/c3", decisionTitle: "13:00 erken giriş", certainty: "inferred" },
  { ...base, kind: "held_request", href: "/inbox/c4", requestCount: 2 },
  { ...base, kind: "feed_broken", href: "/properties/p1", sourceLabel: "Airbnb" },
  { ...base, kind: "recurring_issue", href: "/properties/p1", category: "complaint", evidenceCount: 3, certainty: "inferred" },
  {
    ...base,
    kind: "calendar_conflict",
    href: "/calendar",
    nights: { from: "2026-10-05", to: "2026-10-07" },
    certainty: "inferred",
    money: { kind: "unknown", reason: "no_rate" },
  },
  { ...base, kind: "commitment_due", href: "/inbox/c5", minutesLeft: -120, commitmentTime: "15:00" },
  { ...base, kind: "connection_unhealthy", href: "/settings", minutesSinceOk: 90 },
  { ...base, kind: "booking_gap", href: "/calendar", nights: { from: "2026-10-05", to: "2026-10-06" }, certainty: "inferred" },
  { ...base, kind: "channel_reactivation", href: "/reservations/r1", reservationId: "r1" },
  { ...base, kind: "provider_outage", href: "/inbox", waitingCount: 12 },
  { ...base, kind: "booking_two_properties", href: "/reservations/compare/r1", bookingPropertyNames: ["Lale 3", "Sahil Evi"], autoSendStopped: true },
];

const ARRIVAL = { reservationId: "r9", propertyName: "Lale 5", checkInTime: "15:00", firstBlocking: "Temizlik açık · atanan: Ayşe · başlanmadı", moreBlocking: 1 };

describe("Dikkat kartı — telefonda hiçbir satır kesilmez", () => {
  it("her türün başlığı, ikinci satırı ve tutar satırı alt satıra iner (truncate YOK, break-words VAR)", () => {
    const { container } = render(<AttentionPanel items={ITEMS} arrivals={[ARRIVAL]} canManageReservations />);
    const rows = [...container.querySelectorAll("a[href]")];
    // Anti-vakum: her tür + giriş satırı gerçekten basıldı (yoksa döngü boş kümede yeşil kalır).
    expect(rows.length).toBe(ITEMS.length + 1);
    const paragraphs = [...container.querySelectorAll("a[href] p")];
    expect(paragraphs.length).toBeGreaterThanOrEqual(rows.length * 2);
    for (const p of paragraphs) {
      expect(p.className, p.textContent ?? "").not.toMatch(/\btruncate\b/);
      // Giriş satırının ikinci satırı iki satıra sınırlıdır (line-clamp-2) — o da sarar, kesme tek satırda değildir.
      expect(p.className, p.textContent ?? "").toMatch(/\bbreak-words\b/);
    }
    // Tutar satırı da basıldı (çakışma + gecelik fiyat yok) ve aynı kurala uyuyor.
    expect(container.textContent).toContain("Tutarı görmek için bu dairenin gecelik fiyat aralığını ekleyin.");
  });
});
