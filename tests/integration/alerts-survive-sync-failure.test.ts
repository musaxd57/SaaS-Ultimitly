import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ŞİKAYET UYARISI, SENKRON PATLASA DA KOŞAR (derin denetim, 2026-08-01 — YÜKSEK).
//
// `sendDueAlerts` "süre bütçesinden MUAF" diye belgelenmişti ve öyleydi — ama
// çağrı yeri `syncHospitable`'ın try'ının İÇİNDE ve ONDAN SONRAydı. Yani
// Hospitable fırlattığı anda (402 "abonelik pasif" — CLAUDE.md'ye göre Lale'nin
// BUGÜNKÜ hâli; ya da 401/403/5xx/429) uyarı geçişi o org için HİÇ koşmuyordu.
//
// Muafiyet BÜTÇEYE karşı sağlanmış, İSTİSNAYA karşı sağlanmamıştı.
//
// Bu kalıcı kayıptır, gecikme değil: `sendDueAlerts` tek çağrı yerinden koşuyor
// (grep: yalnız scheduled-sync). Önceki turlarda içeri alınmış ama henüz
// uyarılmamış şikayetler rutin olarak birikir — kendi 50'lik tavanı, 60 sn'lik
// bütçesi ya da e-posta hatasında claim'in geri alınması yüzünden. PMS bağlantısı
// bozulan bir org'da kelime-tabanlı şikayet tespiti TAMAMEN sessizleşiyordu.
//
// Uyarı geçişi hiçbir Hospitable API'sine dokunmuyor (yalnız DB + e-posta), yani
// senkronun başarısına bağlı olmasının teknik bir gerekçesi yoktu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/hospitable", async (orig) => {
  const actual = await orig<typeof import("@/lib/hospitable")>();
  return {
    ...actual,
    isHospitableConfigured: () => true,
    listProperties: vi.fn(),
    listReservations: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => undefined) };
});

import { listProperties, HospitableError } from "@/lib/hospitable";
import { emailService } from "@/lib/email";
import { runScheduledSync } from "@/lib/scheduled-sync";

const mockListProperties = vi.mocked(listProperties);
const mockMail = vi.mocked(emailService.sendReporting);

const COMPLAINT = "Daire çok kirli, param iade edilsin. Bu kabul edilemez!";

async function seedComplaint() {
  const org = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com", hospitableTokenEnc: "enc" },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Lale 7" },
  });
  const when = new Date(Date.now() - 20 * 60_000);
  await prisma.conversation.create({
    data: {
      propertyId: property.id,
      channel: "airbnb",
      guestIdentifier: "Alex",
      externalReservationId: "res-1",
      status: "new",
      lastMessageAt: when,
      messages: {
        create: [{ direction: "inbound", senderName: "Alex", body: COMPLAINT, createdAt: when }],
      },
    },
  });
  return { orgId: org.id };
}

describe("şikayet uyarısı — senkron hatasından bağımsız", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    mockMail.mockResolvedValue({ ok: true });
  });

  it("Hospitable 402 fırlatsa bile uyarı e-postası GİDER", async () => {
    await seedComplaint();
    // Lale'nin bugünkü canlı durumu: abonelik pasif.
    mockListProperties.mockRejectedValue(new HospitableError("Subscription not active", 402));

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);

    expect(mockMail).toHaveBeenCalledTimes(1);
    const html = String(mockMail.mock.calls[0][2]);
    expect(html).toContain("kirli");
  });

  it("beklenmedik bir hata (5xx) fırlatsa bile uyarı GİDER", async () => {
    await seedComplaint();
    mockListProperties.mockRejectedValue(new Error("boom"));

    await runScheduledSync();

    expect(mockMail).toHaveBeenCalledTimes(1);
  });

  it("uyarıdan sonra konuşma 'Sorunlu' olur (insan devri korunur)", async () => {
    const { orgId } = await seedComplaint();
    mockListProperties.mockRejectedValue(new HospitableError("Subscription not active", 402));

    await runScheduledSync();

    const conv = await prisma.conversation.findFirstOrThrow({
      where: { property: { organizationId: orgId } },
    });
    expect(conv.status).toBe("problem");
  });

  it("senkron BAŞARILIYKEN de uyarı gider (regresyon pini)", async () => {
    await seedComplaint();
    mockListProperties.mockResolvedValue([]);

    const res = await runScheduledSync();
    expect(res.ok).toBe(true);
    expect(mockMail).toHaveBeenCalledTimes(1);
  });
});
