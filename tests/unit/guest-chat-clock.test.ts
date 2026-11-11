import { describe, it, expect } from "vitest";
import { guestChatClock } from "@/lib/guest-chat-clock";

// Misafirin QR sohbetinde mesajın yanındaki saat (3c, kurucu 11-11). Sunucu kurar: işletmenin saat dilimi, 24 saat biçimi.
describe("guestChatClock", () => {
  const at = new Date(Date.UTC(2026, 10, 10, 22, 29, 30));

  it("işletmenin saat diliminde SS:DD döner (gece yarısını aşan dilimde de)", () => {
    expect(guestChatClock(at, "Europe/Istanbul")).toBe("01:29");
    expect(guestChatClock(at, "Asia/Tokyo")).toBe("07:29");
    expect(guestChatClock(at, "America/New_York")).toBe("17:29");
  });

  it("gece yarısı 24:00 değil 00:00 yazılır", () => {
    expect(guestChatClock(new Date(Date.UTC(2026, 10, 10, 21, 0, 0)), "Europe/Istanbul")).toBe("00:00");
  });

  it("dilim yoksa / geçersizse varsayılan dilim (İstanbul) kullanılır — saat uydurulmaz, boş da kalmaz", () => {
    expect(guestChatClock(at, null)).toBe("01:29");
    expect(guestChatClock(at, undefined)).toBe("01:29");
    expect(guestChatClock(at, "Mars/Olympus")).toBe("01:29");
  });

  it("geçersiz tarihte boş metin (ekranda saat çizilmez)", () => {
    expect(guestChatClock(new Date("yok"), "Europe/Istanbul")).toBe("");
    expect(guestChatClock("2026-11-10" as unknown as Date, "Europe/Istanbul")).toBe("");
  });
});
