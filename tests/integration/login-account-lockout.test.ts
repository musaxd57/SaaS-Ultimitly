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
    const failBranch = src.slice(
      src.indexOf("if (!user || !ok) {"),
      src.indexOf("E-posta veya şifre hatalı"),
    );
    expect(failBranch).toMatch(/await rateLimit\(`login-acct:/);
    // Ve tavan aşıldığında o dal 429 döndürür (koruma dekoratif değil).
    expect(failBranch).toMatch(/if \(!acct\.ok\)/);
    expect(failBranch).toMatch(/status: 429/);
  });

  it("IP kovası HÂLÂ en başta ve koşulsuz (regresyon pini)", async () => {
    const src = await loginSource();
    const head = src.slice(0, src.indexOf("const bodyResult"));
    expect(head).toMatch(/await rateLimit\(`login:\$\{clientIp\(req\)\}`, 10, 5 \* 60 \* 1000\)/);
  });

  it("ölü `peekRateLimit` geri gelmedi (kullanılmayan koruma bırakılmaz)", async () => {
    const fs = await import("node:fs/promises");
    const rl = await fs.readFile("src/lib/rate-limit.ts", "utf8");
    expect(rl).not.toContain("peekRateLimit");
  });
});
