import { describe, it, expect, vi } from "vitest";
import type { DecisionCardData } from "@/lib/decisions/view-types";

// ---------------------------------------------------------------------------
// KARAR ÖNİZLEMESİ SIĞMAZSA (WhatsApp dilim 3, sert inceleme 10-31 F-1): WhatsApp etkileşimli mesaj gövdesi 1024 karakter; önizleme KESİLMEZ
// (ev sahibi gördüğünden fazlasını göndermesin) — Türkçesi düşer, uyarılar asla; yine sığmıyorsa önizleme YOK, panele yönlendirilir. Bu dala
// gerçek kartla ulaşmak çok sayıda uyarı ister; kart kurucu ve veritabanı sahte, düğme işleyicisi gerçek.
// ---------------------------------------------------------------------------

const longCard: DecisionCardData = {
  id: "dec00001",
  kind: "early_checkin",
  title: "13:00 erken giriş",
  statusLabel: "Karar bekliyor",
  open: true,
  unverified: false,
  sending: false,
  version: 0,
  requestedTime: "13:00",
  dayKey: "2026-11-02",
  dayLabel: "2 Kasım (varış günü)",
  askedAt: "",
  requestQuote: null,
  standardTime: "15:00",
  lang: "tr",
  fee: null,
  note: null,
  lines: ["U", "V", "W", "X"].map((c) => ({ ok: false, text: c.repeat(300) })),
  laterGuestMessageId: null,
  factsHash: "0".repeat(24),
};

vi.mock("@/lib/db", () => ({
  prisma: {
    decisionRequest: {
      findFirst: vi.fn(async () => ({
        id: "dec00001",
        conversationId: "conv1",
        messageId: "m1",
        createdAt: new Date(),
        status: "pending",
        version: 0,
      })),
    },
    hostQuestion: { updateMany: vi.fn(async () => ({ count: 0 })) },
  },
}));
vi.mock("@/lib/decisions/decide", () => ({
  freshDecisionCard: vi.fn(async () => ({ card: longCard, timeZone: "Europe/Istanbul", effective: "pending" })),
  guestWroteAfterRequest: vi.fn(async () => false),
  decideHostDecision: vi.fn(async () => {
    throw new Error("gönderim çağrılmamalı");
  }),
}));

import { DECISION_TEXTS, handleDecisionButton } from "@/lib/host-channel/decision-answer";

describe("karar önizlemesi sığmazsa", () => {
  it("önizleme gönderilmez, kesilmiş metin YOK — ev sahibi panele yönlendirilir", async () => {
    const replies: string[] = [];
    const choices = vi.fn(async () => "wamid.c1");
    const outcome = await handleDecisionButton({
      organizationId: "org1",
      user: { id: "u1", name: "Ev Sahibi" },
      parsed: { step: "choose", decisionId: "dec00001", version: 0, action: "approve" },
      replyTo: "wamid.h1",
      reply: async (t) => {
        replies.push(t);
      },
      choices,
      now: new Date(),
    });
    expect(outcome).toBe("panel");
    expect(choices).not.toHaveBeenCalled();
    expect(replies).toHaveLength(1);
    expect(replies[0]!.startsWith(DECISION_TEXTS.panelOnly)).toBe(true);
  });
});
