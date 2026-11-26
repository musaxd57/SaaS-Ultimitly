// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TrialBanner } from "@/components/billing/trial-banner";
import {
  showTrialBanner,
  trialBannerStage,
  trialBannerSnoozeCookie,
  trialBannerDismissible,
  trialEndDayWord,
  trialEndLabel,
  TRIAL_BANNER_COOKIE,
  TRIAL_BANNER_SNOOZE_SECONDS,
} from "@/lib/billing/trial-banner";

// ---------------------------------------------------------------------------
// Deneme bandı — UX-8 (kurucu 11-13: "milyarlık web siteleri nasıl yapıyorsa öyle yap"). Eskiden 14 gün boyunca her gün aynı amber bant,
// kapatınca 4 saat sonra geri geliyordu. Şimdi: ilk yarıda bant YOK (kenar çubuğu rozeti yeter), son 7 günde kademeli; kapatma aşamaya göre
// 24 / 12 / 4 saat; aşama değişince yeniden görünür; süre dolunca yalnız faturalandırma zorunluysa (aksi hâlde hiçbir şey durmaz).
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  document.cookie = `${TRIAL_BANNER_COOKIE}=; Path=/; Max-Age=0`;
});

describe("aşamalar (saf)", () => {
  it.each([
    [14, "calm"],
    [8, "calm"],
    [7, "info"],
    [4, "info"],
    [3, "warn"],
    [2, "warn"],
    [1, "last"],
    [0, "ended"],
    [-2, "ended"],
  ] as const)("%i gün → %s", (days, stage) => {
    expect(trialBannerStage(days)).toBe(stage);
  });

  it("ilk yarıda bant yok; son 7 günde var; kapatılan aşamada gizli, aşama değişince yeniden görünür", () => {
    const base = { trialing: true, enforced: false, snoozedStage: null };
    expect(showTrialBanner({ ...base, daysLeft: 14 })).toBe(false);
    expect(showTrialBanner({ ...base, daysLeft: 8 })).toBe(false);
    expect(showTrialBanner({ ...base, daysLeft: 7 })).toBe(true);
    expect(showTrialBanner({ ...base, daysLeft: 5, snoozedStage: "info" })).toBe(false);
    expect(showTrialBanner({ ...base, daysLeft: 3, snoozedStage: "info" })).toBe(true); // ton değişti → yeniden
    expect(showTrialBanner({ ...base, daysLeft: 2, snoozedStage: "warn" })).toBe(false);
    expect(showTrialBanner({ ...base, daysLeft: 1, snoozedStage: "warn" })).toBe(true);
    expect(showTrialBanner({ ...base, daysLeft: 1, snoozedStage: "last" })).toBe(false);
    // Eski biçimdeki çerez ("1") hiçbir aşamaya denk gelmez → bir kez yeniden görünür.
    expect(showTrialBanner({ ...base, daysLeft: 5, snoozedStage: "1" })).toBe(true);
  });

  it("🚨 süre dolunca yalnız faturalandırma ZORUNLUYSA (yoksa hiçbir şey durmuyor — 'süreniz doldu' baskısı yanlış olurdu); kapatma yok sayılır", () => {
    expect(showTrialBanner({ trialing: true, daysLeft: 0, snoozedStage: null, enforced: false })).toBe(false);
    expect(showTrialBanner({ trialing: true, daysLeft: 0, snoozedStage: "last", enforced: true })).toBe(true);
    expect(trialBannerDismissible(0)).toBe(false);
    expect(trialBannerDismissible(1)).toBe(true);
  });

  it("deneme yoksa / bitiş bilinmiyorsa hiç yok", () => {
    expect(showTrialBanner({ trialing: false, daysLeft: 3, snoozedStage: null, enforced: true })).toBe(false);
    expect(showTrialBanner({ trialing: true, daysLeft: null, snoozedStage: null, enforced: true })).toBe(false);
  });

  it("kapatma çerezi: değeri aşama, ömrü 24 / 12 / 4 saat; tüm uygulama yolu, yalnız aynı site, https'te Secure", () => {
    expect(TRIAL_BANNER_SNOOZE_SECONDS).toEqual({ info: 86400, warn: 43200, last: 14400 });
    const c = trialBannerSnoozeCookie(true, "warn");
    expect(c).toContain(`${TRIAL_BANNER_COOKIE}=warn`);
    expect(c).toContain("Max-Age=43200");
    expect(c).toContain("Path=/");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(trialBannerSnoozeCookie(false, "info")).not.toContain("Secure");
    expect(trialBannerSnoozeCookie(false, "last")).toContain("Max-Age=14400");
  });

  it("bitiş tarihi işletmenin saat diliminde; son gün 'bugün' / 'yarın' takvim gününe göre", () => {
    expect(trialEndLabel(new Date("2026-11-18T10:00:00Z"), "Europe/Istanbul")).toBe("18 Kasım");
    const ends = new Date("2026-11-13T22:30:00Z"); // İstanbul'da 14 Kasım 01:30
    const now = new Date("2026-11-13T20:00:00Z"); // İstanbul'da 13 Kasım 23:00
    expect(trialEndDayWord(ends, now, "Europe/Istanbul")).toBe("yarın");
    expect(trialEndDayWord(ends, now, "UTC")).toBe("bugün");
  });
});

