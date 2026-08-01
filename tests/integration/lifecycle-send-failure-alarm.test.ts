import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// YAŞAM-DÖNGÜSÜ GÖNDERİM ARIZALARI ARTIK BİR YERE YAZILIYOR
// (derin denetim, 2026-08-01 — YÜKSEK).
//
// Üç göndericinin (karşılama / giriş bilgisi / çıkış hatırlatması) hata dalı
// `delivery.error`'ı YALNIZCA `isDefinitiveSendFailure`'a veriyor, başka hiçbir
// yere yazmıyordu: ne `reportError`, ne console, ne sayaç. Dönen
// `{sent, considered}` farkını da hiçbir çağıran okumuyordu (`scheduled-sync`
// yalnız `.sent`'i topluyor).
//
// Sonuç: giriş talimatı — KAPI KODUNU taşıyan mesaj — misafire hiç gitmese bile
// sistemde tek satır iz kalmıyordu. Host "Önizleme" ekranında satırı
// "gönderildi" görüyordu (belirsiz hatada damga tutuluyor), sorun ancak misafir
// kapıda kalınca anlaşılıyordu.
//
// Bu, 07-31 (2) turunda oto-yanıt için kapatılan "gönderim arızası hiçbir yere
// yazılmıyordu" deseninin SON kopyasıydı.
//
// ⚠️ Alarm PII TAŞIMAZ: yalnız hata sınıfı (definitive/ambiguous) + sayı.
// ---------------------------------------------------------------------------

vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: vi.fn(async () => undefined) };
});
vi.mock("@/lib/hospitable-credentials", () => ({
  getOrgHospitableToken: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/messaging", async (orig) => {
  const actual = await orig<typeof import("@/lib/messaging")>();
  return { ...actual, sendOnChannel: vi.fn(async () => ({ ok: true, providerMessageId: "m1" })) };
});

import { reportError } from "@/lib/report-error";
import { sendOnChannel } from "@/lib/messaging";
import { sendDueWelcomes } from "@/lib/automation";

const mockReport = vi.mocked(reportError);
const mockSend = vi.mocked(sendOnChannel);

const DAY = 86_400_000;
const GUEST = "Ada Lovelace";

async function seed() {
  const org = await prisma.organization.create({
    data: {
      name: "Org",
      timezone: "UTC",
      autoWelcome: true,
      autoWelcomeEnabledAt: new Date(Date.now() - 30 * DAY),
    },
  });
  const property = await prisma.property.create({
    data: { organizationId: org.id, name: "Nuve 7" },
  });
  await prisma.knowledgeBaseItem.create({
    data: {
      propertyId: property.id,
      category: "welcome",
      title: "Karşılama",
      content: "Hoş geldiniz! Rezervasyonunuz onaylandı.",
      isActive: true,
    },
  });
  const reservation = await prisma.reservation.create({
    data: {
      propertyId: property.id,
      guestName: GUEST,
      guestPhone: "+90 555 123 45 67",
      sourceReference: "res-1",
      channel: "airbnb",
      status: "confirmed",
      arrivalDate: new Date(Date.now() + 5 * DAY),
      departureDate: new Date(Date.now() + 8 * DAY),
    },
  });
  return { orgId: org.id, reservationId: reservation.id };
}

describe("yaşam-döngüsü gönderim arızası — koşu başına tek toplu alarm", () => {
  beforeEach(async () => {
    await resetDb();
    mockReport.mockReset();
    mockSend.mockReset();
    vi.stubEnv("AUTO_REPLY_ENABLED", "1"); // ana şalter (yaşam-döngüsü de buna bağlı)
  });
  afterEach(() => vi.unstubAllEnvs());

  it("KESİN hata: alarm düşer, damga geri alınır (yeniden denenebilir)", async () => {
    const { orgId, reservationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 422 - rejected" });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(0);
    expect(out.considered).toBe(1);

    expect(mockReport).toHaveBeenCalledTimes(1);
    const [key, err] = mockReport.mock.calls[0];
    expect(String(key)).toContain("welcome");
    expect(String((err as Error).message)).toContain("definitive=1");

    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(r.welcomeSentAt).toBeNull(); // kesin hata → claim geri alındı
  });

  it("BELİRSİZ hata: alarm düşer, damga TUTULUR (asla yeniden POST edilmez)", async () => {
    const { orgId, reservationId } = await seed();
    mockSend.mockResolvedValue({ ok: false, error: "HTTP 503 - upstream" });

    await sendDueWelcomes(orgId);

    expect(mockReport).toHaveBeenCalledTimes(1);
    expect(String((mockReport.mock.calls[0][1] as Error).message)).toContain("ambiguous=1");

    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: reservationId } });
    expect(r.welcomeSentAt).not.toBeNull(); // belirsiz → duplicate riski, damga kalır
  });

  it("ALARM PII TAŞIMAZ: misafir adı, rezervasyon id'si, ham sağlayıcı metni YOK", async () => {
    const { orgId, reservationId } = await seed();
    mockSend.mockResolvedValue({
      ok: false,
      error: "HTTP 422 - guest Ada Lovelace thread closed",
    });

    await sendDueWelcomes(orgId);

    const payload = `${mockReport.mock.calls[0][0]} ${(mockReport.mock.calls[0][1] as Error).message}`;
    expect(payload).not.toContain(GUEST);
    expect(payload).not.toContain("Ada");
    expect(payload).not.toContain(reservationId);
    expect(payload).not.toContain("res-1");
    expect(payload).not.toContain("thread closed"); // sağlayıcının ham metni
    expect(payload).not.toContain("555"); // telefon
  });

  it("BAŞARILI gönderimde alarm YOK (regresyon pini)", async () => {
    const { orgId } = await seed();
    mockSend.mockResolvedValue({ ok: true, providerMessageId: "m1" });

    const out = await sendDueWelcomes(orgId);
    expect(out.sent).toBe(1);
    expect(mockReport).not.toHaveBeenCalled();
  });

  // Davranış testi karşılama yolunu kanıtlıyor; giriş ve çıkış göndericilerinin
  // hata dalları BİREBİR aynı kodu taşıyor. Bu kaynak-taraması ikisinin de
  // (ve ileride eklenecek dördüncü bir göndericinin) alarmsız kalmamasını pinler
  // — arızanın kendisi zaten "üç kopyadan hiçbirinde alarm yoktu"ydu.
  it("KAYNAK PİNİ: üç yaşam-döngüsü göndericisinin ÜÇÜ de alarma bağlı", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("src/lib/automation.ts", "utf8");

    for (const kind of ["welcome", "checkin", "checkout"]) {
      expect(src).toContain(`reportLifecycleSendFailures("${kind}"`);
    }
    // Hata sınıfı etiketi üç dalda da toplanıyor (damga geri alma ile aynı yerde).
    const pushes = src.match(/failures\.push\(definitive \? "definitive" : "ambiguous"\)/g) ?? [];
    expect(pushes.length).toBe(3);
    // Ham sağlayıcı hatası alarma GİRMEZ — kaynakta böyle bir birleştirme olmamalı.
    expect(src).not.toMatch(/reportLifecycleSendFailures\([^)]*delivery\.error/);
  });
});
