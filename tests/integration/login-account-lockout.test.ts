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
    // T3 (11-13): kullanıcı araması `found` adını aldı (ekip kişisi süzgeci ardından `user`). Çapa bulunamazsa slice(0, -1) bütün dosyayı
    // alırdı → çapanın varlığı ayrıca doğrulanır.
    const at = src.indexOf("const found = await prisma.user.findUnique");
    expect(at).toBeGreaterThan(0);
    const beforeLookup = src.slice(0, at);
    expect(beforeLookup).not.toMatch(/login-acct:/); // ⬅️ kapı geri gelirse kırmızı
  });

  // F1 (Codex 11-17) — sözleşme "kova yalnız başarısız dalda tüketilir"den "hak doğrulamadan ÖNCE atomik ayrılır, doğru parolada ve
  // doğrulama yapılamadığında İADE edilir, başarısız dalda İKİNCİ tüketim yok"a döndü. Pinin amacı aynı: doğru parolayı kilitleyen bir ön
  // kapı yok (net: başarı kova tüketmez — davranışı `login-route.test.ts` + `login-account-budget-race.test.ts` uçtan uca pinler).
  it("hak doğrulamadan ÖNCE ayrılır, başarıda ve doğrulama yapılamadığında iade edilir; başarısız dalda ikinci tüketim yok", async () => {
    const src = await loginSource();
    // 🚨 SINIRLARIN BULUNDUĞUNU DOĞRULA (08-06): çapa bulunamazsa `indexOf` -1 döner ve `slice` sessizce boşa düşer.
    const lookup = src.indexOf("const found = await prisma.user.findUnique");
    const reserve = src.indexOf("await rateLimitReserve(acctKey, LOGIN_ACCT_LIMIT, LOGIN_ACCT_WINDOW_MS)");
    const verify = src.indexOf("await verifyPasswordForLogin(");
    const from = src.indexOf("if (!user || !ok) {");
    const to = src.indexOf("E-posta veya şifre hatalı");
    const emailGate = src.indexOf("if (needsEmailVerification(user))");
    expect(lookup, "kullanıcı aramasının çapası bulunamadı — pin boşa düştü").toBeGreaterThan(0);
    expect(reserve, "hak ayırma (rateLimitReserve) bulunamadı").toBeGreaterThan(lookup);
    expect(verify, "ayırma doğrulamadan SONRAYA kaydı — eşzamanlı istekler yine kapıyı aynı sayaçla geçer").toBeGreaterThan(reserve);
    expect(from, "başarısız-doğrulama dalının başı bulunamadı — pin boşa düştü").toBeGreaterThan(verify);
    expect(to, "sınır metni değişmiş — bu testi yeni sınıra taşı, yoksa pin ÖLÜ").toBeGreaterThan(from);
    expect(emailGate, "e-posta doğrulama kapısının çapası bulunamadı").toBeGreaterThan(to);
    expect(src.match(/`login-acct:\$\{/g)?.length, "hesap kovası anahtarı TEK yerde kurulmalı (acctKey)").toBe(1);

    // Doğrulama yapılamazsa (kapı doygun / hata) hak geri verilir: ayırma ile başarısız dal arasında, catch içinde iade + yeniden fırlatma.
    const verifyBlock = src.slice(reserve, from);
    expect(verifyBlock).toMatch(/catch \(err\) \{[^}]*await rateLimitReleaseReservation\(acct\.reservation\);\s*throw err;/);

    // Başarısız dal: İKİNCİ tüketim yok; yalnız parite yazması (denetimle AYNI ANDA) ve karar ayırmanın sonucundan.
    const failBranch = src.slice(from, to);
    expect(failBranch).not.toMatch(/rateLimit\(|rateLimitReserve\(/);
    expect(failBranch).not.toMatch(/rateLimitReleaseReservation/); // hata hakkı TUTULUR
    expect(failBranch).toMatch(/await Promise\.all\(\[\s*rateLimitTouch\(acctKey\)/); // parite YAZMASI, denetimle aynı anda
    expect(failBranch).toMatch(/if \(!acct\.ok\)/);
    expect(failBranch).toMatch(/status: 429/);

    // Başarı: iade başarısız daldan HEMEN sonra, e-posta doğrulama / 2FA / üyelik dallarından ÖNCE.
    const afterFail = src.slice(to, emailGate);
    expect(afterFail).toMatch(/await rateLimitReleaseReservation\(acct\.reservation\);/);
  });

  it("IP kovası HÂLÂ en başta ve koşulsuz (regresyon pini)", async () => {
    const src = await loginSource();
    // Çapa bulunamazsa `slice(0, -1)` neredeyse bütün dosyayı verir ve pin boşa düşer (DENETIM 08-09 #32).
    const cut = src.indexOf("const bodyResult");
    expect(cut, "gövde okumasının çapası bulunamadı — pin boşa düştü").toBeGreaterThan(0);
    const head = src.slice(0, cut);
    // (09-23: kova anahtarı IPv6 /64'e indirgeyen `rateLimitClientKey`ten gelir.)
    expect(head).toMatch(/await rateLimit\(`login:\$\{rateLimitClientKey\(req\)\}`, 10, 5 \* 60 \* 1000\)/);
  });

  it("ölü `peekRateLimit` geri gelmedi (kullanılmayan koruma bırakılmaz)", async () => {
    const fs = await import("node:fs/promises");
    const rl = await fs.readFile("src/lib/rate-limit.ts", "utf8");
    expect(rl).not.toContain("peekRateLimit");
  });
});