describe("TrialBanner bileşeni", () => {
  it("ilk yarıda hiçbir şey çizmez", () => {
    const { container } = render(<TrialBanner daysLeft={10} endsLabel="23 Kasım" endsDayWord={null} automationStops />);
    expect(container.innerHTML).toBe("");
  });

  it("son 7 gün: nötr ton, bitiş tarihi, 'Plan seçin'; kapatınca aşama çerezi yazılır", () => {
    render(<TrialBanner daysLeft={5} endsLabel="18 Kasım" endsDayWord={null} automationStops />);
    expect(screen.getByText("Denemenizin bitmesine 5 gün kaldı (18 Kasım).")).toBeTruthy();
    expect(document.querySelector("[data-trial-stage]")!.getAttribute("data-trial-stage")).toBe("info");
    expect(document.querySelector("[data-trial-stage]")!.className).not.toContain("amber");
    expect(screen.getByRole("link", { name: "Plan seçin" }).getAttribute("href")).toBe("/settings?tab=faturalandirma");
    fireEvent.click(screen.getByRole("button", { name: "Kapat" }));
    expect(screen.queryByText(/Denemenizin bitmesine/)).toBeNull();
    expect(document.cookie).toContain(`${TRIAL_BANNER_COOKIE}=info`);
  });

  it("son 3 gün: amber", () => {
    render(<TrialBanner daysLeft={3} endsLabel="16 Kasım" endsDayWord={null} automationStops />);
    expect(document.querySelector("[data-trial-stage]")!.className).toContain("amber");
  });

  it("son gün: 'bugün/yarın bitiyor'; otomatik yanıtların kapanacağı yalnız GERÇEKTEN kapanacaksa yazılır", () => {
    render(<TrialBanner daysLeft={1} endsLabel="14 Kasım" endsDayWord="bugün" automationStops />);
    expect(screen.getByText("Denemeniz bugün bitiyor (14 Kasım). Bittiğinde otomatik yanıtlar kapanır.")).toBeTruthy();
    cleanup();
    render(<TrialBanner daysLeft={1} endsLabel="14 Kasım" endsDayWord="yarın" automationStops={false} />);
    expect(screen.getByText("Denemeniz yarın bitiyor (14 Kasım).")).toBeTruthy();
  });

  it("süre dolmuş: kapatma düğmesi yok", () => {
    render(<TrialBanner daysLeft={0} endsLabel={null} endsDayWord={null} automationStops />);
    expect(screen.getByText("Ücretsiz deneme süreniz doldu — devam için bir plan seçin.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kapat" })).toBeNull();
  });
});
