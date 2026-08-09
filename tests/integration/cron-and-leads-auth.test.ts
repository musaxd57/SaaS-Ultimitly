import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// KİMLİKSİZ ERİŞİME AÇIK ÜÇ ROTANIN GERÇEK KORUMASI
//
// 🚨 BU DOSYANIN VAR OLMA SEBEBİ: bu üç rotanın handler'ını import eden HİÇBİR
// test yoktu (denetim #30, kod-doğrulandı). `api-route-scoping.test.ts`in
// gerekçeli listesi onlar için "CRON_SECRET + timingSafeEqual" ve "YALNIZ POST
// + 5/saat IP limiti" YAZIYOR — ama o metinler DÜZ STRING, hiçbir şeye karşı
// doğrulanmıyor. Yani kapının VAR OLDUĞU belgeliydi, ÇALIŞTIĞI değil.
//
// ETKİ ÖLÇEĞİ, neden en yüksek bahisli kimliksiz yüzey burası:
// `/api/cron/sync` → `runScheduledSync()` → org filtresi YOK, TÜM KİRACILAR.
// Tek bir kimliksiz GET şunları tetikler: misafire AI üretimli mesaj gönderimi,
// karşılama/giriş/çıkış mesajları, KVKK anonimleştirmesi (GERİ ALINAMAZ),
// doğrulanmamış kayıt silme (HARD DELETE), depolama nesnesi silme, her
// kiracının Hospitable token'ıyla onlarca dış API çağrısı. Yanıt gövdesi de
// kiracı iş hacmini (org sayısı, mesaj sayıları) dışarı verir.
//
// ⚠️ İŞ FONKSİYONLARI MOCK'LANIR, KAPI DEĞİL. Test edilen şey kapı; onu
// mock'lamak testi kendi konusundan koparırdı.
// ---------------------------------------------------------------------------

const { runScheduledSyncMock, drainEmailOutboxOnceMock } = vi.hoisted(() => ({
  runScheduledSyncMock: vi.fn(),
  drainEmailOutboxOnceMock: vi.fn(),
}));
vi.mock("@/lib/scheduled-sync", () => ({ runScheduledSync: runScheduledSyncMock }));
vi.mock("@/lib/email-outbox", () => ({
  drainEmailOutboxOnce: drainEmailOutboxOnceMock,
  emailOutboxEnabled: () => true,
}));

import { GET as syncGet, POST as syncPost } from "@/app/api/cron/sync/route";
import { GET as outboxGet } from "@/app/api/cron/email-outbox/route";

const SECRET = "s3cret-cron-value";

const req = (url: string, headers: Record<string, string> = {}) =>
  new NextRequest(url, { headers });

