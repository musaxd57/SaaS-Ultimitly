import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";

// ---------------------------------------------------------------------------
// `/api/leads` — KİMLİKSİZ, PUBLIC landing formu. Tek koruması IP hız limiti.
//
// 🚨 BU DOSYANIN VAR OLMA SEBEBİ: rotayı çağıran HİÇBİR test yoktu (denetim
// #30). `api-route-scoping.test.ts`in gerekçeli listesi "YALNIZ POST +
// 5/saat IP limiti" yazıyor ama o düz metin; `audit-2026-08-07-fixes.test.ts`in
// "hız limiti taşır" taraması ise KAPALI bir liste kullanıyor ve `leads` o
// listede YOK. Yani limiti silen mutasyon bugün tamamen sessiz geçiyordu.
//
// Limitsiz kalırsa etki: `Lead` tablosu KVKK kapsamlı PII ile şişer VE her satır
// operatöre e-posta tetikler → Resend kotası/itibarı yanar, ve o kota kayıt
// doğrulama + şifre sıfırlama e-postalarıyla PAYLAŞILIYOR. Yani spam eden bir
// bot, gerçek müşterilerin hesap kurtarma e-postalarını düşürebilir.
// ---------------------------------------------------------------------------

const { sendReportingMock } = vi.hoisted(() => ({ sendReportingMock: vi.fn() }));
vi.mock("@/lib/email", () => ({
  emailService: { sendReporting: sendReportingMock, send: vi.fn() },
}));
vi.mock("@/lib/report-error", () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { POST } from "@/app/api/leads/route";

const body = (i: number) => ({
  name: `Aday ${i}`,
  email: `aday${i}@example.com`,
  consent: true,
});

/** Her istek AYNI istemciden gelir — kova IP başına. */
const req = (i: number, ip = "203.0.113.9") =>
  new NextRequest("http://localhost/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body(i)),
  });

