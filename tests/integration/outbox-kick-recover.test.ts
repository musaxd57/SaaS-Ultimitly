import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";

// ---------------------------------------------------------------------------
// HIZLI UYANDIRMA ↔ PERİYODİK TUR (Opus 10-16 N5 / N6).
//  · N5: uyandırma turu senkron kilidinin DIŞINDA koşar → süresi dolmuş talepleri "belirsiz"e çeviren kurtarmayı YAPMAZ (yavaş periyodik
//    partinin henüz POST'u yapılmamış satırı gereksiz "ulaşmış olabilir" incelemesine düşmesin). Kurtarma yalnız periyodik turda.
//  · N5 ikinci kemer: talebi POST'tan ÖNCE dolmuş satır gönderilmez, KESİN "gönderilmedi" olarak bekleyene geri bırakılır.
//  · N6: takılmış uyandırma turu (dönmeyen sorgu) süreçteki hızlı uyandırmayı sonsuza kapatmaz; tur çağıranın takip numarasını taşımaz.
// ---------------------------------------------------------------------------

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return { ...actual, reportError: reportErrorMock };
});

import { drainOutboxOnce, kickOutboxDrain, __resetOutboxKick, __ageOutboxKick, __setOutboxKickFollowUpMs, __outboxKickRunning, __awaitOutboxKick } from "@/lib/outbox/worker";
import { currentCorrelation, runWithCorrelation } from "@/lib/correlation";

async function waitUntil(fn: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("timeout");
}

