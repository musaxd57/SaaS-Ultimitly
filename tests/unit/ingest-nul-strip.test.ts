import { describe, it, expect } from "vitest";
import { canonicalStr } from "@/lib/channels/ingest";
import { givenNameForStorage } from "@/lib/guest-name-source";

// ---------------------------------------------------------------------------
// NUL KARAKTERİ SAĞLAYICI VERİSİNDEN SİLİNİR (09-28 inceleme ajanı, migration 57 turu). PostgreSQL `text` NUL (U+0000)
// saklayamaz: sağlayıcı bir adı ya da mesaj gövdesini NUL ile gönderirse o rezervasyonun yazması HER senkronda düşüyor,
// tarih / durum değişiklikleri güncellenmiyor ve konuşma bağsız içeri alınıyordu. `canonicalStr` sağlayıcı dizelerinin tek
// girişi (ad, hitap adı, mesaj gövdesi, kod); NUL'dan başka hiçbir karaktere dokunmaz.
// ---------------------------------------------------------------------------

describe("canonicalStr — NUL silinir, başka hiçbir şey değişmez", () => {
  it("🚨 NUL taşıyan dize veritabanına yazılabilir biçime iner", () => {
    expect(canonicalStr("Ay\u0000şe")).toBe("Ayşe");
    expect(canonicalStr("Merhaba\u0000\u0000 kapı kodu?")).toBe("Merhaba kapı kodu?");
    expect(canonicalStr("\u0000")).toBeNull(); // yalnız NUL = boş
  });

  it("KONTROL — NUL dışı içerik bayt bayt aynı (boşluk, sekme, satır sonu, emoji)", () => {
    for (const s of ["Ayşe Yılmaz", " başta boşluk ", "a\tb\nc", "👋 Merhaba", "​görünmez"]) {
      expect(canonicalStr(s)).toBe(s);
    }
    expect(canonicalStr("")).toBeNull();
    expect(canonicalStr(42)).toBeNull();
  });
});

describe("givenNameForStorage — NUL'lu hitap adı", () => {
  it("🚨 NUL silinir; yalnız NUL / boşluk ise ad yok", () => {
    expect(givenNameForStorage("Al\u0000ex")).toBe("Alex");
    expect(givenNameForStorage(" \u0000 ")).toBeNull();
  });
});
