import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb } from "../helpers/db";
import { __resetRateLimit } from "@/lib/rate-limit";

// ---------------------------------------------------------------------------
// ROTA-GENELİ DEĞİŞMEZLER — `POST /api/account/forgot-password`
//
// 🚩 FAZ 3 (08-09): eski `pwResetCode*` kod yolu KALDIRILDI ve bu dosya yeniden
// yazıldı. Silinen 19 testin çoğu o yola aitti, AMA hepsi değildi: aşağıdaki
// testler rotanın TAMAMINA ait güvenlik değişmezleridir ve eski testlerle
// birlikte silinselerdi sessizce pinsiz kalırlardı. Codex'in kısıtı buydu:
// "legacy testleri körlemesine silme; rota-geneli invaryantları önce taşı."
//
// Buraya taşınanlar:
//   · `forgot:{ip}` kovası (12/15 dk) — akışın tamamını kapsar, eski yola özel değil
//   · enumeration: bilinmeyen adres de 200 alır, hiçbir satır yazılmaz
//   · token'sız confirm'in fail-closed reddi (Faz 3'ün YENİ sözleşmesi)
//
// Zamanlama paritesi AYRI dosyada: `forgot-password-timing-parity.test.ts`.
// Challenge yolunun saldırı testleri: `password-reset-challenge.test.ts`.
// ---------------------------------------------------------------------------

// Outbox: fire-and-forget drain testlerle yarışmasın.
vi.mock("@/lib/email-outbox", async (orig) => {
  const actual = await orig<typeof import("@/lib/email-outbox")>();
  return { ...actual, kickEmailOutboxDrain: vi.fn() };
});

import { POST } from "@/app/api/account/forgot-password/route";

const EMAIL = "host@example.com";

