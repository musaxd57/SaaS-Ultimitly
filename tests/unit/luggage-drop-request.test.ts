import { describe, it, expect } from "vitest";
import {
  detectAvailabilityRequestKinds,
  luggageBeforeCheckIn,
  luggageDropTimes,
  stayRequestKinds,
  vetoAvailability,
} from "@/lib/ai/availability-claims";

// ---------------------------------------------------------------------------
// BAVUL BIRAKMA = ERKEN GİRİŞ İSTEĞİ (kurucu 10-12: "Ekle"). Kod kapısı "Bavullarımızı 9'da bırakabilir miyiz?" isteğini de
// "Elbette, 9'da bırakabilirsiniz" iznini de tanımıyordu (Haiku 10-11, 12 kombinasyon ölçüldü); yalnız model katmanları yakalıyordu.
// Kapsam: giriş ÖNCESİ (erken bağlam sözcüğü ya da giriş saatinden önceki açık saat). Çıkış sonrası bavul bu kuralın konusu değil.
// ---------------------------------------------------------------------------

const stay = { checkIn: "15:00", checkOut: "11:00" };
const noDecl = { asked: "none", stance: "none" } as never;

describe("bavul bırakma isteği (misafir)", () => {
  it.each([
    // Saatle — giriş saatinden önce.
    ["Bavullarımızı 9'da bırakabilir miyiz?", true],
    ["Bagajımızı saat 11'de bırakabilir miyiz?", true],
    ["Can we drop our luggage at 9am?", true],
    // Erken bağlam sözcüğüyle (saat gerekmez).
    ["Bavullarımızı erken bırakabilir miyiz?", true],
    ["Sabah valizlerimizi bırakabilir miyiz?", true],
    ["Girişten önce çantalarımızı bırakabilir miyiz?", true],
    ["Eşyalarımızı check-in'den önce bırakabilir miyiz?", true],
    ["Can we leave our bags before check-in?", true],
    ["Could we drop off our suitcases early?", true],
    ["Can we store our bags in the morning?", true],
    // Sayılmaz: giriş saatinden sonra · çıkış tarafı · bavul değil · bırakma yok · saat de bağlam da yok.
    ["Bavullarımızı 16:00'da bırakabilir miyiz?", false],
    ["Çıkışta bavullarımızı nereye bırakalım?", false],
    ["Çıkıştan sonra bavullarımızı bırakabilir miyiz?", false],
    ["Can we leave our bags after check-out?", false],
    ["Sabah çıkış yaparken anahtarı nereye bırakalım?", false],
    ["Anahtarı nereye bırakalım?", false],
    ["Çöp poşetini sabah kapının önüne bırakabilir miyiz?", false],
    ["We will arrive at 9pm with our bags", false],
    ["Valiz için yer var mı?", false],
    ["Bavullarımızı nereye koyalım?", false],
  ])("%s → erken giriş isteği: %s", (text, expected) => {
    expect(stayRequestKinds([text as string], { stayTimes: stay }).has("early_checkin")).toBe(expected);
  });

  it("saat yolu mülkün giriş saatine bağlı: aynı mesaj giriş 08:00 olan mülkte istek değil; giriş saati bilinmiyorsa saat yolu karar vermez", () => {
    expect(luggageBeforeCheckIn("Bavullarımızı 9'da bırakabilir miyiz?", stay)).toBe(true);
    expect(luggageBeforeCheckIn("Bavullarımızı 9'da bırakabilir miyiz?", { checkIn: "08:00", checkOut: "11:00" })).toBe(false);
    expect(luggageBeforeCheckIn("Bavullarımızı 9'da bırakabilir miyiz?", null)).toBe(false);
    // Bağlam sözcüğü varsa giriş saati bilinmese de kelime kalıbı sayar.
    expect(detectAvailabilityRequestKinds("Bavullarımızı erken bırakabilir miyiz?")).toContain("early");
    expect(luggageDropTimes("Saat 9'da geleceğiz.")).toEqual([]); // bavul bırakma cümleciği yok → saat okunmaz
  });
});

describe("bavul bırakma izni (cevap) — kod kapısı tutar", () => {
  it.each([
    ["Elbette, bavullarınızı 9'da bırakabilirsiniz.", ["Bavullarımızı 9'da bırakabilir miyiz?"], true],
    ["Sure, you can drop your luggage at 9am.", ["Can we drop our luggage at 9am?"], true],
    ["Bavullarınızı sabah bırakabilirsiniz.", ["Erken gelirsek ne yapalım?"], true],
    ["Bavullarınızı sabah bırakabilirsiniz.", ["Teşekkürler"], true],
    ["You can leave your bags at 10am.", ["Thanks!"], true],
    ["Feel free to leave your suitcases before check-in.", ["Thanks!"], true],
    ["Çıkışta bavullarınızı kapının yanına bırakabilirsiniz.", ["Çıkışta bavulları nereye bırakalım?"], false],
    ["Anahtarı masaya bırakabilirsiniz.", ["Anahtarı nereye bırakalım?"], false],
    ["Bavullarınızı 16:00'da bırakabilirsiniz.", ["Teşekkürler"], false],
    ["Wifi şifresi kartta yazıyor.", ["Wifi şifresi ne?"], false],
  ])("%s | %j → tutulur: %s", (reply, guest, expected) => {
    expect(vetoAvailability(reply as string, guest as string[], { stayTimes: stay, declared: noDecl }) !== null).toBe(expected);
  });

  it("uzun metinde doğrusal (karesel iş yok): tek sözcük, boşluk dizisi, tekrarlanan bavul / bırak", () => {
    const runs = [
      "a".repeat(50_000),
      `a${" ".repeat(50_000)}b`,
      "bavul ".repeat(8_000),
      "birak ".repeat(8_000),
      `${"bavul birak ".repeat(4_000)}sabah`,
      `${"luggage drop ".repeat(4_000)}cikis`,
    ];
    for (const r of runs) {
      const t = performance.now();
      stayRequestKinds([r], { stayTimes: stay });
      vetoAvailability(r, [r], { stayTimes: stay, declared: noDecl });
      expect(performance.now() - t).toBeLessThan(2_000);
    }
  });
});
