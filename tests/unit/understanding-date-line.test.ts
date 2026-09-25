import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Anlama katmanını çağıran TEK fonksiyon gerçek uygulamaya devreden bir casusla sarılır: davranış aynı, girdi görünür.
vi.mock("@/lib/ai/semantic/understand", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/semantic/understand")>();
  return { ...actual, understandGuestMessages: vi.fn((i: Parameters<typeof actual.understandGuestMessages>[0]) => actual.understandGuestMessages(i)) };
});

import { stayTimeline, understandingDateLine } from "@/lib/ai/stay-timeline";
import { buildUnderstandingUserContent, understandGuestMessages } from "@/lib/ai/semantic/understand";
import { retrieveKbForPrompt } from "@/lib/ai/kb-retrieve";

// ---------------------------------------------------------------------------
// ANLAMA KATMANININ TARİH SATIRI (Konuşma Anlama Durumu; bayrak `AI_CONVERSATION_STATE_ENABLED` varsayılan KAPALI).
// "Yarın 11'de gelebilir miyiz?" gibi göreli ifadenin konaklamadaki yeri (varış günü mü, çıkış günü mü, başka gün mü)
// ancak bugünü ve rezervasyonun günlerini bilerek okunur. Anlama katmanı canlıda AÇIK ve ölçülmüş bir bileşen: bayrak
// kapalıyken girdisi — dolayısıyla önbellek anahtarı — BAYT BAYT eskisi kalmalı. Satır gün hassasiyetinde (dakika yok).
// ---------------------------------------------------------------------------

const IST = "Europe/Istanbul";
const at = (iso: string) => new Date(iso);
const RES = { status: "confirmed", arrivalDate: "2026-09-26T00:00:00.000Z", departureDate: "2026-09-29T00:00:00.000Z" };

describe("understandingDateLine — saf", () => {
  it("rezervasyon biliniyor: bugün/yarın + giriş ve çıkış GÜNLERİ (hafta günüyle)", () => {
    const t = stayTimeline({ now: at("2026-09-25T09:00:00Z"), timeZone: IST, reservation: RES });
    expect(understandingDateLine(t, true)).toBe(
      "Today (property time zone): 2026-09-25 (Friday); tomorrow: 2026-09-26 (Saturday). " +
        "Guest's booking: check-in day 2026-09-26 (Saturday), check-out day 2026-09-29 (Tuesday).",
    );
  });

  it("bağlı rezervasyon yok (null) → açıkça söylenir", () => {
    const t = stayTimeline({ now: at("2026-09-25T09:00:00Z"), timeZone: IST, reservation: null });
    expect(understandingDateLine(t, true)).toMatch(/No booking is linked to this conversation\.$/);
  });

  it("🚨 rezervasyon BİLİNMİYOR (QR) → rezervasyon hakkında hiçbir şey yazılmaz ('yok' demek yanlış olurdu)", () => {
    const t = stayTimeline({ now: at("2026-09-25T09:00:00Z"), timeZone: IST, reservation: undefined });
    const line = understandingDateLine(t, false);
    expect(line).toBe("Today (property time zone): 2026-09-25 (Friday); tomorrow: 2026-09-26 (Saturday).");
    expect(line).not.toMatch(/booking/i);
  });

  it("iptal / onaysız rezervasyon işaretlenir (geçerli bir konaklama gibi sunulmaz)", () => {
    const now = at("2026-09-25T09:00:00Z");
    expect(understandingDateLine(stayTimeline({ now, timeZone: IST, reservation: { ...RES, status: "cancelled" } }), true)).toContain(
      "Guest's booking (CANCELLED — not a valid stay)",
    );
    expect(understandingDateLine(stayTimeline({ now, timeZone: IST, reservation: { ...RES, status: "pending" } }), true)).toContain(
      "Guest's booking (not confirmed yet)",
    );
  });

  it("🚨 GÜN hassasiyeti: aynı gün sabah ve akşam satır AYNI (önbellek anahtarı gün içinde sabit)", () => {
    const morning = understandingDateLine(stayTimeline({ now: at("2026-09-25T06:00:00Z"), timeZone: IST, reservation: RES }), true);
    const evening = understandingDateLine(stayTimeline({ now: at("2026-09-25T19:30:00Z"), timeZone: IST, reservation: RES }), true);
    expect(evening).toBe(morning);
    expect(morning).not.toMatch(/\d{1,2}:\d{2}/); // dakika / saat yazılmaz
  });

  it("gece yarısından sonra (05:00 öncesi) 'yarın' ipucu; bugün ORG diliminde (UTC'de hâlâ dün)", () => {
    // 2026-09-25T22:30Z = İstanbul 26 Eylül 01:30
    const line = understandingDateLine(stayTimeline({ now: at("2026-09-25T22:30:00Z"), timeZone: IST, reservation: RES }), true);
    expect(line.startsWith("Today (property time zone): 2026-09-26 (Saturday)")).toBe(true);
    expect(line).toContain(`a guest's "tomorrow" usually means today (2026-09-26)`);
    // 05:00'ten sonra ipucu yok.
    const after = understandingDateLine(stayTimeline({ now: at("2026-09-26T02:30:00Z"), timeZone: IST, reservation: RES }), true);
    expect(after).not.toContain("shortly after midnight");
  });
});