describe("hızlı uyandırma — kurtarma yalnız periyodik turda; talebi dolan satır gönderilmez", () => {
  let orgId = "";
  let conversationId = "";
  beforeEach(async () => {
    await resetDb();
    __resetOutboxKick();
    reportErrorMock.mockReset();
    reportErrorMock.mockResolvedValue({ notified: true, throttled: false, configured: true });
    vi.stubEnv("OUTBOX_FAST_WAKE", "1");
    const s = await makeOrgWithProperty();
    orgId = s.orgId;
    const conv = await prisma.conversation.create({
      data: { propertyId: s.propertyId, guestIdentifier: "Misafir", channel: "airbnb", externalReservationId: "res-k" },
    });
    conversationId = conv.id;
  });
  afterEach(() => {
    __resetOutboxKick();
    vi.unstubAllEnvs();
  });

  const row = (key: string, data: Record<string, unknown>) =>
    prisma.messageOutbox.create({
      data: {
        organizationId: orgId,
        conversationId,
        channel: "airbnb",
        externalReservationId: "res-k",
        body: "Anahtar kutusu kapının sağında",
        idempotencyKey: key,
        messageType: "manual",
        availableAt: new Date(Date.now() - 60_000),
        ...data,
      },
    });

  it("🚨 uyandırma turu, başka (periyodik) işçinin talebi dolmuş satırını 'belirsiz'e ÇEVİRMEZ; periyodik tur çevirir (KONTROL)", async () => {
    const stale = await row("s1", { status: "sending", claimedBy: "periyodik-isci", claimExpiresAt: new Date(Date.now() - 1000) });
    let ran = false;
    kickOutboxDrain(async () => {
      const r = await drainOutboxOnce({ skipHeal: true, skipRecover: true, batchSize: 5, send: vi.fn(), tokenFor: async () => "tok" });
      ran = true;
      return r;
    });
    await waitUntil(() => ran);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("sending"); // ⬅️ KURTARMA SÜRSEYDİ: ambiguous
    await drainOutboxOnce({ send: vi.fn(), tokenFor: async () => "tok" }); // periyodik tur
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("ambiguous");
  });

  it("🚨 varsayılan uyandırma turu da kurtarmayı atlar (kick'in kendi ayarı)", async () => {
    const stale = await row("s2", { status: "sending", claimedBy: "periyodik-isci", claimExpiresAt: new Date(Date.now() - 1000) });
    // Prisma temsilcisine casus KONMAZ (sonraki testlere sızar — CLAUDE.md dersi); bekleyen satır yok → tur hızlı biter.
    kickOutboxDrain();
    expect(__outboxKickRunning()).toBe(true); // tur gerçekten başladı
    await waitUntil(() => !__outboxKickRunning()); // sabit bekleme değil: tur BİTTİ (Haiku 10-16 — boşa geçme / sonraki teste sızma yok)
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("sending"); // ⬅️ skipRecover yoksa ambiguous
  });

  it("🚨 talebi POST'tan ÖNCE dolan satır gönderilmez → KESİN gönderilmedi: bekleyene geri bırakılır; sonraki tur TEK kez gönderir", async () => {
    const r = await row("e1", { status: "pending" });
    const send = vi.fn().mockResolvedValue({ ok: true, providerMessageId: "p-1" });
    const base = Date.now();
    let jumped = false;
    // Saat, satır TALEP EDİLDİKTEN sonra (kimlik çözümü = POST'tan önceki adım) 6 dk ileri atlar (talep süresi 5 dk) — parti yavaşlamış
    // gibi. Saat okuma SIRASINA bağlı değil (Haiku 10-16).
    const now = () => new Date(jumped ? base + 6 * 60_000 : base);
    const out = await drainOutboxOnce({
      now,
      send,
      tokenFor: async () => {
        jumped = true;
        return "tok";
      },
    });
    expect(out.retried).toBe(1); // gözlemlenebilir: sağlayıcıya gitmeden geri bırakıldı (Opus NOT-4)
    expect(send).not.toHaveBeenCalled(); // ⬅️ KEMERSİZ: süresi dolmuş talep gönderilirdi (başka turun kurtarmasıyla yarış)
    expect(await prisma.messageOutbox.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "pending", claimedBy: null, attemptCount: 0, claimedAt: null });
    await drainOutboxOnce({ now: () => new Date(base + 7 * 60_000), send, tokenFor: async () => "tok" });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await prisma.messageOutbox.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("sent");
  });

  it("🚨 takılmış uyandırma turu (dönmeyen sorgu) hızlı uyandırmayı sonsuza kapatmaz: 10 dk sonra yeni tur başlar ve alarm verilir", async () => {
    let first = 0;
    kickOutboxDrain(() => {
      first++;
      return new Promise(() => {}); // hiç dönmez
    });
    await waitUntil(() => first === 1);
    const second = vi.fn().mockResolvedValue({ claimed: 0 });
    kickOutboxDrain(second);
    await new Promise((r) => setTimeout(r, 50));
    expect(second).not.toHaveBeenCalled(); // KONTROL: tur sürerken ikinci çağrı yalnız "bir tur daha" işaretler
    __ageOutboxKick(11 * 60_000);
    kickOutboxDrain(second);
    await waitUntil(() => second.mock.calls.length === 1); // ⬅️ BEKÇİSİZ: hiç çağrılmaz
    expect(reportErrorMock.mock.calls.some(([c]) => String(c) === "outbox.kick")).toBe(true);
  });

  it("bekçi alarmı çağıran isteğin takip numarasını TAŞIMAZ (Opus P3-4)", async () => {
    const seen: Array<ReturnType<typeof currentCorrelation>> = [];
    reportErrorMock.mockImplementation(async (ctx: unknown) => {
      if (String(ctx) === "outbox.kick") seen.push(currentCorrelation());
      return { notified: true, throttled: false, configured: true };
    });
    kickOutboxDrain(() => new Promise(() => {}));
    await new Promise((r) => setTimeout(r, 20));
    __ageOutboxKick(11 * 60_000);
    await runWithCorrelation({ id: "istek-numarasi-2", organizationId: "org-istek" }, async () => {
      kickOutboxDrain(vi.fn().mockResolvedValue({ claimed: 0 }));
    });
    await waitUntil(() => seen.length > 0);
    expect(seen[0]?.id).not.toBe("istek-numarasi-2"); // ⬅️ eski: alarm isteğin numarasıyla etiketlenirdi
    expect(seen[0]?.organizationId ?? null).toBeNull();
  });

  it("aynı anda en çok BİR takip zamanlayıcısı: art arda biten iki tur ikinci zamanlayıcı kurmaz (Opus N6)", async () => {
    await row("f1", { status: "pending" }); // vadesi gelmiş elle cevap → takip gerekli görünür
    __setOutboxKickFollowUpMs(4321); // ayırt edici gecikme
    const timers = vi.spyOn(globalThis, "setTimeout"); // küresel saat casusu (Prisma temsilcisi DEĞİL), sonunda geri alınır
    try {
      const drain = vi.fn().mockResolvedValue({ claimed: 0 }); // satıra dokunmaz
      kickOutboxDrain(drain);
      await waitUntil(() => timers.mock.calls.some((c) => c[1] === 4321));
      kickOutboxDrain(drain);
      await waitUntil(() => drain.mock.calls.length === 2);
      await __awaitOutboxKick(); // ikinci turun takip kararı BİTTİ (sabit uyku değil — Haiku 10-16)
      expect(timers.mock.calls.filter((c) => c[1] === 4321)).toHaveLength(1); // ⬅️ TEKİLLEŞTİRMESİZ: 2
    } finally {
      timers.mockRestore();
      __resetOutboxKick();
    }
  });

  it("🚨 takılmış turlar sınırsız çoğalmaz: aynı anda en çok 2 canlı tur (Opus P3-5 — bağlantı havuzu tükenmesin)", async () => {
    const hang = vi.fn(() => new Promise(() => {}));
    kickOutboxDrain(hang);
    await waitUntil(() => hang.mock.calls.length === 1);
    __ageOutboxKick(11 * 60_000);
    kickOutboxDrain(hang); // bekçi: ikinci tur (o da takılır)
    await waitUntil(() => hang.mock.calls.length === 2);
    __ageOutboxKick(11 * 60_000);
    const capAlarms = () =>
      reportErrorMock.mock.calls.filter(([c, e]) => String(c) === "outbox.kick" && /sınırı dolu/.test(String((e as Error)?.message))).length;
    const third = vi.fn().mockResolvedValue({ claimed: 0 });
    kickOutboxDrain(third);
    await new Promise((r) => setTimeout(r, 50));
    expect(third).not.toHaveBeenCalled(); // ⬅️ SINIRSIZ: üçüncü tur da açılırdı
    expect(capAlarms()).toBe(1); // sınır doluyken sessiz kalınmaz (Haiku 10-16)…
    kickOutboxDrain(third);
    await new Promise((r) => setTimeout(r, 20));
    expect(capAlarms()).toBe(1); // …ama her elle cevapta yeniden de alarm verilmez
  });

  it("uyandırma turu çağıran isteğin takip numarasını / işletmesini MİRAS ALMAZ (hata raporu dahil)", async () => {
    const seen: Array<ReturnType<typeof currentCorrelation>> = [];
    reportErrorMock.mockImplementation(async () => {
      seen.push(currentCorrelation());
      return { notified: true, throttled: false, configured: true };
    });
    await runWithCorrelation({ id: "istek-numarasi-1", organizationId: "org-istek" }, async () => {
      kickOutboxDrain(async () => {
        throw new Error("boşaltma düştü");
      });
    });
    await waitUntil(() => seen.length > 0);
    expect(seen[0]?.id).not.toBe("istek-numarasi-1"); // ⬅️ ESKİ: hata raporu isteğin numarasıyla etiketlenirdi
    expect(seen[0]?.organizationId ?? null).toBeNull();
  });
});
