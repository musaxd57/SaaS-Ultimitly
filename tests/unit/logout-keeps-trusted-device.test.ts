import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// ÇIKIŞ "BENİ HATIRLA" ÇEREZİNİ SİLMEZ (kullanıcı kararı, 09-07)
//
// 08-09'daki sertleştirme çıkışta `guestops_trusted_device` çerezini de düşürüyordu.
// Sonuç canlıda "bozuk" olarak yaşandı: "Bu cihazı 30 gün hatırla" işaretli
// kullanıcı çıkıp yeniden girince YİNE 6 hane istendi — kutunun vaadi çıkışı
// aşmıyordu. Ürün kararı: cihaz güveni bir CİHAZ özelliğidir, oturumun değil
// (Google/GitHub davranışı). Güven yalnız şunlarla düşer: 30 gün · şifre
// değişimi/sıfırlama (`sessionEpoch`, S2) · 2FA sıfırlama (2FA epoch'u) ·
// kutunun işaretlenmemesi. Ortak bilgisayarda kutuyu İŞARETLEMEMEK kullanıcının
// bilinçli seçimidir; çıkışta sessizce geri almak o seçimi anlamsızlaştırıyordu.
//
// 🚨 S2 KORUNUR: bu dosya yalnız çıkışı ilgilendirir; şifre sıfırlama/değiştirme
// sonrası güvenin düştüğü ayrı dosyalarda pinli (`password-reset-challenge`,
// `account-password-route`, `trusted-device.test.ts`).
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

  it("oturum çerezini süresi dolmuş yazar (çıkış gerçekten çıkıştır)", async () => {
    await clearSessionCookie();
    const session = calls.find((c) => c.name === SESSION_COOKIE);
    expect(session).toBeDefined();
    expect(session!.value).toBe("");
    expect(session!.opts.maxAge).toBe(0);
    expect(session!.opts.path).toBe("/");
  });

  it("🚨 trusted-device çerezine DOKUNMAZ — 'beni hatırla' çıkışı aşar", async () => {
    await clearSessionCookie();
    const names = calls.map((c) => c.name);
    expect(names).not.toContain(TRUSTED_DEVICE_COOKIE); // ⬅️ 08-09 hâlinde siliniyordu
  });
});
