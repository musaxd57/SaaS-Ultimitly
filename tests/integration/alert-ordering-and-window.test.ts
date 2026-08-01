import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// ŞİKAYET UYARISI: SIRA "EN YENİ ÖNCE" + YAŞ PENCERESİ SQL'DE (denetim, 08-01).
//
// İKİ AYRI ARIZA, TEK TEST DOSYASI:
//
// 1. SIRA. `sendDueAlerts` "en yeni önce" (`desc`) çalışmalı ve yorumu da bunu
//    söylüyordu — ama satır 08-01'de bir mutasyon-geri-alma script'inin sayı
//    sınırı olmayan `replace`'i yüzünden KAZAYLA `asc` oldu. Commit mesajında
//    geçmiyordu, yorum kodun tersini anlatıyordu ve 2373 yeşil testin HİÇBİRİ
//    bu sıralamayı ölçmüyordu. Bir denetim ajanı yakaladı.
//
// 2. YAŞ PENCERESİ. `ALERT_MAX_AGE_MS` (72 saat) yalnız JS'te `continue` ile
//    uygulanıyordu; tavan (`take: 50`) ise SQL'de. Damgalanmış konuşmalar
//    (`closing_ack` / `low_confidence_or_risky` / `outside_hours`) `status:"new"`
//    KALIR ve sonsuza kadar birikir → 72 saatten eski 50 satır biriktiği anda
//    her geçiş yalnız o bayat satırları çeker, hepsi JS'te atlanır ve YENİ
//    ŞİKAYET HİÇ SEÇİLMEZ. Uyarı yolu tamamen susardı.
//
// İkisi birlikte tam olarak aynı gün `runDueChannelAutoReplies` için kapatılan
// AÇLIK sınıfını uyarı yolunda geri açıyordu.
// ---------------------------------------------------------------------------

vi.mock("@/lib/email", () => ({
  emailService: { send: vi.fn(), sendReporting: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => {}) };
});

import { emailService } from "@/lib/email";
import { sendDueAlerts } from "@/lib/automation";

const mockMail = vi.mocked(emailService.sendReporting);

const HOUR = 3_600_000;
const COMPLAINT = "Daire çok kirli, param iade edilsin. Bu kabul edilemez!";

async function org() {
  const o = await prisma.organization.create({
    data: { name: "Org", alertEmail: "host@example.com" },
  });
  const p = await prisma.property.create({ data: { organizationId: o.id, name: "Nuve 7" } });
  return { orgId: o.id, propertyId: p.id };
}

/** Tek şikayet konuşması, verilen yaşta. */
async function complaint(propertyId: string, label: string, ageMs: number) {
  const when = new Date(Date.now() - ageMs);
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: label,
      status: "new",
      lastMessageAt: when,
      messages: {
        create: [{ direction: "inbound", senderName: label, body: COMPLAINT, createdAt: when }],
      },
    },
  });
}

/** Damgalanmış ama `status:"new"` kalan bayat satır — gerçek birikme deseni. */
async function staleNoise(propertyId: string, label: string, ageMs: number) {
  const when = new Date(Date.now() - ageMs);
  return prisma.conversation.create({
    data: {
      propertyId,
      channel: "airbnb",
      guestIdentifier: label,
      status: "new",
      lastMessageAt: when,
      autoReplyAttemptedAt: new Date(when.getTime() + 1000),
      skippedReason: "closing_ack",
      messages: {
        create: [{ direction: "inbound", senderName: label, body: COMPLAINT, createdAt: when }],
      },
    },
  });
}

describe("şikayet uyarısı — sıra ve yaş penceresi", () => {
  beforeEach(async () => {
    await resetDb();
    mockMail.mockReset();
    mockMail.mockResolvedValue({ ok: true });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("BAYAT YIĞIN yeni şikayeti EZEMEZ (asıl açlık senaryosu)", async () => {
    const { orgId, propertyId } = await org();
    // 60 bayat satır (hepsi 72 saatten eski) — SQL tavanı 50.
    for (let i = 0; i < 60; i++) {
      await staleNoise(propertyId, `stale-${i}`, (100 + i) * HOUR);
    }
    // Ve TAZE bir şikayet.
    const fresh = await complaint(propertyId, "Taze", 10 * 60_000);

    const out = await sendDueAlerts(orgId);

    // ⬅️ ARIZADA: 50 slot bayat satırlarla dolar, taze şikayet HİÇ seçilmez → 0.
    expect(out.alerted).toBe(1);
    expect(mockMail).toHaveBeenCalledTimes(1);
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: fresh.id } });
    expect(conv.status).toBe("problem");
  });

  it("SIRA en yeni önce: tavan dolduğunda EN YENİ şikayetler uyarılır", async () => {
    const { orgId, propertyId } = await org();
    // 51 TAZE şikayet (hepsi pencere içinde) — tavan 50.
    const ids: { id: string; ageH: number }[] = [];
    for (let i = 0; i < 51; i++) {
      const c = await complaint(propertyId, `G-${i}`, (i + 1) * HOUR);
      ids.push({ id: c.id, ageH: i + 1 });
    }

    await sendDueAlerts(orgId);

    const newest = ids.find((x) => x.ageH === 1)!;
    const oldest = ids.find((x) => x.ageH === 51)!;
    const n = await prisma.conversation.findUniqueOrThrow({ where: { id: newest.id } });
    const o = await prisma.conversation.findUniqueOrThrow({ where: { id: oldest.id } });

    // desc (doğru): en yeni 50 seçilir → en eski dışarıda kalır.
    // asc (kazara olan): tam tersi → İKİ assertion da kırılır.
    expect(n.status).toBe("problem");
    expect(o.status).toBe("new");
  });

  it("72 saatten ESKİ şikayet uyarılmaz (mevcut sözleşme — regresyon pini)", async () => {
    const { orgId, propertyId } = await org();
    await complaint(propertyId, "Eski", 100 * HOUR);

    const out = await sendDueAlerts(orgId);
    expect(out.alerted).toBe(0);
    expect(mockMail).not.toHaveBeenCalled();
  });
});
