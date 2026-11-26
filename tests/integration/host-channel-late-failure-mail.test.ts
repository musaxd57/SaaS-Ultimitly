import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// Codex 11-04 P2 — WhatsApp bilgi / karar bildirimi KABUL edildi (e-posta bastırıldı), sağlayıcı SONRADAN "failed" dedi → bugünkü e-postanın
// AYNISI yedek olarak gider; yinelenen bildirim tek e-posta; cevaplanmış soru / kapanmış karar için e-posta yok; e-posta düşerse yeniden.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({ emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) } }));

import { emailService } from "@/lib/email";
import { scheduleLateFailureMails, deliverDueLateFailureMails, LATE_FAIL_MAIL_PREFIX } from "@/lib/host-channel/late-failure-mail";

const mockMail = vi.mocked(emailService.sendReporting);

async function seed(kind: "info" | "decision", opts: { answered?: boolean; decisionStatus?: string } = {}) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.organization.update({ where: { id: orgId }, data: { alertEmail: "host@example.com" } });
  const conv = await prisma.conversation.create({
    data: { propertyId, channel: "airbnb", guestIdentifier: "Deniz", status: "new", externalReservationId: `res-${kind}` },
  });
  const msg = await prisma.message.create({
    data: { conversationId: conv.id, direction: "inbound", authorType: "guest", senderName: "Deniz", body: "Erken girebilir miyiz?" },
  });
  const decision =
    kind === "decision"
      ? await prisma.decisionRequest.create({
          data: { organizationId: orgId, conversationId: conv.id, messageId: msg.id, kind: "early_checkin", lang: "tr", requestedTime: "12:00", dayKey: "2026-11-05", status: opts.decisionStatus ?? "pending" },
        })
      : null;
  const q = await prisma.hostQuestion.create({
    data: {
      organizationId: orgId,
      conversationId: conv.id,
      kind,
      turnMessageId: msg.id,
      decisionId: decision?.id ?? null,
      status: "sent",
      idempotencyKey: kind === "info" ? `turn:${msg.id}` : `decision:${decision!.id}:v1`,
      providerMessageId: `wamid.${kind}`,
      sentAt: new Date(),
      answeredAt: opts.answered ? new Date() : null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return { q, conv };
}

beforeEach(async () => {
  await resetDb();
  mockMail.mockReset();
  mockMail.mockResolvedValue({ ok: true } as never);
});

describe("ulaşmayan bilgi / karar bildirimi → e-posta yedeği", () => {
  it("🚨 bilgi sorusu: 'failed' (iki kez yinelenen) → TEK e-posta, bugünkü konu satırı; bildirim 'failed' işaretlenir", async () => {
    const { q } = await seed("info");
    expect(await scheduleLateFailureMails(["wamid.info", "wamid.info"])).toBe(1);
    expect(await scheduleLateFailureMails(["wamid.info"])).toBe(0);
    await deliverDueLateFailureMails();
    await deliverDueLateFailureMails();
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(mockMail.mock.calls[0][0]).toBe("host@example.com");
    expect(String(mockMail.mock.calls[0][1])).toMatch(/^Misafir cevabınızı bekliyor — Deniz/);
    // Sağlayıcıya tekrar anahtarı (kira dolup ikinci geçiş denese de tek e-posta).
    expect(mockMail.mock.calls[0][3]).toEqual({ idempotencyKey: `${LATE_FAIL_MAIL_PREFIX}${q.id}` });
    expect((await prisma.hostQuestion.findUniqueOrThrow({ where: { id: q.id } })).status).toBe("failed");
  });

  it("ev sahibi bildirimden SONRA misafire yazdıysa (iş görülmüş) bilgi e-postası gitmez; bildirimden ÖNCEKİ yazısı engellemez", async () => {
    const { q, conv } = await seed("info");
    const sentAt = q.sentAt!;
    await prisma.message.create({
      data: { conversationId: conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Önceki cevap", createdAt: new Date(sentAt.getTime() - 60_000) },
    });
    await scheduleLateFailureMails(["wamid.info"]);
    expect((await deliverDueLateFailureMails()).sent).toBe(1);
    await resetDb();
    mockMail.mockClear();
    const second = await seed("info");
    await prisma.message.create({
      data: { conversationId: second.conv.id, direction: "outbound", authorType: "host", senderName: "Ev sahibi", body: "Tabii, 12:00'de girebilirsiniz.", createdAt: new Date(second.q.sentAt!.getTime() + 60_000) },
    });
    await scheduleLateFailureMails(["wamid.info"]);
    expect((await deliverDueLateFailureMails()).skipped).toBe(1);
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("🚨 karar bildirimi: bekleyen karar → 'Karar bekliyor' e-postası", async () => {
    await seed("decision");
    await scheduleLateFailureMails(["wamid.decision"]);
    await deliverDueLateFailureMails();
    expect(mockMail).toHaveBeenCalledTimes(1);
    expect(String(mockMail.mock.calls[0][1])).toMatch(/^Karar bekliyor: /);
  });

  it("KONTROL: cevaplanmış bilgi sorusu kaydedilmez; karar arada verildiyse e-posta gitmez", async () => {
    await seed("info", { answered: true });
    expect(await scheduleLateFailureMails(["wamid.info"])).toBe(0);
    await resetDb();
    await seed("decision", { decisionStatus: "approved" });
    await scheduleLateFailureMails(["wamid.decision"]);
    await deliverDueLateFailureMails();
    expect(mockMail).not.toHaveBeenCalled();
  });

  it("e-posta düşerse yeniden denenir (2 dk sonra) ve sonra TEK kez gider", async () => {
    await seed("info");
    await scheduleLateFailureMails(["wamid.info"]);
    mockMail.mockResolvedValueOnce({ ok: false } as never);
    const t0 = new Date();
    expect((await deliverDueLateFailureMails(t0)).retry).toBe(1);
    expect((await deliverDueLateFailureMails(new Date(t0.getTime() + 60_000))).sent).toBe(0); // vadesi gelmedi
    expect((await deliverDueLateFailureMails(new Date(t0.getTime() + 3 * 60_000))).sent).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(2);
    expect(await prisma.systemLock.count({ where: { name: { startsWith: LATE_FAIL_MAIL_PREFIX }, holder: "sent" } })).toBe(1);
  });
});
