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
//   · IP kovaları — akışın tamamını kapsar, eski yola özel değil (11-25'ten beri `forgot-ip-req` 5 + `forgot-ip-confirm` 7 / 15 dk;
//     eskiden tek `forgot:{ip}` 12 / 15 dk)
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
import { issueChallenge } from "@/lib/auth/password-reset-challenge";

const EMAIL = "host@example.com";

function reqFrom(body: unknown, ip = "9.9.9.1") {
  return new NextRequest("http://localhost/api/account/forgot-password", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

/** Faz 3 sonrası tek genel confirm hatası: tüm başarısızlık sebeplerini tek bir cevaba indirir (hangi sebep olduğu sızmaz).
 *  Tur 7 T7-AUTH-2 (11-05): yalnız bu ekrandaki düğmeyi ("Baştan başla") anar — eskiden Ayarlar'daki "Kodu tekrar gönder"i anıyordu. */
const GENERIC = "Kod doğrulanamadı. Kodu kontrol edip tekrar deneyin ya da “Baştan başla” ile yeni bir kod isteyin."; // T7-AUTH-2 (11-05)

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

  // ── IP kovaları — eski dosyadan TAŞINDI (legacy'ye özel DEĞİL); 11-25'ten beri eylem başına İKİ kova (istek 5 + doğrulama 7 = eski 12) ──
  it("IP limiti (doğrulama kovası): aynı IP'den 8. doğrulama 429", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 7; i++) {
      const r = await POST(reqFrom({ action: "confirm", code: "00000000", newPassword: "yenisifre1" }, "7.7.7.7"));
      // KONTROL: ilk 7 istek limite TAKILMIYOR — bu olmadan "her zaman 429"
      // mutasyonu da yeşil geçerdi.
      expect(r.status).toBe(400);
    }
    expect((await POST(reqFrom({ action: "confirm", code: "00000000", newPassword: "yenisifre1" }, "7.7.7.7"))).status).toBe(429);
    // Bozuk / bilinmeyen eylem de doğrulama kovasına sayılır (sayılmadan geçen istek yok).
    expect((await POST(reqFrom({ action: "baska" }, "7.7.7.7"))).status).toBe(429);
  });

  it("IP limiti (istek kovası): aynı IP'den 6. kod isteği 429 (farklı adreslerle — adres tavanı 4)", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      expect((await POST(reqFrom({ action: "request", email: `a${i}@example.com` }, "7.7.7.6"))).status).toBe(200);
    }
    expect((await POST(reqFrom({ action: "request", email: "a9@example.com" }, "7.7.7.6"))).status).toBe(429);
  });

  it("IP kovası ADRESE değil IP'ye bağlı: başka IP etkilenmez", { timeout: 90_000 }, async () => {
    for (let i = 0; i < 5; i++) {
      await POST(reqFrom({ action: "request", email: `b${i}@example.com` }, "7.7.7.8"));
    }
    expect((await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.8"))).status).toBe(429);
    // Farklı IP hâlâ çalışıyor → kova global değil.
    expect((await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.7.9"))).status).toBe(200);
  });

  // ── Codex 11-25: "kod iste" ile "kodu doğrula" IP bütçeleri AYRI ─────────
  it("🚨 aynı ağdan çok sayıda KOD İSTEĞİ, elinde geçerli kodu olan kişinin DOĞRULAMASINI kapatmaz", { timeout: 90_000 }, async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const issued = await issueChallenge(prisma, user.id);
    // Ortak ağdaki başka kişiler (farklı adresler) istek bütçesini sonuna kadar kullanır.
    let i = 0;
    while ((await POST(reqFrom({ action: "request", email: `kisi${i++}@example.com` }, "7.7.6.1"))).status === 200) {
      if (i > 30) throw new Error("istek kovası hiç dolmadı");
    }
    // Kişi geçerli kodunu aynı ağdan girer → doğrulama kendi bütçesinden geçer.
    const res = await POST(reqFrom({ action: "confirm", token: issued.token, code: issued.code, newPassword: "yenisifre12" }, "7.7.6.1"));
    expect(res.status).toBe(200);
  });

  it("🚨 ters yön: aynı ağdan çok sayıda DOĞRULAMA denemesi KOD İSTEĞİNİ kapatmaz", { timeout: 90_000 }, async () => {
    let i = 0;
    while ((await POST(reqFrom({ action: "confirm", code: "00000000", newPassword: "yenisifre1" }, "7.7.6.2"))).status === 400) {
      if (++i > 30) throw new Error("doğrulama kovası hiç dolmadı");
    }
    expect((await POST(reqFrom({ action: "request", email: EMAIL }, "7.7.6.2"))).status).toBe(200);
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

describe("Tur 7 T7-AUTH-2 — halka açık sıfırlama ekranı metni", () => {
  it("🚨 genel hata yalnız bu ekranda olan düğmeyi anar ve sebep uydurmaz", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("src/app/api/account/forgot-password/route.ts", "utf8");
    const form = readFileSync("src/components/auth/forgot-password-form.tsx", "utf8");
    expect(route).not.toMatch(/const GENERIC_CONFIRM =[^;]*Kodu tekrar gönder/);
    expect(route).not.toMatch(/const GENERIC_CONFIRM =[^;]*daha yeni bir kod/);
    expect(route).toMatch(/const GENERIC_CONFIRM =[^;]*“Baştan başla”/);
    expect(form).toContain("Baştan başla"); // anılan düğme bu ekranda gerçekten var
    expect(form).not.toContain("Kodu tekrar gönder");
  });
});
