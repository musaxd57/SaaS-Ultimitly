import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// KAYNAK PİNİ — HESAP KOVASI DOĞRULAMADAN ÖNCE KAPI OLARAK KULLANILAMAZ.
// (Codex denetimi, 2026-08-01 — madde 1.)
//
// `login-acct:{email}` kovası bir kaba kuvvet SINIRIDIR, bir KAPI değil. Kimlik
// doğrulamasından ÖNCE değerlendirilirse kurbanın e-postasını bilen biri sadece
// HATALI parolalarla kovayı doldurup hesabı kilitler — kurban DOĞRU parolasıyla
// bile 429 alır. Yani koruma, hizmet engelleme silahına dönüşür.
//
// Davranışın kendisi `login-route.test.ts` içinde uçtan uca pinli (doğru parola
// kilitlenmiyor · başarısız denemeler yine 429 · IP limiti korunuyor · başarılı
// giriş kovayı tüketmiyor). Bu dosya YAPIYI pinler: birisi kapıyı yeniden yukarı
// taşırsa test kırmızıya döner.
// ---------------------------------------------------------------------------
describe("login — hesap kovasının YERİ (yapısal pin)", () => {
  async function loginSource(): Promise<string> {
    const fs = await import("node:fs/promises");
    return fs.readFile("src/app/api/auth/login/route.ts", "utf8");
  }

  it("kullanıcı aranmadan ÖNCE hesap kovasına HİÇ dokunulmaz", async () => {
    const src = await loginSource();
    const beforeLookup = src.slice(0, src.indexOf("const user = await prisma.user.findUnique"));
    expect(beforeLookup).not.toMatch(/login-acct:/); // ⬅️ kapı geri gelirse kırmızı
  });

  it("kova YALNIZ başarısız-doğrulama dalında tüketilir", async () => {
    const src = await loginSource();
    // 🚨 SINIRLARIN BULUNDUĞUNU DOĞRULA (08-06, denetim ajanı uyarısı).
    // Bu `slice` iki LİTERALLE sınırlanıyor ve ikincisi kullanıcıya görünen bir
    // METİN. Biri o metni kurumsallaştırırsa `indexOf` **-1** döner, `slice(a,-1)`
    // dosyanın SONUNA kadar keser ve aşağıdaki üç assertion **YİNE GEÇER** —
    // yani test kırmızıya dönmez, SESSİZCE boşa düşer ve hesap-kovasının yerini
    // koruyan güvenlik pini ölür. Bu iki satır o yolu kapatır.
    const from = src.indexOf("if (!user || !ok) {");
    const to = src.indexOf("E-posta veya şifre hatalı");
    expect(from, "başarısız-doğrulama dalının başı bulunamadı — pin boşa düştü").toBeGreaterThan(-1);
    expect(to, "sınır metni değişmiş — bu testi yeni sınıra taşı, yoksa pin ÖLÜ").toBeGreaterThan(from);
    const failBranch = src.slice(from, to);
    // (09-23: tüketim, denetim yazımıyla AYNI ANDA `await Promise.all([...])` içinde koşar —
    // bilinen hesabın başarısız girişi fazladan bir DB turu kadar yavaş kalmasın diye.)
    expect(failBranch).toMatch(/await Promise\.all\(\[\s*rateLimit\(`login-acct:/);
    // Ve tavan aşıldığında o dal 429 döndürür (koruma dekoratif değil).
    expect(failBranch).toMatch(/if \(!acct\.ok\)/);
    expect(failBranch).toMatch(/status: 429/);
  });

  it("IP kovası HÂLÂ en başta ve koşulsuz (regresyon pini)", async () => {
    const src = await loginSource();
    const head = src.slice(0, src.indexOf("const bodyResult"));
    // (09-23: kova anahtarı IPv6 /64'e indirgeyen `rateLimitClientKey`ten gelir.)
    expect(head).toMatch(/await rateLimit\(`login:\$\{rateLimitClientKey\(req\)\}`, 10, 5 \* 60 \* 1000\)/);
  });

  it("ölü `peekRateLimit` geri gelmedi (kullanılmayan koruma bırakılmaz)", async () => {
    const fs = await import("node:fs/promises");
    const rl = await fs.readFile("src/lib/rate-limit.ts", "utf8");
    expect(rl).not.toContain("peekRateLimit");
  });
});
