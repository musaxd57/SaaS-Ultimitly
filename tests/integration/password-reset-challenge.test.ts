import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { verifyPassword } from "@/lib/auth/password";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// `PasswordResetChallenge` — ZORUNLU SALDIRI TESTLERİ (Codex, 08-02).
//
// Yapısal düzeltmenin çekirdeği: deneme bütçesi HESABA değil CHALLENGE SATIRINA
// ait ve satırın TEK adresleme yolu `tokenHash`. Token yalnız e-posta kutusuna
// gider → onu bilmeyen biri satırı bulamaz, denemesini harcayamaz.
//
// Eski akışta ölçülen: tek IP'den 9 istek/15 dk ile kurban süresiz olarak
// sıfırlama dışında tutulabiliyordu (4 istek kurtarma yolunu kapatıyor,
// 5 istek eldeki kodu yakıyor).
// ---------------------------------------------------------------------------

// Gerçek e-postayı yakala — token BAĞLANTIDA, kod GÖVDEDE.
let lastEmailHtml = "";
vi.mock("@/lib/email", () => ({
  emailService: {
    sendReporting: vi.fn(async (_to: string, _s: string, html: string) => {
      lastEmailHtml = html;
      return { ok: true };
    }),
  },
}));
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});
// Alarm yolunu gözlemle (eşik aşımı testi).
vi.mock("@/lib/report-error", async (orig) => {
  const actual = await orig<typeof import("@/lib/report-error")>();
  return {
    ...actual,
    reportError: vi.fn(async () => ({ notified: true, throttled: false, configured: true })),
  };
});

import { POST } from "@/app/api/account/forgot-password/route";
import { drainEmailOutboxOnce } from "@/lib/email-outbox";
import { reportError } from "@/lib/report-error";
import { sweepPasswordResetChallenges } from "@/lib/auth/password-reset-challenge";

const mockReport = vi.mocked(reportError);
const EMAIL = "host@example.com";
const NEW_PASSWORD = "yepyenisifre1";

