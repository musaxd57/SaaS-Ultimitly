// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TrialBanner } from "@/components/billing/trial-banner";
import {
  showTrialBanner,
  trialBannerSnoozeCookie,
  TRIAL_BANNER_COOKIE,
  TRIAL_BANNER_SNOOZE_SECONDS,
} from "@/lib/billing/trial-banner";

// Deneme bandı (kurucu önerisi 09-24): kapatılabilir, 4 saat sonra kendiliğinden geri gelir; süre dolmuşsa kapatılamaz.
describe("TrialBanner", () => {
  afterEach(() => {
    cleanup();
    document.cookie = `${TRIAL_BANNER_COOKIE}=; Path=/; Max-Age=0`;
  });

  it("'Kapat' bandı gizler ve 4 saatlik çerez yazar (sunucu yenilemede çizmesin)", () => {
    render(<TrialBanner daysLeft={14} />);
    expect(screen.getByText("Pro ücretsiz deneme: 14 gün kaldı.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Planları görün" }).getAttribute("href")).toBe("/settings?tab=faturalandirma");
    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByText("Pro ücretsiz deneme: 14 gün kaldı.")).toBeNull();
    expect(document.cookie).toContain(`${TRIAL_BANNER_COOKIE}=1`);
  });

  it("süre DOLMUŞSA kapatma düğmesi yok (otomatik mesajların duracağının tek işareti)", () => {
    render(<TrialBanner daysLeft={0} />);
    expect(screen.getByText("Ücretsiz deneme süreniz doldu — devam için bir plan seçin.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kapat" })).toBeNull();
  });
});

describe("deneme bandı kuralı (saf)", () => {
  it("kapatılmışsa gizli; süre dolmuşsa kapatma yok sayılır; deneme yoksa hiç yok", () => {
    expect(showTrialBanner({ trialing: true, daysLeft: 14, snoozed: false })).toBe(true);
    expect(showTrialBanner({ trialing: true, daysLeft: 14, snoozed: true })).toBe(false);
    expect(showTrialBanner({ trialing: true, daysLeft: 0, snoozed: true })).toBe(true);
    expect(showTrialBanner({ trialing: false, daysLeft: 3, snoozed: false })).toBe(false);
    expect(showTrialBanner({ trialing: true, daysLeft: null, snoozed: false })).toBe(false);
  });

  it("çerez: 4 saat ömür, tüm uygulama yolu, yalnız aynı site; https'te Secure", () => {
    expect(TRIAL_BANNER_SNOOZE_SECONDS).toBe(4 * 60 * 60);
    const c = trialBannerSnoozeCookie(true);
    expect(c).toContain(`${TRIAL_BANNER_COOKIE}=1`);
    expect(c).toContain("Max-Age=14400");
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(trialBannerSnoozeCookie(false)).not.toContain("Secure");
  });
});