describe("cron rotaları — CRON_SECRET kapısı", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", SECRET);
    runScheduledSyncMock.mockResolvedValue({ organizations: 0 });
    drainEmailOutboxOnceMock.mockResolvedValue({ claimed: 0, sent: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 başlıksız istek 401 — ve TÜM KİRACILARIN geçişi BAŞLAMAZ", async () => {
    const res = await syncGet(req("http://localhost/api/cron/sync"));
    expect(res.status).toBe(401);
    // Asıl kanıt durum kodu değil: iş HİÇ başlamamalı.
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("🚨 YANLIŞ secret 401 — POST da aynı kapıdan geçer", async () => {
    const res = await syncPost(
      req("http://localhost/api/cron/sync", { authorization: `Bearer ${SECRET}-yanlis` }),
    );
    expect(res.status).toBe(401);
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("🚨 SECRET UZUNLUĞU DOĞRU ama içerik yanlışsa 401", async () => {
    // `timingSafeEqual` eşit olmayan uzunlukta FIRLATIR; kod bu yüzden önce
    // uzunluk karşılaştırıyor. Bu vaka sabit-zamanlı dalın GERÇEKTEN koştuğunu
    // sınar — uzunluk ön-kontrolü tek başına reddetmiyor.
    const sameLen = "X".repeat(SECRET.length);
    expect(sameLen).toHaveLength(SECRET.length);
    const res = await syncGet(req("http://localhost/api/cron/sync", { "x-cron-secret": sameLen }));
    expect(res.status).toBe(401);
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("🚨 SECRET QUERY PARAMETRESİYLE KABUL EDİLMEZ (platform log'una sızardı)", async () => {
    const res = await syncGet(req(`http://localhost/api/cron/sync?secret=${SECRET}`));
    expect(res.status).toBe(401);
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("🚨 CRON_SECRET SET DEĞİLSE fail-CLOSED — doğru secret'ı 'bilen' istek bile geçmez", async () => {
    // Ters teşvik kapısı: env düşerse uç nokta KİMLİKSİZ bir tetikleyiciye
    // dönüşmemeli. Yön kuralı: yapılandırma eksikliği ERİŞİM AÇMAZ.
    vi.stubEnv("CRON_SECRET", "");
    const res = await syncGet(req("http://localhost/api/cron/sync", { authorization: "Bearer " }));
    expect(res.status).toBe(401);
    expect(runScheduledSyncMock).not.toHaveBeenCalled();
  });

  it("KONTROL: doğru secret ile GEÇER (Bearer ve x-cron-secret, iki biçim de)", async () => {
    // Bu olmadan "her zaman 401" mutasyonu da yeşil geçerdi.
    const a = await syncGet(req("http://localhost/api/cron/sync", { authorization: `Bearer ${SECRET}` }));
    expect(a.status).toBe(200);
    const b = await syncPost(req("http://localhost/api/cron/sync", { "x-cron-secret": SECRET }));
    expect(b.status).toBe(200);
    expect(runScheduledSyncMock).toHaveBeenCalledTimes(2);
  });

  // 🚨 ZAMANLAMA YAN KANALI DAVRANIŞSAL OLARAK PİNLENEMEZ — YAPISAL PİN ŞART.
  //
  // ÖLÇÜLDÜ (08-09 (2)): `timingSafeEqual` → `provided === secret` mutasyonu
  // yukarıdaki YEDİ davranışsal testin HEPSİNİ yeşil geçiyor. Bu bir eksiklik
  // değil, testin cinsinin sınırı: sabit-zamanlı karşılaştırmanın tek gözlenebilir
  // farkı SÜREDİR ve süre ölçen bir CI testi flaky olurdu. Depo bu kararı zaten
  // bir kez verdi (`forgot-password-timing-parity.test.ts`: "Pinler SÜRE ÖLÇMEZ,
  // YAPISALDIR") — aynı çözüm burada da uygulanıyor.
  //
  // ⚠️ Yorum eleme SATIR BAŞINA çapalı: `/\/\/[^\n]*/g` biçimindeki bir eleme
  // `https://…` içindeki `//`den itibaren her şeyi siler ve taramayı vacuous
  // yapar (bu deponun ölçülmüş tuzağı).
  it("🚨 secret karşılaştırması SABİT ZAMANLI kalır (`===` anti-deseni yasak)", async () => {
    const { readFileSync } = await import("node:fs");
    for (const path of ["src/app/api/cron/sync/route.ts", "src/app/api/cron/email-outbox/route.ts"]) {
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
        .join("\n");
      // Popülasyon guard'ı: tarama gerçekten kapıyı görüyor mu.
      expect(code, path).toContain("CRON_SECRET");
      expect(code, path).toMatch(/timingSafeEqual\(/);
      // Uzunluk ön-kontrolü OPSİYONEL DEĞİL: `timingSafeEqual` eşit olmayan
      // uzunlukta FIRLATIR → kaldırılırsa kapı 401 yerine 500 verir.
      expect(code, path).toMatch(/\.length === .*\.length/);
      // Doğrudan string karşılaştırması yasak.
      expect(code, path).not.toMatch(/provided\s*===\s*secret/);
      expect(code, path).not.toMatch(/secret\s*===\s*provided/);
    }
  });

  it("email-outbox AYNI sözleşmeyi taşır (kopya kod — birlikte gerilemesin)", async () => {
    // İki rota secret mantığını PAYLAŞMIYOR, kopyalıyor. Biri düzeltilip diğeri
    // unutulabilir; bu yüzden kardeş kapı ayrıca sınanır.
    const bad = await outboxGet(req("http://localhost/api/cron/email-outbox"));
    expect(bad.status).toBe(401);
    expect(drainEmailOutboxOnceMock).not.toHaveBeenCalled();

    const ok = await outboxGet(
      req("http://localhost/api/cron/email-outbox", { authorization: `Bearer ${SECRET}` }),
    );
    expect(ok.status).toBe(200);
    expect(drainEmailOutboxOnceMock).toHaveBeenCalledTimes(1);
  });
});