describe("/api/leads — IP hız limiti", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    sendReportingMock.mockResolvedValue({ ok: true });
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 6. istek 429 + Retry-After — ve o istek Lead YAZMAZ, e-posta TETİKLEMEZ", async () => {
    for (let i = 1; i <= 5; i++) {
      expect((await POST(req(i))).status, `istek ${i}`).toBe(201);
    }
    const blocked = await POST(req(6));

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Asıl kanıt durum kodu değil: yan etkilerin İKİSİ DE olmamalı.
    expect(await prisma.lead.count()).toBe(5);
    expect(sendReportingMock).toHaveBeenCalledTimes(5);
  });

  it("kova IP BAŞINA — başka bir istemci etkilenmez", async () => {
    for (let i = 1; i <= 5; i++) await POST(req(i));
    expect((await POST(req(6))).status).toBe(429);

    // Farklı IP kendi bütçesiyle gelir. Bu olmadan "herkesi 429'la" mutasyonu
    // da yeşil geçerdi — ve o mutasyon gerçek bir arıza olurdu (tek saldırgan
    // tüm ziyaretçileri kilitler).
    expect((await POST(req(7, "198.51.100.4"))).status).toBe(201);
  });

  it("honeypot dolu istek 201 der ama HİÇBİR ŞEY yazmaz (bot geri bildirim almaz)", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ ...body(1), website: "http://spam.example" }),
      }),
    );
    expect(res.status).toBe(201); // bot "reddedildim" öğrenmesin
    expect(await prisma.lead.count()).toBe(0);
    expect(sendReportingMock).not.toHaveBeenCalled();
  });

  it("🚨 BÜTÇE DOĞRULAMADAN ÖNCE tüketilir — ve bu BİLİNÇLİ (kardeş rotalardan FARKLI)", async () => {
    // `reservations/import` ve `hospitable/diagnostics` limitlerini bilinçli
    // olarak doğrulamadan SONRA tüketiyor: orada istekte bulunan KİMLİĞİ
    // DOĞRULANMIŞ bir host ve geçersiz bir dosya yüzünden kotasını yakmamalı.
    // Burada istekte bulunan ANONİM ve tam da kötüye kullanım vektörü bu →
    // geçersiz gövde de bütçe tüketir, yoksa saldırgan bozuk gövdelerle
    // sınırsız deneme yapıp kovayı hiç doldurmadan rotayı yorabilirdi.
    for (let i = 0; i < 5; i++) {
      const bad = await POST(
        new NextRequest("http://localhost/api/leads", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
          body: JSON.stringify({ name: "", email: "gecersiz", consent: false }),
        }),
      );
      expect(bad.status).toBe(400);
    }
    // Beş geçersiz istek bütçeyi yaktı → altıncı GEÇERLİ istek de 429.
    expect((await POST(req(1))).status).toBe(429);
    expect(await prisma.lead.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// G3 (kurucu kararı 10-13 "Günde 50 + özet"): IP döndüren biri her talepte bir operatör e-postası tetikleyip ORTAK e-posta kotasını
// (kayıt doğrulama / şifre sıfırlama) bitirebiliyordu. Talep HER ZAMAN kaydedilir; bildirim günde 50 + aşan gün TEK özet.
// ---------------------------------------------------------------------------
describe("/api/leads — günlük bildirim bütçesi (G3)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    sendReportingMock.mockResolvedValue({ ok: true });
    vi.stubEnv("ERROR_ALERT_EMAIL", "ops@example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  /** Her talep FARKLI bir IP'den — IP limiti devreye girmesin (saldırganın IP döndürmesi). */
  const fromIp = (i: number) => req(i, `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`);

  it("53 talep → 53 kayıt, 50 bildirim + 1 özet, sonrası e-posta YOK", async () => {
    for (let i = 1; i <= 53; i++) {
      expect((await POST(fromIp(i))).status, `talep ${i}`).toBe(201);
    }
    // Kayıt kaybı yok — bütçe yalnız e-postayı sınırlar.
    expect(await prisma.lead.count()).toBe(53);
    expect(sendReportingMock).toHaveBeenCalledTimes(51);
    const subjects = sendReportingMock.mock.calls.map((c) => c[1] as string);
    expect(subjects.slice(0, 50).every((s) => s.startsWith("Yeni demo talebi: "))).toBe(true);
    expect(subjects[0]).toBe("Yeni demo talebi: Aday 1");
    expect(subjects[49]).toBe("Yeni demo talebi: Aday 50");
    expect(subjects[50]).toBe("Bugün 50'den fazla demo talebi geldi");
    // Özet kişisel veri TAŞIMAZ (51. talebin adı / e-postası yok) ve paneli gösterir.
    const summaryHtml = sendReportingMock.mock.calls[50][2] as string;
    expect(summaryHtml).not.toContain("Aday 51");
    expect(summaryHtml).not.toContain("aday51@example.com");
    expect(summaryHtml).toContain("Demo Talepleri");
  });

  it("yeni gün yeni bütçe: dünün dolu sayacı bugünü etkilemez", async () => {
    const { claimLeadNotifySlot } = await import("@/lib/lead-notify-budget");
    const yesterday = new Date("2026-10-12T10:00:00Z");
    const today = new Date("2026-10-13T10:00:00Z");
    for (let i = 0; i < 50; i++) expect(await claimLeadNotifySlot(yesterday)).toBe("notify");
    expect(await claimLeadNotifySlot(yesterday)).toBe("summary");
    expect(await claimLeadNotifySlot(yesterday)).toBe("skip");
    expect(await claimLeadNotifySlot(today)).toBe("notify");
  });

  it("gün sınırı uygulama saat dilimine göre: İstanbul gece yarısı (UTC 21:00) yeni gündür", async () => {
    const { claimLeadNotifySlot } = await import("@/lib/lead-notify-budget");
    const beforeMidnightIst = new Date("2026-10-12T20:59:00Z"); // İstanbul 23:59 (12 Ekim)
    const afterMidnightIst = new Date("2026-10-12T21:01:00Z"); //  İstanbul 00:01 (13 Ekim) — UTC'de hâlâ 12 Ekim
    for (let i = 0; i < 51; i++) await claimLeadNotifySlot(beforeMidnightIst);
    expect(await claimLeadNotifySlot(beforeMidnightIst)).toBe("skip");
    expect(await claimLeadNotifySlot(afterMidnightIst)).toBe("notify");
  });

  it("bildirim adresi yokken bütçe TÜKETİLMEZ (adres sonradan eklenirse ilk talepler yine bildirilir)", async () => {
    vi.stubEnv("ERROR_ALERT_EMAIL", "");
    vi.stubEnv("ALERT_EMAIL", "");
    for (let i = 1; i <= 3; i++) await POST(fromIp(i));
    expect(sendReportingMock).not.toHaveBeenCalled();
    expect(await prisma.rateLimitCounter.count({ where: { key: { startsWith: "lead-notify" } } })).toBe(0);
  });
});