describe("buildUnderstandingUserContent — satır yalnız verildiğinde", () => {
  const base = { guestMessage: "Yarın 11'de gelebilir miyiz?", stayTimes: { checkIn: "15:00", checkOut: "11:00" } };

  it("🚨 satır yoksa içerik BAYT BAYT eskisi (undefined / null / boş aynı)", () => {
    const plain = buildUnderstandingUserContent(base);
    expect(buildUnderstandingUserContent({ ...base, dateLine: undefined })).toBe(plain);
    expect(buildUnderstandingUserContent({ ...base, dateLine: null })).toBe(plain);
    expect(buildUnderstandingUserContent({ ...base, dateLine: "" })).toBe(plain);
    expect(plain).not.toContain("Today (property time zone)");
  });

  it("satır mülk saatlerinin HEMEN ardında, bir kez", () => {
    const line = "Today (property time zone): 2026-09-25 (Friday); tomorrow: 2026-09-26 (Saturday).";
    const lines = buildUnderstandingUserContent({ ...base, dateLine: line }).split("\n");
    expect(lines[0]).toBe("Property standard check-in: 15:00; standard check-out: 11:00.");
    expect(lines[1]).toBe(line);
    expect(lines.filter((l) => l === line)).toHaveLength(1);
  });
});

describe("retrieveKbForPrompt — tarih satırının TEK karar noktası", () => {
  const spy = vi.mocked(understandGuestMessages);
  const call = (dateContext?: Parameters<typeof retrieveKbForPrompt>[0]["dateContext"]) =>
    retrieveKbForPrompt({ items: [], guestMessage: "Yarın 11'de gelebilir miyiz?", history: [], ...(dateContext ? { dateContext } : {}) });
  const ctx = { now: at("2026-09-25T09:00:00Z"), timeZone: IST, reservation: RES };

  beforeEach(() => spy.mockClear());
  afterEach(() => vi.unstubAllEnvs());

  it("🚨 bayrak KAPALI: bağlam verilse de katmana satır GİTMEZ (girdi bugünküyle birebir)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "");
    await call(ctx);
    expect(spy.mock.calls[0][0]).not.toHaveProperty("dateLine");
  });

  it("bayrak AÇIK: rezervasyon günleriyle satır gider", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    await call(ctx);
    expect(spy.mock.calls[0][0].dateLine).toBe(understandingDateLine(stayTimeline({ ...ctx }), true));
  });

  it("bayrak AÇIK + rezervasyon verilmedi (QR) → yalnız bugün/yarın; null → 'bağlı rezervasyon yok'", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    await call({ now: ctx.now, timeZone: IST });
    expect(spy.mock.calls[0][0].dateLine).not.toMatch(/booking/i);
    await call({ now: ctx.now, timeZone: IST, reservation: null });
    expect(spy.mock.calls[1][0].dateLine).toContain("No booking is linked");
  });

  it("bayrak AÇIK ama bağlam yok → satır yok; geçersiz dilim → varsayılan dilim (çökme yok)", async () => {
    vi.stubEnv("AI_CONVERSATION_STATE_ENABLED", "1");
    await call();
    expect(spy.mock.calls[0][0]).not.toHaveProperty("dateLine");
    await call({ now: ctx.now, timeZone: "Not/AZone", reservation: RES });
    expect(spy.mock.calls[1][0].dateLine).toContain("check-in day 2026-09-26");
  });
});