function req(body: unknown, ip = "1.1.1.1") {
  return new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Bir challenge iste ve e-postadan token + kodu çıkar. */
async function requestChallenge(ip = "1.1.1.1"): Promise<{ token: string; code: string }> {
  lastEmailHtml = "";
  const res = await POST(req({ action: "request", email: EMAIL }, ip));
  expect(res.status).toBe(200);
  await drainEmailOutboxOnce();
  // ⚠️ Kasten YALNIZ fragment biçimi (`#t=`) kabul edilir. Token bir gün query
  // parametresine (`?t=`) geri taşınırsa bu eşleşme düşer ve dosyadaki TÜM
  // testler kırmızıya döner — taşıyıcı biçimi buradan da pinli.
  const t = lastEmailHtml.match(/#t=([0-9a-f]{64})/);
  // ⚠️ Kod, STILDEN BAGIMSIZ `id="lixus-code"` kancasindan ayiklanir. Eskiden
  // `letter-spacing:4px` ile eslesiyordu ve e-posta tasariminin degismesi bu
  // dosyadaki bes testi birden kirdi — kozmetik bir degisiklik guvenlik testini
  // dusurmemeli.
  const c = lastEmailHtml.match(/id="lixus-code"[^>]*>(\d{8})</);
  if (!t || !c) throw new Error(`e-postada token/kod yok: ${lastEmailHtml.slice(0, 300)}`);
  return { token: t[1], code: c[1] };
}

describe("PasswordResetChallenge — zorunlu saldırı testleri", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    lastEmailHtml = "";
    vi.stubEnv("PASSWORD_RESET_CHALLENGE_ENABLED", "1");
    vi.stubEnv("EMAIL_OUTBOX_ENABLED", "1");
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  // ── 1 ────────────────────────────────────────────────────────────────────
  it("1) saldırgan request kotasını doldursa bile ELDEKİ challenge çalışır", async () => {
    const mine = await requestChallenge();

    // Saldırgan kurtarma yolunu (forgot-req, 4/15dk) kapatır.
    for (let i = 0; i < 5; i++) await POST(req({ action: "request", email: EMAIL }, `9.9.9.${i}`));
    const blocked = await POST(req({ action: "request", email: EMAIL }, "9.9.9.9"));
    expect(blocked.status).toBe(429); // kurtarma yolu gerçekten kapalı

    // …ama kurbanın ELİNDEKİ challenge hâlâ çalışır.
    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: mine.token, code: mine.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, u.passwordHash)).toBe(true);
  }, 60_000);

  // ── 2 ────────────────────────────────────────────────────────────────────
  it("2) bir challenge'a 5 yanlış deneme DİĞERİNİ yakmaz", async () => {
    const a = await requestChallenge("2.2.2.1");
    const b = await requestChallenge("2.2.2.2");
    expect(a.token).not.toBe(b.token);

    for (let i = 0; i < 5; i++) {
      await POST(req({ action: "confirm", email: EMAIL, token: a.token, code: "00000000", newPassword: NEW_PASSWORD }));
    }
    // A tükendi…
    const deadA = await POST(
      req({ action: "confirm", email: EMAIL, token: a.token, code: a.code, newPassword: NEW_PASSWORD }),
    );
    expect(deadA.status).toBe(400);

    // …B ETKİLENMEDİ.
    const okB = await POST(
      req({ action: "confirm", email: EMAIL, token: b.token, code: b.code, newPassword: NEW_PASSWORD }),
    );
    expect(okB.status).toBe(200);
  }, 90_000);

  // ── 3 ────────────────────────────────────────────────────────────────────
  it("3) YENİ request önceki geçerli challenge'ı BOZMAZ", async () => {
    const first = await requestChallenge("3.3.3.1");
    await requestChallenge("3.3.3.2"); // ikinci challenge doğar

    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: first.token, code: first.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200); // ⬅️ saldırgan yeni isteklerle eskisini düşüremez
  }, 60_000);

  // ── 4 ────────────────────────────────────────────────────────────────────
  it("4) paralel iki DOĞRU istekte yalnız BİRİ başarılı olur", async () => {
    const c = await requestChallenge();
    const body = { action: "confirm", email: EMAIL, token: c.token, code: c.code, newPassword: NEW_PASSWORD };

    const [r1, r2] = await Promise.all([POST(req(body, "4.4.4.1")), POST(req(body, "4.4.4.2"))]);
    const oks = [r1.status, r2.status].filter((s) => s === 200);
    expect(oks).toHaveLength(1); // tam olarak BİR tane

    const rows = await prisma.passwordResetChallenge.findMany({ where: { consumedAt: { not: null } } });
    expect(rows).toHaveLength(1); // tüketim damgası bir kez yazıldı
  }, 60_000);

  // ── 5 ────────────────────────────────────────────────────────────────────
  it("5) başarılı reset TÜM challenge'ları kapatır ve oturumları düşürür", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const a = await requestChallenge("5.5.5.1");
    const b = await requestChallenge("5.5.5.2");

    const ok = await POST(
      req({ action: "confirm", email: EMAIL, token: a.token, code: a.code, newPassword: NEW_PASSWORD }),
    );
    expect(ok.status).toBe(200);

    // B artık kullanılamaz.
    const dead = await POST(
      req({ action: "confirm", email: EMAIL, token: b.token, code: b.code, newPassword: "baskasifre1" }),
    );
    expect(dead.status).toBe(400);

    const live = await prisma.passwordResetChallenge.count({
      where: { consumedAt: null, invalidatedAt: null },
    });
    expect(live).toBe(0); // hiç canlı challenge kalmadı

    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.sessionEpoch).toBe(before.sessionEpoch + 1); // çalınmış oturumlar öldü
  }, 90_000);

  // ── 5b: ŞİFRE SIFIRLAMA "BENİ HATIRLA" GÜVENİNİ DE ÖLDÜRÜR ──────────────
  // 🚨 S2 (08-09). Önceden trusted-device token'ı yalnız `(userId, purpose,
  // 2FA-epoch)` üçlüsüne bağlıydı; `sessionEpoch` GİRDİ DEĞİLDİ. Sonuç: kurban
  // şüphelenip ürünün söylediği tek şeyi yapıyor — şifre sıfırlama — TÜM
  // oturumlar ölüyor ama 2FA-ATLAMA kimlik bilgisi 30 gün daha yaşıyordu.
  // Bu test zinciri UÇTAN UCA kuruyor: gerçek sıfırlama rotası koşuyor,
  // sonra token kullanıcının GÜNCEL epoch'una karşı doğrulanıyor.
  it("5b) sıfırlama sonrası ESKİ trusted-device çerezi REDDEDİLİR", async () => {
    const { signTrustedDeviceToken, verifyTrustedDeviceToken } = await import(
      "@/lib/auth/trusted-device"
    );
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const twoFaEpoch = before.twoFactorEnabledAt ? before.twoFactorEnabledAt.getTime() : 0;
    const cookie = await signTrustedDeviceToken(before.id, twoFaEpoch, before.sessionEpoch);
    // KONTROL: sıfırlamadan ÖNCE çerez GEÇERLİ. Bu olmadan "her zaman reddet"
    // mutasyonu da yeşil geçerdi.
    expect(await verifyTrustedDeviceToken(cookie, before.id, twoFaEpoch, before.sessionEpoch)).toBe(true);

    const c = await requestChallenge("5.5.5.9");
    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: c.token, code: c.code, newPassword: "yenisifre9" }),
    );
    expect(res.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.sessionEpoch).toBe(before.sessionEpoch + 1);
    // ASIL İDDİA: eski çerez artık GÜNCEL epoch'a karşı geçmiyor.
    expect(await verifyTrustedDeviceToken(cookie, after.id, twoFaEpoch, after.sessionEpoch)).toBe(false);
  }, 90_000);

  // ── AYRIM: "ÇALIŞMALI" ile "REDDEDİLMELİ" (Codex, 08-09) ────────────────
  // İki durum karıştırılmamalı, o yüzden ikisi de AYRI AYRI pinleniyor:
  //   (a) AYNI challenge'ın bağlantısı + kodu, TTL içinde ve tüketilmemişse
  //       MUTLAKA çalışır. Bu ürünün vaadi; kırılırsa kimse şifresini
  //       sıfırlayamaz.
  //   (b) YENİ e-postanın kodu, ESKİ sekmedeki token'la BİRLİKTE reddedilir.
  //       Bu bir arıza değil, beklenen güvenlik davranışıdır: kod tek bir
  //       challenge SATIRINA aittir ve satırı token adresler. Çapraz eşleşmeye
  //       izin vermek, kodu satırdan koparıp hesaba bağlamak demektir — m47'nin
  //       kapattığı deliğin ta kendisi.
  // ⚠️ Eski sekme OTOMATİK KAPATILMAZ (browser `window.close()`u engeller ve
  // kapatmak veri kaybettirebilir); kullanıcı yeni bağlantıya tıkladığında zaten
  // TAZE bir sayfa açılır.
  it("a) AYNI challenge: bağlantı + kod, TTL içinde ve tüketilmemişken ÇALIŞIR", async () => {
    const c = await requestChallenge("6.1.0.1");
    const res = await POST(
      req({ action: "confirm", token: c.token, code: c.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, u.passwordHash)).toBe(true);
  }, 90_000);

  it("b) ÇAPRAZ eşleşme REDDEDİLİR: yeni e-postanın kodu + ESKİ sekmenin token'ı", async () => {
    const eski = await requestChallenge("6.2.0.1"); // kullanıcının açık duran sekmesi
    const yeni = await requestChallenge("6.2.0.2"); // "tekrar gönder"den gelen yeni mail
    // Kodlar farklı olmalı, yoksa test tesadüfen geçebilir.
    expect(yeni.code).not.toBe(eski.code);

    const capraz = await POST(
      req({ action: "confirm", token: eski.token, code: yeni.code, newPassword: NEW_PASSWORD }),
    );
    expect(capraz.status).toBe(400);
    expect((await capraz.json()).fields?.code).toContain("Bu kod artık kullanılamıyor");

    // 🚨 VE ESKİ CHALLENGE YANMADI: kendi kodu HÂLÂ çalışıyor. Çapraz denemenin
    // eski satırın bütçesini tüketip kullanıcıyı dışarıda bırakmadığını gösterir.
    const kendi = await POST(
      req({ action: "confirm", token: eski.token, code: eski.code, newPassword: NEW_PASSWORD }),
    );
    expect(kendi.status).toBe(200);
  }, 90_000);

  // ── 6 ────────────────────────────────────────────────────────────────────
  it("6) bilinmeyen ve kayıtlı e-posta DIŞARIDAN ayırt edilemez", async () => {
    const known = await POST(req({ action: "request", email: EMAIL }, "6.6.6.1"));
    const unknown = await POST(req({ action: "request", email: "yok@example.com" }, "6.6.6.2"));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json()); // gövde BİREBİR aynı

    // Bilinmeyen e-posta için HİÇBİR satır yazılmadı.
    expect(await prisma.passwordResetChallenge.count()).toBe(1);
  }, 60_000);

  // ── 7 ────────────────────────────────────────────────────────────────────
  it("7) token/hash HİÇBİR API yanıtında, log'da, Sentry'de veya AuditLog'da görünmez", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const c = await requestChallenge();
      const row = await prisma.passwordResetChallenge.findFirstOrThrow();

      const res = await POST(
        req({ action: "confirm", email: EMAIL, token: c.token, code: c.code, newPassword: NEW_PASSWORD }),
      );
      const bodyText = JSON.stringify(await res.json());

      const surfaces: string[] = [
        bodyText,
        ...logSpy.mock.calls.flat().map(String),
        ...errSpy.mock.calls.flat().map(String),
        ...warnSpy.mock.calls.flat().map(String),
        ...mockReport.mock.calls.flat().map((a) => (a instanceof Error ? a.message : String(a))),
        JSON.stringify(await prisma.auditLog.findMany({ select: { metadataJson: true, action: true } })),
      ];
      for (const s of surfaces) {
        expect(s).not.toContain(c.token);
        expect(s).not.toContain(c.code);
        expect(s).not.toContain(row.tokenHash);
        expect(s).not.toContain(row.codeHash);
      }
      // Denetim kaydı YAZILDI ama yalnız OPAK id taşıyor.
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "account.password_reset" } });
      expect(String(audit.metadataJson)).toContain(row.id);
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  }, 60_000);

  // ── 8 ────────────────────────────────────────────────────────────────────
  it("8) eşik aşımı REDAKTE audit + uyarı üretir — her yanlış denemede DEĞİL", async () => {
    const c = await requestChallenge();

    // İlk 4 yanlış deneme: alarm YOK (log/Sentry DoS'u olmasın).
    for (let i = 0; i < 4; i++) {
      await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    }
    expect(mockReport).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { action: "account.password_reset_blocked" } })).toBe(0);

    // 5. deneme tavana taşır → TAM BİR KEZ uyarı.
    await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    expect(mockReport).toHaveBeenCalledTimes(1);
    const blocked = await prisma.auditLog.findMany({ where: { action: "account.password_reset_blocked" } });
    expect(blocked).toHaveLength(1);
    expect(String(blocked[0].metadataJson)).not.toContain(c.token);
    expect(String(blocked[0].metadataJson)).not.toContain(c.code);

    // Sonraki denemeler ALARM TEKRARLAMAZ (challenge başına bir kez).
    mockReport.mockClear();
    await POST(req({ action: "confirm", email: EMAIL, token: c.token, code: "00000000", newPassword: NEW_PASSWORD }));
    expect(mockReport).not.toHaveBeenCalled();
  }, 90_000);

  // ── 9 ────────────────────────────────────────────────────────────────────
  it("9) süresi dolmuş challenge reddedilir; sweep ölüleri toplar, CANLIYA dokunmaz", async () => {
    const expired = await requestChallenge("9.9.9.1");
    await prisma.passwordResetChallenge.updateMany({
      where: {},
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await POST(
      req({ action: "confirm", email: EMAIL, token: expired.token, code: expired.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(400); // süresi dolmuş → reddedildi

    // Canlı bir challenge daha ekle, sonra süpür.
    const live = await requestChallenge("9.9.9.2");
    await prisma.passwordResetChallenge.updateMany({
      where: { expiresAt: { lt: new Date() } },
      data: { createdAt: new Date(Date.now() - 48 * 60 * 60_000), expiresAt: new Date(Date.now() - 48 * 60 * 60_000) },
    });

    const removed = await sweepPasswordResetChallenges();
    expect(removed).toBe(1); // yalnız ölü satır gitti

    // CANLI satır duruyor ve HÂLÂ çalışıyor.
    const stillOk = await POST(
      req({ action: "confirm", email: EMAIL, token: live.token, code: live.code, newPassword: NEW_PASSWORD }),
    );
    expect(stillOk.status).toBe(200);
  }, 90_000);

  // ── 10 ───────────────────────────────────────────────────────────────────
  // 🚨 TAŞIYICI PİNİ (Codex, 08-02): token URL FRAGMENT'inde durur, QUERY'de
  // değil. Query parametresi istek satırının parçasıdır → Railway edge log'u,
  // Next istek log'u, araya giren vekiller ve e-posta güvenlik tarayıcılarının
  // ön-ısıtma istekleri onu görür. Bu katmanların token'ı SAKLAMADIĞINI
  // kanıtlayamayız (üçüncü taraf platform), o yüzden token'ı erişemeyecekleri
  // yere koyuyoruz. Fragment sunucuya HİÇ gönderilmez.
  // ── SIRA: KOD ÖNCE, BUTON SONRA (kullanıcı gözlemi, 08-09) ────────────────
  // Buton öndeyken kullanıcı önce sayfaya gidiyor, kodu görmediğini fark ediyor
  // ve kopyalamak için e-postaya GERİ dönüyordu. Akış değişmedi (token yine
  // bağlantıda, kod yine açılan sayfada girilir); değişen yalnız okuma sırası.
  it("kod bloğu e-postada butondan ÖNCE gelir", async () => {
    await POST(req({ action: "request", email: EMAIL }, "3.1.4.1"));
    await drainEmailOutboxOnce();
    const codeAt = lastEmailHtml.indexOf('id="lixus-code"');
    const buttonAt = lastEmailHtml.indexOf("Şifremi sıfırla");
    // KONTROL: ikisi de GERÇEKTEN var — biri eksikse indexOf -1 döner ve
    // karşılaştırma tesadüfen "geçebilirdi".
    expect(codeAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(-1);
    expect(codeAt).toBeLessThan(buttonAt);
    // Metin de sırayla tutarlı olmalı: "önce bağlantıyı açın" demek artık yanlış.
    expect(lastEmailHtml).toContain("önce bu kodu kopyalayın");
  }, 60_000);

  it("10) e-postadaki bağlantı token'ı FRAGMENT'te taşır; query string YOK", async () => {
    const c = await requestChallenge("10.0.0.1");

    const href = lastEmailHtml.match(/href="([^"]+)"/)?.[1];
    if (!href) throw new Error("e-postada bağlantı yok");
    const url = new URL(href.replace(/&amp;/g, "&"));

    // Sunucuya giden parça TEMİZ: ne query, ne yol içinde sır.
    expect(url.search).toBe("");
    expect(url.pathname).toBe("/sifremi-unuttum");
    expect(url.pathname).not.toContain(c.token);

    // Sır YALNIZ fragment'te.
    expect(url.hash).toBe(`#t=${c.token}`);

    // Ve hiçbir yerde `?t=` biçimi geçmiyor (e-posta gövdesinin TAMAMI taranır —
    // düz-metin yankısı / ikinci bir bağlantı da yakalanır).
    expect(lastEmailHtml).not.toMatch(/[?&]t=/);
  }, 60_000);

  // ── 11 ───────────────────────────────────────────────────────────────────
  it("11) token'lı confirm E-POSTASIZ çalışır (bağlantı taze sayfa yükler)", async () => {
    const c = await requestChallenge("11.0.0.1");
    // Gövdede `email` YOK — istemci bağlantıdan geldiğinde o adrese sahip değil.
    const res = await POST(req({ action: "confirm", token: c.token, code: c.code, newPassword: NEW_PASSWORD }));
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, u.passwordHash)).toBe(true);
  }, 60_000);

  // ── 12 ───────────────────────────────────────────────────────────────────
  it("12) uyuşmayan e-posta YOK SAYILIR (token sahibini sızdıran oracle yok)", async () => {
    const c = await requestChallenge("12.0.0.1");
    // Yabancı bir adresle aynı token: reddedilmez, sıfırlama TOKEN'IN sahibine
    // uygulanır. Reddetmek, token'ı ele geçirene "bu hangi hesap?" sorusunu
    // deneme yanılmayla yanıtlatırdı.
    const res = await POST(
      req({ action: "confirm", email: "baskasi@example.com", token: c.token, code: c.code, newPassword: NEW_PASSWORD }),
    );
    expect(res.status).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(NEW_PASSWORD, u.passwordHash)).toBe(true);
  }, 60_000);

  // ── 13 ───────────────────────────────────────────────────────────────────
  // ↑12'nin TERS yönü. ⚠️ SÖZLEŞME FAZ 3'te DEĞİŞTİ (08-09) ve test onunla
  // birlikte güncellendi — eski hâli DÖRT girdinin de `fields.email` almasını
  // bekliyordu. Artık ayrım action'a göre:
  //   · `request`  → e-posta ZORUNLU, alan adı `email` (kullanıcıya yardımcı
  //     olmak için ayrıntılı; burada gizlenecek bir şey yok, adres zaten girdi).
  //   · `confirm`  → TOKEN zorunlu; adres geçerli olsa da olmasa da AYNI generic
  //     `code` cevabı döner. Eskiden token'sız confirm eski kod yoluna düşüyordu;
  //     o yol kalktığı için tek doğru cevap fail-closed reddir. Şekil ayrımı
  //     bırakılsaydı yanıtın alan adı isteğin hangi dala düştüğünü sızdırırdı.
  it("13) token YOKKEN: request e-posta ister, confirm GENERIC ile fail-closed reddedilir", async () => {
    for (const body of [{ action: "request" }, { action: "request", email: "gecersiz" }]) {
      const res = await POST(req(body, "13.0.0.1"));
      expect(res.status).toBe(400);
      expect((await res.json()).fields?.email).toBe("Geçerli bir e-posta girin.");
    }
    for (const body of [
      { action: "confirm", code: "12345678", newPassword: NEW_PASSWORD },
      { action: "confirm", email: "gecersiz", code: "12345678", newPassword: NEW_PASSWORD },
      { action: "confirm", email: EMAIL, code: "12345678", newPassword: NEW_PASSWORD },
    ]) {
      const res = await POST(req(body, "13.0.0.1"));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.fields?.code).toContain("Bu kod artık kullanılamıyor");
      // Alan adı AYRIŞMAMALI: `email` sızarsa dal oracle'ı geri gelir.
      expect(Object.keys(json.fields ?? {})).toEqual(["code"]);
    }
  }, 60_000);

  // ── FAZ 3 (08-09): "BAYRAK KAPALI" TESTİ KALDIRILDI ──────────────────────
  // O test bayrak kapalıyken ESKİ kod yolunun çalıştığını asserte ediyordu
  // (`pwResetCodeHash` dolar). Faz 3 o yolu kaldırdı, yani test artık var
  // olmayan bir davranışı pinliyordu. Yerine geçen sözleşme — bayrağın hiçbir
  // etkisi kalmadığı ve eski yolun geri gelemediği — üç env değeriyle birlikte
  // `forgot-password-phase3-contract.test.ts` içinde pinleniyor.
});
