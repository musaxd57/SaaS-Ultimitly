import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// ÇIKIŞ "BENİ HATIRLA" ÇEREZİNİ DE DÜŞÜRÜR (denetim, 08-09)
//
// `guestops_trusted_device` 2FA'yı ATLAYAN 30 günlük bir kimlik bilgisidir ve
// hiçbir yer onu temizlemiyordu — `clearSessionCookie` yalnız oturum çerezine
// dokunuyordu. httpOnly olduğu için kullanıcı onu göremez, silecek bir arayüz
// de yok. Ortak/ofis bilgisayarında senaryo net: kurban 2FA ile girer, "bu
// cihazı hatırla" der, ÇIKIŞ YAPAR; sonradan yalnız ŞİFREYİ ele geçiren biri
// ikinci faktörü hiç görmeden girer — ve o oturum `mfa: true` damgalanır, ki bu
// operatör yetkisinin TEK kapısıdır.
//
// 🚨 S2/S1 SINIRI: bu düzeltme `sessionEpoch`e DOKUNMAZ. Yalnız BU tarayıcıdaki
// çerezin süresini doldurur → başka cihazlar etkilenmez. "Her çıkışta tüm
// cihazlar düşsün" hâlâ per-session `jti` işidir (ayrı migration turu).
// ─────────────────────────────────────────────────────────────────────────────

type SetCall = { name: string; value: string; opts: Record<string, unknown> };
const calls: SetCall[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, opts: Record<string, unknown>) => {
      calls.push({ name, value, opts });
    },
    get: () => undefined,
  }),
}));

import { clearSessionCookie } from "@/lib/auth";
import { TRUSTED_DEVICE_COOKIE } from "@/lib/auth/trusted-device";
import { SESSION_COOKIE } from "@/lib/auth/session";

describe("clearSessionCookie", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("oturum çerezini VE trusted-device çerezini birlikte süresi dolmuş yazar", async () => {
    await clearSessionCookie();

    const names = calls.map((c) => c.name);
    // KONTROL: eski davranış (yalnız oturum) hâlâ duruyor — bu iddia olmadan
    // "hiçbir şey yazma" mutasyonu da yeşil geçerdi.
    expect(names).toContain(SESSION_COOKIE);
    // ASIL İDDİA.
    expect(names).toContain(TRUSTED_DEVICE_COOKIE);
  });

  it("trusted-device çerezi GERÇEKTEN geçersizleştirilir (maxAge 0 + boş değer + aynı path)", async () => {
    await clearSessionCookie();

    const trusted = calls.find((c) => c.name === TRUSTED_DEVICE_COOKIE);
    expect(trusted).toBeDefined();
    expect(trusted!.value).toBe("");
    // `maxAge: 0` olmadan çerez yenilenmiş olurdu — "sildim" görünüp silmemek.
    expect(trusted!.opts.maxAge).toBe(0);
    // ⚠️ `path` YAZILDIĞI PATH'LE AYNI OLMAK ZORUNDA (`setTrustedDeviceCookie`
    // `path:"/"` kullanıyor): farklı path'te silme isteği tarayıcıda HİÇBİR ŞEY
    // yapmaz ve çerez sessizce yaşamaya devam eder — oturum çerezinin kendi
    // yorumunda yazılı olan tuzağın aynısı.
    expect(trusted!.opts.path).toBe("/");
    expect(trusted!.opts.httpOnly).toBe(true);
  });
});
