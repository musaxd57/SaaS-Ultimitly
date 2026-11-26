import { describe, it, expect } from "vitest";
import {
  INTERNAL_NOTE_AUTHOR_MAX_CHARS,
  INTERNAL_NOTE_MAX_CHARS,
  canDeleteInternalNote,
  checkInternalNoteBody,
  internalNoteAuthorName,
  normalizeInternalNoteBody,
} from "@/lib/internal-notes/core";

// ---------------------------------------------------------------------------
// İÇ NOT — saf çekirdek (dilim D1): metin temizliği, 1.000 karakter sınırı (RET, kırpma yok), yazan adı kopyası, silme yetkisi.
// ---------------------------------------------------------------------------

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(0x7f);
const C1 = String.fromCharCode(0x85);

describe("iç not metni", () => {
  it("baş / son boşluk kırpılır; NUL ve denetim karakterleri silinir; satır sonu KALIR (CRLF / CR → LF); sekme boşluğa döner", () => {
    expect(normalizeInternalNoteBody(`  Misafir${NUL} aradı${BEL}\r\nyarın 10:00${DEL}\rgelir${C1}\t!  `)).toBe("Misafir aradı\nyarın 10:00\ngelir !");
  });

  it("boş ya da yalnız boşluk / denetim karakteri → 'empty'", () => {
    expect(checkInternalNoteBody("")).toEqual({ ok: false, reason: "empty" });
    expect(checkInternalNoteBody(" \n\t ")).toEqual({ ok: false, reason: "empty" });
    expect(checkInternalNoteBody(`${NUL}${BEL}`)).toEqual({ ok: false, reason: "empty" });
  });

  it("🚨 1.000 karakter: tam sınır kabul; 1.001 RET (kırpılmaz); sınır temizlikten SONRA sayılır", () => {
    const exact = "a".repeat(INTERNAL_NOTE_MAX_CHARS);
    expect(checkInternalNoteBody(exact)).toEqual({ ok: true, body: exact });
    expect(checkInternalNoteBody(`${exact}b`)).toEqual({ ok: false, reason: "too_long" });
    // Kenardaki boşluk ve denetim karakteri sayılmaz: temiz metin 1.000 ise kabul.
    expect(checkInternalNoteBody(`   ${exact}${NUL}   `)).toEqual({ ok: true, body: exact });
  });

  it("KONTROL: Türkçe metin ve satır içi boşluklar aynen kalır", () => {
    expect(checkInternalNoteBody("Kapıda söylendi: şemsiye   unutulmuş.\n\nYarın arayacak.")).toEqual({
      ok: true,
      body: "Kapıda söylendi: şemsiye   unutulmuş.\n\nYarın arayacak.",
    });
  });

});

describe("yazan adı kopyası", () => {
  it("tek satır, temiz, en çok 80 karakter; vekil çifti ortasından bölünmez", () => {
    expect(internalNoteAuthorName("  Ayşe\nYılmaz ")).toBe("Ayşe Yılmaz");
    const long = "x".repeat(INTERNAL_NOTE_AUTHOR_MAX_CHARS + 20);
    expect(internalNoteAuthorName(long)).toHaveLength(INTERNAL_NOTE_AUTHOR_MAX_CHARS);
    const emoji = `${"y".repeat(INTERNAL_NOTE_AUTHOR_MAX_CHARS - 1)}😀z`;
    const cut = internalNoteAuthorName(emoji);
    expect(cut).toBe("y".repeat(INTERNAL_NOTE_AUTHOR_MAX_CHARS - 1));
    expect(cut.length).toBeLessThanOrEqual(INTERNAL_NOTE_AUTHOR_MAX_CHARS);
  });
});

describe("silme yetkisi", () => {
  it("yazan kişi ve sahip siler; yönetici başkasının notunu silemez; yazanı bilinmeyen notu yalnız sahip siler", () => {
    expect(canDeleteInternalNote({ authorUserId: "u1" }, { userId: "u1", role: "manager" })).toBe(true);
    expect(canDeleteInternalNote({ authorUserId: "u1" }, { userId: "u2", role: "manager" })).toBe(false);
    expect(canDeleteInternalNote({ authorUserId: "u1" }, { userId: "u2", role: "owner" })).toBe(true);
    expect(canDeleteInternalNote({ authorUserId: null }, { userId: "u2", role: "manager" })).toBe(false);
    expect(canDeleteInternalNote({ authorUserId: null }, { userId: "u2", role: "owner" })).toBe(true);
    expect(canDeleteInternalNote({ authorUserId: "u1" }, { userId: "u1", role: "staff" })).toBe(true);
  });
});
