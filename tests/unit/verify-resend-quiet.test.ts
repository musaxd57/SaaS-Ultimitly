import { describe, it, expect } from "vitest";
import { verifyLinkRecentlyIssued, VERIFY_TTL_MS, VERIFY_RESEND_QUIET_MS } from "@/lib/auth/email-verify";

// U12 (kurucu 10-22): son 10 dakikada üretilmiş geçerli bağlantı → yeni bağlantı / e-posta yok. Saf karar tablosu.
describe("verifyLinkRecentlyIssued", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const issuedAgo = (ms: number) => new Date(now.getTime() - ms + VERIFY_TTL_MS);
  it.each([
    ["bağlantı yok", null, false],
    ["az önce üretildi", issuedAgo(1_000), true],
    ["9 dk önce", issuedAgo(9 * 60_000), true],
    ["tam 10 dk önce (pencere dışı)", issuedAgo(VERIFY_RESEND_QUIET_MS), false],
    ["11 dk önce", issuedAgo(11 * 60_000), false],
    ["süresi dolmuş", new Date(now.getTime() - 1), false],
  ])("%s → %s", (_n, expiresAt, expected) => {
    expect(verifyLinkRecentlyIssued(expiresAt as Date | null, now)).toBe(expected);
  });
});
