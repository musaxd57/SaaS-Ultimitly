import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ŞİKAYET UYARISI SESSİZCE KAYBOLAMAZ (denetim, 07-31).
//
// Bulunan arıza: `sendDueAlerts` konuşmayı ATOMİK olarak "new" → "problem"
// yapıyor, SONRA `emailService.send(...)` çağırıyordu. `send()` asla fırlatmaz —
// sağlayıcı hatasında yalnız console'a yazar ve dönüşü de okunmuyordu. Sonuç:
// Resend'in tek bir 5xx'i host'a giden ACİL bildirimi KALICI olarak yutuyordu.
// Satır bir daha seçilemiyordu çünkü:
//   · sendDueAlerts yalnız status:"new" seçer, satır artık "problem",
//   · model yolu (applyChannelAutoReply) "problem" görünce erken dönüyor.
// Yani retry YOKTU. Tek iz, host'un fark etmesi gereken bir inbox rozetiydi.
//
// Yeni sözleşme: sonuç OKUNUR (`sendReporting`) ve başarısızlıkta claim geri
// alınır → bir sonraki geçiş yeniden dener. Risk alanları KALIR, böylece rozet
// görünürlüğü kaybedilmez.
// ---------------------------------------------------------------------------
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { reportError } from "@/lib/report-error";
import { sendDueAlerts } from "@/lib/automation";

const mockSend = vi.mocked(emailService.sendReporting);
const mockReport = vi.mocked(reportError);

async function seedComplaint() {
  const org = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
  });
  const conversation = await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      status: "new",
      lastMessageAt: new Date(),
      messages: {
        create: [
          {
            direction: "inbound",
            senderName: "Alex",
            body: "Daire çok kirli, param iade edilsin. Bu kabul edilemez!",
            createdAt: new Date(),
          },
        ],
      },
    },
  });
  return { orgId: org.id, conversationId: conversation.id };
}

describe("şikayet uyarısı e-postası — sessiz kayıp yok", () => {
  beforeEach(async () => {
    await resetDb();
    mockSend.mockReset();
    mockSend.mockResolvedValue({ ok: true });
    mockReport.mockClear();
  });

  it("e-posta BAŞARISIZ olursa konuşma 'new'e geri döner ve sonraki geçiş TEKRAR dener", async () => {
    const { orgId, conversationId } = await seedComplaint();

    mockSend.mockResolvedValueOnce({ ok: false, error: "provider 503" });
    const first = await sendDueAlerts(orgId);

    // Gönderilmeyen uyarı "gönderildi" diye sayılmaz.
    expect(first.alerted).toBe(0);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true, skippedReason: true, lastRiskType: true },
    });
    // Claim geri alındı → yeniden seçilebilir.
    expect(after.status).toBe("new");
    // ...ama görünürlük KAYBOLMADI: rozet bu alanlardan besleniyor.
    expect(after.skippedReason).toBe("complaint");
    expect(after.lastRiskType).not.toBeNull();

    // Sessiz değil: koşu başına TEK toplu alarm (PII yok).
    expect(mockReport).toHaveBeenCalled();
    expect(String(mockReport.mock.calls[0][0])).toContain("sendDueAlerts");

    // İKİNCİ geçiş: sağlayıcı düzeldi → uyarı gerçekten gidiyor.
    const second = await sendDueAlerts(orgId);
    expect(second.alerted).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(2);

    const settled = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true },
    });
    expect(settled.status).toBe("problem");
  });

  it("e-posta BAŞARILI olduğunda davranış eskisiyle birebir aynı (regresyon pini)", async () => {
    const { orgId, conversationId } = await seedComplaint();

    const out = await sendDueAlerts(orgId);
    expect(out.alerted).toBe(1);
    expect(mockSend.mock.calls[0][0]).toBe("host@example.com");
    expect(mockReport).not.toHaveBeenCalled();

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true, skippedReason: true },
    });
    expect(after.status).toBe("problem");
    expect(after.skippedReason).toBe("complaint");
  });

  it("kalıcı arıza sonsuz döngü yapmaz: mesaj yaşlanınca aday listesinden düşer", async () => {
    const { orgId, conversationId } = await seedComplaint();

    // Mesajı uyarı penceresinin (ALERT_MAX_AGE_MS) dışına taşı.
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await prisma.message.updateMany({ where: { conversationId }, data: { createdAt: old } });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: old },
    });

    mockSend.mockResolvedValue({ ok: false, error: "provider down" });
    const out = await sendDueAlerts(orgId);

    expect(out.alerted).toBe(0);
    // Hiç denenmedi bile → geri alma/tekrar döngüsü büyümez.
    expect(mockSend).not.toHaveBeenCalled();
  });
});
