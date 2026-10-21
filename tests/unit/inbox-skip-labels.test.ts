import { describe, it, expect } from "vitest";
import { SKIP_REASON_ACTIONS, SKIP_REASON_LABELS } from "@/lib/inbox-skip-labels";
import { SETTINGS_NAV } from "@/lib/settings-nav";
import { HAZARD_UNVERIFIED_REASON } from "@/lib/hazard-unverified-alert";
import { MESSAGE_TOO_LONG_REASON } from "@/lib/ai/message-length";
import { HANDOFF_NOTICE_REASON } from "@/lib/ai/output-veto";
import { RESERVATION_CANCELLED_NOTE } from "@/lib/inbox-skip-note";
import { BILLING_PAUSED_REASON } from "@/lib/outbox/billing-hold";
import { CHANNEL_PAUSED_REASON } from "@/lib/outbox/worker";
import { PROVIDER_OUTAGE_REASON, sendFailureReason } from "@/lib/outbox/state";
import { CLOSING_HANDLED_REASON, CLOSING_OPEN_REASON } from "@/lib/conversation-attention";

// ---------------------------------------------------------------------------
// Konuşma sayfası bandı (UX incelemesi 10-21 N): `Conversation.skippedReason`a YAZILAN her gerekçenin etiketi olmalı. Etiketsiz gerekçe
// "Otomatik yanıt beklemede" yedeğine düşer — olası tehlike konuşmasında (T2) bant yapay zekânın sonra cevap vereceğini ima ediyordu.
// Liste: `persistRiskVisibility` çağrıları + doğrudan `data: { skippedReason }` yazımları (automation, outbox işçisi, tehlike uyarısı,
// olay paneli, senkron). Yeni bir gerekçe yazan kod eklenince BURAYA da eklenir.
// ---------------------------------------------------------------------------

const PERSISTED_REASONS = [
  "human_hold",
  "reservation_ended",
  "outside_hours",
  MESSAGE_TOO_LONG_REASON,
  CLOSING_HANDLED_REASON,
  CLOSING_OPEN_REASON,
  "not_connected",
  "daily_budget",
  "low_confidence_or_risky",
  "ai_unavailable",
  "escalated_to_human",
  "complaint",
  "ai_unusable",
  "delivery_unverified",
  PROVIDER_OUTAGE_REASON,
  BILLING_PAUSED_REASON,
  CHANNEL_PAUSED_REASON,
  "auto_reply_disabled",
  HAZARD_UNVERIFIED_REASON,
  sendFailureReason("blocked"),
  sendFailureReason("rate_limited"),
  sendFailureReason("definitive_failure"),
  sendFailureReason("ambiguous"),
];

/** Yalnız gösterimde türetilen anahtarlar (`skipNoteReasonFor`). */
const DISPLAY_ONLY = [HANDOFF_NOTICE_REASON, RESERVATION_CANCELLED_NOTE];

describe("konuşma bandı etiketleri", () => {
  it("kaydedilen her gerekçenin ve gösterim anahtarının etiketi var", () => {
    const missing = [...PERSISTED_REASONS, ...DISPLAY_ONLY].filter((r) => !SKIP_REASON_LABELS[r]);
    expect(missing).toEqual([]);
  });

  it("olası tehlike: 'beklemede' demez, ev sahibini misafire ulaşmaya çağırır", () => {
    const label = SKIP_REASON_LABELS[HAZARD_UNVERIFIED_REASON];
    expect(label).toContain("olası bir tehlike");
    expect(label).toContain("cevap vermedi");
    expect(label).not.toMatch(/beklemede/i);
  });

  it("C: bağlantı / saat / plan sebeplerinde eylem bağlantısı var ve gerçek bir ayar sekmesine gider", () => {
    const tabs = new Set(SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id)));
    for (const reason of ["outside_hours", "not_connected", sendFailureReason("definitive_failure"), sendFailureReason("blocked"), "daily_budget", BILLING_PAUSED_REASON]) {
      const action = SKIP_REASON_ACTIONS[reason];
      expect(action, reason).toBeTruthy();
      expect(tabs.has(new URL(action.href, "https://x.test").searchParams.get("tab") ?? "")).toBe(true);
    }
    // Belirsiz teslimde ilk iş kanalı kontrol etmek — "bağlantıyı aç" yanlış yönlendirir; tehlikede eylem konuşmanın kendisi.
    expect(SKIP_REASON_ACTIONS[sendFailureReason("ambiguous")]).toBeUndefined();
    expect(SKIP_REASON_ACTIONS[HAZARD_UNVERIFIED_REASON]).toBeUndefined();
  });
});