function reqFrom(body: unknown, ip = "9.9.9.1") {
  return new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Faz 3 sonrası tek genel confirm hatası. Metin DEĞİŞTİRİLMEMELİ: ekrandaki
 *  "Kodu tekrar gönder" davetiyesiyle eşleşiyor ve tüm başarısızlık sebeplerini
 *  tek bir cevaba indiriyor. */
const GENERIC = "Bu kod artık kullanılamıyor.";

describe("forgot-password — rota-geneli değişmezler", () => {
  beforeEach(async () => {
    await resetDb();
    __resetRateLimit();
    vi.clearAllMocks();
    const org = await prisma.organization.create({ data: { name: "Org" } });
    await prisma.user.create({
      data: { organizationId: org.id, name: "Host", email: EMAIL, passwordHash: "old", role: "owner" },
    });
  });

  // ── IP kovası — eski dosyadan TAŞINDI (legacy'ye özel DEĞİL) ──────────────
  it("IP limiti: aynı IP'den 13. istek 429", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 12; i++) {
      const r = await POST(reqFrom({ action: "confirm", code: "00000000", newPassword: "yenisifre1" }, "7.7.7.7"));
      // KONTROL: ilk 12 istek limite TAKILMIYOR — bu olmadan "her zaman 429"
      // mutasyonu da yeşil geçerdi.
      expect(r.status).toBe(400);
    }
    const res = await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.7"));
    expect(res.status).toBe(429);
  });

  it("IP kovası ADRESE değil IP'ye bağlı: başka IP etkilenmez", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 12; i++) {
      await POST(reqFrom({ action: "confirm", code: "00000000", newPassword: "yenisifre1" }, "7.7.7.8"));
    }
    expect((await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.8"))).status).toBe(429);
    // Farklı IP hâlâ çalışıyor → kova global değil.
    expect((await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.9"))).status).toBe(200);
  });

  // ── Enumeration — eski dosyadan TAŞINDI ──────────────────────────────────
  it("ENUMERATION: bilinmeyen adres de 200 alır ve HİÇBİR satır yazılmaz", async () => {
    const res = await POST(reqFrom({ action: "request", email: "yok@example.com" }, "9.9.9.2"));
    expect(res.status).toBe(200);
    expect(await prisma.passwordResetChallenge.count()).toBe(0);
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it("ENUMERATION KONTROLÜ: bilinen adres AYNI 200'ü alır (fark yalnız posta kutusunda)", async () => {
    const res = await POST(reqFrom({ action: "request", email: EMAIL }, "9.9.9.3"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // …ama satırlar YAZILDI — yani 200 eşitliği "hiçbir şey yapılmadı" demek değil.
    expect(await prisma.passwordResetChallenge.count()).toBe(1);
    expect(await prisma.emailOutbox.count()).toBe(1);
  });

  it("geçersiz e-posta şekli YALNIZ request'te reddedilir", async () => {
    const res = await POST(reqFrom({ action: "request", email: "duz-metin" }, "9.9.9.4"));
    expect(res.status).toBe(400);
    expect((await res.json()).fields?.email).toContain("Geçerli bir e-posta");
  });

  // ── FAZ 3'ün YENİ SÖZLEŞMESİ: token'sız confirm fail-closed ──────────────
  // Eski yol kalktığı için token'sız bir confirm'ün gidebileceği yer YOK.
  // ⚠️ Cevap DEĞİŞMEZ ve ayrışmaz: hangi sebep olursa olsun aynı 400 + aynı
  // `code` alanı + aynı metin. Aksi hâlde yanıt şekli, isteğin hangi dala
  // düştüğünü (ve dolaylı olarak hesabın varlığını) sızdırırdı.
  describe("token'sız confirm", () => {
    const CASES: [string, Record<string, unknown>][] = [
      ["token alanı hiç yok", { action: "confirm", code: "12345678", newPassword: "yenisifre1" }],
      ["token boş string", { action: "confirm", token: "", code: "12345678", newPassword: "yenisifre1" }],
      ["token yalnız boşluk", { action: "confirm", token: "   ", code: "12345678", newPassword: "yenisifre1" }],
      ["token string değil", { action: "confirm", token: 42, code: "12345678", newPassword: "yenisifre1" }],
      ["e-posta VAR ama token yok", { action: "confirm", email: EMAIL, code: "12345678", newPassword: "yenisifre1" }],
      ["geçersiz e-posta + token yok", { action: "confirm", email: "duz-metin", code: "12345678", newPassword: "yenisifre1" }],
      // 🚨 ŞEKİL DOĞRULAMALARINDAN ÖNCE: kısa şifre ya da bozuk kod, token'sız
      // istekte FARKLI bir gövde üretmemeli. Token kontrolü en başta olduğu için
      // hepsi tek cevaba çöküyor.
      ["kısa şifre + token yok", { action: "confirm", code: "12345678", newPassword: "kisa" }],
      ["bozuk kod + token yok", { action: "confirm", code: "abc", newPassword: "yenisifre1" }],
      ["hiçbir alan yok", { action: "confirm" }],
    ];

    for (const [label, body] of CASES) {
      it(`${label} → aynı generic 400`, async () => {
        const res = await POST(reqFrom(body, "9.9.9.5"));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.fields?.code).toContain(GENERIC);
        // Başka bir alan adı SIZMAMALI (şekil farkı = dal oracle'ı).
        expect(Object.keys(json.fields ?? {})).toEqual(["code"]);
      });
    }

    it("token'sız confirm HİÇBİR DB yazması yapmaz (şifre değişmez, satır oluşmaz)", async () => {
      await POST(reqFrom({ action: "confirm", email: EMAIL, code: "12345678", newPassword: "yenisifre1" }, "9.9.9.6"));
      const u = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
      expect(u.passwordHash).toBe("old");
      expect(u.sessionEpoch).toBe(0);
      expect(await prisma.passwordResetChallenge.count()).toBe(0);
    });
  });

  it("bilinmeyen action generic reddedilir", async () => {
    const res = await POST(reqFrom({ action: "baska", email: EMAIL }, "9.9.9.7"));
    expect(res.status).toBe(400);
    expect((await res.json()).fields?._).toContain("Geçersiz işlem");
  });
});
