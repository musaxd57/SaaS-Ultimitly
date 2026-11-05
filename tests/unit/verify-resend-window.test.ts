import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { VERIFY_RESEND_QUIET_MS, VERIFY_RESEND_REQUESTED_TEXT } from "@/lib/auth/verify-resend-window";
import { VERIFY_RESEND_QUIET_MS as SERVER_QUIET_MS } from "@/lib/auth/email-verify";

// Tur 7 T7-AUTH-1 (kurucu onayı 11-05): sunucunun sessiz penceresi, formun bekleme sayacı ve ekrandaki "10 dakika bekleyin" TEK sabitten.
describe("doğrulama e-postası yeniden isteme penceresi", () => {
  it("sunucu ile istemci aynı sabiti kullanır", () => {
    expect(SERVER_QUIET_MS).toBe(VERIFY_RESEND_QUIET_MS);
  });

  it("ekrandaki süre sabitle tutarlı ve metin 'gönderildi' iddia etmez", () => {
    expect(VERIFY_RESEND_REQUESTED_TEXT).toContain(`${VERIFY_RESEND_QUIET_MS / 60_000} dakika bekleyin`);
    expect(VERIFY_RESEND_REQUESTED_TEXT).not.toMatch(/gönderildi|gönderdik/i);
  });
});
