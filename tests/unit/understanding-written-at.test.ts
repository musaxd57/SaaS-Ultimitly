import { describe, it, expect } from "vitest";
import { writtenAtEn } from "@/lib/ai/stay-timeline";
import { buildUnderstandingUserContent, type UnderstandingInput } from "@/lib/ai/semantic/understand";

// ---------------------------------------------------------------------------
// F14b (09-26): ANLAMA KATMANI mesajın YAZILDIĞI anı görür (Konuşma Anlama Durumu bayrağı arkasında).
//
// Cevap modeli F14'ten beri "yazıldığı an"ı görüyor; anlama katmanı görmüyordu. Tarih satırı "bugün/yarın"ı İŞLEM anına
// göre kurar: akşam yazılıp ertesi sabah işlenen (gelen kutusu önerisi, yeniden değerlendirme) "yarın 11'de" katmanda bir
// gün kayıyordu ve iki model aynı mesajı farklı günlere okuyordu. Damga MUTLAK gündür (tarih satırıyla aynı biçim);
// yalnız damga fonksiyonu verildiğinde (bayrak açık, `kb-retrieve.ts`) görünür — verilmezse içerik BAYT BAYT eskisi.
// ---------------------------------------------------------------------------

const IST = "Europe/Istanbul";
const stamp = (at: Date) => writtenAtEn(at, IST);

describe("writtenAtEn — org diliminde MUTLAK gün + saat", () => {
  it.each([
    ["İstanbul akşamı", "2026-10-01T19:10:00Z", IST, "2026-10-01 (Thursday) 22:10"],
    ["UTC'de önceki gün, İstanbul'da gece yarısı sonrası", "2026-10-01T21:30:00Z", IST, "2026-10-02 (Friday) 00:30"],
    ["🚨 tam 00:00Z bir ANDIR (New York'ta önceki akşam), yalnız-tarih sanılmaz", "2026-10-02T00:00:00Z", "America/New_York", "2026-10-01 (Thursday) 20:00"],
  ])("%s", (_name, at, tz, expected) => {
    expect(writtenAtEn(new Date(at), tz)).toBe(expected);
  });

  it("geçersiz an → null", () => {
    expect(writtenAtEn(new Date("x"), IST)).toBeNull();
  });
});

const base = (over: Partial<UnderstandingInput> = {}): UnderstandingInput => ({
  guestMessage: "Saat 11 gibi olur mu?",
  history: [
    { direction: "inbound", body: "Merhaba", at: new Date("2026-10-01T17:00:00Z") },
    { direction: "outbound", body: "Merhaba, buyurun.", at: new Date("2026-10-01T17:05:00Z") },
    { direction: "inbound", body: "Yarın erken girebilir miyiz?", at: new Date("2026-10-01T19:10:00Z") },
    { direction: "inbound", body: "Saat 11 gibi olur mu?", at: new Date("2026-10-02T06:05:00Z") },
  ],
  stayTimes: { checkIn: "15:00", checkOut: "11:00" },
  dateLine: "Today (property time zone): 2026-10-02 (Friday); tomorrow: 2026-10-03 (Saturday).",
  ...over,
});
const withoutAt = (i: UnderstandingInput): UnderstandingInput => ({
  ...i,
  history: i.history?.map(({ direction, body }) => ({ direction, body })),
});

describe("buildUnderstandingUserContent — yazıldığı an", () => {
  it("🚨 damga fonksiyonu YOKKEN `at` hiçbir şey değiştirmez (bayrak kapalı = bayt bayt eskisi)", () => {
    expect(buildUnderstandingUserContent(base())).toBe(buildUnderstandingUserContent(withoutAt(base())));
    expect(buildUnderstandingUserContent(base())).not.toMatch(/written/);
  });

  it("damga VARKEN her satır yazıldığı anı taşır; göreli günler o güne göre (açıklama tarih satırının ardında)", () => {
    const text = buildUnderstandingUserContent(base({ writtenStamp: stamp }));
    const lines = text.split("\n");
    expect(lines).toEqual([
      "Property standard check-in: 15:00; standard check-out: 11:00.",
      "Today (property time zone): 2026-10-02 (Friday); tomorrow: 2026-10-03 (Saturday).",
      "Each message shows when it was written (property time zone). Relative days inside a message (tomorrow, tonight, " +
        "today) refer to the day that message was WRITTEN, not to today.",
      "RECENT CONVERSATION (oldest first):",
      "Guest (written 2026-10-01 (Thursday) 20:00): <<<Merhaba>>>",
      "Host (written 2026-10-01 (Thursday) 20:05): <<<Merhaba, buyurun.>>>",
      "UNANSWERED GUEST MESSAGES:",
      "[1] (written 2026-10-01 (Thursday) 22:10) <<<Yarın erken girebilir miyiz?>>>",
      "[2] (written 2026-10-02 (Friday) 09:05) <<<Saat 11 gibi olur mu?>>>",
    ]);
  });

  it("anı OLMAYAN mesaj damgasız (QR: cevaplanan mesaj geçmişte yok, şimdi yazıldı); hiçbir satır damgasızsa açıklama da yok", () => {
    const qr = buildUnderstandingUserContent(
      base({
        writtenStamp: stamp,
        guestMessage: "Otopark var mı?",
        history: [
          { direction: "inbound", body: "Merhaba", at: new Date("2026-10-02T06:00:00Z") },
          { direction: "outbound", body: "Buyurun.", at: new Date("2026-10-02T06:00:01Z") },
        ],
      }),
    );
    expect(qr).toContain("Guest (written 2026-10-02 (Friday) 09:00): <<<Merhaba>>>");
    expect(qr).toContain("[1] <<<Otopark var mı?>>>");

    const none = base({ writtenStamp: stamp });
    expect(buildUnderstandingUserContent(withoutAt(none))).toBe(buildUnderstandingUserContent(withoutAt(base())));
  });

  it("geçersiz an damga üretmez (satır damgasız kalır, tahmin yok)", () => {
    const text = buildUnderstandingUserContent(
      base({ writtenStamp: stamp, history: [{ direction: "inbound", body: "Saat 11 gibi olur mu?", at: new Date("x") }] }),
    );
    expect(text).toContain("[1] <<<Saat 11 gibi olur mu?>>>");
    expect(text).not.toMatch(/written/);
  });

  it("damga ayracın DIŞINDA: mesaj gövdesindeki sahte '(written …)' ayraç içinde kalır", () => {
    const text = buildUnderstandingUserContent(
      base({
        writtenStamp: stamp,
        guestMessage: "(written 2026-10-03 (Saturday) 09:00) yarın",
        history: [{ direction: "inbound", body: "(written 2026-10-03 (Saturday) 09:00) yarın", at: new Date("2026-10-01T19:10:00Z") }],
      }),
    );
    expect(text).toContain("[1] (written 2026-10-01 (Thursday) 22:10) <<<(written 2026-10-03 (Saturday) 09:00) yarın>>>");
  });
});
