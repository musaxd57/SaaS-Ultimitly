import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECURITY_CONTACT, SECURITY_TXT_EXPIRES } from "@/app/(legal)/guvenlik/content";

// ---------------------------------------------------------------------------
// `security.txt` BAYATLAMA + TUTARLILIK PİNİ (RFC 9116).
//
// Neden test: RFC 9116 §5.3 açıkça şunu diyor — "bayat bilgi taşıyan bir
// security.txt, hiç olmamasından KÖTÜ olabilir". Süresi geçmiş bir dosya, bir
// partner denetçisinin çalıştıracağı her RFC-9116 doğrulayıcısında kırmızı
// yanar; yani dosya kendi kendini denetim bulgusuna çevirir.
//
// İnsan hafızası bunu tutamaz (tarih 10 ay sonra dolacak), o yüzden CI tutar:
// süre dolmasına 30 GÜN KALA test kırmızıya döner ve yenileme hatırlatılır.
// ---------------------------------------------------------------------------

const RAW = readFileSync(join(process.cwd(), "public/.well-known/security.txt"), "utf8");

/** RFC 9116 alanları: `Ad: değer`, yorumlar `#` ile. Aynı ad birden çok kez
 *  geçebilir (ör. iki `Contact`), bu yüzden dizi döner. */
function field(name: string): string[] {
  return RAW.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .filter((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}:`))
    .map((l) => l.slice(name.length + 1).trim());
}

describe("public/.well-known/security.txt (RFC 9116)", () => {
  it("ZORUNLU alanlar var: Contact (≥1) ve Expires (TAM 1)", () => {
    // RFC 9116 §2.5.3 Contact "MUST always be present";
    // §2.5.5 Expires "MUST always be present and MUST NOT appear more than once".
    expect(field("Contact").length).toBeGreaterThanOrEqual(1);
    expect(field("Expires")).toHaveLength(1);
  });

  it("Contact URI biçiminde (mailto:/https:) — çıplak e-posta GEÇERSİZ", () => {
    for (const c of field("Contact")) {
      expect(c, `URI değil: ${c}`).toMatch(/^(mailto:|https:\/\/|tel:)/);
    }
    // Politika sayfasındaki adresle AYNI olmalı; ikisi ayrışırsa araştırmacı
    // hangi adrese yazacağını bilemez.
    expect(field("Contact")).toContain(`mailto:${SECURITY_CONTACT}`);
  });

  it("🚨 BAYATLAMA: Expires gelecekte, 365 günden yakın, ve dolmasına >30 gün var", () => {
    const expires = new Date(field("Expires")[0]);
    expect(Number.isNaN(expires.getTime()), "Expires RFC3339 olarak ayrıştırılamadı").toBe(false);

    const daysLeft = (expires.getTime() - Date.now()) / 86_400_000;
    // Bu üç iddia BİRLİKTE anlamlı: geçmişte olmamalı, çok uzağa atılmamalı
    // (§2.5.5 "RECOMMENDED <1 yıl"), ve yenileme için erken uyarı vermeli.
    expect(daysLeft, "Expires GEÇMİŞTE — dosya bayat, RFC §5.3'e göre hiç olmamasından kötü").toBeGreaterThan(0);
    expect(daysLeft, "Expires 365 günden uzağa atılmış (RFC §2.5.5)").toBeLessThan(365);
    expect(
      daysLeft,
      "Expires dolmasına 30 günden az kaldı → security.txt'i ve /guvenlik sayfasını YENİLE",
    ).toBeGreaterThan(30);
  });

  it("SÜRÜKLENME: dosyadaki Expires ile sayfadaki sabit AYNI", () => {
    // İki yerde yazılı bir tarih, er geç ayrışır. Sayfa "şu tarihe kadar
    // geçerli" diyorken dosya başka bir tarih söylerse hangisi doğru?
    expect(field("Expires")[0]).toBe(SECURITY_TXT_EXPIRES);
  });

  it("Canonical YALNIZ gerçekten servis ettiğimiz adresi listeler", () => {
    // RFC 9116 §3.1: dosya YALNIZCA getirildiği TAM alan adı için geçerlidir.
    // Apex (lixusai.com) şu an farklı bir sunucuya işaret ediyor, dolayısıyla
    // buradaki dosya onu KAPSAMIYOR — apex'i `Canonical` diye listelemek
    // kapsamadığımız bir alan için sorumluluk iddia etmek olurdu.
    for (const c of field("Canonical")) {
      expect(c, `servis etmediğimiz canonical: ${c}`).toBe(
        "https://www.lixusai.com/.well-known/security.txt",
      );
    }
  });

  it("Policy bağlantısı OTURUMSUZ erişilebilir bir yola işaret eder", () => {
    // `/guvenlik` middleware'in PUBLIC_PREFIXES listesinde değilse, politikayı
    // okumak isteyen (tanım gereği oturumsuz) araştırmacı /login'e düşer ve
    // `security.txt`'in `Policy` alanı ölü bağlantıya döner.
    const mw = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");
    expect(mw).toContain('"/guvenlik"');
    for (const p of field("Policy")) {
      expect(p).toBe("https://www.lixusai.com/guvenlik");
    }
  });

  it("VAAT EDİLMEYEN alanlar YOK (ölü bağlantı = bayat bilgi)", () => {
    // `Encryption`/`Acknowledgments`/`Hiring` ancak GERÇEKTEN varsa yazılır;
    // olmayan bir PGP anahtarına işaret etmek RFC §5.3 anlamında bayat bilgidir.
    for (const f of ["Encryption", "Acknowledgments", "Hiring"]) {
      expect(field(f), `${f} yazılmış ama karşılığı var mı?`).toHaveLength(0);
    }
  });
});
